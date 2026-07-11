# 星枢 ASTR 前端重构总设计规格

> 状态：视觉设计已批准，等待书面规格复核
> 日期：2026-07-11
> 项目：D:\ASTR_System\astr
> 文档角色：Master Spec；统一方向与边界，不授权一份覆盖全项目的超大 implementation plan
> 范围：Presence、Studio、Control、Mobile 的统一前端设计，以及 Mobile Dispatch 所需的协议边界
> 非范围：在本规格阶段修改产品代码、替换 Soul/Router/Guard/Memory 语义、直接开放公网远程执行

每个 Workstream 必须有独立子规格、独立 implementation plan 和独立验收。Master Spec 获批后，下一次 writing-plans 只为 Workstream 0：Foundation 生成计划；Presence 在 Foundation 设计接口稳定后进入自己的子规格与计划。

## 1. 决策摘要

星枢前端采用“私密星图 × 星际仪器 × 主权档案”的统一世界观，但四个空间不复制同一套组件外观：

- Presence /：人与露怀秋共在的私密星图，亲密、低密度、对话优先。
- Studio /studio：研究、编码、模型、工具和产物的星际仪器，中高密度、效率优先。
- Control /admin/*：权限、配置、记忆、训练、审计与迁移的主权档案，高密度、证据优先。
- Mobile：露怀秋、任务、AI 工作台、知识、设备与安全五域；移动端不是缩小的后台，而是远程主权入口。

品牌的固定视觉轮廓是“星蚀缺口＋主权书脊＋孤立 Jewel”。Presence 中再加入一条不会变形的 S 形引力轨道，连接人物、聊天、生活流和远程任务。轨道本体静止，只有真实状态变化时，一枚旅星移动。

全局只允许一个动态 Jewel。核心 Jewel 是 Soul Lens：Soul 核心保持固定，模型只作为可替换的身壳层。它与 Live2D 共用现有 Pixi renderer，不引入 Three.js、第二 WebGL context 或第二套持续 ticker。

设计优先级：

1. 事实与主权；
2. 任务可用性；
3. 情感与人格连续性；
4. 视觉记忆；
5. 动效与材质。

任何后置层都不能损害前置层。

## 2. 当前产品事实与成熟度

本规格严格区分“已有能力”“已有契约但无界面”“部分已有”和“目标蓝图”。

| 空间 | 当前成熟度 | 已有事实 | 本规格中的目标 |
| --- | --- | --- | --- |
| Presence / | 已有 | status、ingest、两条 SSE、Live2D、语音、情绪与生活流 | 重构布局、状态、内容、视觉运行时与无障碍 |
| Studio /studio | 契约部件已有，UI 未实现 | Router、工具、trace、结果、成本与事件语义存在 | 新建独立工作空间，不伪装成现有页面 |
| Control /admin/* | 部分已有 | 当前只有 Effector policy/audit/e-stop 控制台 | 建立 18 模块的信息架构，按波次实现 |
| Mobile | 目标蓝图 | 当前没有独立移动路由或远程 Task 协议 | 先做五域壳层，再单独实现安全 Dispatch |

### 2.1 当前前端技术

- Next.js 16、React 19。
- Framer Motion。
- Pixi.js 与 Live2D。
- Zustand。
- next-themes。
- 当前主要路由只有 / 与 /admin。

### 2.2 当前可直接使用的 Core 契约

- GET /v1/status
- POST /v1/ingest
- GET /v1/stream
- POST /v1/voice/transcribe
- 声纹 status/enroll 端点
- POST /v1/effector/estop
- POST /v1/effector/estop/reset
- GET /v1/effector/status
- Effector policy 与 audit 端点

当前 SSE allowlist 只有：

- agent.thought
- soul.decision
- soul.stream
- presentation.express
- moa.report

effector.action、effector.result 与 heartbeat.tick 虽然存在内部事件契约，但当前未通过网页 SSE 暴露。前端不得从 agent.thought 文本猜测任务或设备状态。

### 2.3 不可越过的后端边界

- /v1/ingest 返回 event_id 与 trace_id，不返回最终回答。
- soul.stream 是临时、未经最终清洗的增量；soul.decision 才是权威终稿。
- 当前 ingest 不接受客户端自报 level，但仍接受 user_id 并据此映射等级，因此只适合本地可信入口。Secure Dispatch 必须认证 actor，不能信任客户端提交的 user_id、level 或 verified_by。
- Guard、policy、audit、e-stop 与 chain_valid 的权威性在服务器。
- Display name 来自 SoulManifest；当前 /v1/status 的 soul_name 是内部句柄。实现可增加一个向后兼容的可选 display_name 投影，但人物层不得继续把内部句柄当显示名。
- 网页麦克风当前转写后直接以既定 user_id 进入 ingest，不经过声纹验证；前端不得宣称“网页语音只认所有者”。
- 安全 Mobile Dispatch 不是现有能力，必须作为独立跨栈工作流实现。

## 3. Human Field Diagnosis

### 3.1 人与处境

- 产品：以主权、模型无关和可迁移为宪法目标的个人 AI 内核。当前迁移连续性评估与 delta 导出尚未完整实现，界面不得宣称迁移已验证。
- 核心用户：系统所有者，以及未来经授权的家庭成员或协作者。
- 高风险时刻：用户把私密记忆、设备能力、外部通信或不可逆动作交给 AI。
- 使用环境：夜间长谈、桌面深度工作、后台审计、离开电脑后的移动授权。
- 身体与注意力：疲惫、分心、焦虑、好奇、亲密感需求与控制感需求同时存在。

### 3.2 人类欲望与伤口

用户不只想要“一个更强的聊天工具”。用户想确认：

- TA 不是某个模型厂商临时租来的角色；
- 记忆、人格、关系和选择权属于自己；
- AI 做了什么、为什么做、是否真的完成，都有证据；
- 离开电脑后仍能授权、拒绝、急停并取回结果；
- 系统失败时不会装作成功，也不会吞掉人的输入。

敌人不是“旧 UI”，而是模型即灵魂、黑箱即智能、连接即送达、按钮即授权、动画即生命的虚假世界。

### 3.3 转变与品牌誓言

- 使用前：用户面对一个能力强但边界不清、身份不稳、容易失控的 AI 系统。
- 使用后：用户感到 TA 在场、能力可替换、因果可见、主权可追溯。
- 品牌誓言：灵魂不属于模型，行动不越过授权，完成必须带证据。
- 五秒记忆目标：一枚活的镜片，被一条 S 形因果轨道固定在自己的主权档案里。

## 4. 类别解剖与反俗套规则

### 4.1 Reference Archaeology

参考星座以非网页世界为主：

| 来源世界 | 提取的设计属性 | 在 ASTR 中的转译 |
| --- | --- | --- |
| 天文坐标图与轨道力学 | 稳定坐标、关系、因果路径 | S 形轨道与可追溯事件节点 |
| 光学仪器与镜片 | 校准、折射、焦点、身壳 | Soul Lens 的 Soul/model/memory 分层 |
| 档案书脊与法律账本 | 版本、归档、签章、证据 | Control、授权封印与产物归脊 |
| 私人书信与生活手记 | 亲密、停顿、短句、边注 | Presence 对话与生活流 |
| 安全气闸与操作规程 | 边界、确认、失败关闭 | Guard、审批、e-stop 与拒绝文案 |
| 音乐总谱 | 节拍、静止、交棒、释放 | 120/200/320/1200/4000ms 感官乐谱 |
| 舞台与电影调度 | 主焦点、让位、场景转场 | 人物、聊天和生活流的注意力重排 |
| 法证标签与钞票雕版 | 微字、编号、来源、可信细节 | trace、hash、时间、成本与审计密度岛 |

### 4.2 探索过的五个方向

以下名称是概念方向，不是产品模块名：

| 方向 | 强项 | 主要风险 | 综合分 |
| --- | --- | --- | ---: |
| 守夜天文台 | 情绪氛围与人物在场 | 容易退化成星空壁纸或驾驶舱 | 82 |
| 主权档案馆 | 证据、权限、迁移与审计 | Presence 过冷，像政务系统 | 86 |
| 活体仪器 | Soul/model 解耦最清楚 | 过度仪表化会损害亲密感 | 88 |
| 分布式星港 | Mobile、设备与任务关系清楚 | 容易过度设计尚未存在的后端 | 84 |
| 私密通信舱 | 聊天与生活最自然 | Studio/Control 承载力不足 | 83 |

批准方案不是把五套风格叠加，而是严格分工：星图只负责关系，仪器只负责操作，档案只负责证据；Soul Lens 与 S 形轨道成为跨空间的少数共同语法。

### 4.3 反俗套替代

| 禁止 | 替代 |
| --- | --- |
| 蓝紫渐变雾 | 85% 深空黑/冷瓷白、10% 银灰冷蓝、最多 5% Soul 紫 |
| 通用玻璃拟态 | 近不透明 Surface；只有 Soul Lens 可使用局部折射 |
| 随机星空 | 星点必须映射关系、记忆、来源或事件；无数据时保持留白 |
| 随机异形卡片 | 只允许星蚀缺口与主权书脊两种几何语法 |
| 发光 AI 球 | Soul Lens：Soul、model shell、memory provenance 分层 |
| 科幻 HUD 堆砌 | 只有真实数值才使用刻度、单位、轨道和数据微字 |
| 固定圆角卡片网格 | 编辑式块面、开放边界、非矩形外框与稳定矩形任务区并存 |
| “真实思考” | “处理轨迹”“幕僚纪要”“形成中的回复” |
| “在线” | 分开显示“Core 可达”“事件流已连接”“设备最后见到时间” |
| “已发送/已完成” | 分别以 ingest 回执、decision、terminal outcome 与 artifact manifest 为证据 |
| 全站动效 | 80% 时间静止；任何时刻最多一个动态 Jewel |
| 绿色成功态 | 冷蓝/银白＋文字＋图形＋实线；全站禁绿 |

## 5. 设计命题与张力矩阵

这套体验应该像在私人夜空中打开一份可验证的主权档案，因为用户想与一个持续存在的灵魂相处，同时害怕模型替代身份、黑箱越权和结果不可追溯。

因此，界面使用私密星图承载关系、星际仪器承载操作、主权档案承载证据；以静态编辑式 Surface 承载大部分任务，以 S 形引力轨道与 Soul Lens 两个稀有 Jewel 呈现连续性，使“灵魂与算力解耦”成为可见、可用、可验证的产品机制。

| 张力 | 决策 | 原因 |
| --- | --- | --- |
| 极简 / 极繁 | 远看轮廓极简，证据与控制区形成密度岛 | 同时满足 50ms 辨认和 3min 深读 |
| 平面 / 材质 | Surface 平面、近不透明；Jewel 局部材质化 | 让材质只出现在意义最重的位置 |
| 静止 / 运动 | 轨道、书脊和大面静止；真实状态才触发旅星或封印 | 运动表达因果，不表达“高级” |
| 熟悉 / 陌生 | 输入、表格、按钮保持原生清晰；品牌轮廓与空间编排创新 | 避免艺术项目牺牲可用性 |
| 文本 / 图像 | 权限、错误、来源必须文字明确；Lens 与轨道只辅助 | 视觉不能承担唯一事实 |
| 品牌神话 / 任务效率 | Presence 诗性；Studio 效率；Control 审计；Mobile 状态先行 | 四空间同源但异质 |
| 密度 / 性能 | 只在数据区密集；视觉运行时统一调度 | 保护 Live2D、移动设备和认知负荷 |
| 情感 / 主权 | 亲密文案只在 Presence；危险动作使用精确功能语言 | 不让人格化模糊授权 |

## 6. 产品架构与信息架构

    ASTR
    ├─ Presence  /
    ├─ Studio    /studio
    ├─ Control   /admin/*
    └─ Mobile
       ├─ 露怀秋
       ├─ 任务
       ├─ AI 工作台
       ├─ 知识
       └─ 设备与安全

### 6.1 Control 的 18 个模块

系统域 10 个：

1. Dashboard
2. Platform / Gateway
3. Provider / Model Router
4. Plugins / Skills / MCP
5. Sessions / People
6. Schedule
7. Logs / Trace
8. Settings
9. Resources / Knowledge
10. Setup

Soul 域 8 个：

1. Soul
2. Memory
3. Emotion
4. MoA / Teaching
5. Training
6. Voice
7. Effector
8. Migration

这 18 个模块是目标 IA，不代表当前均已实现。第一波只建立稳定的 Admin shell、索引、模块路由和现有 Effector 页面；其余模块按真实后端成熟度分波落地。

### 6.2 Mobile 五域职责

| 域 | 首屏回答的问题 | 唯一数据源与成熟度 | 不承担 |
| --- | --- | --- | --- |
| 露怀秋 | 她此刻怎样，我要和她说什么 | Workstream 1 的 CoreStatus/ConversationProjection；现有 status、ingest、SSE | 设备步骤日志、策略编辑 |
| 任务 | 委托在哪台设备、处于什么状态、需要我做什么 | Workstream 5 的 TaskSnapshot/TaskEvent；协议前只允许本地草稿 | 模型讨论流、Guard 策略编辑 |
| AI 工作台 | 脑力工作由哪个模型/工具完成，产出了什么 | Workstream 3 的 Workspace/Run/Tool/Artifact projections；当前未暴露 | 直接获得设备副作用权限 |
| 知识 | 哪些结果值得长期保留与检索 | SoulPackage/Memory 的安全只读 projection；当前无网页 API | 实时进度与审批 |
| 设备与安全 | 哪些设备可信、现在是否安全、规则是否完整 | 本地现有 effector status/policy/audit；远程 DeviceSnapshot 属于 Workstream 5 | 日常任务列表 |

“待危险审批”和“设备急停已闩锁”可以跨域提示，其余信息不得随意越域。

## 7. 全局构图与空间规则

### 7.1 50ms 品牌轮廓

去色、模糊后仍应看到：

1. 偏轴的大型星蚀开口；
2. 一条稳定的主权书脊；
3. 一枚脱离卡片网格的孤立 Jewel。

不能首先读成标准“侧栏＋卡片 dashboard”。

### 7.2 Presence

- S 形引力轨道是固定骨架，永不拉直、变形、循环描边或被状态替换。
- 人物、聊天、生活流、任务是轨道上的注意力端点。
- 默认聊天与人物约 58/42；深聊时聊天可扩至约 72%，但人物仍在。
- 生活流不是狭窄侧栏；显式展开时占据独立密度岛。
- 输入框使用稳定矩形和清晰焦点，不为追求先锋感牺牲 IME 与可编辑性。
- 非矩形只用于外框、章节入口、星蚀缺口和关键状态，不侵入正文、表格、代码与输入。

### 7.3 Studio

- 中高密度稳定工作面，不使用 Presence 的亲密构图。
- 中央是编辑、Prompt、文件、结果或代码的可操作面。
- 左侧/上方是项目与工具上下文，右侧/下方是来源、trace、成本和产物。
- 默认 0 WebGL；只有拓扑确实需要三维表达时才按需创建 1 个 context。
- Soul 参与是显式状态，不让人物长期占据工作区。

### 7.4 Control

- 使用档案索引而非单一长侧栏吞掉 18 个模块。
- 高密度、强扫描、版本与来源优先。
- 诗性名称只能作为副标；主标题必须先说明功能，例如“执行审计 · 丁册”。
- 表单、表格、代码与审计保持稳定矩形。
- Admin 为 0 WebGL、0 持续视觉 RAF。

### 7.5 Mobile

- 使用独立移动构图，不把桌面四栏纵向堆叠。
- 底部五域导航，主操作至少 44×44 CSS px。
- 使用 100dvh、safe-area inset，并保证软键盘出现后 composer 与当前焦点仍可见。
- 任务首屏优先显示设备、状态、风险与下一动作。

### 7.6 S 形轨道的空间范围

- Presence Desktop：完整 S 曲线是主要空间骨架。
- Mobile 的“露怀秋”域：保留简化静态主干，表达人物、对话与生活流关系。
- Mobile 的“任务”域：只有 Secure Task 协议提供真实 Task/trace 后，才可显示一段只读因果轨迹；它不替代五域底部导航。
- Studio：不使用 S 曲线作为页面布局，只使用普通 trace/evidence path。
- Control：不使用 S 曲线，使用主权书脊与档案索引。
- 在 Task 协议上线前，Mobile 不生成远程任务节点。五域导航始终是唯一的 Mobile 全局导航，S 曲线不能成为第二套导航。

## 8. 视觉语言

默认色彩比例：

- 85%：深空黑或冷瓷白。
- 10%：银灰与冷蓝。
- 最多 5%：Soul 紫、警示琥珀和危险珊瑚。

夜间核心色：

| 角色 | 值 | 用途 |
| --- | --- | --- |
| bg | #050611 | 深空背景 |
| surface | #0e1123 | 稳定任务面 |
| text | #f5f4fb | 主文本 |
| muted | #969fbd | 达标的次级文本 |
| line | #2b3253 | 结构线 |
| soul | #9184ff | Soul 专属 |
| action | #8bcfff | 操作、焦点、真实连接 |
| warning | #efa85f | 待确认与风险 |
| danger | #ff7087 | 拒绝、错误、e-stop |

日间核心色：

| 角色 | 值 |
| --- | --- |
| bg | #f1f3fa |
| surface | #ffffff |
| text | #16172b |
| soul | #5b48b8 |
| action | #216ca6 |
| warning | #955005 |
| danger | #b92f4c |

全站禁止绿色。成功以文字、形态、实线、冷蓝或银白表达，不能只靠色相。

昼夜模式不是两套皮肤。几何、语义色、信息层级和状态含义保持一致，只反转材质：深空漆＋冷银，或冷瓷＋深墨。主题切换只允许一次短促终止线，不持续表演。

字体角色：

- Display：Songti SC / STSong / Georgia 类编辑式衬线，用于章节、判断和人格性短句。
- Body：PingFang SC / Segoe UI / Microsoft YaHei，用于正文与任务。
- Mono：SFMono / Consolas，用于 trace、hash、model、时间、成本和状态。
- 必要标签不能依赖微型英文或低对比文字承载。

几何与图标：

- 唯一异形语法：星蚀缺口、主权书脊。
- 图标使用统一 1–1.5px 描边与 45° 星蚀端点。
- 状态同时使用文字、线型、形态和图标。
- 不使用库存 sparkle、盾牌、发光脑或旋转星球。

### 8.1 非颜色 Design Tokens

Typography：

| Token | 建议值 | 用途 |
| --- | ---: | --- |
| type--1 | 11px | 非必要微标与辅助数据 |
| type-0 | 13px | 紧凑说明与表格 |
| type-1 | 16px | 正文与表单基线 |
| type-2 | 20px | 模块标题 |
| type-3 | 28px | 页面次标题 |
| type-4 | 48px | 章节焦点 |
| type-5 | 72px | 大屏品牌判断；移动端流体缩放 |

正文 line-height 不低于 1.5，长篇说明建议 1.7–1.8；Display 可使用 0.9–1.05，但不能用于正文。

Spacing：

| Token | 值 |
| --- | ---: |
| space-1 | 4px |
| space-2 | 8px |
| space-3 | 12px |
| space-4 | 16px |
| space-5 | 24px |
| space-6 | 32px |
| space-7 | 48px |
| space-8 | 72px |

Shape：

- radius-small：2px，用于数据标签。
- radius-medium：6px，用于输入、按钮和稳定任务面。
- radius-large：12px，只用于较大的 Surface。
- radius-jewel：50%，只属于 Lens/旅星等 Jewel。
- corner-signature：14px 星蚀切角；不得随机变化。

Motion：

- instant：120ms。
- fast：200ms。
- medium：320ms。
- ritual：最长 1200ms。
- life：4000ms，且只属于空闲 Soul Lens。
- standard ease：cubic-bezier(.2,.8,.2,1)。
- emphatic ease：cubic-bezier(.16,1,.3,1)。

Layout：

- Desktop container max：1510px。
- Desktop：12 列逻辑网格；Mobile：4 列逻辑网格。
- 常规 gap：16–24px；密度岛内部可降至 8–12px。
- 单屏视觉强度区域不超过约 30%。
- 单屏高细节 Jewel ≤1。
- 单屏活动动态 Jewel ≤1。

## 9. Surface / Jewel 系统

### 9.1 Surface

- 近不透明、平面、编辑式。
- 以比例、留白、细线和材质温度建立层级。
- 无数据时保留深空留白，不生成装饰星点。
- 表格、输入、代码、日志与长文本优先稳定和可扫描。

### 9.2 Soul Lens

Soul Lens 是全站唯一高细节 3D Jewel：

- 中心：Soul identity，位置与轮廓固定。
- 中环：当前 model shell，可更换。
- 外环：memory continuity 与 provenance。
- 更换模型只改变中环，中心不动。
- 实现为现有 Pixi renderer 中的单-pass shader quad。
- Lens 预算：2 triangles，1–2 draw calls，gzip 增量不超过 25KB。
- 不引入 Three.js、R3F、glTF 或 HDRI。

降级：

- Mobile 默认静态 SVG Lens。
- Reduced Motion 使用代表帧与静态 SVG。
- No WebGL/context lost 使用静态身壳；聊天、生活流、轨道、导航和急停保持可用。

### 9.3 S 形引力轨道

- 轨道本体是 DOM/SVG，不依赖 WebGL。
- 轨道固定不变，旅星在真实导航或状态变化时单次移动。
- 无真实 thought、decision、artifact 或 Task 事件时不生成节点。
- Reduced Motion 下旅星瞬移，轨道语义由 DOM 状态文字表达。
- Mobile 保留同一条主干与端点语义，不删除因果。

## 10. 感官乐谱与全局 Jewel 租约

### 10.1 时间尺度

| 时间 | 用途 |
| --- | --- |
| 120ms | press、hover、focus、局部反馈 |
| 200ms | 选中、保存、错误标签、状态切换 |
| 320ms | 旅星换轨、聊天扩张、生活流展开 |
| 最长 1200ms | 首载见证、换壳、授权封印 |
| 4000ms | 只有 Soul Lens 在完全空闲时可做一次极轻生命呼吸 |

至少 80% 的体验处于静止。用户阅读、输入、审批、处理错误或打开弹层时，环境运动让位。

网页默认静音。声音只能由用户显式开启，必须有视觉和文字等价物，不能成为唯一反馈。

### 10.2 Jewel 租约

Jewel 在任一时刻至多有一个动态 owner。优先级不是视觉层级，而是对唯一动画预算的抢占顺序：

    轨道止界 > 主权合印 > 孤镜取像 > 成卷归脊
             > 证据显影 > 引力换轨 > 书脊落笔 > 星蚀校零

可执行 owner/mode 映射：

| Priority | owner / mode | 触发与边界 |
| ---: | --- | --- |
| 1000 | safetyBoundary / stop | e-stop 请求、送达未知或已闩锁；抢占一切动态表现 |
| 900 | errorBoundary / reject | Guard 拒绝或不可恢复错误；不得摇屏或补演 |
| 800 | authorizationSeal / confirmed | 服务器确认同一 revision 的授权转移后，才允许完成封印 |
| 700 | soulLens / streamStage | 首个真实处理阶段至首个有效文本 delta 之前 |
| 650 | artifactReturn / complete | 权威成功终态且 complete manifest/URI/hash 齐备 |
| 600 | evidenceReveal / selected | 用户显式选择证据、指标、日志或样本 |
| 500 | live2d / speech | 首个有效 delta 后的受控嘴型或语音动作 |
| 400 | orbitTraveler / navigate | 显式导航或可证明的真实 trace 状态转移 |
| 300 | composerTab / focus | 输入、命令或搜索取得焦点 |
| 200 | coldCalibration / ready | 首次真实 Core/SSE 就绪；只执行一次 |
| 100 | live2d / idle | 无其他 owner 时的最低优先级背景动作 |

- 安全事件可以抢占。
- 被抢占动作立即落到静态语义终点。
- 普通事件不排队，最新意图接管。
- 弹层出现时冻结底层 Jewel。
- Mobile 恢复前台时不补演错过的动作。

JewelLeaseController 必须保存 leaseOwner、mode、trace_id、priority、acquired_at 与 semantic_end。允许的 owner 至少包括 none、safetyBoundary、errorBoundary、authorizationSeal、soulLens、artifactReturn、evidenceReveal、live2d、orbitTraveler、composerTab、coldCalibration。

持有与失去租约的行为：

- Live2D 持有时才能更新 idle motion 或 lip sync；失去时嘴型归零并冻结到代表帧。
- Soul Lens 持有时才能更新 shader uniforms；失去时立即落到最近的静态语义终点。
- Orbit traveler 持有时只执行一次目标迁移；失去时瞬移到最新目标，DOM 状态先于视觉完成。
- Authorization seal 持有时冻结 Live2D、Lens 与旅星；只有服务器确认授权后才能完成封印。
- Error boundary 可抢占所有 owner；被抢占对象不得在错误解除后补演。
- 同优先级事件采用最新意图获胜；非安全事件不排队。
- Live2D 的 idle/speech motion 使用最低背景 lease；任一安全、授权、错误、任务或显式导航 Jewel 都可使其冻结，但文本与语音状态不能因此中断或丢失。

流式期间的所有权必须显式转移：

- 在首个有效文本 delta 前，Soul Lens 可以用 streamStage mode 表示服务器真实报告的阶段；不得根据本地计时器编造阶段。
- 首个有效 soul.stream delta 到达时，Lens 先落到静态语义终点并释放租约；若 Live2D 嘴型/语音动作已启用，JewelLeaseController 再把租约转给 live2d/speech。二者不能同时更新。
- 无 TTS 时，speech lease 在 soul.decision 后最多再保留 1200ms；有 TTS 时以当前音频实际结束为边界，并继续服从超过 5 秒时的 Pause/Stop/Hide 要求。
- soul.decision、取消、错误、页面 hidden/offscreen 或视觉暂停都会释放 speech lease；释放后嘴型归零，不补演漏掉的 token。
- reduced motion、静态降级或无 WebGL 时不获取动态 streamStage/speech lease；DOM 阶段文字、终稿和一张代表帧承担全部语义。

视觉运行时生命周期：

- Pixi Application 创建后，无论 Live2D model load 成功、拒绝或组件卸载，都必须进入同一个幂等 destroy 路径。
- destroy 可重复调用，不得重复释放或留下 ticker、ResizeObserver、listener、context。
- context lost 后立即停 ticker、释放 lease 并切静态 SVG。
- 自动恢复最多一次；再次失败后保持静态降级，只有用户显式触发 VISUAL_RETRY 才重试。
- 页面 hidden、offscreen 或 reduced 后 250ms 内所有视觉 lease 释放，持续 RAF 为 0。

## 11. 八个 Micro-Wonders

| 名称 | 触发 | 行为 | 降级 |
| --- | --- | --- | --- |
| 星蚀校零 · 冷启动 | Core 与 SSE 首次真正就绪 | 50ms 给静态剪影，200ms 可操作，最多 1200ms 沉降 | 直接显示静态校齐状态 |
| 引力换轨 · 导航 | 用户显式切换人物、聊天、生活流或任务 | 固定 S 曲线，一枚旅星 320ms 换位 | 旅星瞬移＋aria-current |
| 书脊落笔 · 输入聚焦 | Composer、Prompt、命令或搜索获得焦点 | 1px 页签与光标对齐，随后静止 | 双焦点环＋字段名 |
| 孤镜取像 · 流式阶段 | 首个真实阶段或流事件到达 | 只映射真实阶段，不随 token 闪动 | 阶段文字、耗时、取消入口 |
| 证据显影 · 数据揭示 | 用户选择指标、日志、审计或样本 | 显示来源→结论的一条证据链 | 静态行高亮与表格 |
| 主权合印 · 授权执行 | 服务器确认授权成功 | 范围、费用、可回滚性先静止展示，再闭合封印 | 勾号、时间、trace/approval ID |
| 轨道止界 · 错误拒绝 | Guard 拒绝或不可恢复错误 | 旅星在边界停止，不摇屏、不丢输入 | 明确错误、诊断复制、合法下一步 |
| 成卷归脊 · 产物完成 | 成功终态成立，且持久 artifact URI/manifest/hash 齐备 | 产物归入书脊，显示位置、设备、时间与 hash；audit 只作附加证据 | 静态完成通知和文件链接 |

能力门：

- Foundation 只提供 Micro-Wonder 的静态样式、语义 API 与租约框架，不触发未来成功仪式。
- 主权合印要求 canSealApproval=true；远程场景只有 Workstream 5 的服务器 Approval 资源被确认后才可为真。此前只能显示静态“尚未授权/已确认”文本。
- 成卷归脊要求 canReturnArtifact=true；只有 Workstream 3 或 5 提供成功终态与 complete artifact manifest/URI/hash 后才可为真。普通 audit、partial artifact、deny 或 failed 不得触发。
- JewelLeaseController 默认把所有 capability gate 设为 false；业务 projection 明确提供证据后才能开启。

## 12. 内容与语言系统

### 12.1 四空间语气

| 空间 | 语气 | 示例 |
| --- | --- | --- |
| Presence | 亲近、短句、不服务腔 | “……在。干嘛。” |
| Studio | 冷静、协作、证据优先 | “read_file · note.txt · 返回 2 行 · trace t-d1” |
| Control | 精确、后果优先 | “当前文件 hash 链校验通过 · 3 环” |
| Mobile | 极短、状态先行 | “书房工作站最后见到：12 秒前；尚未授权” |

### 12.2 内容披露顺序

    结果 → 影响 → 证据 → 机制 → 原始数据

- Presence 默认显示 display name、活动、对话和送达状态；trace、model、cost 二级披露。
- Studio 默认显示任务、阶段、结果与产物；完整事件 JSON 深层披露。
- Control 默认显示急停、有效策略、地盘和危险底线；overlay 路径、hash 与原始策略深层披露。
- Mobile 默认显示设备、任务、风险与动作；敏感路径、凭据、完整 prompt 和私密记忆默认不展示。

### 12.3 禁用词

- “AI 正在思考”→“Core 已接收”“正在生成回复”“处理轨迹”。
- “在线”→分别写“Core 可达”“事件流已连接”“设备最后见到”。
- “已发送”→收到 ingest 回执后写“Core 已接收 · trace_id”。
- “绝对安全”“零风险”→“Guard 判定：allow/confirm/deny”。
- “日志未被篡改”→“当前文件 hash 链校验通过”。
- “完全本地”→明确本轮使用的本地/云模型、TTS 和 grounding。
- “真实思考”→“处理摘要”“幕僚纪要”。
- “六位幕僚共同判断”→“按信息量启用 2/4/6 席；琐碎闲聊可跳过”。
- “完成”只用于权威 terminal outcome 与所需证据齐备；Guard 通过叫“已放行”；attempt 创建叫“已触发/已开始”；只有 ToolOutcome.status=executed 才叫“已执行”。

## 13. Presence 数据流

### 13.1 发送与回答

    用户输入
      → POST /v1/ingest
      → 收到 event_id + trace_id
      → UI 标记“Core 已接收”
      → soul.stream 临时增量
      → soul.decision 权威终稿
      → 临时气泡原位被终稿接管

要求：

- ingest 回执前只能叫“本地显示”或“发送中”。
- fetch 失败不能静默吞掉；保留 draft、selection、组合文本和诊断。
- soul.stream 不逐 token 触发动效或读屏播报。
- decision 早于/晚于 stream done、done 缺失、decision 缺失、重复 id、乱序 seq 都必须有确定行为。
- 断线重连不得产生重复气泡。
- 用户上滚后不得强制追随流式输出。

### 13.2 Life 与处理轨迹

- agent.thought、moa.report 与 decision 可进入生活/处理时间线。
- 不把这些内容称为“完整真实思维链”。
- 生活流显示整理后的事件摘要、来源与时间。
- 机器标签、完整 trace 和原始 payload 移入 Studio 或 Control。

### 13.3 设置与策略

- 设置提交后不能立即乐观显示成功。
- PUT 成功后重新 GET 权威值。
- 显示生效 revision、写入位置、时间和影响范围。
- 结果未知时先读回，不盲目重复 mutation。

## 14. 统一语义状态机

“统一”指统一事件与派生规则，不是把所有故障域压成单一枚举。运行时至少包含以下并行 regions：

| Region | 状态 |
| --- | --- |
| Core | cold、loading、reachable、offline、error |
| Reply SSE | connecting、open、retrying、closed |
| Life SSE | connecting、open、retrying、closed |
| Conversation | empty、idle、sending、streaming、final、error |
| VisualRuntime | loading、ready、contextLost |
| Visibility | visible、hidden、offscreen |
| Motion | full、reduced、paused |
| Safety | normal、stopRequested、stopUnknown、stoppedLatched、resetting |
| Task | none、draft、queued、planning、approvalRequired、running、terminal |

同一时刻允许组合，例如：Core reachable + Reply SSE retrying + VisualRuntime contextLost + Visibility hidden + Motion reduced + Conversation idle。VisualRuntime contextLost 只能降级视觉，不能把 Core 标为 offline；一条 SSE 断开也不能把另一条已连接 SSE 标为断开。

关键输入事件：

- STATUS_OK / STATUS_FAIL
- INGEST_ACK / INGEST_FAIL
- REPLY_SSE_OPEN / REPLY_SSE_ERROR
- LIFE_SSE_OPEN / LIFE_SSE_ERROR
- STREAM_DELTA / STREAM_DONE / SOUL_DECISION
- WEBGL_READY / WEBGL_LOST / VISUAL_RETRY
- REDUCE_ON / REDUCE_OFF
- VISUAL_PAUSE / VISUAL_RESUME
- DOCUMENT_HIDDEN / DOCUMENT_VISIBLE
- ESTOP_REQUESTED / ESTOP_ACK / ESTOP_ACK_TIMEOUT / ESTOP_RESET_REQUESTED / ESTOP_RESET_ACK
- TASK_SNAPSHOT / TASK_EVENT

关键 guards：

- canSend：Core reachable、输入有效、IME 未组合；设备 e-stop 只停执行副作用，不能让 Presence 对话失语。
- canFinalizeReply：decision.trace_id 与当前请求匹配，且该 decision 尚未消费。
- canAnimate：Visibility visible、Motion full、VisualRuntime ready、当前组件持有 Jewel lease。
- canMutateControl：Core reachable、权威值已加载且 principal 具备目标 scope；只有会启动执行或扩大副作用范围的 mutation 才额外要求 Safety normal。只读、诊断与独立 reset 流程不受该通用 guard 锁死。
- canShowTaskAdvanceEntry（W0）：仅凭 Core reachable、Safety normal 与认证/在线/heartbeat 的前端提示控制入口显隐；它不具备 device session、stop_epoch 或 policy revision，绝不能授权 Task 副作用。
- canAuthorizeTaskAdvance（W5）：actor 已认证、目标设备 online、heartbeat 未超过默认 30s TTL、Safety normal，并绑定当前 device session、stop_epoch 与 policy revision；只有该层可授权创建或推进 Task。
- canApproveTask：actor 已认证、目标设备 online、heartbeat 未超过默认 30s TTL、Safety normal，且 Task revision、action digest、device session、stop_epoch、policy revision 与有效期均匹配。
- canRequestEstop：目标设备可识别，且本地或远程安全通道具备所需身份；不依赖 Core reachable、当前 Safety 或 Task 状态，同一 stop 幂等键可安全重试。即使通道不可达，控件也保持可操作并进入“未送达/送达未知”的诚实状态。
- canResetEstop：principal 通过 reset 专属权限与新鲜二次认证，Safety 为 stoppedLatched，device session 与 expected stop_epoch 匹配，且没有未裁决的并发 stop 请求；不复用 canMutateControl 或 canApproveTask。

派生 UI 优先级只决定显著提示，不抹掉其他 region：

    Safety stoppedLatched / stopUnknown / stopRequested
      > denied / approval required
      > outcome unknown / blocking error
      > Core offline
      > SSE retrying
      > Conversation streaming
      > ready / idle

VisualRuntime contextLost、Motion reduced/paused 和 Visibility hidden/offscreen 使用局部状态标记，不得覆盖上述业务状态。

页面级通用状态词汇（由并行 regions 派生，不是单一枚举）：

    cold
      → loading
      → ready(idle | streaming | success | empty)

    异常：
    offline | denied | error(reason=timeout) | contextLost

    正交 regions：
    viewport(desktop | mobile)
    + Motion(full | reduced | paused)
    + Visibility(visible | hidden | offscreen)

### 14.1 时间规则

- 200ms 内完成的请求不闪 loading。
- 10s 无首个响应进入 error(reason=timeout)，不伪造进度。
- Success 提示至少保留 3s，或直到用户下一动作。
- 连续失败两次或持续 3s 才切普通连接 banner 的 offline；一次成功即可恢复。该去抖只用于信息提示，审批、heartbeat freshness 与 e-stop 必须在证据失效时立即 fail closed。
- role=status 最多 1Hz；阻断性错误才使用 role=alert。
- hidden/offscreen/reduced 后 250ms 内 app-owned RAF 归零。

### 14.2 状态原则

- Cold：DOM shell、标题、composer、急停和静态 Soul 先出现。
- Loading：分区独立 busy，视觉加载不锁核心任务。
- Ready/Idle：S 轨道静态，任务面可立即操作。
- Streaming：一条临时消息，终稿原位接管。
- Empty：只描述当前视图，不谎称全局无历史。
- Offline：保留历史与 draft，明确是否具备可靠队列。
- Denied：说明策略、影响和合法下一步，不提供绕过。
- Error：说明是否可能产生副作用；未知则先查询。
- Context lost：静态 SVG 接管，核心功能不依赖 Canvas。
- Reduced：语义与能力完整，不能以“少显示内容”代替无障碍。

## 15. Mobile Dispatch 协议边界

本节定义目标体验所需的最薄协议边界，不是当前 Core 能力，也不在首轮纯前端重构中启用。

### 15.1 Task 状态机

    DRAFT (client only)
      → QUEUED
      → PLANNING
      → APPROVAL_REQUIRED (optional)
      → RUNNING
      → TERMINAL

TERMINAL.outcome：

- succeeded
- no_action
- denied
- failed
- cancelled
- stopped
- expired
- outcome_unknown

规则：

- QUEUED 可说明 device_offline 或 capacity；设备安全状态不是可等待后自动续跑的队列原因。
- 审批只推进同一份、未过期的 task revision 与 action digest。
- e-stop 是设备级正交状态，不是可自动恢复的 pause。
- 权威 stoppedLatched ACK 会把该设备上所有服务端非终态 Task 转为 TERMINAL(stopped)，使旧 approval 与 attempt 失效；reset 后也不得恢复。
- DRAFT 只存在客户端，可在停止期间保留和编辑，但 Safety 不是 normal 时不得创建服务端 Task；reset 后提交会创建全新的 task_id。
- stopped 任务在复位后保持终态；重试必须生成新 task_id，并带 retry_of 与当前 stop_epoch。
- 外部副作用响应丢失时进入 outcome_unknown，禁止猜成功或自动重跑。

允许的状态转移：

| From | To | 条件 |
| --- | --- | --- |
| DRAFT | QUEUED | 创建请求通过认证与 schema 校验，目标设备 Safety normal、heartbeat 新鲜，并绑定当前 stop_epoch |
| DRAFT | 本地删除 | 尚未创建 task_id |
| QUEUED | PLANNING | 设备认领，device session 与 policy revision 有效 |
| QUEUED | TERMINAL(cancelled/expired) | 用户取消或任务过期 |
| PLANNING | APPROVAL_REQUIRED | Guard 返回 confirm |
| PLANNING | RUNNING | Guard 返回 allow，且没有需人工确认的副作用 |
| PLANNING | TERMINAL(denied/failed/cancelled/expired) | Guard 拒绝、规划失败、取消或过期 |
| APPROVAL_REQUIRED | RUNNING | Approval CAS 成功，且 Guard 在执行前复核通过 |
| APPROVAL_REQUIRED | TERMINAL(denied/cancelled/expired) | 拒绝、取消或过期 |
| QUEUED / PLANNING / APPROVAL_REQUIRED / RUNNING | TERMINAL(stopped) | 目标设备返回权威 stoppedLatched ACK；旧 approval、attempt 与执行许可立即失效 |
| RUNNING | TERMINAL(succeeded/no_action/failed/cancelled/outcome_unknown) | 执行器权威结果；stop 只由上一行的权威 ACK 成立 |
| TERMINAL | 无 | 终态不可迁出；retry 创建新 Task |

所有服务端转移使用 expected revision 的 compare-and-swap。stopRequested 或 stopUnknown 时立即禁止新的 create、claim、approve 与 side effect，但不冒充 stopped；stoppedLatched ACK 到达后由设备安全闩锁优先把所有相关非终态 Task 收束为 TERMINAL(stopped)。approve、deny、cancel 与 e-stop 并发时，e-stop 设备闩锁优先；其余由第一个成功的 CAS 决定，失败客户端必须重新获取权威快照。Reset 只建立新的安全 epoch，永远不迁出旧 Task 的终态。

幂等分层：

- Create Task：客户端提供 create idempotency key 与 request digest；同 key 同 digest 返回同 task_id，同 key 不同 digest 返回冲突。
- Claim/Execute：设备认领后才创建独立 attempt_id 与 execution idempotency key；Task 创建成功不代表已有 attempt。
- Approval decision、cancel、retry、e-stop、reset 各自使用独立幂等键。
- 不可逆下游不支持幂等时，超时必须进入 outcome_unknown。

### 15.2 最小对象

Task：

- task_id、idempotency_key、trace_id、source、goal、target_device_id
- actor { user_id, level, verified_by }
- state、state_reason、outcome、revision、last_event_seq
- execution { attempt_id, device_session_id, policy_revision }
- approval_ref、progress、artifact_refs、error
- created_at、updated_at、expires_at、retry_of

Approval：

- approval_id、task_id、task_revision、action_digest
- human_summary、tool、redacted_args、risk_category、target_scope
- expires_at、status、decided_by、decided_at
- immutable authority_snapshot 或 authority_snapshot_ref，其中至少包含 target_device_id、device_session_id、stop_epoch、policy_revision、task_revision、normalized_tool、canonical_args、target_scope、cost_cap、external_destinations/data_egress 与 expires_at
- authority_snapshot_version、canonicalization = RFC 8785 JCS、digest_algorithm = SHA-256

authority_snapshot 是服务器持久化的审批权威载荷：canonical_args 只在受保护的服务端存储，普通 UI 仅获得 redacted_args；action_digest 必须等于该不可变快照规范序列化后的 SHA-256。approve 时以及每次产生副作用前，服务器都从持久快照重算 digest、验证当前设备/策略/epoch/revision 与有效期，并让审计事件引用同一 snapshot version。客户端提交的 human_summary、tool 或 redacted_args 不能成为执行授权来源。

DeviceSnapshot：

- device_id、session_id、online、last_seen_at
- safety_state、stop_epoch、capabilities、policy_revision

ArtifactManifest：

- artifact_id、task_id、kind、name、mime、size
- sha256、ref、status = complete | partial

### 15.3 审批、断线与急停

- 危险审批显示动作、目标设备、路径/站点、是否外发、风险类别、策略原因、有效期和回滚性。
- 危险批准需要 L3 二次确认，但 actor 所有者等级仍为 L2。
- Approval digest 必须绑定 target device、device session、stop_epoch、policy revision、task revision、规范化 tool/args/scope、费用上限、外发目标和有效期。
- 批准时与每次产生副作用前都重新验证上述绑定，并再次经过现有 Guard；审批不能替代 Guard 对新危险动作的裁决。
- 手机离线时不能乐观批准。
- 创建、审批、拒绝、急停与复位分别使用幂等键。
- e-stop 控件不受 normal 状态、普通 Admin mutation guard 或 Task 状态限制；重复请求返回同一闩锁事实或更高 stop_epoch，不能因已停止而隐藏。
- Reset 使用独立授权、二次认证、expected stop_epoch 与 compare-and-swap；只有 stoppedLatched 可进入 resetting，ACK 后建立新的安全 epoch。Reset 不复用普通配置 mutation，也永不恢复、重排或重新审批旧 Task。
- 重连先拉 Task 快照，再从 last_event_seq 补事件；按 event id 去重、按 revision 防倒退。
- 手机断线不自动终止桌面已认领任务，但必须显示最后同步时间。
- Mobile e-stop 点击后先显示“停止请求发送中”；只有设备 ACK 后显示“设备已停止”。
- 确认 stop 请求未发出时显示“未送达”；请求已发出但 ACK 丢失时显示“送达状态未知／尚未确认设备停止”，不能制造安全假象。
- 权威 stop ACK 表示目标设备已持久化停止闩锁，并返回单调递增的 stop_epoch；HTTP 网关仅接收请求不等于设备已停止。
- 新 stop_epoch 立即使旧 approval 与未完成 attempt 失效。Reset 产生新安全 epoch，但不得重新激活任何旧 Task。
- 本机热键/本地端点维持 <500ms 目标；该目标不能外推为公网 SLA。
- “加入知识”是显式动作，Task 完成不自动污染长期记忆。

### 15.4 候选最薄接口

    POST /v1/tasks
    GET  /v1/tasks/{task_id}
    GET  /v1/tasks/{task_id}/events?after_seq=...
    POST /v1/tasks/{task_id}/cancel
    POST /v1/tasks/{task_id}/retry
    POST /v1/approvals/{approval_id}/decision
    GET  /v1/devices
    POST /v1/devices/{device_id}/heartbeat
    POST /v1/devices/{device_id}/estop
    POST /v1/devices/{device_id}/estop/reset
    GET  /v1/artifacts/{artifact_id}

这些接口复用现有 executor/Guard，不复制安全判定；同时新增持久 Task、设备身份、审批、幂等、事件补放与 artifact 状态层。它们不能引入第二套 Guard 或隐式远程授权。

所有 Task event、device、approval 与 artifact 接口必须按 principal、task ownership、device binding 和 scope 授权，不能只凭可猜测 ID 访问。Heartbeat 只能使用设备凭据与有效 device session，普通用户客户端不能伪造在线状态。

## 16. 组件与运行时边界

建议的语义边界，不在本规格中锁死具体文件名：

- AppShell：路由、主题、skip link、全局状态区。
- ThemeMaterialController：昼夜材质，不能改变业务语义。
- SemanticStateStore：Core/SSE/Task/visual 的语义状态，不存 Pixi 对象。
- PresenceVisualRuntime：唯一拥有 Pixi Application、renderer、ticker、resize、visibility。
- Live2DAdapter：模型 load/update/expression/lip sync，不创建 renderer 或 RAF。
- SoulLensPass：只消费小型 uniform snapshot，不直接访问 React/Zustand。
- JewelLeaseController：仲裁 Live2D、Lens、授权封印与八个 Micro-Wonders。
- OrbitSVG：读取语义状态；即使 renderer 崩溃仍存在。
- AssetManager：校验 manifest/hash，选择 desktop/mobile atlas，失败后一次性降级。
- StateAnnouncer：合并状态文本，避免逐 token 或多节点 live-region 泛滥。
- ConversationRegion：消息列表、临时气泡、终稿接管、滚动主权。
- Composer：IME、语音、发送回执、草稿和错误恢复。
- AdminModuleShell：18 模块索引、面包屑、版本、权限、审计。
- MobileShell / FiveDomainNav：只负责移动布局、五域导航、safe-area 与域切换，不拥有远程执行能力。
- MobileDomainAdapters：消费各 Workstream 提供的只读 projections；缺少 projection 时显示明确未启用状态。
- DispatchClient / MobileTaskRegion：只属于 Workstream 5，消费 TaskSnapshot/TaskEvent/Approval/DeviceSnapshot，不能进入 Foundation 或 Mobile Shell。

页面组件不得直接调用 requestAnimationFrame、getContext 或新建 Pixi ticker。

## 17. 无障碍规格

基线：WCAG 2.2 AA。

### 17.1 结构与键盘

- 每页一个 main，标题层级连续。
- 提供跳至主内容、composer、Admin 主表单或审计的 skip link。
- 使用原生 button、a、input、textarea、select。
- Tab 顺序等于视觉和阅读顺序；S 轨道与 Canvas 不进入 Tab。
- Dialog 打开后进入焦点，Escape 关闭，关闭后回到触发器；非 modal popover 不 trap。
- 异步 success 不移动焦点；表单错误聚焦摘要或首个无效字段。
- Admin 单选分段控件使用 radiogroup 与方向键。

### 17.2 读屏

- Live2D/Canvas 设为 aria-hidden，旁边 DOM 分别说明 Core、事件流、回复与情绪状态。
- Chat 使用语义列表，消息包含作者、正文和可选时间。
- 整条时间线不使用 aria-live。
- soul.stream 不逐字朗读；decision 后一次 polite announcement。
- Offline、denied、context lost 每次转换只播报一次。
- S 轨道图形隐藏，因果由独立 DOM 状态表达。
- StateAnnouncer 必须位于所有 aria-busy 子树之外，使用单一 DOM 节点原子更新；普通状态最多 1Hz，权威终稿只播报一次。

### 17.3 触控、缩放与对比

- 主要触控目标至少 44×44 CSS px，间距至少 8px；最低不得小于 24×24。
- 无 hover-only、长按-only 或精确手势-only 行为。
- 正文/表单至少 4.5:1；大字、边界、焦点和图形状态至少 3:1。
- 200% zoom 无裁切；400% 或 320 CSS px 时单列 reflow。
- 除真实二维数据表外，不允许整页横向滚动。
- 必要信息不能使用当前低透明 text-ink-3 或 7% hairline 单独承载。
- Reduced Motion 与 Pause/Stop/Hide 是两个独立能力。任何自动 Live2D、Lens 或环境运动若持续超过 5 秒，必须自动停止或提供可持久化的“暂停视觉动态”控制；暂停后不影响文本、状态与操作。

### 17.4 IME

发送前必须执行：

    if (event.isComposing || event.keyCode === 229) return;

- composition 期间或 keyCode 229 不发送。
- compositionend 后下一次 Enter 才发送。
- Shift+Enter 换行。
- 失败保留 draft、selection 与组合文本。
- 覆盖微软拼音、macOS 拼音、日文 IME 和 Android Gboard 中文。

## 18. 性能与工程预算

### 18.1 当前必须偿还的视觉债务

- 至少 5 条持续链路：Pixi ticker、Starfield、DustMotes、两个 FlameCore。
- 多个 2D Canvas 各自每 500ms 读取样式。
- 当前 hidden 只跳过 draw，没有真正停 RAF。
- Live2D DPR 无上限。
- 两张 2048² 纹理解码约 32MiB；Mobile 尚无 1024 atlas。
- Live2D model 引用两个缺失声音文件。
- 模型来源未固定 version/hash，许可与再分发需复核。
- Live2D 加载失败存在 app/context 清理风险。
- Worker 会发布 presentation.tts，相关默认设置需与“网页默认静音、用户显式开启”原则对齐。

实施原则：

- Starfield、Dust、Flame 不再各自拥有持续循环。
- 无数据装饰静态化或移除。
- Lens 复用现有 Pixi。
- Presence 之外默认不安装 Live2D。

### 18.2 硬预算

| 指标 | Presence Desktop | Presence Mobile | Studio | Control |
| --- | ---: | ---: | ---: | ---: |
| WebGL context | ≤1 | ≤1 | ≤1，按需 | 0 |
| app-owned 持续 RAF | ≤1 | ≤1 | active ≤1 | 0 |
| hidden/offscreen/reduced RAF | 0 | 0 | 0 | 0 |
| 视觉帧率 | 30fps | 24fps | active 30fps | 无持续动画 |
| DPR cap | 1.5 | 1.25 | 1.5 | n/a |
| Live2D + Lens | ≤8k tris / ≤110 calls | ≤8k / ≤96 calls | 不与 Live2D 同屏 | n/a |
| ASTR texture + RT | ≤64MiB | ≤32MiB | ≤48MiB | 0 |
| 视觉 JS P95 | ≤4ms/frame | ≤6ms/frame | ≤5ms | n/a |
| GPU P95 | ≤6ms/frame | ≤8ms/frame | ≤7ms | n/a |

其他门槛：

- LCP ≤2.5s。
- INP ≤200ms。
- CLS ≤0.1。
- TBT ≤200ms。
- 10 秒流式期间无 >50ms long task。
- 30 分钟 soak 后 JS heap 回收净增长 <10MiB。
- 同屏 data-dynamic-jewel="active" 数量 ≤1。
- Soul Lens 自身 gzip 增量 ≤25KB。
- Presence 可选视觉传输体积：Desktop ≤4MB，Mobile ≤1.5MB；Mobile 必须使用 1024 atlas，不请求 2048 atlas。

### 18.3 固定测量档

- Desktop：Chrome 149.0.7827.201、Windows 11 24H2、Intel Core i5-8250U、Intel UHD 620、16GiB。
- Mobile：Pixel 6a、Tensor GS101、6GiB、Android 15、Chrome 149。
- 4× CPU 与 Fast 4G 冷缓存作为附加 throttling 档。
- 丢帧按相对 30fps/24fps 目标 cadence 的 missed ticks 统计，不以 60Hz 原始刷新率作分母。
- Device viewport 覆盖 DPR 1/2；renderer 分别封顶 1.5/1.25。
- 64/32MiB 只统计 ASTR 管理的纹理与 render target。
- hidden/reduced 切换 250ms 后观察 10 秒，app-owned RAF 必须为 0。
- 每个 viewport 分别执行 5 次冷缓存与 5 次暖缓存。用户体验门槛以冷缓存 p75 为准，暖缓存记录 median 用于回归；4× CPU/Fast 4G 档同样承担 LCP、INP、CLS、TBT 门槛。
- 帧 cadence、视觉 JS P95 与 long task 通过 PerformanceObserver、RAF timestamp 和自定义 marks 采集。
- Draw calls、triangles、纹理与 render target 通过 Pixi renderer instrumentation 与 Spector.js capture 采集。
- GPU P95 优先使用 EXT_disjoint_timer_query_webgl2；不可用时记录 Spector/浏览器 GPU trace，并把“不支持精确 GPU timer”作为结果元数据，不能凭主观流畅度判定。
- DPR 断言比较 canvas backing width/height 与 client size，必须满足 renderer cap。

## 19. 测试与验收

### 19.1 自动化

- 所有 route × 核心状态运行 axe，critical/serious = 0。
- 使用 role/name 定位业务控件，data-ui-state 等属性只用于状态与运行时测试。
- 静态检查拒绝新增绿色 token/硬编码。
- Hook HTMLCanvasElement.getContext，验证 context 数。
- Hook RAF，验证稳态、hidden、offscreen、reduced。
- 验证同屏动态 Jewel ≤1。
- 断言 canvas backing size 不超过 DPR cap。
- 断言 Lens triangles/calls、Live2D+Lens 总 calls 与纹理/RT 估算字节。
- 断言 30/24fps 目标 cadence 的 missed ticks、视觉 JS/GPU P95 与 long task。
- 断言 Desktop/Mobile 视觉资源传输体积和 Mobile atlas 选择。

建议的测试属性：

- data-ui-state
- data-sse-state
- data-visual-runtime
- data-soul-lens-fallback
- data-orbit-state
- data-dynamic-jewel

### 19.2 SSE 竞态

- decision 早于/晚于 stream done。
- done 永远不来。
- decision 永远不来。
- trace 不匹配。
- 重连后 duplicate event id。
- duplicate/乱序 seq。
- malformed JSON、空 delta、1000 token burst。
- route 卸载时存在 reconnect timer。
- 临时气泡最终只保留一条。
- 断线后 draft 不丢、不重复发送。

### 19.3 Live2D 与 Canvas

- Cubism Core、model JSON、moc、texture 分别 404。
- WebGL 不可用、shader compile fail、context lost/restored。
- 在 core load、dynamic import、model load 三阶段快速卸载。
- 连续 mount/unmount 20 次。
- ResizeObserver、orientation、DPR、零尺寸容器。
- reduced-motion 初始开启与运行中切换。
- hidden/offscreen 后 250ms 停表。
- localStorage 中 NaN、Infinity 与越界值。

### 19.4 人工无障碍

- Windows Chrome/Edge + NVDA。
- Windows Firefox + NVDA。
- macOS Safari + VoiceOver。
- iOS Safari + VoiceOver。
- Android Chrome + TalkBack。
- Keyboard only、touch only、移动端硬件键盘。
- 200%/400% zoom 与 WCAG 1.4.12 文字间距。

### 19.5 Task 安全

- 同一 create idempotency key + request digest 重复 100 次只创建一个 Task；在设备认领前不创建 attempt。
- 同一 key 携带不同 request digest 必须冲突拒绝。
- 同一 execution idempotency key 只能创建一个 attempt。
- task revision、action digest、device session、stop_epoch、policy revision 或 expiry 不匹配时 fail closed。
- 任意状态断线后恢复，无倒退、重复或漏 artifact。
- e-stop ACK 前不显示停止；请求未发出显示未送达，ACK 丢失显示送达状态未知。
- reset 后 stopped 任务不恢复。
- 执行成功但响应丢失时进入 outcome_unknown，不重复副作用。
- Artifact SHA-256、partial/complete 与访问授权正确。
- 提交、Guard、审批、拒绝、过期、急停、复位、执行和 artifact 共享 task_id/trace_id。
- 跨 principal/task/device 的 IDOR 请求全部拒绝。
- 旧 approval、旧 device session、旧 stop_epoch 与过期凭据重放全部拒绝。
- 普通用户客户端伪造 heartbeat 或 device capability 时拒绝。
- approve、deny、cancel 与 e-stop 并发时，结果符合 revision CAS 与 e-stop 抢占规则。
- 未授权 principal 不能读取 artifact；部分上传不能冒充 complete。

## 20. 实施拆分

这是一个统一的 Master Spec，但不是一次“大爆改”，也不能导向一份覆盖六个工作流的 implementation plan。每个 Workstream 必须单独经历子规格、计划、实现与验收。当前书面规格获批后，只进入 Workstream 0：Foundation 的 writing-plans。

### Workstream 0：Foundation

- 语义 token、昼夜材质、禁绿规则。
- AppShell、skip links、StateAnnouncer。
- SemanticStateStore。
- 运行时与性能观测钩子。
- 基础无障碍与测试 harness。

### Workstream 1：Presence

- S 形引力轨道。
- 聊天/人物/生活流的有机布局。
- ingest/stream/decision 真实状态。
- Composer、语音、IME、错误恢复。
- PresenceVisualRuntime、Live2DAdapter、SoulLensPass。
- 移除或静态化多余 Canvas 循环。

### Workstream 2：Control

- Admin shell 与 18 模块索引。
- 建立 18 个目标路由与明确的 available/planned 状态。
- 迁移现有 Effector policy/audit/e-stop。
- Admin 保持 0 WebGL 与高密度扫描能力。
- 验收终点到此为止；其余 17 个模块分别根据真实后端成熟度另立子项目，不属于 Workstream 2。

### Workstream 3：Studio

- Workstream 3A 先定义并实现安全、只读、可授权的 Studio projections。
- Workstream 3B 在 projections 稳定后新建 /studio shell。
- 默认 0 WebGL。
- 只展示 projection 可证明的阶段和结果。

Studio projection prerequisites：

| Studio 信息 | 当前真实来源 | 当前网页缺口 | 子规格要求 |
| --- | --- | --- | --- |
| Model/Router | ModelRouter、routes.yaml、ledger | status 只有当前 local model 与今日总成本 | RunProjection：model、provider、route、per-run cost |
| Tool action/result | 内部 effector.action/result 与 Dispatcher outcome | 当前 SSE 未暴露 | 授权后的 ToolProjection，参数脱敏 |
| Trace/stage | Event trace_id、bus、Guard audit | 无通用 trace read API | TraceProjection，按 principal/scope 授权 |
| Source/citation | 模型/工具输出中的来源 | 无统一来源 schema | SourceProjection：URI、title、quote、hash |
| Artifact | output、screenshot_ref 等零散字段 | 无 manifest、完整性或权限接口 | ArtifactProjection：URI、sha256、complete/partial |
| Workspace/file | 当前没有 Studio workspace | 无 workspace API | 最小 WorkspaceProjection 或本地项目适配器 |

在这些 projections 可用前，Studio shell 只能显示明确的未启用/无数据状态，不能用假任务、假成本或假 artifact 填充。

### Workstream 4：Mobile Shell

- MobileShell 与 FiveDomainNav。
- 露怀秋域消费 Workstream 1 的 CoreStatus/ConversationProjection。
- AI 工作台消费 Workstream 3 的 Workspace/Run projections。
- 知识域要求 SoulPackage/Memory 的安全只读 projection。
- 设备与安全域在本地可信模式下消费 Workstream 2 的 EffectorProjection；远程 DeviceSnapshot 不属于本工作流。
- Task 协议前，任务域只显示明确标注的本地草稿，不展示远程设备状态。
- 不开放远程副作用。

Workstream 4 的壳层可在 Foundation 后开发，但完整验收必须等待上述 read projections；缺少数据源的域必须显示能力未启用，而不是 mock 数据。

### Workstream 5：Secure Task / Dispatch

- 单独的跨栈规格与威胁模型。
- 持久 Task、设备配对、身份、approval、idempotency、event replay、artifact、remote e-stop ACK。
- DispatchClient / MobileTaskRegion 只在协议、认证、授权和负向安全测试通过后接入 Mobile。
- 完成协议与安全评审前，Mobile 不得点亮远程执行。

唯一依赖 DAG：

    Workstream 0 Foundation
      ├─→ Workstream 1 Presence
      ├─→ Workstream 2 Control Shell
      └─→ Workstream 3A Studio Projections → Workstream 3B Studio Shell

    W1 CoreStatus/ConversationProjection
      + W2 EffectorProjection
      + W3 Workspace/Run/ArtifactProjection
      + Knowledge Read Projection
        → Workstream 4 Mobile Shell 完整验收

    W0 Foundation
      + W4 Mobile Shell
      + 独立 Task Protocol / Threat Model / Auth
        → Workstream 5 Secure Dispatch Client Enablement

Workstream 1、2、3A 可在 Foundation 稳定后并行。Workstream 4 的纯壳层可提前开发，但完整域内容依赖各自 projection。Workstream 5 的协议设计可并行研究，任何远程 UI enablement 必须最后通过安全门。

## 21. 非目标

- 不重写 SoulOrchestrator、Memory、Router、Guard 或现有执行语义。
- 不在前端复制 Guard 判定。
- 不在首轮引入 Three.js/R3F/Babylon。
- 不通过解析 thought 文本推断 Task。
- 不让 Mobile 直接暴露本地 Core 到公网。
- 不一次实现 18 个 Admin 模块。
- 不把 Studio/Mobile 蓝图描述为当前功能。
- 不做自动播放声音、鼠标尾迹、滚动劫持、常驻粒子、彩纸或烟花。
- 不为设计稿清理、覆盖或提交用户当前未完成的前端改动。

## 22. Soul-grade 自评

| 维度 | 得分 |
| --- | ---: |
| Human truth 与情感精度 | 11/12 |
| 概念原创性 | 11/12 |
| 视觉必然性 | 11/12 |
| 构图与层级 | 9/10 |
| 极简/极繁张力 | 9/10 |
| Surface/Jewel 工艺 | 10/10 |
| 交互与 Micro-Wonders | 9/10 |
| 内容与证据 | 8/8 |
| 可用性与认知清晰 | 8/8 |
| 无障碍韧性 | 4/4 |
| 技术与性能 | 4/4 |
| **总分** | **94/100** |

扣分来自两个真实风险：

1. Studio、18 模块 Control 与 Mobile 尚未以真实数据完成界面验证；
2. Secure Dispatch 需要独立协议、威胁模型和真机验证，不能只凭视觉规格宣布成立。

本规格通过以下失败测试：

- 模板测试：核心语法不能无改动复制给普通 AI SaaS。
- Any-brand 测试：Soul/model 分层、主权书脊和 S 形因果轨道属于 ASTR。
- 五秒记忆测试：用户可复述 Soul Lens、星蚀缺口或 S 曲线。
- Meaning 测试：主要视觉决策均能回指身份、关系、授权或证据。
- Noise 设计测试：规格要求实施时移除装饰性星点和独立 3D context，并统一持续 Canvas 调度；尚待代码与真机验证。
- Mobile 设计测试：五域独立构图已定义；尚待真实移动端实现验证。
- Reduced Motion 设计测试：静态 SVG 与文本保留品牌身份的方案已定义；尚待浏览器与辅助技术验证。
- Engineering 测试：渲染 context、draw calls、DPR、GPU 内存和 RAF 均有硬预算。
- Ethics 测试：情感设计解释状态与关系，不用人格化诱导授权。

## 23. 书面规格复核门槛

在进入 implementation plan 前，用户需要确认：

1. 四空间与五域信息架构无误；
2. Presence 的 S 形轨道与 Soul Lens 保留；
3. Control 的 18 模块是分波目标，而非当前完成状态；
4. Studio 与 Mobile 明确属于新界面；
5. Secure Dispatch 作为独立工作流，不在纯前端重构中偷改后端；
6. WCAG、性能和安全门槛可以作为实施验收标准。

用户批准本书面规格后，下一步只调用 writing-plans 为 Workstream 0：Foundation 生成实施计划。Presence、Control、Studio、Mobile 与 Secure Dispatch 分别在自己的子规格获批后再生成各自计划。
