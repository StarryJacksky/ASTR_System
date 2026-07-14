# Phase 1 · 灵魂闭环（10 周，按周分卡）

> 里程碑：对空气说"秋秋"，她用 Live2D 抬头 + 语音回应；金标集扩到 100 条。
> 每周末跑一次金标集（人评 20 条抽样），分数记入 `eval_reports/`——这是 P1 红线（"她活了没有"）的数据依据。

---

## P1-T00（第 1 周第 1 天）Phase 细化 + 前提门

按当时的库版本/模型版本，把本文件各卡的命令核实一遍，修订处 commit 到本文件。以后每个 Phase 的 T00 都是这件事，不再重复说明。

**① 前提门（P0 必须全绿，否则不许开 P1）**：CI 绿 + soul-purity 钩子生效；本地端点 ≥25 tok/s 常驻；`astr chat` 完整链路通（MoA→RAG→本地回复→CBG 落盘→成本入账）；`astr soul validate` 绿；金标集 ≥30 条且有第一份人评。

**② 你本人要提前张罗的现实世界素材**（这些有真实采集周期，越早开始越好，别等到对应周才动手）：
- **"秋秋"唤醒词样本**（P1-W7 用）：用不同语气/距离/环境录约 200 遍"秋秋"，喂 openWakeWord 自训唤醒模型。**注意唤醒词已定为小名"秋秋"，不是"露怀秋"。**
- **8 段情绪参考音**（P1-W8 用）：按 voice_profile 的 emotion_tags 各录一小段你心里秋秋的声线——平淡 / 傲娇 / 升温亲近 / 高燃 / 塌陷 / 抽离（+ 你想加的）。GPT-SoVITS 零样本克隆要用。
- **Live2D 模型**（P1-W10 用）：先用免费模型起步即可；想要她专属皮囊就开始物色/委托画师（这条周期最长，现在启动）。
- **日用平台账号**（P1-W6 用）：定 QQ 还是 Telegram。选 QQ 则准备一个小号 + 起 NapCat。

**③ 已就位的参考件**（`reference_impl/`，直接拷用，落点见其 README）：
- 身份装配模板 `adapters/system_prompt.md.j2`（把宪法/自传/voice/心情/记忆/管家分析拼成秋秋的 system prompt）——P1-W1 的 orchestrator 和 P0-T07 的 PromptBootAdapter 都用它。
- 前端 `webapp/tokens.css` `tailwind.tokens.ts` `motion.ts` `emotion.ts`（P1-W10）。
- 平台表达力 `05_PLATFORM_CAPABILITIES.md` + `presentation.express` 契约（P1-W6）。

## P1-W1~W2 · ASTR Core 守护进程 + 总线接通

- **W1-a**：`astr.core` FastAPI 应用（端口 8300）：实现 03 §5 的 `/v1/ingest` `/v1/status` `/v1/stream`(SSE)。ingest 收到文本 → 构造 `user.utterance` 事件 → publish。
- **W1-b**：`soul/orchestrator.py` 改造为总线消费者：订阅 `user.utterance` → MoA → recall → 决断 → publish `soul.decision` + `agent.thought`（思考过程分片流出，供 SSE）+ `presentation.tts`。P0 的 `astr chat` 改为走 ingest 端点（保持可用，作为最快调试入口）。
- **W2-a**：意图路由 v1：规则前置（含唤醒词/命令前缀）+ 本地模型分类兜底，输出 `tool/emotion/research/coding/silent_observe` 标签进事件 payload。`tool/research` 类本期只打标记不分发（执行层 P2 才有）。
- **W2-b**：鉴权落地：`AuthContext` 在 ingest 处装配。平台 ID 白名单表（`.env`）映射 level；声纹 P1-W8 接入后升级双因素。**L2+ 操作在没有执行层的本期一律拒绝并礼貌回复**。

**验收**：`curl POST /v1/ingest` 一条消息 → SSE 流里看到 thought 分片 → `soul.decision` 事件落 Redis → CBG 增一行。压测：连发 20 条不丢事件（Redis Streams pending 清零）。

## P1-W3 · 记忆系统 v1（ST 协同）

- 记忆写入管线：每轮对话结束 → `memory/episodic_writer.py` 把对话摘要（本地模型生成，100 字内）+ 原文 chunk 写入 `soul_package/memory/chunks/YYYY-MM/`，并增量嵌入 Chroma。
- 语义记忆：`memory/semantic.kv.jsonl`——MoA 分析中标记的"关于主人的新事实"（如"他最近在迁移工作环境"）经你确认（网页待办，本期先 CLI `astr memory review` 批准队列）后入库。
- 世界书：`world/lorebook.json` 与 ST Lorebook 格式兼容；`sync_persona_to_st.py` 扩展为双向校验、单向同步（Soul→ST）。
- 图记忆 v0：人物/地点/事件实体抽取（本地模型）→ NetworkX → `memory/relations.graphml`。只建图，检索 P3 用。

**验收**：和 露怀秋 聊"我下周要去出差"，重启全部进程后问"我下周干嘛"，能答对（episodic 检索命中）。`astr memory review` 有待批条目流程。

## P1-W4 · 情感状态机（clean-room，借鉴 MaiBot 概念）

- **不 import、不拷 MaiBot 代码**（GPL-3.0 + EULA，见 06 §4.1）。**照其公开概念 clean-room 自行重写**两个东西：情感数值模型（孤独/倾诉欲/烦躁/兴奋，含时间衰减函数）和事件→情绪增量映射表，落 `soul/emotion.py`（本就只是个百来行的数值衰减模型）。README/NOTICES 以"灵感来源"致谢 MaiBot，**不作为代码依赖**。
- 情绪向量持久化到 `soul_package/memory/emotion_state.json`（每 10 分钟快照）；进 system prompt 模板（"你现在的心情……"）；`soul.decision` payload 带 `emotion_delta`。
- `/v1/status` 暴露当前情绪向量。

**验收**：连续 2 小时不理她，孤独值上升曲线可在 status 看到；一次愉快对话后兴奋值跳变且回复语气可感知差异（人评）。

## P1-W5 · 心跳引擎 v1（只想不说）

- `soul/heartbeat.py`：APScheduler（`uv add apscheduler`）按总规 §2.3.5 随机间隔触发 → 收集快照（最近对话摘要、情绪向量、时间、天气 API）→ 内心独白 prompt → 输出 JSON `{should_speak, target, content, emotion_delta}`。
- **本期硬编码 should_speak 永远不外发**：独白写入 `memory/chunks/monologues/` + `monologue` 事件进总线（网页可看）。主动发声 P5 解锁——先积累 3 个月独白数据观察她"想说什么"。

**验收**：运行 24h 产生 ≥20 条独白；抽读 5 条给出人评（是否符合人设）记 diary。

## P1-W6 · AstrBot 接入（单平台）+ 表达力抽象地基

> 上游规范：`05_PLATFORM_CAPABILITIES.md` §1/§2/§3。本周只立**表达力抽象**并实现单平台的 text/表情/语音三种通道；表情包引擎与多平台降级矩阵留到 P5-W2。原则：接口先写、实现后跟。

- **W6-a · AstrBot 桥插件（保留原卡）**：fork AstrBot，写 ASTR 桥插件：收到消息 → POST `/v1/ingest`（带平台 ID、会话 ID）→ 订阅对应 `soul.decision` → 回发平台。先接你日用平台（QQ 或 Telegram）。多轮会话上下文以 `astr_user_id` 为键统一（总规 §2.1.1 跨平台连贯性最小实现）。
- **W6-b · `presentation.express` 事件落契约**：在 `03_CONTRACTS.md` §1 事件类型表新增 `presentation.express`，schema 照抄 05 §2（`channels[]` + `platform_hint`）。`astr/contracts/events.py` 增对应 Pydantic 模型 + 单测。灵魂层从此**只产出平台无关的"表达意图"**，不再直接拼平台消息。
- **W6-c · `PlatformAdapter` 抽象 + 单平台实现**：`astr/sensors/platform/base.py` 定义 `PlatformAdapter` Protocol：`async def render(express: ExpressEvent) -> list[Segment]`，缺失能力**自动降级到 `fallback_text`，永不丢消息**。先实现日用平台一个 adapter，落地三通道：`text`、平台表情（QQ=`face` / Telegram=emoji）、`voice`（订阅 `presentation.tts` 产物）。若日用平台是 QQ：起 NapCat 容器（OneBot v11，Docker Compose，本机），AstrBot 侧开 `aiocqhttp` 适配器连接。
- **W6-d · 能力探测**：adapter 启动时 probe 实测支持的动作，写 `D:\ASTR\effector\logs\platform_caps.json`；不支持的能力在 render 时静默降级。

**验收**：
- 给 露怀秋 发消息得到回复；同一话题在该平台与 `astr chat` 间无缝接续（记忆共享）。
- 一条 `presentation.express`（含 text+表情+voice 三通道）端到端发出，三通道都到达；人为构造一个该平台不支持的通道，断言降级为 `fallback_text` 且无异常。
- `platform_caps.json` 存在且非空（05 §8-1）。

## P1-W7 · 语音输入管线

- `sensors/voice.py`：sounddevice 常驻采音 → silero-vad 切段 → openWakeWord 检测自训"秋秋"唤醒词（先用内置近似词起步，自训练唤醒词模型是独立小任务：录 200 遍样本 + 官方 colab 流程）→ 唤醒后 8s 窗口 SenseVoice-Small(ONNX, CPU) 转写 → ingest。
- 唤醒提示音 + 任务栏图标状态（红点=在听）。隐私规则：非唤醒窗口音频不落盘。

**验收**：安静环境喊"秋秋，今天天气怎么样"，3 秒内 SSE 流出现转写文本和回复。误唤醒率：放 1h 播客 <3 次。

## P1-W8 · 语音输出管线

- `presentation/tts.py`：订阅 `presentation.tts` → 合成 → 播放（sounddevice）。双后端：`edge` （edge-tts，开发期默认）和 `sovits`（GPT-SoVITS 本地 API，CPU 模式，预热常驻）。`.env` 切换。
- emotion_tag → SoVITS 参考音频映射表（8 段参考音录制是你的真人任务，可先用临时音色）。
- 简单打断：新 utterance 到达时停止当前播放。

**验收**：端到端语音对话（喊→听→答）往返 <6s（edge 后端）/ <10s（sovits CPU）。emotion_tag 切换可听出差异。

## P1-W9 · 声纹 + 鉴权闭环 + 稳定性周

- 声纹：resemblyzer 或 3D-Speaker（CPU）做说话人嵌入，注册你的声纹模板，语音入口的 AuthContext 升 L2。
- 全链路稳定性：start_all.ps1 完整拉起后 48h 浸泡测试，修崩溃、内存泄漏、Redis pending 堆积。
- 金标集扩到 60 条（新增语音场景、记忆场景）。

**验收**：48h 无人工干预不崩；声纹冒充测试（放别人录音）不能获得 L2。

## P1-W10 · Agent 网页 v0 + Live2D（设计大奖级·基线）

> 上游规范：`04_DESIGN_SYSTEM.md`（锁定）。本周达 04 §9 的**基线验收**即可——干净、现代、token 齐全、骨架立正。**不要在 P1 追求拿奖**，拿奖是 P6 精修冲刺的事。

- **W10-a · 设计系统落盘（先于任何组件）**：按 04 §2 写 `webapp/src/styles/tokens.css`（色彩/字体/间距/圆角/阴影/动效全量变量），在 `webapp/tailwind.config.ts` 映射为主题。装 `framer-motion`、`shadcn/ui`（init 后把默认色改成引用 token）、`next-themes`、`lucide-react`（04 §4）。暗/亮双主题可切换（04 §3.1）。**铁律**：组件内禁止硬编码色值，只用 `var(--astr-*)` 或 Tailwind 映射类。
- **W10-b · 七组件骨架**：按 04 §5 登记并实现 `Live2DStage / ThoughtStream / MessageTimeline / RoundtableFeed / EmotionGauge / VoiceVisualizer / StatusBar` 的骨架；布局沿总规 §2.7.3 分区。动效统一引用 `webapp/src/lib/motion.ts`（04 §6 的共享 variants），禁止逐组件重写时长/缓动。
- **W10-c · 三块核心信息流接通**：聊天时间线（SSE `/v1/stream`）、思考流折叠面板（`agent.thought` 逐字浮现）、状态栏（情绪向量/当日成本/躯壳版本，mono 字体）。
- **W10-d · Live2D 舞台 + 情绪光接通**：pixi-live2d-display 嵌入（免费模型起步），三个最小行为：Idle 呼吸眨眼、说话嘴动（RMS 音量驱动，TTS 进程 WebSocket 推音量包络）、`presentation.live2d` 事件触发 4 种表情。按 04 §3.2 接通情绪→环境光通道：订阅 `emotion_delta`，用 `emotionToGlow()` 写 `--astr-emotion-glow`，体现在页面背光/她的气泡描边（变化要缓慢，`--dur-slow`+）。
- **W10-f · 设置页：声纹录入 + 安全状态（从 W9 移入）**：在驾驶舱设置区做一个「录入主人声纹」面板——浏览器 `getUserMedia` 录 5 段（各 ~4s）→ 调后端 `POST /v1/voiceprint/enroll`（W10 时给 core 加这个端点，内部走 `sensors/voiceprint.enroll` 的嵌入+保存）→ 显示注册成功 + 当前阈值。同区展示语音入口鉴权状态（已注册/未注册、`voice_require_voiceprint` 开关）。**目的**：声纹注册不该逼用户开终端跑 `enroll-mic`，开源后人人能点。后端（模型/嵌入/三态校验/CLI）W9 已就绪，这里只补 Web 录音 UI + 一个 enroll 端点。
- **W10-e · P1 里程碑验收仪式**：录一段视频——你对空气喊"秋秋"，她抬头（表情事件）+ 语音回答 + 网页同步显示思考流 + 情绪光随之微变。这段视频同时是 P6 营销素材第一号。

**本卡验收（04 §9 基线档）**：
- `tokens.css` 全量落盘 + Tailwind 映射；CI 无硬编码色值（04 §8-1 通过）。
- 暗/亮主题平滑切换；七组件骨架可渲染；驾驶舱布局成型。
- Live2D 三行为可见；情绪光通道接通（至少手动改值见效果）。
- Lighthouse 性能 & 可访问性 ≥ 85（04 §8-2）。

**P1 总验收**：里程碑视频完成；金标集 ≥100 条且最近一次人评均分 ≥ 上月；你本人主观回答"她有点活了吗"——若否，触发总规 §5.4 红线流程（停下重设计，重点排查：模型表现力 / 人格卡质量 / MoA 纪要质量 三选一归因）。
