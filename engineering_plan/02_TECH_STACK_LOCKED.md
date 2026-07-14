# 02 · 锁定技术栈与仓库规范

> 本文件是宪法之一。改动任何"锁定"项需要在 diary.md 写明理由并升版本号。

## 1. 锁定技术栈

| 层 | 选型 | 版本策略 |
|----|------|---------|
| 语言 | Python 3.11.x（核心系统）/ TypeScript（Agent 网页） | 3.11 锁死到 P6（生态兼容性最稳） |
| 包管理 | **uv**（取代 pip/poetry） | 最新稳定版 |
| 数据校验 | **Pydantic v2** | SoulPackage schema 的唯一定义方式 |
| LLM 网关 | **LiteLLM**（Python SDK 方式嵌入，不起独立 proxy） | ModelRouter 的底座 |
| 本地推理 | llama.cpp `llama-server`（OpenAI 兼容端点 `:8080/v1`） | 每月评估升级一次，不追 daily build |
| 事件总线 | **Redis Streams**（Docker: `redis:7-alpine`） | 消费组按层命名：`cg.soul` / `cg.effector` / `cg.presentation` / `cg.train` |
| 结构化存储 | SQLite（`ops/astr.db`，WAL 模式）——事件归档、成本账本、训练队列 | 不引入 Postgres，P6 再议 |
| 向量库 | **ChromaDB**（嵌入式模式，persist 到磁盘） | 原始文本永远存 SoulPackage，向量可随时重建 |
| 图记忆 | NetworkX + GraphML 落盘（`memory/relations.graphml`） | 不引入 Neo4j |
| Web 框架（内部 API） | FastAPI + uvicorn | ASTR Core 守护进程 |
| 前端 | Next.js 15 + React 19 + Tailwind + Zustand + pixi-live2d-display | P1-W10 才开工 |
| 日志 | **structlog**（JSON 行格式，按天切文件到 `ops/logs/`），全链路携带 `trace_id` | |
| 测试 | pytest + pytest-asyncio；金标集评估器是一等公民测试 | |
| 代码质量 | ruff（lint+format）+ pre-commit | |
| CI | GitHub Actions：ruff + pytest + **soul-purity 检查**（soul_package 内禁权重文件） | |
| 容器 | Docker Desktop (WSL2 backend)，仅用于：Redis、SillyTavern、未来 Tectonic | 给 WSL2 设 `.wslconfig` 内存上限 8GB |
| 秘钥 | `.env`（gitignore）+ `python-dotenv`；**所有 key 只在 ModelRouter 进程读取** | 永不进代码/日志 |

## 2. 仓库与磁盘布局（锁定）

代码仓库（git，建议 `D:\ASTR_System\astr\`）：

```
astr/
├── pyproject.toml              # uv 管理；包名 astr
├── .env.example                # 全部配置键的模板（含注释）
├── .pre-commit-config.yaml
├── .github/workflows/ci.yml
├── src/astr/
│   ├── contracts/              # ★ 03 号文档的代码落盘处（events.py / soul.py / adapter.py）
│   ├── bus/                    # Redis Streams 封装（publish / subscribe / replay）
│   ├── router/                 # ModelRouter（LiteLLM 封装 + tier 策略 + 成本账本）
│   ├── soul/                   # SoulOrchestrator / MoA / 心跳引擎 / 圆桌调度器
│   ├── memory/                 # SoulPackage 读写 / Chroma 检索 / 图记忆
│   ├── adapters/               # EmbodimentAdapter 实现（prompt_boot / transformer_lora / prompt_only）
│   ├── sensors/                # 语音管线 / 平台网关桥（AstrBot 插件在独立目录）
│   ├── effector/               # P2：MCP 客户端 / CU 引擎 / 安全护栏
│   ├── presentation/           # TTS 调度 / Live2D 事件出口
│   └── ops/                    # 评估器 / 金标集 runner / 备份 / 自检脚本
├── tests/
├── webapp/                     # Next.js（P1-W10 起）
└── scripts/                    # 一次性脚本与云训练 train.sh
```

数据磁盘布局（**不在代码仓库内**，按总规 §3.3，路径锁定 `D:\ASTR\`）：

```
D:\ASTR\
├── soul_package\justin\        # ★ 真身。独立 git 仓库。结构见 03_CONTRACTS §2
├── embodiments\                # 躯壳产物：base_models / derived_weights / runtime_cache
├── effector\logs\              # 动作审计日志（hash 链）
└── ops\                        # golden_set / eval_reports / migration_logs / logs / astr.db / diary.md
```

> Windows 注意：路径统一用 `pathlib.Path`，配置里写 `D:/ASTR` 正斜杠形式；所有文件 IO 显式 `encoding="utf-8"`。

## 3. 编码规范（执行 AI 强制遵守）

1. 全部函数带 type hints；公共函数带一行式 docstring（说明"为什么"而非"是什么"）。
2. 异步优先：总线消费、API 调用全部 async；CPU 密集（嵌入、音频）丢线程池。
3. 模块间只许 import `contracts/`——`soul/` 不许 import `effector/` 的内部实现，跨层只走事件总线。这是五层解耦的代码级执行。
4. 每个对外行为（发消息、动鼠标、花钱调 API、写 SoulPackage）必须写一条 structlog 日志，含 `trace_id`、`event_type`、关键参数。
5. 配置只从环境变量/`.env` 读，统一经 `astr.contracts.settings.Settings`（Pydantic Settings）。代码里出现裸 `os.environ` 视为 bug。
6. 凡是"花钱"的调用（云 API）必须经过 ModelRouter——任何模块直接 import openai/anthropic SDK 视为 P0 bug。

## 4. Windows 专项注意事项

- llama.cpp 用官方 CUDA 预编译包（`llama-bxxxx-bin-win-cuda-x64.zip`），不自己编译。
- 音频采集用 `sounddevice`（PortAudio），不用 pyaudio。
- Computer Use（P2）：pyautogui + pygetwindow + mss 在 Windows 原生工作良好；管理员权限窗口无法被普通进程控制——这天然是一道安全边界，记入护栏文档。
- 开机自启用「任务计划程序」注册 `astr-core` 守护进程，不做 Windows 服务（调试太痛苦）。
- 杀毒软件会拦 pyautogui 键鼠注入：开发期把 Python 解释器加白名单。
