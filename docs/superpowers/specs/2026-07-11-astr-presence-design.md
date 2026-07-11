# 星枢 ASTR Workstream 1：Presence 子规格

> 日期：2026-07-11  
> 状态：在 Master Spec 已批准基础上的实施规格  
> 范围：`/` 的 Presence 体验、真实数据流、S 形引力轨道、统一 Pixi/Live2D 运行时  
> 非范围：后端契约重写、远程 Secure Task、Studio、Control 18 模块、Mobile 五域壳

## 1. 目标与设计判断

Presence 不是管理台首页，也不是人物立绘旁挂一个窄聊天框。它是人与 Soul 共在的私密星图：对话是主要行为，人物是持续在场，生活流是可展开的密度岛，固定 S 形引力轨道只负责把四个端点的关系显出来。

这一 Workstream 必须同时完成两件事：

1. 把当前 474 行单体 Client 页面拆成有真实状态、错误恢复和滚动主权的会话体验。
2. 把 Starfield、Dust、Flame 与 Live2D 的多套持续循环收敛为最多一个 Pixi Application、一个 ticker、一个 app-owned RAF 链路。

视觉基调沿用全局宪法：夜间以蓝、紫、近黑为主；日间做材质反转；不使用绿色；高细节只属于 Soul Lens 与人物共用的唯一视觉运行时。先锋感来自比例、星蚀缺口、轨道和空间穿插，不把输入、正文或消息气泡做成难用的异形容器。

## 2. 当前事实与不可伪造边界

Presence 只能消费当前 Core 已提供的事实：

- `GET /v1/status`：内部 Soul handle、model、成本、预算、情绪与可选 activity。
- `POST /v1/ingest`：只确认接收，返回 `event_id` 与 `trace_id`，不返回最终回答。
- `GET /v1/stream`：命名 SSE 事件 `agent.thought`、`soul.stream`、`soul.decision`、`moa.report` 等。
- `POST /v1/voice/transcribe`：音频转写；它本身不证明“只识别主人”。
- `GET/POST /v1/voiceprint/*`：声纹录入状态与录入。
- `GET /v1/effector/status`、`POST /v1/effector/estop`、`POST /v1/effector/estop/reset`：本机执行层安全状态。

当前 SSE 没有浏览器可提交的 replay cursor、HTTP event id 或可靠断线补发；因此前端可以去重已看到的事件，但不得声称断线期间事件完整、不得伪造历史或远程 Task 节点。`soul.stream` 是临时文本，`soul.decision` 是权威终稿。`soul_name` 是内部 handle；只有后端真的提供 `display_name` 时才显示为人物名。

急停只约束执行副作用，不让聊天失语。Controller 启动即 GET `/v1/effector/status`；首个权威读回前显示“安全状态核验中”，不得把 Foundation 的初始 `normal` 当作设备证据，但急停按钮仍然可用。任何急停/复位都以 POST 成功后再 GET `/v1/effector/status` 的权威读回为准，禁止本地乐观翻转。读回失败或读回值与请求目标相反时进入“送达未知/结果不一致”，保留重试与诊断；reset 后仍为 stopped 时继续显示已闩锁。

## 3. 空间构图

### 3.1 Desktop

页面使用一块非对称、非卡片网格的 Presence 场：

- 顶部是细长主权书脊，承载星枢标识、连接状态、主题、视觉暂停、设置、Control 入口与本机急停。主题与视觉暂停继续由 AppShell 的唯一控制实例提供，Presence header 通过 route-control slot 进行构图，不复制第二枚按钮。
- 主场默认约为聊天 58% / 人物 42%。聊天列拥有真正可阅读的宽度；人物不被压成侧栏。
- 深聊状态由用户显式触发，聊天扩至约 72%，人物缩为仍可辨认的持续在场，不自动因为消息数量跳动布局。
- 生活流默认为沿轨道悬挂的摘要端点；展开后成为覆盖主场一部分的独立密度岛，不是 220px 窄栏。
- Task 端点在当前协议缺失时只显示“远程任务尚未启用”的能力边界，不生成任务数量、进度或因果节点。

完整 S 形轨道为一张 `aria-hidden` 的 DOM/SVG 图层，视口变化时换用预定义的 desktop/compact path，但同一断点内路径不因业务状态变形。轨道上的四个 DOM 端点按阅读顺序仍是人物、对话、生活、任务；旅星只在用户显式切换端点或真实状态迁移时做一次 320ms 移动，Reduced Motion 下瞬移。

### 3.2 Mobile 与窄屏

本 Workstream 只保证 `/` 的响应式 Presence，不提前实现 Workstream 4 的五域 MobileShell：

- 320 CSS px 起单列重排，人物保持可见但采用静态/轻量舞台。
- 对话与 composer 优先，生活流以全宽 sheet/section 展开。
- 使用 `100dvh`、safe-area inset；软键盘出现时 composer 和焦点不被遮挡。
- 所有主要触控目标至少 44×44 CSS px，页面无横向滚动。
- Mobile 默认静态 SVG Lens；视觉资源不得主动请求 desktop 2048 atlas。

## 4. 信息与内容层级

默认首层只显示：人物 display name（存在时）、activity、对话、发送回执、Core/SSE 状态和急停状态。内部 handle、model、成本、trace id 放在二级披露区域；不得把内部 handle 当作已经证实的品牌姓名。

状态文案遵循事实：

- ingest 前：“发送中”或“仅在本地”。
- ACK 后：“Core 已接收”，并可展开 `event_id` / `trace_id`。
- SSE 断线：“实时连接中断，断线期间内容可能不完整”。
- 只有 decision 到达后才叫“回答完成”。
- 思考/研讨内容叫“处理片段”或“生活记录”，不叫“完整真实思维链”。
- 语音错误明确区分权限拒绝、录音失败、转写失败、空转写和 Core 不可达。

## 5. 数据与状态架构

### 5.1 单一数据控制器

`PresenceController` 是唯一业务协调层：

- 创建一条 EventSource 连接并在其中分发 reply 与 life 事件；不再建立两条物理 SSE。
- 维护一个 status poller 和一个 effector status readback；组件不能各自轮询。
- 启动即核验 effector status，在权威证据到达前单独保存 `safetyEvidence=checking`，不得从语义初值推断设备未闩锁。
- 将网络事实 dispatch 到现有 `semanticStore` 的并行 regions。
- 持有 `CoreStatusProjection` 与 `ConversationProjection`，不把 Pixi 对象放进 Zustand/React state。
- 卸载时关闭 EventSource、清除 retry/status/timeout timer，防止路由离开后重连。

Controller 与 Jewel runtime 都通过 `useSyncExternalStore` 暴露状态。`getSnapshot` 在状态未变化时必须返回同一个不可变引用，`subscribe` 身份稳定，并提供确定性的 `getServerSnapshot`；Strict Mode 的 mount/unmount/remount 不得创建两个 controller、poller、EventSource 或 Jewel singleton。

Reply SSE 与 Life SSE 仍是两个语义 region，因为同一物理连接里不同事件的处理故障不能互相抹除。当前 Core 只有一条 transport，transport error 时两个 region 都进入 retrying；解析单个 life payload 失败只能丢弃该帧并记录诊断，不能把 reply region 标成离线。

### 5.2 会话归并

前端一次只允许一个 active local request；发送中快速双击只产生一个 ingest。每次发送建立 `{localMessageId, text, eventId?, traceId?, status}`。因为 Core 会先 publish 再返回 ACK，Controller 还维护一个有容量上限、带 TTL 的 pre-ACK reply buffer：ACK 前到达的 `soul.stream` / `soul.decision` 先按真实 `trace_id` 暂存，不能提前归类为 external。

1. 本地消息先进入 `sending`，但 draft 只在 ACK 成功后清空。
2. ingest ACK 绑定权威 `event_id` / `trace_id`，随后按到达顺序重放 buffer 中同 trace 的帧；不匹配帧才进入 external 规则。
3. ACK 失败、buffer TTL 到期或请求结束时必须释放暂存；其中权威 `soul.decision` 按 external rule 保留一次，无法绑定的 provisional stream delta 丢弃并记录可展开诊断，不能把 decision 静默删除或把无主 delta 冒充终稿。任何帧仍按 event id 去重，不能在重放时重复显示。
4. 只有与 active `trace_id` 匹配的 stream/decision 才接管该临时回答。
5. 非 active trace 的真实 decision 可作为外部/历史回答保留一次，但不能完成当前请求。
6. 按事件 `id` 去重；stream 的 `seq` 只接受严格递增。重复、乱序或空 delta 不重复追加。
7. decision 无论早于还是晚于 stream done 都原位接管临时气泡；之后同 trace 的 stream 不得覆盖终稿。
8. stream done 缺失不影响 decision 完成；decision 暂缺时保留临时文本并显示“等待终稿”，不伪造成功。
9. 请求 10 秒无首个有效 stream/decision 时进入可恢复 timeout；保留消息、draft 备份、receipt 与诊断。timeout 后同 trace 的 late decision 仍可权威接管，但必须标注为迟到终稿且只消费一次。

由于当前协议没有 replay cursor，重连后只能以 event id 去重当前进程已见事件，并明确提示可能缺口。

### 5.3 滚动主权

消息列表只在以下情况自动贴底：首次加载、用户仍在底部阈值内、或用户自己刚发送。用户上滚后，stream delta 不抢夺滚动；显示“回到最新”按钮与未读计数。decision 原位接管不得引起整页布局跳动。

## 6. Composer、语音与错误恢复

Composer 使用原生 `textarea`：

- `event.isComposing || event.keyCode === 229` 时 Enter 不发送。
- Shift+Enter 换行；compositionend 后下一次 Enter 才发送。
- draft、selectionStart、selectionEnd 与组合文本在 fetch/转写失败时保留。
- send guard 只要求 Core reachable、非空输入、非 composition；e-stop 不禁用聊天。
- ACK 失败后给出“重试发送”和“复制诊断”，不静默吞错；重试复用原文本但创建新的本地 attempt，不假装幂等。

语音为显式两段操作：开始录音、停止并转写。权限状态、录音时长、转写 busy 和错误都用文字呈现；空转写不自动发送。转写成功先回填 textarea，由用户确认发送，避免错误识别直接触发下游行为。录音有明确最大时长和取消动作；路由卸载/取消必须停止全部 MediaStream tracks、关闭 AudioContext 并忽略迟到转写。网页默认静音。

## 7. 视觉运行时

### 7.1 PresenceVisualRuntime

只有 `PresenceVisualRuntime` 可以：

- 创建和销毁 Pixi `Application`；
- 拥有 renderer、stage、ticker、ResizeObserver、WebGL context listeners；
- 执行 30fps desktop / 24fps mobile cadence；
- 设置 DPR cap：desktop 1.5，mobile 1.25；
- 向 `runtime-metrics` 写入 context、RAF、draw-call、texture estimate；
- 根据 semanticStore 的 visibility、motion、visualRuntime 与 offscreen 状态启停 ticker。

`PresenceVisibilityCoordinator` 独立保存 `documentVisible` 与 `viewportOnscreen` 两条事实，由一个 `PresenceVisibilityBridge` 拥有 IntersectionObserver（阈值为可测试常量并在卸载时清理），按 `hidden > offscreen > visible` 原子派生单一 Visibility region。document visible 不得先派发 visible 再补 offscreen，从而产生短暂 lease/RAF。

页面组件、`Live2DAdapter`、`SoulLensPass` 不得创建 renderer、ticker、RAF 或调用 `getContext`。Pixi/Live2D 通过 Client Component 顶层 `next/dynamic(..., { ssr: false })` 懒加载，DOM shell、composer、急停和静态 Soul 先渲染。

Application 一旦创建，model load 成功、拒绝、快速卸载、context lost 都进入同一个幂等 destroy 路径。完整场景成功后只 dispatch 一次 `WEBGL_READY`；retry 先进入 loading。context lost 时立即停 ticker、释放 Jewel lease、切换静态 SVG；自动恢复最多一次，再失败显示可访问、至少 44px 的“重试视觉”控件，只有用户显式触发 `VISUAL_RETRY` 才再试。

hidden、offscreen、reduced 或 paused 后 250ms 内 app-owned RAF 为 0。Reduced Motion 与用户“暂停视觉动态”保持独立；恢复时显式暂停优先。

### 7.2 Live2DAdapter

Adapter 只负责：Cubism Core/model/texture load、模型挂载、transform、expression、代表帧和嘴型参数。它不拥有 renderer/ticker，禁止 `Live2DModel.registerTicker` 与 `PIXI.Ticker.shared`；创建模型必须 `autoUpdate:false`，仅由 PresenceVisualRuntime 的 application ticker 调用 `model.update(deltaMS)`。Live2D 只有在持有 `live2d/idle` 或 `live2d/speech` lease 时更新；失去 lease 立刻把嘴型归零并冻结代表帧。

旧 `Starfield`、`DustMotes`、`FlameCore` 的独立 Canvas 循环删除或改为静态 CSS/SVG。无数据时不补装饰星点。Live2D 获取脚本必须固定上游 commit/SDK version；可执行 Core、model、moc、texture 等资产有 SHA-256 manifest 与来源/许可证记录。clean checkout preflight 校验缺失/hash 不匹配并 fail closed 到静态 Soul；模型配置中缺失的声音引用明确降级，不请求不存在资源。许可证/再分发仍需人工确认时必须标成未确认，不能由本地缓存或 E2E 通过代替。

### 7.3 SoulLensPass 与全局 Jewel

Soul Lens 是同一 Pixi stage 内的 2-triangle single-pass quad：中心 Soul identity 固定，中环表示 model shell，外环表示 memory continuity/provenance。当前后端没有 provenance projection，因此外环以“未提供”静态态呈现，不能伪造连续性百分比。

W1 建立应用级 Jewel runtime bridge：一个共享 `JewelLeaseController` 订阅 semanticStore 环境并发布当前 lease 快照。每次 acquire 返回本地 generation/token；completion/release 必须匹配 token，避免旧的同 owner/mode 动画释放新 lease。

stream 所有权顺序：首个有效 delta 前，只有与 active trace 匹配的真实处理事件时 Lens 才可取得 `soulLens/streamStage`；后台 heartbeat 或其他 trace 的 thought 不能触发。首个有效 delta 先让 Lens 落到静态终点并释放，再允许 Live2D speech；decision、错误、取消、hidden/offscreen/reduced/paused 都释放 speech，绝不逐 token 重启动画。

## 8. 无障碍与语义

- 页面只有一个 `main#main-content` 和连续标题层级；除全局“跳到主内容”外，Presence 提供“跳到消息输入”链接与可聚焦 composer target。
- Orbit SVG、Canvas、Live2D 均 `aria-hidden`、不可聚焦；邻近 DOM 分别说明 Core、reply SSE、life SSE、conversation、visual fallback 与轨道当前端点。
- 聊天使用语义列表，每条消息有作者、正文与可选时间；整条 timeline 不设 live region。
- 终稿只通过全局 `StateAnnouncer` 播报一次；stream delta 不播报。
- 设置层若为 dialog，则打开聚焦、Escape 关闭、关闭后回到触发器；否则实现为不 trap 的 popover 并标明语义。
- 200% zoom 无裁切；400%/320px 单列；焦点、正文、状态均满足 WCAG 2.2 AA。

## 9. 组件边界

建议落地边界：

- `app/page.tsx`：Server Component，只装配静态壳与一个 Presence client boundary。
- `components/presence/PresenceExperience.tsx`：客户端协调视图，不直接操作 Canvas。
- `PresenceHeader`：品牌、真实状态与安全入口。
- `OrbitSVG` / `OrbitNavigation`：固定图形和 DOM 端点状态。
- `ConversationRegion` / `MessageTimeline`：会话与滚动主权。
- `Composer` / `VoiceInput`：IME、draft、selection、录音和转写。
- `LifeRegion`：处理/生活摘要与独立展开密度岛。
- `SoulPresence`：静态身份说明与视觉运行时 slot。
- `PresenceController`：Core/SSE/readback/timeout。
- `PresenceVisibilityCoordinator` / `PresenceVisibilityBridge`：独立 document/viewport 证据与原子派生。
- `PresenceVisualRuntime`、`Live2DAdapter`、`SoulLensPass`：唯一视觉运行时内部模块。
- `JewelRuntimeBridge`：semantic environment、lease generation 与静态终点。

旧 `components/astr/*` 只在语义与生命周期满足本规格时复用；不得为了保留旧结构而让新组件继续依赖单体页面。

## 10. 验收门槛

### 10.1 自动化

- 纯 reducer 覆盖 ACK/失败、pre-ACK delta/decision 缓冲与重放、trace 匹配、early/late decision、missing done/decision、duplicate id、乱序 seq、malformed frame、timeout/late decision、快速双击单 ingest。
- 组件测试覆盖 IME 229、composition、Shift+Enter、失败保留 draft/selection、语音成功只回填不自动发送、滚动主权与一次终稿播报。
- transport 测试断言 connecting/open/retrying/closed、只有一条 EventSource、卸载清 timer/reconnect、不同语义 region 不互相抹除。
- external-store 测试覆盖稳定 immutable snapshot、`getServerSnapshot`、Strict Mode 单例，以及 `renderToString + hydrateRoot` 无 hydration/infinite-loop 警告。
- visual runtime 测试覆盖 document/viewport 完整转换矩阵、阶段性 404、快速卸载、幂等 destroy、`WEBGL_READY`、context lost/一次自动恢复/显式 retry、DPR cap、zero-size、20 次 mount/unmount、shared ticker 零监听。
- instrumentation 断言 Presence WebGL context ≤1、持续 app-owned RAF ≤1、hidden/offscreen/reduced 250ms 后为 0、同屏 active Jewel ≤1。
- 静态检查拒绝页面组件的 RAF/getContext/Pixi ticker 与新增绿色 token/硬编码。

### 10.2 浏览器、性能证据与人工

- Desktop、1280、768、390、320 宽度下验证默认 58/42、深聊 72/28、生活岛、100dvh 与 safe area。
- 日/夜主题均验证对比、星蚀缺口、轨道与静态 fallback。
- Core 在线、离线、SSE retry、streaming、final、timeout、context lost、e-stop unknown/latched 组合不互相覆盖。
- 键盘全流程、200%/400% zoom、Reduced Motion、视觉暂停；全页恰好一个 pause 控件、一个 live region，并有 composer skip target。
- 生产 build 后进行真实浏览器截图与控制台检查；无 hydration、uncaught、WebGL leak 或横向滚动错误。

验收证据分层，禁止把 mock Core E2E 全绿等同于硬件认证：

- 自动门：真实 RAF/context、calls/triangles、纹理/RT bytes、DPR、资源传输、Lens gzip、10 秒流式 long task，以及浏览器可采集的 LCP/INP/CLS/TBT 原始值。schema 驱动的 budget evaluator 必须把环境无关门槛写成超限即失败：Desktop/Mobile context ≤1、持续 RAF ≤1、hidden/offscreen/reduced RAF=0、DPR ≤1.5/1.25、Live2D+Lens ≤8k triangles 且 ≤110/96 calls、ASTR texture+RT ≤64/32MiB、Presence 可选视觉传输 ≤4/1.5MB、Lens gzip ≤25KB、10 秒流式无 >50ms long task。不能只有“记录数值”而不判定。
- 固定硬件/人工门：指定设备的 5 次冷/暖档、GPU timer/Spector、30 分钟 heap soak、NVDA/VoiceOver/TalkBack、真实软键盘与微软拼音/macOS 拼音/日文 IME/Gboard。
- 每项产出带日期、浏览器、OS、CPU/GPU、viewport、throttle、原始数值和支持状态的 evidence artifact；不可用时写“不支持/未执行”，不得写通过。
- mock Core 负责确定性 UI 竞态；最终另跑一次真实 Core HTTP/SSE smoke，验证 proxy/CORS/事件命名，不以 mock 代替集成事实。

## 11. 完成定义

W1 只有在以下条件同时成立时完成：

1. `/` 已从单体页面迁移到上述组件与控制器边界。
2. 发送、SSE、终稿、语音、急停均显示真实状态且失败可恢复。
3. 完整 S 形轨道、宽聊天、持续人物和独立生活岛在响应式布局中成立。
4. Presence 最多一个 WebGL context、一个持续 RAF/ ticker，旧独立 Canvas 循环不再运行。
5. Live2D/Lens/context lost 降级不影响聊天、生活、导航与急停。
6. W1 自动化、lint、typecheck、build 与当前环境可执行的浏览器门全部通过；固定硬件/人工门必须有明确 evidence 状态，未执行项不得被宣称已认证。
