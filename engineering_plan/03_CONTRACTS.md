# 03 · 系统契约（宪法文件）

> 本文件中的代码在 P0-T05/T07 落盘到 `src/astr/contracts/`。落盘后**本文件与代码同步修改**，否则以代码为准并视为文档 bug。
> Schema 演进规则：只许加可选字段，不许改名/删字段；破坏性变更必须升 `SCHEMA_VERSION` 大版本并写迁移脚本。

## 1. 事件契约（`contracts/events.py`）

所有跨层通信走 Redis Streams，stream key = `astr:events`，按 `type` 前缀过滤。

```python
"""ASTR 事件契约。SCHEMA_VERSION = "1.0"。"""
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any, Literal
from pydantic import BaseModel, Field
from ulid import ULID  # uv add python-ulid

SCHEMA_VERSION = "1.0"

class EventType(StrEnum):
    USER_UTTERANCE = "user.utterance"        # 用户说话（任何平台/语音）
    SYSTEM_EVENT = "system.event"            # 日历/邮件/温度等环境事件
    AGENT_THOUGHT = "agent.thought"          # 思考过程片段（给网页 SSE）
    MOA_REPORT = "moa.report"                # 智囊团结构化分析
    SOUL_DECISION = "soul.decision"          # 灵魂层最终决断（要说/要做什么）
    EFFECTOR_ACTION = "effector.action"      # 执行层动作意图
    EFFECTOR_RESULT = "effector.result"      # 动作结果 + 截图引用
    PRESENTATION_TTS = "presentation.tts"    # 待合成语音文本 + emotion_tag
    PRESENTATION_LIVE2D = "presentation.live2d"  # 表情/动作意图
    PRESENTATION_EXPRESS = "presentation.express"  # 平台无关"表达意图"(text/sticker/voice/poke...)，见 05 §2
    TRAIN_SAMPLE = "train.sample"            # 沉淀的训练样本
    HEARTBEAT_TICK = "heartbeat.tick"        # 心跳触发
    SAFETY_ALERT = "safety.alert"            # 护栏告警

class AuthContext(BaseModel):
    astr_user_id: str                        # "jacksky" 是唯一 L2+ 用户
    level: Literal[0, 1, 2, 3]
    verified_by: list[str] = []              # ["voiceprint", "telegram_id"]

class Event(BaseModel):
    id: str = Field(default_factory=lambda: f"evt_{ULID()}")
    ts: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    schema_version: str = SCHEMA_VERSION
    source: str                              # "sensor.voice" / "soul.orchestrator" / ...
    type: EventType
    payload: dict[str, Any]                  # 各类型的 payload 模型见同文件下方
    auth: AuthContext
    trace_id: str                            # 同一条因果链共享；入口处生成 f"trc_{ULID()}"
```

每个 `EventType` 配一个 payload Pydantic 模型（如 `UserUtterancePayload(text, platform, lang, audio_ref)`），P0-T05 一并落盘，此处从略——**字段一旦上线只加不改**。

**唯一在此明确的 payload：`presentation.express`**（灵魂层从此只产出平台无关的"表达意图"，由各平台 adapter 翻译；因被 P1-W6/P5-W2 多张任务卡引用，故在此落盘，详见 05 §2/§3）：

```python
class ExpressChannel(BaseModel):
    """一条表达通道。kind 决定其余字段语义；平台不支持该 kind 时 adapter 降级到 fallback_text。"""
    kind: Literal["text", "sticker", "voice", "face",
                  "poke", "reply", "image", "reaction", "forward", "file"]
    content: str | None = None     # text 主体 / face 的 id 等
    emotion: str | None = None     # sticker 选择用情绪标签（见 05 §4）
    context: str | None = None     # sticker 选择用语境
    ref: str | None = None         # voice/image/file 资源引用，如 "tts://..."
    target: str | None = None      # poke/at 目标（astr_user_id 或平台 id）
    to_msg_id: str | None = None   # reply 锚定的消息 id
    fallback_text: str = ""        # 平台不支持该 kind 时的降级文本（永不丢消息）

class ExpressPayload(BaseModel):
    """type == presentation.express 的 payload。channels 按序发送，可多通道。"""
    channels: list[ExpressChannel]
    platform_hint: str | None = None  # "qq"/"wechat"/...；None = 由 orchestrator 当前会话决定
```

`PlatformAdapter.render(ExpressPayload) -> list[Segment]` 的契约见 05 §2：缺失能力自动降级，**永不丢消息**。

**`effector.action` / `effector.result` 的 payload**（P2 执行层；契约先于实现，`guard.py` 与 `cu_engine.py` 都按它走）：

```python
class EffectorAction(BaseModel):
    """type == effector.action。每一步动作意图，落 CBG + hash 链审计日志。"""
    action_id: str
    tool: str                       # "mcp.filesystem.read" / "browser.click" / "cu.click" / ...
    args: dict[str, Any]
    risk: Literal[0, 1, 2, 3]       # 权限级别；3 须经 guard 的 L3 流程（声纹+弹窗）才放行
    rationale: str                  # 为什么做这一步（进 causal_behavior_graph）
    untrusted_refs: list[str] = []  # 本步依据的不可信内容来源 id（注入审计，见 05 §7 / guard_policy）

class EffectorResult(BaseModel):
    """type == effector.result。"""
    action_id: str
    ok: bool
    screenshot_ref: str | None = None
    output_digest: str | None = None
    error: str | None = None
```

不变量：危险动作（`risk==3`）未经 L3 不得产出 `effector.action`；每个动作前后必须写 hash 链审计日志（P2-W1）。

## 2. SoulPackage 契约（`contracts/soul.py`）

目录结构沿用总规 §2.8.2 全量（identity / identity_atlas / causal_behavior_graph / memory / preferences / behavior_capsules / skills / world / continuity_proofs / embodiment），P0 只需建骨架 + 校验器。核心模型：

```python
class SoulManifest(BaseModel):
    """soul_package/justin/manifest.yaml —— 灵魂包的户口本。"""
    soul_name: str = "justin"    # 内部句柄（路径/版本前缀，稳定不变，类比 username）
    display_name: str = "露怀秋"  # 她的名字
    nickname: str = "秋秋"        # 小名
    soul_version: str            # "justin-2026.06.12-0.1.0"（语义化版本，总规 §2.8.7）
    schema_version: str = "1.0"
    created_at: datetime
    current_embodiment: str      # 当前躯壳 adapter 名，如 "prompt_boot:qwen3-8b-q4"
    embodiment_history: list[EmbodimentRecord] = []

class EmbodimentRecord(BaseModel):
    adapter: str                 # "prompt_boot:qwen3-8b-q4"
    started_at: datetime
    ended_at: datetime | None = None
    sci_report_ref: str | None = None   # continuity_proofs/sci_reports/xxx.json

class Constitution(BaseModel):
    """identity/constitution.yaml —— 不可变价值观，每条带稳定 ID。"""
    rules: list[ConstitutionRule]        # id, text, immutable: bool

class DecisionTrace(BaseModel):
    """causal_behavior_graph/decisions.cbg.jsonl 的一行 —— CBG-lite（见 99 号文档 #4）。
    P1 起每次 soul.decision 自动落一条；这是机制级传承的原始矿藏，越早积累越值钱。"""
    id: str
    ts: datetime
    trace_id: str
    context_digest: str                  # 输入情境摘要
    candidates: list[Candidate]          # 每个候选: content_digest, rejected_reason | None
    chosen: int                          # 选中的候选下标
    reasoning: str                       # 决断理由（模型自述）
    moa_report_ref: str | None = None
```

**硬性不变量（CI 强制）**：
1. `soul_package/` 内禁止出现 `*.safetensors|*.gguf|*.bin|*.pt|*.onnx`。
2. 所有文件必须是 UTF-8 文本、开放格式（json/jsonl/yaml/md/parquet/graphml/png/wav）。
3. `astr soul validate`（P0-T05 的 CLI）必须随时通过：检查 manifest、schema 版本、目录完整性。
4. 向量库（Chroma）不在 soul_package 内——它是 `embodiments/runtime_cache/` 的派生缓存，原始 chunk 文本在 `memory/chunks/`。

## 3. EmbodimentAdapter 契约（`contracts/adapter.py`）

接口沿用总规 §2.8.5 的四方法（`cold_boot` / `derive_weights` / `evaluate_continuity` / `export_soul_delta`），补充工程化定义：

```python
class InferenceHandle(BaseModel):
    """cold_boot 的返回——上层只拿到一个 OpenAI 兼容端点 + 注入说明。"""
    endpoint: str                # "http://127.0.0.1:8080/v1" 或 LiteLLM 模型名
    model_name: str
    system_prompt: str           # 已注入身份叙事/宪法/风格的完整 system prompt
    rag_collection: str          # Chroma collection 名
    adapter_name: str

class ContinuityReport(BaseModel):
    sci: float
    p_continuity: float          # 人格连续性
    m_completeness: float        # 记忆完整性
    c_retention: float           # 能力保留度
    d_consistency: float         # 决策一致性
    details_ref: str             # eval_reports/ 下完整报告路径
```

**v1 实现的三个 Adapter**（`src/astr/adapters/`）：

| Adapter | Phase | 说明 |
|---------|-------|------|
| `PromptBootAdapter` | P0 | 零微调：narrative+constitution+voice_profile → system prompt；memory/chunks → Chroma RAG。`derive_weights` 直接 raise NotImplementedError。**它就是总规说的最简 TransformerLoRAAdapter v0，改名以诚实反映行为** |
| `PromptOnlyAdapter` | P1 | 同上但 endpoint 指向云 API（经 ModelRouter）。露怀秋 的不宕机保险 + Computer Use 分时期间的代班躯壳 |
| `TransformerLoRAAdapter` | P4 | 真正实现 `derive_weights`：调云训练管线产出 LoRA，本地 llama.cpp 挂载 |

## 4. ModelRouter 契约（`contracts/router.py` + `src/astr/router/`）

```python
class RouteRequest(BaseModel):
    task: str                    # "emotion_analysis" / "soul_reply" / "intent" / "roundtable.critic" ...
    messages: list[dict]
    cost_tier: Literal["free", "cheap", "balanced", "max"] = "balanced"
    require_local: bool = False  # True = 隐私敏感，禁止出网（如涉及屏幕内容）
    timeout_s: int = 30
    trace_id: str
```

实现规则：
1. 底层全部走 LiteLLM（`litellm.acompletion`），模型名/参数由 `router/routes.yaml` 配置表决定，**代码里不出现具体模型名**。
2. 每次调用写成本账本：SQLite 表 `api_ledger(ts, trace_id, task, model, tokens_in, tokens_out, cost_usd)`。
3. **每日预算闸**：`.env` 里 `ASTR_DAILY_BUDGET_USD=5`。当日累计达 80% → 自动全员降一档 tier 并发 `safety.alert`；达 100% → 只剩 `free`（本地模型）+ 白名单任务。
4. fallback 链在 routes.yaml 声明，按序重试，全失败则降级到本地模型并标记 `degraded=true`。

`routes.yaml` 初始内容（P0-T04 落盘）：

```yaml
tasks:
  soul_reply:        { free: local-qwen3-8b, cheap: local-qwen3-8b, balanced: local-qwen3-8b, max: claude-sonnet }
  emotion_analysis:  { cheap: deepseek-chat, balanced: claude-haiku, max: claude-sonnet }
  logic_analysis:    { cheap: deepseek-chat, balanced: gpt-mini-tier, max: gpt-flagship }
  retrieval_analysis:{ cheap: deepseek-chat, balanced: gemini-flash, max: gemini-pro }
  intent:            { free: local-qwen3-8b }
  scoring:           { cheap: deepseek-chat, balanced: claude-haiku }   # 凌晨批量评分
models:   # LiteLLM 模型名映射，唯一允许出现具体模型 ID 的地方
  local-qwen3-8b: { litellm: "openai/qwen3-8b", api_base: "http://127.0.0.1:8080/v1" }
  claude-sonnet:  { litellm: "anthropic/claude-sonnet-4-6" }
  # ... 其余开工时按当时最新型号填
```

> MoA 路由策略（总规 §2.3.1）在此落地为：短消息（<20 字）→ 仅 `emotion_analysis@cheap`；中等 → emotion+logic 双路；长消息/学术 → 四路全开 @balanced。判定逻辑在 `soul/moa.py`，阈值进 `.env`。

## 5. 内部 API 端点（ASTR Core 守护进程, FastAPI, `:8300`）

| 端点 | 用途 |
|------|------|
| `POST /v1/ingest` | 注入一条 user.utterance（平台桥/调试用） |
| `GET /v1/stream` | SSE：agent.thought / soul.decision 实时流（网页用） |
| `GET /v1/status` | 当前躯壳、情绪向量、显存占用、当日 API 花费 |
| `POST /v1/soul/validate` | 触发 soul validate |
| `GET /v1/golden/run` | 跑金标集，返回报告 ref |

端口分配锁定：llama.cpp `:8080` / ASTR Core `:8300` / Agent 网页 dev `:3100`（`:3000` 被本机「民间科学」站占用，故改 3100）/ SillyTavern `:8000` / Redis `:6379`。
