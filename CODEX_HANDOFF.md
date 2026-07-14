# ASTR 星枢系统交接手册

> 交接日期：2026-07-14
> 工作分支：`codex/astr-frontend-redesign`
> 远端：`origin = https://github.com/StarryJacksky/ASTR_System.git`

## 双仓拓扑与文档归属

- **代码仓**：`D:\ASTR_System\astr`，远端为 `StarryJacksky/ASTR_System`。Core、Web、测试、设计规范、工程计划和本交接手册都进入这个仓库。
- **数据根目录**：`D:\ASTR` 自身不是 Git 仓库，不能在这里直接执行提交。
- **活动 Soul 数据仓**：`D:\ASTR\soul_package\justin`，当前分支为 `main`，保留独立提交历史；截至本次交接尚未配置 remote。它绝不能被推入公开代码仓。
- `D:\ASTR\backups\...\justin` 是备份副本，`uv_cache` 是依赖缓存；两者都不是日常发布仓。
- API keys、登录态、模型权重、浏览器 profile、依赖缓存和运行时秘密不得提交到任何远端。Soul/Memory 检查点只进入经过确认的私有数据远端，或使用加密 `git bundle` 迁移。

本次代码分支必须一并携带以下规划与证据，不能只提交页面代码：

- `engineering_plan/`：总规、技术栈锁定、合同、设计系统、阶段规划、研究和可公开的参考实现；这是从原仓库外目录正式归档进来的工程基线。私人 `reference_impl/soul_seed/` 已按合规边界排除。
- `docs/superpowers/specs/`：已确认的设计规范。
- `docs/superpowers/plans/`：各批次实施计划。
- `webapp/docs/`：资产、边界和验证记录。
- `CODEX_HANDOFF.md`：当前事实、前后端打通顺序与 Mac 迁移手册。

规划文档描述目标和约束，不自动证明能力已经实现；出现冲突时，以当前代码、合同测试和本手册的“当前事实”段落为准。

## 给接任 Codex 的第一句话

不要从零重做，也不要根据页面外观猜后端能力。先阅读本文件、`README.md`、`webapp/README.md`、`webapp/AGENTS.md`，再运行 `git status -sb` 和 `git log -10 --oneline`。当前分支已经连续完成 Presence、Mobile、Control 与 Studio 的前端重构和严格验收；下一阶段应先完成 macOS 迁移基线与真实权限合同，再逐步打开仍为 unavailable/planned 的功能。

用户原先提供的设计技能位于 Windows 外部路径：

```text
E:/windows ORI DOWNLOADS/soul-grade-frontend-design-v1.0/soul-grade-frontend-design-v1.0/SKILL.md
```

它不在 Git 仓库中。换 Mac 后若要继续完全遵循原技能，请单独安全复制或重新安装该技能。即使技能暂时不在，下面的设计宪法也必须保留。

## 不可回退的产品与设计决定

- 产品名是“星枢系统 / ASTR”，不是泛用后台模板。
- 色彩以蓝、紫、黑和深色为主；不要使用绿色作为状态色、装饰色或渐变端点。
- 保留明暗主题切换；切换只改变材质与颜色，不改变信息几何。
- Presence 的 S 形波浪/中继轨迹必须保留。聊天和 Life 区域要宽裕，人物重要但不能挤压主要工作区。
- 页面可以使用有机、不对称、断裂式构图，但不要变成无边界实验艺术；不要回到普通矩形卡片墙、Bento 拼盘、泛玻璃拟态、随机渐变或无意义 3D。
- Mobile 是独立的移动产品形态，不是桌面页面缩小版。长期目标包含安全 Dispatch、AI Workbench、Knowledge 与类似 Cherry Studio 的 AI 工作流能力。
- 前端只能呈现已有合同能证明的事实。没有 authority、认证 scopes、稳定 endpoint 或真实数据时，必须显示 `unavailable`/`planned`，不能用 mock、假数字、假模型、假任务或禁用按钮表演能力。
- 不要为了前端重构顺手重设计或改写后端。后端变化必须从独立合同设计、威胁模型和测试开始。

## 当前已经完成什么

### Presence `/`

- 对话是主工作面，Soul 持续挂载，Life 由明确意图展开。
- `POST /v1/ingest` 的 ACK 只是收件证明；只有 SSE `soul.decision` 是最终权威事实。
- 已覆盖 ACK、流式增量、最终决断、超时、迟到决断、SSE gap、Core 不可达、急停状态和输入安全。
- 单一视觉 runtime 受严格所有权与 RAF/可见性预算约束；失败时降级为静态 Soul Lens。

### Mobile `/mobile/*`

- 五域：Presence、Tasks、Workbench、Knowledge、Safety。
- Presence 和 Safety 只在服务端目标与浏览器主机都为精确 loopback 时启用。
- Tasks 只把明确保存的草稿存在当前浏览器 `localStorage`，不会发任务。
- Workbench、Knowledge、Secure Dispatch 与远程电脑操作仍未启用。
- Safety 仅 GET 三个现有 Effector endpoint，不包含任何移动端 mutation。

### Control `/admin`

- 有 18 个真实模块档案入口，适合未来继续扩展多个后台页面。
- 只有 Effector 当前标为 available；其他 17 个模块仍是 planned dossier。
- Effector 已接现有策略、审计、状态、急停和复位合同；POST/PUT 返回后仍以权威 GET 回读定权。

### Studio `/studio`

- 当前是静态的“合同视界 / Contract Horizon”，HTTP 200，但明确显示 `Studio 投影未启用`。
- Workspace、Run、Tool、Trace、Source、Artifact 六类只作为冻结分类目录，全部为 `unavailable`。
- 页面不发起任何 Studio/Core 业务请求，没有 Run、模型路由、成本、产物、按钮、编辑器或假记录。
- Presence 与 Control 已加入 `prefetch={false}` 的 Studio 入口；Mobile 权限边界和导航未改变。
- Studio 源码/构建边界有独立 fail-closed scanner 和大量 adversarial fixtures；继续修改时必须保留该门禁。

## 真实的前后端调用链

当前 Core 入口是 `src/astr/core/app.py`，CLI 通过 `uv run astr core --port 8300` 绑定 `127.0.0.1`。Redis Streams 是事件总线。Web 默认运行在 `http://localhost:3100`。

### 传输拓扑

```text
Browser
  |-- REST /api/core/*
  |     Next rewrite (webapp/next.config.ts)
  |     -> ASTR_CORE_URL，默认 http://127.0.0.1:8300
  |
  `-- SSE 直接连接 NEXT_PUBLIC_ASTR_CORE/v1/stream
        -> 默认 http://127.0.0.1:8300/v1/stream

ASTR Core :8300
  -> Redis Streams
  -> Soul worker / ModelRouter / Memory / Presentation / Effector
  -> soul.stream（暂态）与 soul.decision（权威）
```

SSE 当前直连 Core，是因为现有 Next rewrite 会缓冲流。`NEXT_PUBLIC_ASTR_CORE` 会在构建时嵌入浏览器产物，改变它后必须重建。

### 已存在并实际被 Web 使用的合同

| Method/path | 当前用途 | 当前消费者 |
| --- | --- | --- |
| `GET /v1/status` | Soul、模型、当日成本、预算、情绪、Life activity | Presence、Mobile Presence |
| `POST /v1/ingest` | 注入用户文本，返回 `event_id` 与 `trace_id` | Presence、Mobile Presence |
| `GET /v1/stream` | SSE：thought/stream/decision/expression/MoA | Presence、Mobile Presence |
| `POST /v1/voice/transcribe` | WAV base64 转写 | Presence |
| `GET /v1/voiceprint/status` | 声纹注册状态 | 设置面板 |
| `POST /v1/voiceprint/enroll` | 注册声纹样本 | 设置面板 |
| `GET /v1/effector/status` | 急停、pending、审计尾巴 | Presence、Control、Mobile Safety |
| `POST /v1/effector/estop` | 急停 ACK | Presence、Control |
| `POST /v1/effector/estop/reset` | 复位 ACK | Presence、Control |
| `GET /v1/admin/effector/policy` | 读取执行策略 | Control、Mobile Safety 的裁剪投影 |
| `PUT /v1/admin/effector/policy` | 修改允许的策略字段 | Control |
| `GET /v1/admin/effector/audit` | 审计证据 | Control、Mobile Safety 的裁剪投影 |

`POST /v1/respond`、`POST /v1/event` 与 `GET /v1/social` 也已存在，但主要服务 AstrBot/平台桥，不要未经合同设计直接并入网页。

### 当前鉴权事实

- Core HTTP 路由目前没有真正的浏览器会话、Bearer token、CSRF 或 scope middleware。
- `user_id` 会进入白名单等级解析，但它仍是请求字段，不等同于经过网络认证的 principal。
- CLI 只绑定 loopback，CORS 只允许若干本地开发 origin；这是当前的主要安全边界。
- Mobile 会额外检查 Core URL 与浏览器 hostname 都是无凭据 loopback，并只向客户端传一个 boolean。
- 因此绝不能把 `:8300` 直接暴露到公网，也不能在现状下开放远程 Dispatch 或移动端 mutation。

## 前后端正确打通顺序

下面是建议架构，不代表 endpoint 已经存在。每一阶段都应先写合同/威胁模型和失败测试，再改 Core 与 UI。

### Phase 0 — macOS 可复现基线

1. 在 Mac 干净克隆当前分支，不复制 Windows 的 `.venv`、`node_modules`、`.next` 或二进制缓存。
2. 把所有运行数据改到 macOS 可用的 `ASTR_DATA_DIR`，让 Core、Redis、备份与模型路径不再依赖 `D:/`。
3. 让 Python tests、Web unit/coverage/build、边界门和浏览器矩阵在 Mac 通过。
4. 在任何新功能前记录 Mac 专属差异：IME、真实 hidden page、Metal/本地模型、麦克风、辅助功能权限。

### Phase 1 — Authority 与网关合同

先建立所有未来能力共用的安全底座：

- 定义经过认证的 principal、device 与 scopes，例如 `presence:read`、`studio:read`、`dispatch:create`、`dispatch:approve`、`admin:effector`。
- 浏览器远程访问使用单一 HTTPS origin。推荐由 TLS reverse proxy/BFF 接收安全 cookie 或短期 token，再访问只绑定 loopback 的 Core。
- Cookie 方案必须有 CSRF；token 方案必须有 audience、过期、轮换与撤销。所有 mutation 都要审计。
- SSE 需要同源、禁缓冲的反向代理或专用 streaming gateway，并支持鉴权、断线续传、事件 ID、trace/principal 隔离。
- 定义稳定错误 envelope、`schema_version`、分页/cursor、idempotency 与 capability discovery。
- FastAPI OpenAPI 可作为合同来源，但前端仍要保留当前 fail-closed runtime parser，不能盲信网络 JSON。

建议先设计而非直接实现：

```text
GET /v1/auth/session
GET /v1/capabilities
GET /v1/events/stream
```

验收：未认证、scope 不足、过期 token、CSRF、跨 origin、重放、断线续传和审计链都必须有 Python contract tests、Web mock parity tests 与 real-Core smoke。

### Phase 2 — Studio 只读投影（先读后写）

先确定稳定 ownership、ID、保留策略和脱敏边界，再开放薄只读 endpoint。建议的合同草案：

```text
GET /v1/studio/workspaces
GET /v1/studio/workspaces/{workspace_id}
GET /v1/studio/runs?workspace_id=...&cursor=...
GET /v1/studio/runs/{run_id}
GET /v1/studio/runs/{run_id}/trace
GET /v1/studio/tools
GET /v1/studio/sources/{source_id}
GET /v1/studio/artifacts/{artifact_id}/metadata
```

第一版不要做 Run 创建、Prompt 编辑、Approve、Tool 调用或文件下载。只有在真实只读数据、scope 与 endpoint 都就位后，才把 `/studio` 的相应分类从 `unavailable` 变为真实 empty/data/error 状态。

### Phase 3 — AI Workbench / Cherry Studio 类能力

- 把现有 ModelRouter、会话、工具目录、Source/Artifact/Trace 映射为版本化投影，而不是让前端直接读内部文件或 Redis。
- 明确模型路由事实来自哪里、费用如何归属到 Run、fallback 如何审计。
- Prompt、provider、模型参数、tool permission 与 artifact 下载都必须有独立 scopes。
- 长任务采用 job 状态和事件流，不让浏览器把 POST ACK 当完成。

### Phase 4 — Mobile Secure Dispatch

推荐拓扑：

```text
iPhone/Mac Browser
  -> HTTPS Gateway / authenticated ASTR Core
  -> Dispatch service + immutable audit
  -> paired desktop device agent（主动出站连接，不开放电脑入站端口）
  -> Guard / approval / e-stop
```

先定义设备配对、能力清单和任务状态机：

```text
draft -> submitted -> accepted -> running
      -> awaiting_approval -> running
      -> completed | failed | cancelled | expired
```

建议合同草案：

```text
GET  /v1/dispatch/devices
POST /v1/dispatch/tasks                 # 必须带 Idempotency-Key
GET  /v1/dispatch/tasks/{task_id}
POST /v1/dispatch/tasks/{task_id}/approve
POST /v1/dispatch/tasks/{task_id}/cancel
GET  /v1/dispatch/events/stream
GET  /v1/dispatch/tasks/{task_id}/artifacts
```

不可发送任意 shell 字符串。任务必须是结构化、可解释、可审计的 capability；高风险动作要二次确认，ACK 与权威状态分离，设备离线/重复请求/迟到结果/撤销竞态都要测试。

Mac 上的 `src/astr/effector/platform_backend.py` 目前只实现 `WindowsBackend`，`darwin` 会抛 `NotImplementedError`。如果 Mac 只作为客户端而 Windows PC 是执行设备，应优先实现配对的 Windows device agent；如果 Mac 自身也要被控制，再单独实现 Quartz/Accessibility backend，并要求 macOS Screen Recording、Accessibility 与 Input Monitoring 权限。

### Phase 5 — Knowledge、Memory、Training 与 Soul 迁移

- 先做脱敏、只读、可追溯的 Knowledge/Memory projection，不要把 `soul_package` 或本机路径直接暴露给浏览器。
- 训练/蒸馏是长 job：需要数据集版本、审批、取消、进度、产物哈希、模型/人格边界和审计。
- Soul 迁移必须使用版本化 manifest、完整性哈希、兼容性检查、原子导入与回滚；模型权重不得进入 `soul_package`。
- 导出/下载必须有独立 scope、审计和数据最小化。

## Mac 迁移操作手册

### 1. 不要复制这些目录

```text
.venv/
webapp/node_modules/
webapp/.next/
webapp/coverage/
webapp/test-results/
D:/ASTR/bin/llama/          # Windows 可执行文件，Mac 不可用
D:/ASTR/uv_cache/
D:/ASTR_System/.npm-cache/
D:/ASTR_System/.playwright-browsers/
```

它们应在 Mac 重新安装/生成。

### 2. 需要通过私有远端、加密介质或安全同步单独迁移

- 仓库根 `.env` 中的 API keys；不要提交 Git，也不要贴进 Codex 对话。
- `D:/ASTR/soul_package/justin`：独立的活动 Soul 数据仓。优先配置受控的私有远端并保留完整历史；没有私有远端时，用加密 `git bundle` 迁移。绝不能推到 `StarryJacksky/ASTR_System` 这个代码远端。
- `D:/ASTR/soul_package/` 下除 `justin` 仓外的必要运行数据：按敏感数据处理，通过加密介质迁移。
- `D:/ASTR/ops/`：账本、审计、备份、语音模板等运行证据；按敏感数据处理。
- `D:/ASTR/embodiments/`：本地模型、ASR/voiceprint/vision 资产；体积大，可按需重新下载。
- `D:/ASTR/effector/`：策略覆盖、审计、沙箱。浏览器 profile 可能含登录态且不保证跨平台，优先在 Mac 重新登录。
- `D:/ASTR/backups/`：确认恢复演练后再决定保留周期。
- 外部的 soul-grade frontend skill。

`webapp/public/live2d/` 被 Git 忽略且受独立许可证约束。干净克隆会安全降级为 StaticSoulLens。若要在 Mac 启用 Live2D，应先阅读 `webapp/docs/live2d-assets.md`，接受许可证后运行：

```bash
cd webapp
node scripts/fetch-live2d.mjs --download --accept-live2d-licenses
node scripts/fetch-live2d.mjs --check
```

不要把当前 Windows 的未验证/不完整资产当作已认证资源复制后直接启用。

### 3. Mac 初始安装

Apple Silicon 推荐使用原生 arm64 工具链：

```bash
xcode-select --install
brew install git uv node@22 redis
npm install -g npm@10.8.2
```

然后：

```bash
git clone https://github.com/StarryJacksky/ASTR_System.git
cd ASTR_System
git switch codex/astr-frontend-redesign

uv sync
cp .env.example .env
# 在 .env 中填写密钥，并把 ASTR_DATA_DIR 改成真实绝对路径，例如 /Users/alice/ASTR

brew services start redis
uv run pytest
uv run astr core --port 8300
```

另行恢复数据仓。若之后配置了私有远端：

```bash
mkdir -p /Users/alice/ASTR/soul_package
git clone <PRIVATE_SOUL_REPOSITORY_URL> /Users/alice/ASTR/soul_package/justin
```

若仍无 remote，则先在 Windows 从 `D:\ASTR\soul_package\justin` 生成完整 bundle，将 bundle 通过加密介质带到 Mac，再恢复：

```powershell
git -c safe.directory=D:/ASTR/soul_package/justin -C D:/ASTR/soul_package/justin bundle create D:/ASTR/backups/justin-2026-07-14.bundle --all
```

```bash
mkdir -p /Users/alice/ASTR/soul_package
git clone /path/to/justin-2026-07-14.bundle /Users/alice/ASTR/soul_package/justin
```

bundle 文件本身包含完整 Soul 历史，必须加密保存、限制访问，并在 Mac 恢复和校验后安全处置临时副本。

另开终端：

```bash
cd webapp
npm ci
npx playwright install chromium
npm run dev
```

访问 `http://localhost:3100`，再检查：

```bash
curl http://127.0.0.1:8300/v1/status
curl -N http://127.0.0.1:8300/v1/stream
```

默认 loopback 环境不需要改 Web 变量。若改 `NEXT_PUBLIC_ASTR_CORE`，必须在改完环境后重新 `npm run build`。

### 4. 目前不能原样用于 Mac 的部分

- `docker-compose.yml` 使用 `D:/ASTR/...` bind mount；先改成环境变量插值或增加不提交秘密的 macOS override，再启动。
- `scripts/start_all.ps1`、`start_llm.ps1`、`download_models.ps1`、`backup_task.ps1` 是 Windows 脚本。
- 可选 vision extra 锁到 CUDA 12.6 index，不适用于 Apple Silicon；不要直接运行 `uv sync --extra vision`。另做 Metal/CPU 依赖方案。
- 本地 llama.cpp 需要 Mac/Metal 构建和 `.sh` 启动脚本；不要复制 `llama-server.exe`。
- Effector GUI backend 只有 Windows；Mac Quartz/Accessibility backend 尚未实现。
- Watchdog、全局热键、窗口枚举、语音设备、TTS/ASR、屏幕/输入权限需要逐项 Mac 实测。

## 下一位 Codex 的优先工作清单

1. **先完成迁移，不加功能**：在 Mac 恢复数据，修正路径/compose/启动脚本，跑全量 Python 与 Web 验证。
2. **提交 macOS portability tranche**：只做跨平台和文档，不顺手打开 Studio/Dispatch。
3. **写 Authority/Gateway 设计与威胁模型**：让用户审核后再实现。
4. **实现并验证 auth/capabilities/streaming 基础合同**。
5. **先接 Studio 只读投影**，每个分类只在真实 endpoint 到位后启用。
6. **再做 Workbench/Knowledge**，最后做 Secure Dispatch mutation。
7. **Dispatch 完成后**再考虑 Soul migration、training jobs 与远程 artifact 下载。

## 验证与已知未完成证据

Web 的完整顺序见 `webapp/README.md`。关键规则：

- `npm run check:presence-budgets` 会生成新生产构建戳，必须在各 build-boundary scanner 之前运行。
- `test:e2e:no-build` 只接受与当前源码/Core identity 匹配的已戳构建。
- Studio scanner 的 fixture suite 与真实 production checker 都必须通过。
- Mobile real-hidden Chromium 生命周期是独立硬证据，不得静默 skip 或改名为 pass。
- 当前 Live2D 默认 gate 允许真实静态 fallback，但 dynamic certification 尚未完成。
- macOS IME、真实设备、辅助技术、固定硬件、Field INP 与 Mac GUI Effector 都仍需实机证据。

提交前至少运行：

```bash
uv run pytest
uv run pre-commit run -a

cd webapp
npm run test:run
npm run test:coverage
npm run lint
npm run typecheck
npm run check:presence-budgets
npm run check:presence-boundaries
npm run check:control-boundaries
npm run check:studio-boundaries
npm run check:mobile-boundaries
npm run test:e2e:no-build -- --grep-invert "real hidden Mobile page retains zero application RAF without synthetic visibility"
```

## 接手时可直接给 Codex 的提示词

```text
请先完整阅读仓库根 CODEX_HANDOFF.md、README.md、webapp/README.md 和 webapp/AGENTS.md。
不要从零重构，不要改变后端或把 unavailable 改成假数据。
先检查当前分支和工作区，复跑与目标有关的最新验证。
本轮目标是完成 macOS 可复现基线；任何新能力先写合同、权限和威胁模型给我审核。
保持星枢的蓝紫黑/明暗主题、Presence S 波浪、宽裕 Chat/Life、有机但克制的先锋布局，以及 Mobile 的独立产品形态。
```
