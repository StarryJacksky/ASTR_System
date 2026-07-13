# 星枢 ASTR · Mobile 五域主权中继子规格

> 状态：设计批准；独立复核 C0 / I0 / M0
> 日期：2026-07-13
> Workstream：4 · Mobile Shell
> 上游：Foundation、Presence W1、Control W2、Studio 3A 合同规格
> 范围：独立移动构图、五域路由、底部导航、真实只读域适配器、本地任务草稿、能力未启用状态
> 非范围：Secure Dispatch、远程设备、Task/Approval/Artifact 协议、设备配对、远程急停 ACK、任何新增后端

## 1. 决策摘要

星枢 Mobile 是“主权中继”，不是缩小的 Presence、Studio 或 Control。它用五个稳定域承接未来远程主权入口，但只点亮当前合同能证明的能力：

| 域 | 路由 | W4 状态 | 当前权威来源 |
| --- | --- | --- | --- |
| 露怀秋 | `/mobile/presence` | `local-available` / `unavailable-remote-context` | loopback 来源下的 W1 CoreStatus / ConversationProjection |
| 任务 | `/mobile/tasks` | `local-only` | 此浏览器的显式本地草稿 |
| AI 工作台 | `/mobile/workbench` | `unavailable` | Studio 3A authority 尚未获授权 |
| 知识 | `/mobile/knowledge` | `unavailable` | Knowledge Read Projection 尚不存在 |
| 设备与安全 | `/mobile/safety` | `local-read-only` / `unavailable-remote-context` | loopback 来源下当前 Web 主机的 Effector GET 合同 |

`/mobile` 只重定向到 `/mobile/presence`。五个 URL 均可直达，FiveDomainNav 是 Mobile 内唯一全局导航。

未来 W5 可以在相同任务域和安全域位置接入真实 `TaskSnapshot`、`TaskEvent`、`Approval` 与 `DeviceSnapshot`；W4 不预演这些数据，也不放“发送到电脑”假按钮。

## 2. 不可越过的产品边界

### 2.1 W4 不拥有远程执行

W4 源码禁止出现或依赖：

- `DispatchClient`
- `MobileTaskRegion`
- `TaskSnapshot` / `TaskEvent`
- `Approval`
- `DeviceSnapshot`
- `/v1/tasks`
- `/v1/devices`
- `/v1/approvals`
- 远程 artifact endpoint

不得：

- 把 `/v1/ingest` 当成 Dispatch
- 信任客户端 `user_id`、level 或 verified_by
- 从 `agent.thought`、intent、SSE 或 Guard audit 推断 Task
- 把 localhost Core 暴露公网
- 在前端复制 Guard 判定
- 声称设备 online、已送达、已执行或已完成

### 2.2 Mobile 共同来源门禁

Presence 写入与 Safety 读取都只属于本机可信入口。`MobileShell` 持有一个不发业务请求的 `MobileAuthorityGate`，它组合两份独立证据后产生三态：`checking`、`trusted-local`、`unavailable-remote-context`。

1. Server Component 先解析 `ASTR_CORE_URL`（缺省 `http://127.0.0.1:8300`）与 `NEXT_PUBLIC_ASTR_CORE`（缺省同为 loopback）。二者都必须是合法 `http:` / `https:` URL，且 hostname 精确为 `localhost`、`127.0.0.1`、`[::1]` 或 URL 解析器返回的 `::1`；任一为远端、非法或非 HTTP(S)，只向客户端传递 `serverAuthorityTrusted=false`，不泄露目标 URL。
2. 客户端 hydration 后再以相同 hostname allowlist 校验 `window.location.hostname`。只有 server evidence 与 browser evidence 同时通过才成为 `trusted-local`；其余均为 `unavailable-remote-context`。

不接受 LAN、mDNS、自定义域、公网域，亦不接受 query、storage、cookie 或自报 header 覆盖。浏览器 origin 为 localhost 但 `ASTR_CORE_URL` 或 `NEXT_PUBLIC_ASTR_CORE` 指向远端时也必须 fail closed。

- `checking` 与 `unavailable-remote-context` 下不得挂载 `TrustedMobilePresenceDomain` 或 `TrustedMobileLocalSafetyDomain`，因此不会创建 W1 controller、Core/SSE/voice client 或 Effector client。
- remote context 的 Presence 显示静态 capability gate：“当前来源或 Core 目标不是本机可信入口，未连接 Core，也未开放对话写入”；Composer、语音、重试、对话事实、Control 链接与 Header“返回 Presence”链接均不渲染或预取。
- remote context 的 Safety 按 5.5 显示静态 gate；不渲染 Control 链接。
- Tasks、Workbench、Knowledge 不消费 Core，仍可按各自真实边界使用；其中 Tasks 仍只是当前浏览器的未加密本地草稿，不会发送到任何电脑。
- 共同门禁仅约束产品代码的自动连接与可操作入口；它不把现有通用 rewrite 宣称为认证边界，也不替代 W5 的设备身份与授权协议。

### 2.3 W4 的真实完成定义

W4 可以完成：

- 五域壳层、路由、唯一底部导航与 safe-area
- loopback 来源下露怀秋域的现有本机对话；其他来源只显示不可用事实
- 任务域的浏览器本地草稿
- 工作台 / 知识域的明确 capability gate
- loopback 来源下当前 Web 主机的本地 Effector 只读摘要；其他来源零请求

W4 不能完成：

- Mobile 全域真实数据验收
- Secure Dispatch
- 远程设备与任务状态
- 远程审批、artifact 或 e-stop ACK

完整域验收仍等待 Studio、Knowledge 与 W5 projections；壳层验收不把依赖缺失写成产品完成。

## 3. 品牌构图：主权中继

Mobile 的独特轮廓是“星蚀顶标 × 中继桅杆 × 底部五域龙骨”：

- 顶部左侧是星枢字标与当前域，右上是一枚静止、局部裁切的星蚀圆。
- 一条细直的中继桅杆连接页头、当前事实和主内容，但不承担导航。
- 底部 FiveDomainNav 像一条固定龙骨，五个域是五枚可达刻度。
- 露怀秋域内可出现简化静态 S 主干；其他域不使用 S 曲线。
- 任务域在真实 Task 协议前没有远程节点、旅星或因果轨迹。

它不能退化为：

- 手机宽度的桌面侧栏
- 五张圆角卡片组成的 dashboard
- HUD 指标堆叠
- 蓝紫渐变雾、玻璃拟态或随机星空
- 标准 bento grid

视觉语言：

- 深夜使用黑蓝、靛蓝、冷紫、银白；昼间使用冷瓷、墨蓝和低饱和紫。
- 全站禁绿；success 使用冷蓝 / 银白 + 明确文字 + 实线形态。
- Surface 近不透明；不使用 `backdrop-filter`。
- 不使用渐变、3D、Three.js、WebGL、Canvas、持续 RAF 或持续 CSS animation。
- 非矩形只用于星蚀缺口、页头边缘和当前域标记；输入、正文、消息和事实列表保持稳定矩形。
- 远看极简；只有真实数据区形成密度岛。

昼夜模式只改变材质，不改变几何、信息顺序、路由或能力状态。

## 4. MobileShell

### 4.1 结构

每个页面：

```text
AppShell global skip link
└─ MobileShell [data-route-surface="mobile"]
   ├─ MobileHeader
   │  ├─ ASTR / 当前域
   │  ├─ 本地 / 能力状态短句
   │  └─ Theme + Motion + 返回 Presence（仅 trusted-local）
   ├─ main#main-content
   │  └─ domain adapter
   └─ FiveDomainNav
```

规则：

- 每页只有一个 `<main id="main-content">` 与一个 h1。
- Header 不是第二套 Mobile 导航；只有 `trusted-local` 时跨空间保留一个克制的“返回 Presence”入口，`checking` / remote context 不渲染或预取该入口。
- FiveDomainNav 使用真实 `<a>`、稳定 URL 与 `aria-current="page"`。
- 五个目标始终显示文字，不能只用图标；每个至少 44×44 CSS px，间距至少 8px。
- 当前域使用颜色、实线、位置和 `aria-current` 四重说明，不靠颜色单独表达。

### 4.2 Viewport 与 safe area

- 根布局必须导出 Next `Viewport`，至少声明 `width: "device-width"`、`initialScale: 1` 与 `viewportFit: "cover"`；不得通过 `maximumScale` 或 `userScalable` 禁止缩放。没有 `viewport-fit=cover` 时，`env(safe-area-inset-*)` 不算有效验收证据。
- Shell 使用 `min-height: 100dvh`。
- Header 顶部包含 `env(safe-area-inset-top)`。
- 底部导航包含 `env(safe-area-inset-bottom)`。
- main 的 `padding-bottom` 与 `scroll-padding-bottom` 必须大于导航高度 + safe area。
- 软键盘出现后当前 input/textarea、Composer feedback 和 focused control 仍可滚动到可见区域。
- 320 CSS px 和 400% zoom 单列 reflow；整页不产生横向滚动。
- Desktop 打开 `/mobile/*` 时仍显示同一移动信息架构，内容场最大宽度受控；不套假手机模型。

### 4.3 Global ambient isolation

Mobile route 必须抑制 AppShell 的持续 ambient animation 与 grain overlay，以保持静止、降低移动端成本并避免把渐变雾带入 Mobile。Route 自身使用纯色 Surface 与静态线条。

## 5. 五域详细语义

### 5.1 露怀秋域

首屏回答：“她此刻怎样，我要和她说什么。”

真实数据：

- W1 `CoreStatusProjection`
- W1 `ConversationProjection`
- Core / Reply SSE / Life SSE 的独立语义状态
- W1 Composer actions

这些数据与 action 仅在共同来源门禁为 `trusted-local` 时存在。`checking` / `unavailable-remote-context` 必须渲染静态 gate，不能先挂载 W1 owner 再靠 CSS 隐藏；由独立子组件边界保证 `usePresenceController` 只在门禁通过后调用。

结构：

- 静态 SVG Soul Lens 与简化静态 S 主干，均 `aria-hidden`
- DOM 事实：display name（若提供）、Core 可达、两条 SSE、当前 activity
- 对话消息列表
- 现有 Composer，保留 IME、Shift+Enter、失败草稿/selection 恢复与语音能力

边界：

- `soul_name` 仍是内部句柄，不冒充 display name。
- 对话写入仍是当前可信本机 Presence 能力，不叫“发送任务”。
- 不显示设备步骤、Guard 策略、远程设备或 Task 状态。
- Mobile 使用静态 Lens，不安装 Live2D / Pixi runtime。
- 时间线不使用 `aria-live`；权威终稿继续由全局 StateAnnouncer 单次播报。

### 5.2 任务域

首屏顺序固定：

```text
目标设备：未绑定
状态：本地草稿
风险：尚未由 Guard 评估
下一动作：继续编辑
说明：未发送；不会在电脑执行
```

唯一允许的数据是 `LocalTaskDraft`：

```ts
interface LocalTaskDraft {
  readonly schema_version: 1;
  readonly draft_id: string; // local_draft_*, 永远不叫 task_id
  readonly text: string;
  readonly created_at: string;
  readonly updated_at: string;
}
```

本地草稿行为：

- 未显式保存的编辑值只存在于当前 Tasks route 的 React mount；任何路由切换、history back/forward、刷新或关闭页面都可丢失，界面在编辑器旁持续写明“离开此页会丢失未保存内容”。W4 不用 sessionStorage、模块单例或自动 localStorage 暗中持久化，也不承诺拦截浏览器导航。
- 用户若要跨页面保留，必须先显式点击“保存到此浏览器”。这是刻意收窄的 W4 生命周期，不把不可靠的 SPA navigation blocker 写成安全承诺。
- 用户点击“保存到此浏览器”后才写 localStorage；界面明确“本机浏览器存储，未加密，请勿写入凭据”。
- 最多 12 条，每条正文 1..4000 字符；空白不能保存。
- storage key 带 schema version；解析 fail-closed，拒绝 prototype key、坏时间、重复 ID、超长数组或字段。
- Storage 读写失败时保留当前 session 草稿，并显示“未持久化”；不能静默声称已保存。
- 允许继续编辑与删除本地草稿；删除只影响此浏览器。
- 不产生网络请求、trace、device ID、risk verdict、queue status 或 terminal outcome。

禁止：

- “发送到电脑”“开始任务”“批准”“重试执行”按钮
- queued / planning / running / completed 状态
- 远程设备卡片、伪心跳、Task 节点或 S 形因果轨迹
- 把保存到 localStorage 称为“任务已创建”

静态锁闭区写：“安全 Dispatch 尚未启用 · 等待设备身份、Task authority、审批、幂等与 ACK 协议。”它是说明文字，不是 disabled fake button。

### 5.3 AI 工作台域

显示：

- `Workspace / Run / Tool / Trace / Source / Artifact` 六个 capability 名称
- 统一状态：“Studio 投影未启用”
- 原因：“缺少已授权 authority、认证 scopes 与只读 endpoints”
- 说明：“没有可验证的 Run、模型路由、成本或产物数据。”

禁止：

- 假 Run、假模型、`$0` 成本、假 artifact、示例任务
- Prompt / Run / Tool / Download 操作
- 从 Presence SSE 或今日总成本拼装 Studio 数据
- success / artifact-return Micro-Wonder

### 5.4 知识域

显示：“安全只读知识投影未启用。”

它可以解释未来将回答“哪些结果值得长期保留与检索”，但当前：

- 不显示假记忆数量、索引数或更新时间
- 不读取 SoulPackage / Memory 本地文件
- 不提供搜索框、写入、删除或“加入知识”假入口
- 不把聊天历史当知识库
- 不泄露私密记忆、完整 prompt 或路径

### 5.5 设备与安全域

域标题必须写清：“当前 Web 主机 · 本机可信入口”。这里的“本机”仅指浏览器本身通过 loopback origin 打开的 Web 主机，不是访问页面的手机，也不是任意 LAN / 公网部署服务器。不能写“我的电脑在线”或把 Web host 冒充远程设备。

在任何 Effector 请求之前必须通过共同 authority 门禁：

- 仅当 2.2 所述 server Core targets 与 `window.location.hostname` 全部通过 loopback allowlist 时，状态才可进入 `local-read-only` 并创建 GET-only adapter。
- server evidence 为 false 时，SSR 直接输出 `unavailable-remote-context`；server evidence 为 true 时，SSR 与 hydration 初始状态为“正在核验本机来源”。两者都不得预取 Safety 数据；客户端 browser evidence 也通过后才允许首次请求。
- LAN IP、mDNS、自定义域名、反向代理域名与公网域名一律进入 `unavailable-remote-context`，三个 Effector 请求均为 0；界面写明“当前来源不是本机可信入口，未读取服务器安全状态”。
- 不接受 query、localStorage、cookie 或客户端自报 header 覆盖 hostname 判定；W4 也不把 `isSecureContext` 单独当成本机证明。
- 此门禁只约束 Mobile 产品行为，并不把现有通用 `/api/core/*` rewrite 声称为已认证安全边界。现有 `/` Presence 与 `/admin` 也不因此成为远程安全入口；Mobile 在 remote context 不链接过去。若要让真机读取或操作电脑，必须等待 W5 设备身份、认证 scopes、反重放与权威 ACK；W4 不扩大后端或代理授权。

W4 使用专用 read-only adapter，只允许：

```text
GET /v1/effector/status
GET /v1/admin/effector/policy
GET /v1/admin/effector/audit
```

Mobile 安全投影按权威来源拆成三个互不遮蔽的小投影：

```ts
interface MobileLocalStatusProjection {
  readonly stopped: boolean;
  readonly pending_count: number;
  readonly audit_tail_count: number;
}

interface MobileLocalPolicyProjection {
  readonly approval_mode: "ask" | "audited" | "auto";
  readonly headless_scope: "cwd" | "folders" | "full";
  readonly max_steps_per_task: number;
}

interface MobileLocalAuditProjection {
  readonly audit_date: string | null;
  readonly audit_total: number | null;
  readonly chain_valid: boolean | null;
}

type MobileChannelSnapshot<T> =
  | { readonly phase: "idle" | "loading"; readonly value: null; readonly error: null; readonly verified_at: null }
  | { readonly phase: "ready"; readonly value: T; readonly error: null; readonly verified_at: string }
  | { readonly phase: "refreshing"; readonly value: T; readonly error: null; readonly verified_at: string }
  | { readonly phase: "stale"; readonly value: T; readonly error: string; readonly verified_at: string }
  | { readonly phase: "error"; readonly value: null; readonly error: string; readonly verified_at: null };
```

Controller snapshot 分别持有 `status`、`policy`、`audit` 三个 `MobileChannelSnapshot`，不存在要求三源同时成功的 aggregate projection。服务端响应中的 speaker、pending 内容、原始 audit row、路径、应用、站点、sandbox 和 overlay 路径不进入 Mobile projection；投影完成后立即丢弃。

读取语义：

- 只有 loopback 来源门禁通过后才存在 policy / audit / status 三通道；门禁未通过时不创建 client/controller，也不提供“重试读取”按钮。
- policy / audit / status 三通道独立加载与失败。
- 刷新失败保留同通道最近已验证值并标“可能陈旧”；初次失败显示明确重试。
- 一个通道的 loading/error/stale 不得清空、降级、伪造或隐藏另外两个通道的已验证值；错误文案使用本地稳定分类，不透传服务端敏感详情。
- `stopped=true` 才显示“本机执行层已闩锁”；请求失败显示未知，不能解释为安全。
- `chain_valid=true` 只叫“当前审计文件 hash 链校验通过”；false 叫“链校验失败”；null 叫“未提供链完整性证据”。
- audit_total null 不能显示 0。

W4 基线只读：不渲染 e-stop、reset、policy mutation 或 approval 控件。只有共同来源门禁通过时才提供真实链接“在 Control 查看本机安全控制”；remote context 不渲染或预取该链接。远程 e-stop 必须等待 W5 的设备身份、幂等 stop request 与权威 ACK。

## 6. 数据与组件边界

### 6.1 组件职责

- `MobileShell`：布局、header、main、safe-area 与共同 `MobileAuthorityGate`；零业务请求，只消费服务端非敏感 trust boolean 与浏览器 hostname。
- `FiveDomainNav`：五个链接与当前域；零业务状态，不导入业务 client。
- `MobilePresenceDomain`：按来源状态选择静态 gate 或 `TrustedMobilePresenceDomain`；后者消费 W1 owner，不复制 reducer / SSE。
- `LocalTaskDraftRegion`：session state 与显式浏览器持久化；零网络。
- `MobileWorkbenchGate`：静态 capability unavailable。
- `MobileKnowledgeGate`：静态 capability unavailable。
- `MobileLocalSafetyDomain`：按来源状态选择静态 gate 或 `TrustedMobileLocalSafetyDomain`；后者消费专用 GET-only client/controller。

### 6.2 代码隔离

- 每个域是独立 route chunk；访问 tasks/workbench/knowledge 不启动 Presence SSE 或 Effector 请求。
- remote-context Presence/Safety 不创建对应 controller/client，网络请求与 SSE 连接均为 0；门禁子组件不得以“先挂载再隐藏”实现。
- Safety chunk 不包含 POST、PUT、estop、reset、patchPolicy 或 Dispatch 字符串。
- Workbench/Knowledge chunk 不包含 Core client。
- Mobile 不导入 Pixi、Live2D、framer-motion、Three、Canvas helper 或 RAF owner。
- `MobileShell/FiveDomainNav` 不导入业务 client。

### 6.3 No-mock boundary

Mock Core 只存在于测试环境。生产代码没有 demo device、demo task、sample run、fake cost、fake artifact 或 fallback success。

## 7. 状态、错误与内容

### 7.1 内容语气

Mobile 语气极短、状态先行：

- “Core 可达”
- “回复流重连中”
- “本地草稿 · 未发送”
- “Studio 投影未启用”
- “当前 Web 主机 · 安全状态未知”

禁用笼统“在线”、绝对安全、完全本地、已发送、已执行、完成。

### 7.2 状态不互相覆盖

- Core offline 不清空对话与本地草稿。
- Reply SSE retrying 不等于 Life SSE retrying。
- Visual 降级不等于 Core offline。
- Safety unknown / latched 可显著显示，但不删除当前域内容。
- 缺 capability 是 unavailable，不是 empty/error。
- Task 只允许 none/draft；任何其他 Task status 都是 W4 边界违规。

### 7.3 唯一跨域提示

只有真实的“本机急停已闩锁”或未来真实“待危险审批”允许跨域提示。W4 不为获得提示而在所有路由后台轮询；没有当前已验证投影时不显示预置横幅。

## 8. 无障碍

- WCAG 2.2 AA。
- 原生 link/button/textarea；Tab 顺序等于视觉/阅读顺序。
- 底部导航 role/name/aria-current 稳定，五项始终有可见文字。
- 触控目标 ≥44×44，目标间距 ≥8px。
- 正文与表单 ≥4.5:1；焦点、边界、状态图形 ≥3:1。
- 200% 无裁切；400% / 320px 单列，无整页横向滚动。
- safe-area 与软键盘不遮挡 focused control。
- 静态 Lens / S 主干 / eclipse `aria-hidden`；等价事实由 DOM 文本表达。
- 对话时间线不 aria-live；全站仍只有一个 StateAnnouncer。
- Reduced Motion 与用户暂停控制独立；W4 即使 full motion 也没有持续动画。
- 本地草稿 textarea 不用 Enter 提交，完整支持 IME。

## 9. 性能与隐私

- Mobile W4：0 WebGL、0 Canvas、0 route-owned RAF、0 continuous CSS animation。
- hidden/offscreen/reduced RAF = 0。
- 无 Live2D、2048 atlas、音频预载或自动播放。
- LCP ≤2.5s、INP ≤200ms、CLS ≤0.1、TBT ≤200ms。
- localStorage 草稿明确未加密；不读取剪贴板、不自动上传、不跨设备同步。
- Mobile Safety 不渲染敏感路径、speaker、raw audit、tool args 或完整 prompt。

## 10. 验收矩阵

### 10.1 路由与 IA

- `/mobile` 正确导向 presence。
- 五个 URL 可直达；exact registry 无重复/额外域。
- bottom nav 恰好五项、唯一、当前域正确。
- 每页一个 main / h1；全局 skip link 有效。

### 10.2 Truth boundary

- tasks 只产生 local draft，网络 0 个 `/v1/tasks|devices|approvals|artifacts` 请求。
- workbench/knowledge 无 fake count/data/action。
- browser origin 与两个 server Core targets 全部为 loopback 时，Presence 才可启动现有 W1 Core/SSE/ingest/voice；remote-context Presence 为静态 gate，Core/SSE/ingest/transcribe/Effector-status 请求均为 0，且无“返回 Presence”或 Control 跨空间入口。
- 同一共同门禁通过时 Safety 才发三个 GET；remote-context Safety 为 0 请求且无 Control 链接；bundle/source 无 mutation path 与远程协议类型。
- Presence 对话不叫 Task/Dispatch。
- 无 projection 时没有 task node、trace node、device card 或 success ritual。

### 10.3 Draft robustness

- 显式保存、恢复、编辑、删除；Storage 失败保留 session draft。
- 未保存文本只在 Tasks route mount 内保留；界面持续警告任何离页均会丢失；路由切换、back/forward、刷新后不暗中恢复。
- malformed/prototype/oversized/duplicate record fail-closed。
- 12 条 / 4000 字符边界。
- 所有 UI 文案始终带“本地 / 未发送 / 不执行”。

### 10.4 Safety truth

- browser origin、`ASTR_CORE_URL` 与 `NEXT_PUBLIC_ASTR_CORE` 全部为 loopback 时才发三个 GET；任一为 LAN / mDNS / 自定义域名 / 公网 / 非法目标均发起 0 个 Effector 请求并显示 `unavailable-remote-context`。
- SSR / hydration 不预取；共同 authority 门禁通过前不创建 Safety client/controller；`ASTR_CORE_URL=https://remote.example` 为必测的 fail-closed 负例。
- 三通道独立覆盖 `idle/loading/ready/refreshing/stale/error` 六种 phase；`error` / `stale` 都有可操作 retry，retry 只触发对应通道的 GET，不把 action 名冒充 phase。
- status、policy、audit 各自的单通道初次失败都必须覆盖；三类 retained-value 刷新失败都进入对应 `stale`，另外两通道的值与 phase 保持不变。
- stopped true/false/unknown 不互换。
- chain true/false/null 三态。
- total null 不变 0。
- 不渲染 POST/PUT/急停/复位/策略编辑控件。

### 10.5 Visual / responsive / a11y

- dark/light × 390×844 / 430×932 screenshot baselines；相同几何。
- 320、390、430、768 CSS px 无横向 overflow。
- 200% / 400% zoom 导航与 focused inputs 可达。
- route × ready/unavailable/error 运行 axe，critical/serious = 0。
- 静态扫描范围为 `src/app/mobile/**`、`src/features/mobile/**` 及其生产 route chunks：禁绿、gradient、glass、animation、WebGL、RAF 与 heavy visual import。既有全局 `globals.css` 可服务其他空间，不按仓库级关键词误报；但必须静态核验其中存在以 SSR route witness 为条件的 `body:has([data-route-surface="mobile"]) .astr-ambient/.astr-grain` 首帧覆盖，令二者同时 `display:none`、`animation:none`、`background:none`。
- 每个 `/mobile/*` 在禁用 JavaScript 的 SSR 首帧与正常 hydration 后都断言 ambient/grain computed hidden；不得先播放一帧再隐藏。
- 浏览器验收断言 `document.getAnimations()` 无 running infinite Mobile/global ambient animation，并用页面加载前 RAF probe 分别验证稳定、hidden 与 reduced-motion 状态 route-owned RAF = 0。
- 真机补充 Pixel 6a Chrome、Android TalkBack；结果未跑前不声称真机验收完成。

## 11. 实施波次

1. Domain registry、routes、MobileShell、FiveDomainNav、静态视觉与 boundary tests。
2. LocalTaskDraft model/store/region。
3. Mobile Presence adapter（静态 Lens + W1 Conversation/Composer）。
4. Workbench / Knowledge capability gates。
5. GET-only Mobile Safety client/controller/domain。
6. Cross-space links、README、build/chunk boundary、Playwright/axe/visual acceptance。
7. W4 壳层 tranche 独立审查；Critical/Important 清零后只做阶段收口，Workstream 4 保持 `partial`。验收报告固定列出 Studio / Knowledge projections 与 Secure Dispatch authority 仍未完成，绝不声称 Mobile 全域完成。

Workstream 5 另立 Secure Dispatch 子规格、威胁模型与跨栈实施计划。W4 的未来插槽不是授权入口。
