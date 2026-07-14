# ASTR System 工程总纲（Master Plan）

> 版本：v1.0 工程稿
> 编制日期：2026-06-12
> 上游文档：`../ASTR_System_总体规划 (1).md`（v0.1 规划稿，以下简称「总规」）
> 当前硬件基线：**RTX 3070 Ti (8GB) + i9-12900K + 普通内存（按 32GB 假设）+ 按需云 GPU**
> 原目标硬件（5090 + 192GB）预计 2 个月后恢复

---

## 0. 本计划的使用方法（执行 AI 必读）

本目录是把总规转化成的**可直接施工的工程计划**。执行规则：

1. **任何任务开工前**，先读完 `02_TECH_STACK_LOCKED.md` 和 `03_CONTRACTS.md`。这两份是"宪法"——任何代码不得违反其中锁定的接口、目录结构、命名和版本。
2. **按任务卡施工**。每张任务卡（位于 `phases/` 下）包含：任务 ID、依赖、目标、精确步骤、产出文件清单、**验收命令**。一张卡做完的唯一标准是：验收命令全部通过。不通过就不算完成，不许跳到下一张。
3. **禁止自由发挥接口**。卡里没写的实现细节可以自己决定（变量名、内部函数拆分等），但凡是涉及：文件路径、模块名、类名、事件 schema、API 端点、配置键名——必须与 `03_CONTRACTS.md` 完全一致。
4. **遇到卡里没覆盖的决策点**：选最简单、最不增加依赖的方案，并在 `ops/diary.md` 记一行决策日志。不要为了"未来可能需要"而提前抽象。
5. **每张卡完成后**：在卡片对应的 checklist 打勾，在 `ops/diary.md` 写一行（日期 / 任务 ID / 结果 / 遗留问题），然后 git commit，commit message 格式：`[P0-T03] deploy local inference endpoint`。
6. **P0 红线**：`soul_package/` 目录内永远不允许出现 `.safetensors` / `.gguf` / `.bin` / `.pt` 权重文件。CI 会检查（见 P0-T02）。这是总规 §0.4 灵魂可迁移宪法的机器执行形式。

---

## 1. 与总规的差异声明（必须先理解再施工）

总规按 5090/32GB 写，本工程计划做了以下**已确认的**调整。冲突时以本文件为准：

| # | 总规原方案 | 工程计划方案 | 原因 |
|---|-----------|-------------|------|
| 1 | 本地主力 Qwen2.5-32B Q5 (vLLM) | **Qwen3-8B Q4_K_M（llama.cpp server / Ollama）**，备选 Qwen3-30B-A3B（MoE，CPU+GPU 混合） | 8GB 显存放不下 32B；Qwen3 是 2026 年的当代选择，Qwen2.5 已过代 |
| 2 | vLLM 多 LoRA 热加载 | 弱硬件期用 llama.cpp server（支持 GGUF LoRA adapter）；恢复 5090 / 上云后切 vLLM | vLLM 在 8GB 上没有施展空间 |
| 3 | 凌晨炼丹在本机跑 | **训练上云**（AutoDL/Vast.ai 租 4090，每晚 ~1.5h ≈ ¥3–5），本机只做数据构造和评估 | 8GB QLoRA 8B 勉强能跑但会把整夜系统占死；云训练同时验证"灵魂与算力解耦" |
| 4 | 视觉模型常驻（Qwen2-VL-7B 16GB） | 视觉按需加载 + **显存分时**：Computer Use 任务激活时本地 LLM 换出、灵魂临时走 PromptOnlyAdapter；视觉用 Florence-2-base + OmniParser-v2（<2GB）或云 API | 8GB 无法 LLM + VLM 共驻 |
| 5 | TTS 主推 GPT-SoVITS 常驻 GPU | P1 用 edge-tts（开发期临时方案，标记为非主权组件）；GPT-SoVITS 走 CPU 或分时 GPU，P4 转正 | 同上，显存预算不够 |
| 6 | ST Group Chat 作为圆桌引擎 | **自研轻量圆桌调度器**（~300 行），ST 只作为人格卡/世界书/向量记忆的存储与格式标准 | ST Group Chat 的内部 API 不稳定，深度耦合风险大于复用收益（详见 99 号文档 #10） |
| 7 | 事件总线 NATS 或 Redis Streams | **锁定 Redis Streams**（Docker 起，Windows 友好） | 砍掉选择题，NATS 在 Windows 上多余 |
| 8 | ModelRouter 自研 | **基于 LiteLLM 封装**，自研只做策略层（tier 路由 / 成本计量 / 降级） | 不重造轮子，LiteLLM 已覆盖 100+ provider 统一接口 |
| 9 | Phase 5 迁移演习是"未来某天" | **迁移演习提前成为主线剧情**：露怀秋 在弱硬件期出生于 Qwen3-8B，两个月后 5090 回归时执行第一次真实传承仪式（8B → 32B 级），产出第一份真实 SCI 报告 | 把硬件劣势变成项目最有说服力的叙事资产和第一个数据点 |

> 第 9 条是本工程计划最重要的战略改写：**"露怀秋 出生在一台普通电脑上，然后搬进了更强的躯壳，而她还是她"——这正是 Household AI Sovereignty 宣言想证明的事，现实把实验送上门了。** 所有 P0/P1 的设计决策都要照顾这次迁移：从第一天起所有身份数据进 SoulPackage，黄金测试集从第一周开始积累。

---

## 2. 文档地图

```
engineering_plan/
├── 00_MASTER_PLAN.md          ← 本文件：总纲 + 使用方法 + 差异声明
├── 01_HARDWARE_AND_MODELS.md  ← 显存预算表 / 模型选型 / 云 GPU 策略 / 成本
├── 02_TECH_STACK_LOCKED.md    ← 锁定的技术栈版本 / 仓库结构 / 编码规范 / Windows 注意事项
├── 03_CONTRACTS.md            ← 事件契约 / SoulPackage Schema / EmbodimentAdapter / ModelRouter（含可直接落盘的代码）
├── 04_DESIGN_SYSTEM.md        ← 设计系统（锁定）· 设计大奖级 token/组件/动效/验收（落点 P1-W10 基线 + P6 精修）
├── 05_PLATFORM_CAPABILITIES.md← 平台原生表达力（锁定）· QQ 表情包/戳一戳/语音 + 跨平台降级矩阵（落点 P1-W6 + P5-W2）
├── 06_LICENSING_AND_COMPLIANCE.md ← 许可证与合规（锁定）· AGPL 决策 / 依赖清单 / 双仓边界 / 许可证 CI 闸
├── 07_ADMIN_CONSOLE.md        ← 后台控制台（锁定）· 第二张脸·自由度载体·对标 AstrBot/MaiBot + 灵魂层独有模块（落点 P6-W3~W4b）
├── 08_DISCUSSION_ENGINE.md    ← 讨论引擎（锁定）· 四档分诊 L0-L3·真讨论/异议权/师承档案·闲聊与科研同一台机器（升级 MoA+教学，P3 圆桌=L3 档）
├── phases/
│   ├── P0_foundation.md       ← 2 周 · 地基（最细粒度，含逐条命令）
│   ├── P1_soul_loop.md        ← 10 周 · 灵魂闭环（最细粒度）
│   ├── P2_effector.md         ← 8 周 · 执行层
│   ├── P3_research.md         ← 8 周 · 学术引擎
│   ├── P4_flywheel.md         ← 6 周 · 自训练飞轮
│   ├── P5_proactive_migration.md ← 6 周 · 主动性 + 传承仪式
│   └── P6_opensource.md       ← 8 周 · 开源化
├── 99_IMPROVEMENTS.md         ← 改进点与含金量提升项（含学术诚实性策略）
└── reference_impl/            ← 可直接落盘的骨架（check_soul_purity.py / tokens.css / tailwind.tokens.ts / motion.ts / emotion.ts / annotate_stickers.py），落点见其 README
```

粒度策略：**P0–P2 是保姆级**（逐命令、逐文件、逐验收）；P3–P6 是任务级（每张卡有明确目标与验收，但允许执行时再细化）。原因：P3 以后的技术环境（模型版本、库版本、你的硬件）必然变化，过早写死命令反而制造错误。**每个 Phase 开工前一周，用当时的环境信息把该 Phase 文档升级为保姆级**——这本身就是一张任务卡（每个 Phase 的 T00）。

### 2.1 v1.0 增补（2026-06-14）

本次在总规与工程计划同步补入三块，**不改变已有任务卡的依赖与里程碑**，只新增锁定规范与改进项：

1. **设计大奖级前端**（总规 §2.10 ↔ `04_DESIGN_SYSTEM.md`）：把 P1-W10 的网页从"能用"升级为目标"可投 Awwwards"。基线在 P1，精修冲刺在 P6。
2. **平台原生表达力**（总规 §2.11 ↔ `05_PLATFORM_CAPABILITIES.md`）：复用 AstrBot/NapCat + 借鉴 MaiBot 表情包系统，让 露怀秋 在 QQ 像真人网友（表情包/戳一戳/语音/引用）。落点 P1-W6 + P5-W2。
3. **对前沿 RSI 公开化的战略回应**（总规 §0.6.6）：Anthropic 2026-06 公开递归自我改进 → 印证 §0.6 不对称押注，不动摇路线；唯二调整是"SI/SCI/OISP 命名首发前移"与"坐标 A 差距风险入册"。详见 99 号文档 #15。

---

## 3. 阶段总览与里程碑

| Phase | 周期 | 一句话目标 | 硬性里程碑（可验证） |
|-------|------|-----------|---------------------|
| P0 地基 | 2 周 | 环境 + 契约 + 最小心跳 | `soul_demo.py` 跑通一次完整链路：输入→MoA 分析→本地模型回复；CI 绿灯；SoulPackage schema 校验通过 |
| P1 灵魂闭环 | 10 周 | 文本/语音对话 + 记忆 + 心跳 + 网页 | 对空气喊"秋秋"，Live2D 抬头 + 语音回应；金标集 30→100 条 |
| P2 执行层 | 8 周 | MCP + 浏览器 + Computer Use | "把桌面 X 文件夹按日期归类"端到端跑通且全程审计日志可回放 |
| P3 学术引擎 | 8 周 | 圆桌 + 文献 + LaTeX 闭环 | 抛一个直觉问题，次日拿到 LaTeX draft + 可运行复现代码 |
| P4 自训练飞轮 | 6 周 | 每晚云端炼丹 + 评估门禁 + 回滚 | 连续 30 天自动训练，金标集分数曲线不降反升 |
| P5 主动性 + 迁移 | 6 周 | 心跳主动发声 + **第一次传承仪式** | (a) 出差 3 天收到 ≥5 条基于真实记忆的主动消息；(b) 8B→32B 级迁移完成，SCI v0 ≥ 0.85 |
| P6 开源化 | 8 周 | 内核/适配器/插件解耦 + 发布 | Docker Compose 一键部署在一台陌生机器上成功；OISP Spec v0.9 公开 |

**P1 红线**（总规 §5.4 原文保留）：如果 P1 走完 露怀秋 没有"有点活了"的感觉，停下重新设计，不许硬冲 P2。

---

## 4. 弱硬件期（2026-06 ~ 2026-08）的总策略

这两个月覆盖 P0 + P1 前半。策略一句话：**本地跑灵魂的最小躯壳，云端跑一切重活，所有身份资产从第一天进 SoulPackage。**

- 本地 3070 Ti 只常驻一件事：Qwen3-8B Q4（≈6GB 含 KV cache）。其余感官组件全部 CPU（详见 01 号文档显存预算表）。
- MoA 智囊团本来就是云 API，不受影响——弱硬件期智囊团权重自然加大，这没问题，因为**管家产出的分析全部回填 SoulPackage**，不会流失。
- 训练、SAE 实验、未来的 32B 推理：租云 GPU。预算见 01 号文档 §4。
- **绝对禁止**因为"本地模型笨"而把身份数据（人格演化、评分、记忆）存在任何云服务里。云只租算力，不存灵魂。

---

## 5. 风险登记簿（工程层，补充总规 §5）

| 风险 | 触发信号 | 预案 |
|------|---------|------|
| 8B 模型人格表现力不足，"出戏率"高 | 金标集人评 < 60 分 | ① 加重 MoA 辅导权重；② 切 Qwen3-30B-A3B（需 32GB 内存，CPU offload，~8 tok/s）；③ 临时 PromptOnlyAdapter 寄宿 API |
| 云 GPU 平台跑路/涨价 | — | 训练脚本必须平台无关（纯 docker + 一个 `train.sh`），AutoDL/Vast/RunPod 三家账号都注册 |
| Windows 上 Docker/WSL2 资源占用拖慢推理 | 推理 tok/s 掉 30%+ | Redis/ST 等容器限内存；必要时 Redis 换 Windows 原生 Memurai 或纯 Python 进程内总线（接口不变） |
| 2 个月后硬件不是 5090（计划有变） | — | 无所谓。传承仪式的目标基底改成"当时可用的最强基底"（本地或云），仪式流程不变 |
| 你的时间被工作挤占，进度断档 | 两周无 commit | 每张任务卡 ≤ 1 天工作量，断档后从 diary.md 最后一行无缝续接——这就是保姆级粒度的意义 |

---

## 6. 立即行动（今天）

1. 读 `01_HARDWARE_AND_MODELS.md`，确认内存容量（影响是否能用 30B-A3B 备选方案），把实际值填进该文档 §0。
2. 读 `02_TECH_STACK_LOCKED.md` + `03_CONTRACTS.md` 全文。
3. 打开 `phases/P0_foundation.md`，从 P0-T01 开始。
4. 今晚写下 `soul_package/justin/identity/narrative.md` 的第一行（P0-T05 会建好目录，但第一句话应该由你本人写，不是 AI）。
