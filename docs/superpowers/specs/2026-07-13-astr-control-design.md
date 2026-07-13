# 星枢 Control / Admin 设计规格

**状态：** 从已批准的 Master Spec 收敛出的 Workstream 2 子规格  
**范围：** 前端 Control shell、18 模块信息架构、现有 Effector 控制面与验收  
**明确不在范围：** 后端改造、Secure Task、为其余 17 个模块新增 API、Studio 或 Mobile 实现

## 1. 目标与边界

Control 是星枢系统的主权控制面。它必须让操作者在很短时间内判断：正在查看哪个档案、数据来自哪里、当前是否可操作、哪条安全事实具有最终权威。

Workstream 2 交付以下内容：

1. `/admin` 的 18 模块档案索引；
2. 18 个稳定、可直接访问的目标路由；
3. 每个路由明确标记 `available` 或 `planned`，不得把内部 Python 能力冒充网页合同；
4. 将现有 Effector policy、audit、e-stop 迁移到 `/admin/effector`；
5. 完成深浅材质、响应式、键盘、无障碍、API 真相与 0 WebGL / 0 持续视觉 RAF 验收。

当前 Core 只提供一个成熟的 Admin 写入域：Effector。其余模块即使在 Python 内部已有实现，也没有网页读取/写入合同，因此仍是 `planned`。`/v1/status`、`/v1/voiceprint/status` 等 Presence 合同不被包装成新的 Admin 模块合同。

## 2. 18 模块信息架构

系统域：

| 路由 | 功能主标题 | 诗性副标 | Workstream 2 状态 |
| --- | --- | --- | --- |
| `/admin/dashboard` | 系统概览 | 总星图 | planned |
| `/admin/platform-gateway` | 平台与网关 | 航道 | planned |
| `/admin/model-router` | Provider 与模型路由 | 星门 | planned |
| `/admin/plugins-skills-mcp` | 插件、Skills 与 MCP | 工具舱 | planned |
| `/admin/sessions-people` | 会话与人物 | 名册 | planned |
| `/admin/schedule` | 调度计划 | 星历 | planned |
| `/admin/logs-trace` | 日志与 Trace | 回声档案 | planned |
| `/admin/settings` | 系统设置 | 定标室 | planned |
| `/admin/resources-knowledge` | 资源与知识 | 藏书穹顶 | planned |
| `/admin/setup` | 安装与初始化 | 点火序列 | planned |

Soul 域：

| 路由 | 功能主标题 | 诗性副标 | Workstream 2 状态 |
| --- | --- | --- | --- |
| `/admin/soul` | Soul 配置 | 灵魂档案 | planned |
| `/admin/memory` | 记忆系统 | 深空存档 | planned |
| `/admin/emotion` | 情绪系统 | 潮汐仪 | planned |
| `/admin/moa-teaching` | MoA 与教学 | 议事庭 | planned |
| `/admin/training` | 训练 | 飞轮 | planned |
| `/admin/voice` | 声音与声纹 | 声纹室 | planned |
| `/admin/effector` | 执行策略与审计 | 丁册 | available |
| `/admin/migration` | 灵魂迁移 | 远航封装 | planned |

`planned` 页面可以解释目标职责、当前缺失的网页合同和未来验收前提，但不得出现可点击的伪操作、虚构统计、模拟任务或静态假日志。

## 3. 空间与视觉语言

Control 不复用 Presence 的亲密 S 形轨道。它使用三层空间：

1. **主权书脊：** 左侧一条窄而稳定的垂直结构，承担品牌、返回、模块索引入口和当前域定位；它不是装满菜单的传统侧栏。
2. **档案星图：** `/admin` 首屏与可呼出的模块索引使用两域档案矩阵。模块像装订索引而非 dashboard 卡片；available 与 planned 同时用文字、线型和形态区分。
3. **工作档案：** 模块页由功能标题、诗性副标、面包屑、状态、来源和主体工作面组成。正文、表单、审计和代码始终保持稳定矩形。

先锋感只出现在外框、书脊、星蚀缺口、档案页码和章节入口。表单控件、表格、审计条目、代码、错误信息不使用异形裁切。

夜间以深空黑、冷蓝、Soul 紫和银灰为主；日间反转为冷瓷白、深墨与克制的蓝紫。全站禁绿。成功或完整状态使用冷蓝、银白、实线与文字共同表达。危险只使用既有 danger 红；待确认使用 warning 琥珀。

星空元素是静态结构证据：细密星点、坐标刻度、轻微星蚀缺口与档案连线。Control 不使用 WebGL、Canvas、持续动画、旋转星球或循环星轨。

## 4. Shell 与导航行为

- `/admin` 展示完整 18 模块索引，并把 Effector 置于可用状态，不自动跳转。
- `/admin/[module]` 解析统一注册表；未知 slug 走 Next `notFound()`。
- 桌面使用主权书脊、主工作面和可选证据栏；索引通过宽幅档案面板展开，不把 18 项塞成长侧栏。
- 窄屏使用顶部紧凑书脊和全宽索引面板；它保持 Control 信息架构，不冒充 Mobile 五域。
- 全局 skip link 到 `#main-content`；模块页另有到 `#module-index`、`#control-form`、`#audit-ledger` 的局部跳转。
- 当前模块、域、available/planned、来源和表面修订必须可见，不能只靠颜色或 hover。

## 5. Effector 数据合同

前端只消费现有 Core：

- `GET /v1/admin/effector/policy`
- `PUT /v1/admin/effector/policy`
- `GET /v1/admin/effector/audit?date=<date>&limit=<1..500>`
- `GET /v1/effector/status`
- `POST /v1/effector/estop`
- `POST /v1/effector/estop/reset`

Policy 的可写字段只有：`approval_mode`、`headless_scope`、`headless_cwd`、`headless_folders`、`app_whitelist`、`login_sites_whitelist`、`dangerous_categories`、`dangerous_keywords`、`max_steps_per_task`。`sandbox_dir`、`locked`、核心危险类别/关键词与 `overlay_path` 只读。

数据层必须：

- 检查 HTTP 状态与响应形状，不把错误 JSON 当成功；
- policy、audit、status 独立加载，局部失败不清空其它真实证据；
- 一个时刻只提交一个 policy patch，避免无 revision 合同下的乱序覆盖；
- e-stop/reset 先 POST，再 GET `/v1/effector/status`；只有权威回读决定 UI 状态；
- POST 成功但回读相反或失败时显示 `unknown`，不得乐观翻转；
- e-stop 始终保留为独立安全操作，不受普通 policy 保存状态阻断；
- 组件卸载或新请求替代旧请求时中止读取，避免陈旧响应回写。

## 6. Effector 工作面

工作面由三个可独立扫描的区域构成：

1. **策略档案：** 审批模式、无头范围、文件夹、应用、登录站点、步数上限；使用稳定表单。
2. **安全底线：** 核心危险类别和关键词显示锁定来源；用户扩展可添加/移除。底线不能通过 UI 删除。
3. **审计丁册：** 日期选择、刷新、链完整性、总数、decision、track、dangerous、trace_id、时间与描述。完整性不使用绿色。

审批模式与无头范围使用真正的 `radiogroup`/`radio` 语义，并支持 Left/Right 与 Up/Down 方向键。Chip 编辑器支持 Enter 添加、明确删除按钮、IME 安全和可读错误。所有主操作至少 44×44 CSS px。

## 7. 状态、错误与空态

- 加载、ready、offline、error、saving、unknown、latched、clear 都有文字状态。
- planned 页面说明“当前 Core 未提供此模块的网页合同”，并列出未来需要的 projection/endpoint 类别；不显示假的空图表。
- audit 没有记录时说明“当前所选日期没有审计条目”，不暗示系统从未执行。
- 链完整性 `null` 显示未提供证据；`true` 显示完整；`false` 显示断裂。
- 错误保留最近一次已验证数据并标记可能陈旧，不把瞬时离线变成全屏空白。

## 8. 性能与无障碍

- Admin 为 0 WebGL、0 Canvas、0 持续视觉 RAF。
- 首屏不加载 Presence Live2D/Pixi/Lens 代码或资产。
- 动效只允许 CSS 状态过渡，并遵守 reduced motion / 用户暂停。
- axe critical/serious 为 0；320px 宽无水平溢出；200%/400% 缩放保留主要操作。
- 深浅主题保持相同几何、层级和语义，只反转材质。
- 模块索引、radiogroup、日期选择、急停与错误恢复均可全键盘操作。

## 9. 验收终点

Workstream 2 在以下条件全部满足时完成：

1. 18 个路由均可直接访问且状态真实；
2. 只有 Effector 提供真实写操作；
3. policy/audit/e-stop 使用现有 Core 合同并通过乱序、失败与权威回读测试；
4. 深浅主题、桌面/窄屏、键盘、axe、缩放与离线态通过；
5. source/bundle 门禁证明 Admin 无 WebGL、Canvas、持续 RAF 与 Presence 重资产；
6. 后端文件无修改；
7. 其余 17 模块继续保持 planned，不把后续子项目偷渡进本工作流。

