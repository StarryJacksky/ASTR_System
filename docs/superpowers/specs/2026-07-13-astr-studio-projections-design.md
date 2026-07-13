# 星枢 ASTR · Studio 安全只读投影子规格

> 状态：合同设计批准；实现门未开启
> 日期：2026-07-13
> Workstream：3A · Studio Projections
> 上游：`2026-07-11-astr-frontend-redesign-design.md`
> 边界：定义薄只读投影、授权、脱敏、状态语义与验收；不修改 Router、Soul、Memory、Guard、Effector 或事件语义，不授权在前端伪造投影

## 1. 决策摘要

Studio 不是 Presence 对话页的换皮，也不是 Control 的第三个后台面板。它只消费经过服务器授权、脱敏并带来源证据的六类投影：

1. `WorkspaceProjection`
2. `RunProjection`
3. `ToolProjection`
4. `TraceProjection`
5. `SourceProjection`
6. `ArtifactProjection`

当前 Core 只有部分候选字段、契约声明或瞬时对象，没有可供网页安全读取的 Studio authority 与合同。因此本子规格采用以下硬决策：

- Workstream 3A 只允许在稳定 authority 已存在后增加薄、只读、可授权的 projection layer；不重写任何内部执行机制。
- Workstream 3B 只能消费 3A 的公开合同；不得读取内部文件、SQLite、Redis 或解析 thought 文本。
- 当前没有实现 3A 端点、认证机制或缺失 authority 的授权；在获得明确跨栈实现授权前，不改后端。
- 端点未存在时，`/studio` 若将来提前出现，只能显示 `unavailable`，不能显示 mock Run、`$0` 假成本、假工具、假来源、假文件或假产物。
- `/v1/status` 的当前本地模型和今日总成本只可称为“Core 环境概览”，不得投影成某一次 Run 的 model/provider/route/cost。
- `/v1/stream` 不是 Studio Trace API；它没有 principal/scope 过滤、稳定回放和通用 trace 查询。

## 2. 当前权威事实

### 2.1 已公开的网页合同

当前 Core 公开：

- `POST /v1/ingest`
- `POST /v1/respond`
- `POST /v1/event`
- `GET /v1/social`
- voice / voiceprint 端点
- `GET /v1/stream`
- `GET /v1/status`
- Effector status、e-stop、policy 与 audit 六个端点

这些合同分别服务 Presence、平台桥与 Control。没有 `/v1/studio/*`、workspace、run、trace、source 或 artifact 读取端点。

### 2.2 只有候选字段或契约声明、尚不能网页直读的事实

| Studio 事实 | 当前候选字段 / 声明 | 最多能提示什么 | 为什么不能直接暴露 |
| --- | --- | --- | --- |
| 模型路由 | `RouteResponse` 声明 / 瞬时返回对象 | 单次 live call 对象可携带 task、model、tier、tokens、cost、degraded、trace | 没有持久 authority、按 Run 聚合、provider 安全标签与 principal 授权 |
| 成本 | `api_ledger` SQLite | trace、task、model、tokens、cost、时间 | 当前列表函数是 CLI/内部 SQL；没有授权、分页、run 归属 |
| 工具结果 | `ToolOutcome` | executed / needs_confirmation / denied / failed 等结果 | 原始 plan args、路径和摘要可能含凭据或私密内容 |
| Effector 事件 | EventType/payload 声明、Redis bus | schema 声明允许 action/result；不证明生产者实际发布或历史完整 | 当前 SSE 不是按主体过滤的通用历史 API |
| 决策轨迹 | CBG JSONL | trace、情境摘要、候选、reasoning | reasoning 和候选不等于可公开处理摘要，且可能泄露私密推理 |
| 屏幕截图 | `screenshot_ref` 与 CU 文件 | 某一步保存过截图 | 没有 manifest、hash、complete、生命周期或读取授权 |
| Workspace | 无统一来源 | 无 | 当前没有 workspace ID、成员、根范围或文件 projection |
| Source/citation | 零散模型/工具输出 | 某些文本可能含 URL | 没有统一 URI/title/quote/hash 或可信来源语义 |

### 2.3 Authority / source readiness

“内部有相似字段”不等于已经有可投影 authority。每类资源必须同时具备稳定 ID、生命周期、认证主体 ownership 与持久来源，才能进入薄 projection：

| Projection | 当前候选来源 | 稳定 ID / 生命周期 | 认证 ownership | 当前裁定 |
| --- | --- | --- | --- | --- |
| Workspace | 无；cwd/folders 只是 Guard 范围 | 无 | 无 | 固定 `unavailable`；需要独立 Workspace authority 项目 |
| Run | CU report、respond、dispatcher outcome 是瞬时结果 | 无持久 Run ID / 状态机 | 无 | 固定 `unavailable`；需要独立 Run authority 项目 |
| Tool | `ToolOutcome`、pending、Guard audit | outcome 瞬时；audit 不是 Run step entity | 无可靠绑定 | 固定 `unavailable`；需要在认证执行时写入只读投影记录 |
| Trace | Redis Event、CBG JSONL | trace_id 存在，但历史不完整、来源异质 | 旧 Event auth 来自客户端 | 固定 `unavailable`；需要认证绑定的 append-only trace authority |
| Source | 无统一模型 | 无 | 无 | 固定 `unavailable`；需要独立 Source authority 项目 |
| Artifact | screenshot / MoA / JSONL 等零散文件 | 无 manifest / 生命周期 | 无 | 固定 `unavailable`；需要独立 Artifact manifest authority |
| Route call | RouteResponse 与 cost ledger | ledger 无 run ID、model key/tier/provider 快照 | 无 | 固定 `unavailable`；需要认证 Run 写入时保存 route-call evidence |

Event type 声明不证明生产链实际发布了该事件；瞬时 Python 对象也不是历史 authority。3A 端点只能包装已经通过独立实现与安全评审的 authority。缺失 authority 的建设是新的后端数据项目，不得隐藏在“薄投影”实现里。

### 2.4 明确禁止的错误映射

- `agent.thought.stage` → Run stage
- `soul.decision.intent` → Studio Run type
- Guard audit row → Tool terminal outcome
- `status.cost_today_usd` → per-run cost
- `status.local_llm_model` → 本轮模型
- `screenshot_ref` → complete Artifact
- 普通 URL 文本 → verified Source
- SSE 当前连接 → trace 完整
- 空响应、`null` 或读取失败 → `0`、`empty` 或 `complete`

### 2.5 当前安全缺口

- 当前 FastAPI 路由没有 route-level authentication / authorization dependency。
- localhost CORS allowlist 只约束浏览器跨源读取，不是身份认证；本机其他进程仍可调用 Core。
- `/v1/stream` 没有 principal、session 或 trace filter，也没有历史 cursor；事件还包含 `auth.astr_user_id`、level 与 `verified_by`。
- `/v1/effector/status` 的 speaker、pending 摘要和原始 audit tail，以及 `/v1/admin/effector/audit` 的路径/extra，都可能包含敏感信息。
- Studio 不得自动接入这些原始流或审计来拼装 Run。它们在完成服务器授权与脱敏前继续留在现有可信本机/Control 边界。

## 3. 授权与信任模型

### 3.1 前置条件

3A 实现前必须存在服务器认证后的 principal。服务器不得信任客户端提交的 `user_id`、level、scope 或 `verified_by`。

每条可投影记录必须在写入 authority 时由服务器认证上下文绑定 `principal_id`、必要的 `workspace_id` / `run_id` 与授权版本。以下字段永远不能用来反推 ownership：

- 旧 `Event.auth`（其 `user_id` 来自客户端请求）
- speaker、Soul 名、路径、trace_id、platform session key
- ledger / CBG 中没有认证绑定的历史行

旧记录默认不可见。若未来需要迁移，必须另有可审计的安全迁移方案，逐条建立 ownership；不能以路径、trace 或用户名启发式归属。

最小读取 scopes：

- `studio:discover`
- `studio:workspace:read`
- `studio:run:read`
- `studio:tool:read`
- `studio:trace:read`
- `studio:source:read`
- `studio:artifact:read`
- `studio:artifact:content`：单独授权，不随 manifest 自动获得

`studio:discover` 只允许读取自身能力状态，不允许读取资源或数量。资源还必须经过 workspace membership / ownership 过滤。客户端路由参数只用于定位候选资源，不构成授权。

### 3.2 防枚举

- 未认证：`401`
- 已认证但缺少 `studio:discover`：`403`
- 某个资源不属于 principal 或不存在：统一 `404`
- 列表响应不得泄露无权资源的数量、ID、时间或名称
- 错误正文只返回稳定 `code` 与面向用户的安全摘要，不回传本地路径、SQL、stack、provider key 或原始异常

### 3.3 缓存与来源

所有 Studio 响应默认：

```http
Cache-Control: private, no-store
Vary: Authorization, Cookie
X-ASTR-Projection-Schema: studio.v1
```

Studio endpoint 使用同源网关或精确 origin allowlist，不增加 wildcard CORS。每个 envelope 包含生成时间、过期边界、revision、authority、已授 scopes 与资源绑定。

## 4. 统一 envelope 与能力状态

### 4.1 Projection envelope

```ts
type StudioScope =
  | "studio:discover"
  | "studio:workspace:read"
  | "studio:run:read"
  | "studio:tool:read"
  | "studio:trace:read"
  | "studio:source:read"
  | "studio:artifact:read"
  | "studio:artifact:content";

interface ProjectionResourceBinding {
  readonly workspace_id: string | null;
  readonly run_id: string | null;
}

interface ProjectionEnvelope<T> {
  readonly schema_version: "studio.v1";
  readonly revision: string;
  readonly observed_at: string; // 本次 projection 生成时间，UTC RFC 3339
  readonly expires_at: string | null;
  readonly authority: "astr-core";
  readonly granted_scopes: readonly StudioScope[];
  readonly resource: ProjectionResourceBinding;
  readonly data: T;
}

interface ProjectionPage<T> {
  readonly items: readonly T[];
  readonly next_cursor: string | null;
  readonly snapshot_revision: string;
}

type ProjectionErrorCode =
  | "AUTH_REQUIRED"
  | "SCOPE_REQUIRED"
  | "RESOURCE_NOT_FOUND"
  | "CONTRACT_NOT_INSTALLED"
  | "SOURCE_NOT_CONFIGURED"
  | "INVALID_CURSOR"
  | "INVALID_QUERY"
  | "PROJECTION_UNAVAILABLE"
  | "PROJECTION_MALFORMED"
  | "ARTIFACT_EXPIRED";

interface ProjectionErrorResponse {
  readonly error: {
    readonly code: ProjectionErrorCode;
    readonly message: string;
    readonly retryable: boolean;
  };
}
```

`observed_at` 是 projection 生成时间，不是 Run/Source/Artifact 的业务发生时间；业务时间由各资源字段表达。`expires_at` 为 `null` 只适用于不可变 terminal 事实，否则服务器必须提供保守过期时间。前端在过期后标 stale 并重新验证。

`revision` 与 `snapshot_revision` 是服务器生成的不可猜测版本标识，用于说明快照变化；都不是权限凭据。列表翻页必须保持同一 `snapshot_revision`。

### 4.2 Capability state

```ts
type ProjectionKind = "workspace" | "run" | "tool" | "trace" | "source" | "artifact";

type ProjectionCapability =
  | {
      readonly kind: ProjectionKind;
      readonly state: "available";
      readonly schema_version: "studio.v1";
      readonly reason_code: "READY";
    }
  | {
      readonly kind: ProjectionKind;
      readonly state: "unavailable";
      readonly schema_version: null;
      readonly reason_code: "CONTRACT_NOT_INSTALLED" | "SOURCE_NOT_CONFIGURED";
    }
  | {
      readonly kind: ProjectionKind;
      readonly state: "forbidden";
      readonly schema_version: "studio.v1";
      readonly reason_code: "SCOPE_REQUIRED";
    };

interface CapabilityResponseData {
  readonly capabilities: readonly ProjectionCapability[];
}

type CapabilityResponse = ProjectionEnvelope<CapabilityResponseData>;
type WorkspaceListResponse = ProjectionEnvelope<ProjectionPage<WorkspaceProjection>>;
type WorkspaceDetailResponse = ProjectionEnvelope<WorkspaceProjection>;
type RunListResponse = ProjectionEnvelope<ProjectionPage<RunProjection>>;
type RunDetailResponse = ProjectionEnvelope<RunProjection>;
```

能力查询只描述该 principal 可见的产品能力，不返回资源数量。

`capabilities` 必须包含六个已知 kind，各出现且仅出现一次；顺序无语义。重复、缺项、未知 kind 或任一 state/schema/reason 矛盾组合会使整份 capability response fail-closed。

`run=available` 的含义包含稳定 Run authority、route-call authority 与 `/route-calls` 端点均已安装；route-call 没有独立 capability。若 route-call authority 未就绪，`run` 必须为 unavailable，不能返回空 route-call 列表冒充“本轮零模型调用”。

Capability 采用 scope-first，避免通过状态探测 authority readiness：

| kind | required scope |
| --- | --- |
| workspace | `studio:workspace:read` |
| run（含 route-call） | `studio:run:read` |
| tool | `studio:tool:read` |
| trace | `studio:trace:read` |
| source | `studio:source:read` |
| artifact | `studio:artifact:read` |

- 缺 kind 对应 scope 时一律 `forbidden/SCOPE_REQUIRED`，无论 authority 是否安装；不得泄露 readiness。
- 具备 scope 后才可按 authority readiness 返回 available 或 unavailable；具备 scope 却返回 forbidden，或缺 scope 却返回 available/unavailable，均使整份 response fail-closed。
- 任何资源 endpoint 的 `200` envelope 都必须在 `granted_scopes` 中包含 `studio:discover` 与对应 read scope；route-call 需要 run scope。
- Trace 的 available evidence ref 除 trace scope 外，还要求 ref kind 对应的目标 scope；envelope、capability、endpoint 与 ref 的 scope 组合矛盾时拒绝整份 response。

能力发现流程唯一且 fail-closed：

- 未认证：`401 AUTH_REQUIRED`
- 已认证但无 `studio:discover`：`403 SCOPE_REQUIRED`，整个 Studio 显示 forbidden
- `GET /v1/studio/capabilities` 精确 `404`：当前部署未安装合同，六类全部映射 unavailable；不继续请求资源端点。缺路由时框架默认 404 body 是唯一不要求 `ProjectionErrorResponse` 的例外，客户端只看该 collection path 的 status
- `200`：只根据已知 kind/state/reason_code 点亮能力
- 网络错误或 `5xx`：capability 为 error，不得降格成 unavailable 或 empty
- 3B 不得靠逐个探测资源端点发现能力

### 4.3 UI 四态

Workstream 3B 必须严格区分：

| 状态 | 含义 | UI 文案原则 |
| --- | --- | --- |
| `unavailable` | 网页合同或权威来源未安装 | “Run 投影未启用”，不能写“暂无 Run” |
| `forbidden` | 合同存在，但当前 principal 无 scope | “无权读取”，不泄露是否存在数据 |
| `empty` | 授权 GET 成功且集合为零 | 此时才可写“暂无 Run / 来源 / 产物” |
| `error/stale` | 请求失败或最近证据过期 | 保留最近已验证证据、时间与重试；不能清空成 empty |

### 4.4 Stale 隔离

已验证证据缓存键至少包含认证 `principal_id`、登录/session identity、projection kind、endpoint、父 workspace/run、资源 ID、规范化 filters、order version、granted scope hash、schema version、snapshot revision 与 page cursor。Capability、detail 与各类 list/page 使用不同 namespace；同一 Run 下的 Tool、Trace、Source、Artifact 绝不能共用缓存槽。

- 只有同一认证主体、同一 session、同一资源上的暂时 network/`5xx` 才允许保留 stale。
- principal 或 session 变化、登出、`401`、`403`、scope 撤销、资源 `404`、capability 从 available 降级时，立即清除对应证据。
- workspace/run 选择变化时，旧资源可留在自己的 cache key 中，但不得显示在新选择下。
- stale 不触发 success、complete、download、approval 或 Micro-Wonder 能力。

## 5. 公开 HTTP allowlist

3A 只允许以下 `GET`。不得加入 POST、PUT、PATCH、DELETE、execute、approve、cancel 或 upload：

```text
GET /v1/studio/capabilities
GET /v1/studio/workspaces?cursor=&limit=
GET /v1/studio/workspaces/{workspace_id}
GET /v1/studio/runs?workspace_id=&cursor=&limit=
GET /v1/studio/runs/{run_id}
GET /v1/studio/runs/{run_id}/route-calls?cursor=&limit=
GET /v1/studio/runs/{run_id}/tools?cursor=&limit=
GET /v1/studio/runs/{run_id}/trace?cursor=&limit=
GET /v1/studio/runs/{run_id}/sources?cursor=&limit=
GET /v1/studio/runs/{run_id}/artifacts?cursor=&limit=
GET /v1/studio/artifacts/{artifact_id}
```

Artifact content 不属于 v1 初始 allowlist；v1 的 content handle 必须为 `null`。若以后提供，必须使用单独 scope、短寿命同源不透明 handle、每次读取重新授权、内容类型约束与 hash 校验，并另立威胁评审。

列表统一：

- `limit` 默认 50，范围 `1..100`
- `limit` 必须是未重复的规范十进制整数；非数字、重复、`<1` 或 `>100` 返回 `422 INVALID_QUERY`，不 clamp
- `workspace_id` 与其他 filter 必须单值、非空、满足 ID/长度限制；重复、未知或非法参数返回 `422 INVALID_QUERY`
- cursor 必须单值、非空并满足不透明 token 长度限制；重复、篡改、过期或上下文不匹配返回 `422 INVALID_CURSOR`
- cursor 是服务器签名/不透明值，客户端不得解析
- cursor 绑定 principal/session、scope hash、endpoint、父 workspace/run、全部 filters、排序版本、snapshot revision 与 expiry
- 跨主体、跨 endpoint、跨 filter、过期或篡改 cursor 返回 `422 INVALID_CURSOR`；父资源越权仍统一 `404`
- 排序固定：workspace `updated_at DESC NULLS LAST, id ASC`；run `created_at DESC, id ASC`；route/tool/trace `sequence ASC, id ASC`；source/artifact `created_at ASC, id ASC`
- 响应包含 `next_cursor: string | null`
- 坏 cursor 返回 `422 INVALID_CURSOR`，不静默回到第一页

### 5.1 Error wire mapping

| HTTP | code | retryable | 语义 |
| --- | --- | --- | --- |
| 401 | `AUTH_REQUIRED` | false | 没有有效认证 |
| 403 | `SCOPE_REQUIRED` | false | 缺 discovery 或集合级 scope |
| 404 | `RESOURCE_NOT_FOUND` / `CONTRACT_NOT_INSTALLED` | false | 资源不可见；capabilities collection 的 404 专用于未安装 |
| 410 | `ARTIFACT_EXPIRED` | false | 未来 content handle 过期；v1 不产生 |
| 422 | `INVALID_CURSOR` | false | cursor/filter/revision 不匹配 |
| 422 | `INVALID_QUERY` | false | limit/filter/重复或未知 query 非法 |
| 500 | `PROJECTION_MALFORMED` | true | authority 无法安全投影 |
| 503 | `SOURCE_NOT_CONFIGURED` / `PROJECTION_UNAVAILABLE` | true | 临时依赖或 authority 不可达 |

除未安装 capabilities collection 的框架默认 404 外，所有 Studio 错误（包括框架级 query validation 422）统一转换为 `ProjectionErrorResponse`。服务器日志可记录内部诊断，wire message 不包含敏感细节。

### 5.2 Endpoint / resource invariants

Runtime validation 不止检查字段类型，还必须检查请求上下文与交叉不变量：

- capability/list 根请求的 `resource` 只能包含其实际 filter；detail 的 `resource.workspace_id/run_id` 必须与 path、data 与认证后的 parent lookup 全部一致。
- `/workspaces/{W}` 的 `data.id=W`；`/runs/{R}` 的 `data.id=R`。提供 `workspace_id=W` filter 时，run list 的每个 `workspace_id` 必须等于 W；没有 filter 时，每个 item 仍须单独通过 principal 的 workspace ownership 并与自己的 parent binding 一致。
- run 的 route/tool/trace/source/artifact child response 必须绑定同一个 R；任何 item 的 `run_id` 不同会拒绝整页。
- artifact detail 的 path ID、data ID、run parent 与 envelope binding 必须一致。
- terminal Run (`succeeded|failed|cancelled`) 必须有 `terminal_at`；非 terminal 和 `unknown` 必须为 `null`。时间满足 `created_at <= terminal_at <= updated_at`（若 terminal）以及 `created_at <= updated_at`。
- terminal Tool (`denied|executed|failed|cancelled|disabled`) 必须有 `ended_at`；`proposed|waiting_approval|unknown` 不得伪造结束时间；有开始/结束时满足 `started_at <= ended_at`。Tool/route/trace sequence 在同一 snapshot 内严格递增且不重复。
- `route_summary.cost_completeness=complete` 时 known call count 与 known cost 必须非 null；`unknown` 时两者必须为 null；`partial` 数字只表示已知子集并必须在 UI 标注。
- `manifest_state=complete`、artifact URI、hash 与 content state/handle 组合必须满足 6.6 的不变量；矛盾组合拒绝整份 detail/item。
- 同一翻页序列的 envelope revision、page snapshot revision、resource binding、filters 与排序版本保持一致。

任何“请求 A、返回 B”、跨 parent item、矛盾 terminal/time、越权 ref 或不一致聚合都 fail-closed，不能靠 UI 修补。

### 5.3 Bounded decoding

服务器和前端都实施资源上限；普通未知字段仍计入总大小、深度与数组长度：

- capabilities / error body：最多 64 KiB
- detail body：最多 512 KiB
- list / trace page body：最多 2 MiB
- JSON 最大深度 16；分页 `items` 最多 100；capabilities 恰好 6；单 stage 的 evidence refs 最多 32
- ID 最多 256 字符；URI 最多 2048；普通 label 512；summary 4096；quote 8192

客户端先检查可信范围内的 `Content-Length`，并始终用有字节上限的流读取；不得直接对未知大小响应调用无界 `response.json()`。超限、过深、数组超长、极长字符串或解析失败统一当 `PROJECTION_MALFORMED`，不保留该次新数据。

## 6. 六类 projection

### 6.1 WorkspaceProjection

```ts
interface WorkspaceProjection {
  readonly id: string;
  readonly display_name: string;
  readonly kind: "local_project" | "collection" | "unknown";
  readonly state: "available" | "unavailable";
  readonly root_label: string | null;
  readonly updated_at: string | null;
}
```

- `root_label` 是服务器生成的安全标签，默认不得返回绝对路径。
- v1 不返回目录树、文件正文、file-read capability、git 凭据或环境变量。
- 没有统一 workspace authority 时 capability 必须为 `unavailable`。

### 6.2 RunProjection

```ts
type RunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";

interface RunProjection {
  readonly id: string;
  readonly workspace_id: string;
  readonly status: RunStatus;
  readonly stage_label: string | null;
  readonly input_summary: string | null;
  readonly result_summary: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly terminal_at: string | null;
  readonly trace_id: string | null;
  readonly route_summary: ModelRouteAggregate | null;
}

interface ModelRouteAggregate {
  readonly known_call_count: number | null;
  readonly known_cost_usd: number | null;
  readonly cost_completeness: "complete" | "partial" | "unknown";
}

interface ModelRouteCallProjection {
  readonly id: string;
  readonly run_id: string;
  readonly sequence: number;
  readonly task: string;
  readonly provider_label: string | null;
  readonly model_key: string | null;
  readonly model_label: string | null;
  readonly route_label: string | null;
  readonly tier_used: "free" | "cheap" | "balanced" | "max" | null;
  readonly local: boolean | null;
  readonly tokens_in: number | null;
  readonly tokens_out: number | null;
  readonly cost_usd: number | null;
  readonly degraded: boolean | null;
  readonly captured_at: string;
}

type RouteCallListResponse = ProjectionEnvelope<ProjectionPage<ModelRouteCallProjection>>;
```

- `succeeded` 需要权威 terminal outcome；没有终态时用 `unknown`，不能猜。
- `provider_label` 是安全展示名，不是 API base、账户、key 名或内部配置全文。
- `cost_usd: null` 表示未提供；前端不得渲染 `$0.00`。
- 同一个 Run 可以有零到多次 route call；不得压成单个“本轮模型”。
- route call 必须在认证 Run 执行时持久化；不得从当前 `routes.yaml` 反推历史 provider、model key、tier 或 local。
- `route_summary.known_call_count` 和 `known_cost_usd` 只能由绑定该 Run 的 route-call authority 聚合；证据不全时 completeness 为 partial/unknown，数字为 `null` 或明确的已知子集，不能冒充完整总额。
- 每次 Run 的 route/cost 必须按同一 run authority 归属；今日累计不能替代。
- 当前 ledger 不保存足够字段且没有 Run ownership，因此不能作为 v1 的充分 authority。
- 原始 prompt、私密对话和 Soul reasoning 默认不在 RunProjection。

### 6.3 ToolProjection

```ts
type ToolStatus =
  | "proposed"
  | "waiting_approval"
  | "denied"
  | "executed"
  | "failed"
  | "cancelled"
  | "disabled"
  | "unknown";

interface ToolProjection {
  readonly id: string;
  readonly run_id: string;
  readonly sequence: number;
  readonly tool_label: string;
  readonly status: ToolStatus;
  readonly summary: string;
  readonly argument_summary: string | null;
  readonly result_summary: string | null;
  readonly dangerous: boolean | null;
  readonly trace_id: string;
  readonly started_at: string | null;
  readonly ended_at: string | null;
}
```

- 只有内部 `ToolOutcome.status == executed` 才可投影为 `executed`。
- Guard `allow` 只表示放行，不表示执行完成。
- `argument_summary` 必须由服务器用工具级 allowlist 构造；前端不得接收原始 args 后自行打码。
- 绝对路径默认只显示 workspace-relative 安全标签；token、cookie、Authorization、password、secret、key、私密正文永不进入 projection。
- 工具失败摘要不得包含 stack、本地异常对象或完整输出。

### 6.4 TraceProjection

```ts
interface TracePageData extends ProjectionPage<TraceStageProjection> {
  readonly trace_id: string;
  readonly run_id: string;
  readonly trace_completeness: "complete" | "partial" | "unknown";
}

interface TraceStageProjection {
  readonly id: string;
  readonly sequence: number;
  readonly kind: "route" | "tool" | "guard" | "result" | "artifact" | "other";
  readonly status: "pending" | "active" | "succeeded" | "failed" | "denied" | "unknown";
  readonly source_label: string;
  readonly summary: string;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly evidence_refs: readonly TraceEvidenceRef[];
}

type TraceEvidenceRef =
  | {
      readonly kind: "run" | "route_call" | "tool" | "source" | "artifact";
      readonly access: "available";
      readonly id: string;
    }
  | {
      readonly kind: "redacted";
      readonly access: "redacted";
      readonly id: null;
    };

type TracePageResponse = ProjectionEnvelope<TracePageData>;
type ToolListResponse = ProjectionEnvelope<ProjectionPage<ToolProjection>>;
```

- Trace 是整理后的处理证据，不是“完整真实思维链”。
- 不投影 `DecisionTrace.reasoning`、候选隐式推理、system prompt 或原始 `agent.thought.text`。
- `studio:trace:read` 不绕过其他 scopes。服务器在投影前按 granted scopes 裁剪：没有 tool/source/artifact/run scope 时，相关 stage 详情与真实 ID 不得出现；可省略该 stage，或合并成固定文案、`kind=other`、无资源 ID 的脱敏缺口。
- `TraceEvidenceRef.access=available` 只有在当前 principal 同时拥有对应资源 scope 且资源 ownership 通过时成立；否则只能省略 ref 或返回固定 `kind=redacted,access=redacted,id=null`，不能泄露资源类别。前端不接收真实 ID 后再自行隐藏。
- 因 scope 裁剪掉任何 stage 时，面向当前 principal 的 `trace_completeness` 必须降为 `partial`。
- `sequence` 由服务器稳定生成；前端不靠 timestamp 猜顺序。
- 缺事件时 `trace_completeness=partial|unknown`，不得宣称“完整”。
- `trace_completeness=complete` 只描述 authority 对整条 trace 的判断；UI 只有在同一 snapshot revision 的所有页都读取完、最终 `next_cursor=null` 后，才可把当前物化视图称为完整。
- v1 先使用分页快照。若以后增加 SSE，必须同时有授权过滤、cursor replay、去重、顺序和断线缺口语义。

### 6.5 SourceProjection

```ts
type Sha256Hex = string; // wire invariant: /^[0-9a-f]{64}$/

interface SourceProjection {
  readonly id: string;
  readonly run_id: string;
  readonly created_at: string;
  readonly origin_uri: string | null;
  readonly title: string;
  readonly quote: string | null;
  readonly retrieval_version: string | null;
  readonly content_sha256: Sha256Hex | null;
  readonly retrieved_at: string | null;
  readonly access: "available" | "redacted" | "expired";
}

type SourceListResponse = ProjectionEnvelope<ProjectionPage<SourceProjection>>;
```

- Source 必须来自服务器的统一来源 schema；不能从输出文本正则抓 URL。
- `origin_uri` 只允许 `https` 或经过显式注册的安全 scheme；拒绝 `file:`、`javascript:`、`data:` 和 UNC 路径。
- `content_sha256` 只对 authority 在 `retrieval_version` 中保存/标识的“交给来源解析器的确切字节序列”计算，不对 title、quote、DOM 重排或当前在线页面计算。
- 所有 SHA-256 wire value 唯一编码为 64 位小写 hexadecimal (`^[0-9a-f]{64}$`)；拒绝大写、前缀、base64、短值和混合编码。
- Source 的 `content_sha256` 非 null 时，`retrieval_version` 与 `retrieved_at` 必须同时非 null；hash 必须绑定该版本的确切字节。
- quote 有服务器端长度上限并遵守内容权限；hash 未提供时显示“未提供”，不推断完整性。
- `access=available` 时上述可选字段按真实证据返回；`null` 仍表示未提供，不能补默认值。
- `access=redacted` 时 title 固定为“来源已脱敏”，且 `origin_uri`、quote、retrieval_version、content_sha256、retrieved_at 必须全部为 `null`。
- `access=expired` 时可保留已审查的 title 与 retrieved_at；`origin_uri`、quote、retrieval_version、content_sha256 必须为 `null`，不能留下目标或内容指纹。
- 任一 access/字段矛盾组合拒绝整项；脱敏由服务器完成，前端不先接收再隐藏。
- envelope 的 `authority=astr-core` 只证明该 projection 由 Core 生成，不证明第三方来源内容真实、正确或未撒谎。
- 前端打开外部来源时使用安全新窗口策略，不携带 opener。

### 6.6 ArtifactProjection

```ts
interface ArtifactProjection {
  readonly id: string;
  readonly run_id: string;
  readonly display_name: string;
  readonly media_type: string;
  readonly byte_size: number | null;
  readonly sha256: Sha256Hex | null;
  readonly manifest_state: "complete" | "partial" | "unavailable";
  readonly artifact_uri: string | null;
  readonly content: {
    readonly state: "not_exposed" | "available" | "expired";
    readonly handle: string | null;
  };
  readonly created_at: string;
}

type ArtifactListResponse = ProjectionEnvelope<ProjectionPage<ArtifactProjection>>;
type ArtifactDetailResponse = ProjectionEnvelope<ArtifactProjection>;
```

- `screenshot_ref` 本身不是 ArtifactProjection。
- `artifact_uri` 是 authority 内部不透明资源标识，不能直接导航或下载；它不等于 content permission。
- v1 固定 `content.state=not_exposed` 且 `handle=null`。未来 content handle 只能是短寿命同源不透明值，并在每次读取时再次校验 `studio:artifact:content`。
- `manifest_state=complete` 需要成功终态、完整 manifest、`artifact_uri` 与对确切 artifact bytes 计算的 `sha256`；它不自动代表内容可取。
- Artifact `sha256` 使用同一 64 位小写 hex wire invariant；任何非规范编码或与 manifest bytes 不一致都会使 manifest 不可验证。
- v1 的 `canReturnArtifact` 永远为 false。未来只有 manifest complete、terminal success、content available、有效 handle、content scope 与 hash 全部满足时才可开启。
- `partial`、`failed`、`denied`、content expired、hash 缺失都不能开启 `canReturnArtifact`。
- 文件名是安全展示名；不得泄露绝对路径或接受路径穿越。
- 浏览器不得把未知 media type 直接内嵌执行。

## 7. 脱敏规范

### 7.1 永不投影

- API key、cookie、Authorization、session token、密码、私钥
- provider 完整账号、内部 API base 与 key 环境变量名
- system prompt、Soul constitution 私密全文、Memory 原文
- `DecisionTrace.reasoning`、候选隐式推理与原始 thought 文本
- 未授权绝对路径、用户名、设备路径与截图本地位置
- 原始工具 args、原始异常、stack trace、SQL、Redis payload

### 7.2 服务器负责

脱敏是 projection authority 的职责，不是 React 渲染器的职责。服务器应对每一种工具维护允许展示的字段/摘要生成器；未知工具默认 `argument_summary=null`。

前端仍需：

- 以文本渲染摘要，不执行 HTML
- ID 必须非空、无控制字符并有长度上限；摘要/标题/quote 有按字段的服务器与客户端双重上限
- count、sequence、tokens、bytes 必须是非负 safe integer；cost 必须是非负有限数；时间必须是带时区的合法 RFC 3339
- 拒绝 prototype-pollution key、危险 URI、未知 enum 和安全关键字段的错误类型
- 为向后兼容可忽略普通未知字段，但未知字段永远不能提升 capability、scope、terminal、complete、content availability 或 Micro-Wonder；安全关键对象中的 `__proto__` / `constructor` / `prototype` 直接拒绝整份 projection

## 8. 错误与陈旧证据

稳定错误码：

```text
AUTH_REQUIRED
SCOPE_REQUIRED
RESOURCE_NOT_FOUND
CONTRACT_NOT_INSTALLED
SOURCE_NOT_CONFIGURED
INVALID_CURSOR
INVALID_QUERY
PROJECTION_UNAVAILABLE
PROJECTION_MALFORMED
ARTIFACT_EXPIRED
```

要求：

- `404` 不能被 UI 区分为“无权”还是“不存在”。
- `5xx` 不是 empty；只有 4.4 规定的同一 principal/session/resource 才可保留最近快照并标 `observed_at`。
- schema/version/shape 不匹配时前端拒绝整份对应 projection，不做宽松猜测。
- 一个 projection 失败不能清空其他 projection。
- 新请求可中止旧请求；旧响应不能覆盖新 workspace/run 选择。
- 重试只做 GET，不产生 mutation。

## 9. Workstream 3B 消费边界

3B shell 的最小真实信息架构：

- 顶部事实轨：principal scope、各 projection capability、最近验证时间
- 项目刻度轨：WorkspaceProjection
- 中央工作面：Run 输入摘要、阶段、结果；没有合同则只显示未启用
- 右/下证据轨：Tool、Trace、Source、Artifact 与 per-run route/cost
- Soul 只显示“参与 / 未参与 / 未提供”的显式证据，不长期占据工作区

3B 不得：

- 接 mock Studio client 作为生产 fallback
- 从 Presence conversation 或 generic SSE 反推 Run
- 在无合同状态放可执行 Run、Approve、Tool、Download 按钮
- 用假文件树、示例任务或演示数字填空
- 把 unavailable 写成 empty
- 触发任何成功/归档 Micro-Wonder
- 使用 S 形轨道、Control 档案壳或第二 WebGL context

视觉边界：0 WebGL、0 持续 route-owned RAF；稳定中高密度工作面，使用仪器刻度、证据路径与非对称留白，不使用通用 bento/card/glass/gradient 语法。昼夜主题保持同一几何结构。

## 10. 安全威胁清单

必须在实现计划前覆盖：

1. IDOR / workspace 越权
2. cursor 篡改与资源枚举
3. 跨 principal SSE 或缓存泄漏
4. 原始 tool args 中的凭据、路径与私密正文泄漏
5. provider 配置与环境变量泄漏
6. 原始 thought / reasoning 被误当 trace
7. run cost 与当日成本错配
8. Guard allow 被误称 executed
9. partial screenshot 被误称 complete artifact
10. artifact 标识 / 未来 content handle 的路径穿越、过期重放与内容嗅探
11. 外部 source URI 的危险 scheme 与 opener 攻击
12. 乱序、重复、旧响应覆盖新选择
13. 读取失败被显示为 empty
14. prototype-pollution key、极深 JSON、超长字符串与非有限数
15. 前端未知字段意外点亮能力或 Micro-Wonder
16. 旧 Event.auth / speaker / path / trace 被错误当成 ownership
17. cursor 跨 principal、scope、filter、revision 或 endpoint 重放
18. Core authority 被误解为第三方 Source 内容真实性背书

## 11. 3A 验收矩阵

### 11.1 合同

- 精确 GET allowlist；不存在 Studio mutation。
- 所有 response 通过服务器模型和前端 runtime validator。
- `schema_version`、revision、observed_at、expires_at、authority、granted_scopes 与 resource binding 完整。
- cursor 稳定分页、limit 规范校验、非法 limit 与坏 cursor 明确失败。
- cursor 绑定 principal/session/scope/endpoint/filter/revision/expiry，跨上下文重放失败。
- 非法、重复、未知 query 与越界 limit 统一返回 `422 INVALID_QUERY` error envelope。
- 普通额外字段可安全忽略但不提升能力；危险 key、未知 enum 与 URI 拒绝。
- capability、page、detail、trace page 和 error wire shape 均有精确模型。
- capability 六个 kind 的重复、缺项、未知项与矛盾 state/schema/reason 组合全部拒绝。
- capability 采用 scope-first；available/unavailable/forbidden 与 granted_scopes 的矛盾组合全部拒绝。
- 未安装 capabilities route 的默认 404 是唯一 error-envelope 例外。

### 11.2 授权

- 未认证、缺 scope、跨 workspace、跨 principal 全部负向测试。
- 无权资源与不存在资源对客户端均为 404。
- 列表不泄露无权数据数量。
- Artifact manifest 与 content scope 分离。
- legacy rows 默认不可见；不得用 user_id/speaker/path/Soul/trace 启发式建立 ownership。
- principal/session 变化、登出、401/403/scope 撤销/404 会清除对应前端证据。
- 只有 trace scope、没有 tool/source/artifact/run scope 时，不返回跨域详情或真实 evidence ID，并将 view completeness 降为 partial。
- 每个资源 endpoint 的 200 envelope 必含 discovery + 对应 read scope；route-call 与 Trace available refs 覆盖目标 scope 负向测试。

### 11.3 语义

- `null` 保持未知，不转成 0、false、empty 或 complete。
- per-run route/cost 必须和 run/trace 一致。
- 多 route call 保持独立 sequence；当前 routes.yaml 不回填历史事实。
- 只有 ToolOutcome executed 可称已执行。
- Trace 缺口明确 partial/unknown；分页未全部物化时不称当前视图完整。
- v1 content 不暴露，`canReturnArtifact=false`；未来还需完整 manifest + artifact URI + hash + terminal success + content handle + content scope 才可开启归脊能力。
- Source hash 对象与 retrieval version 明确；不把 Core envelope 当第三方真实性证明。
- Source available/redacted/expired 的字段组合逐一覆盖；redacted/expired 不泄露 URI、quote 或内容指纹。
- Source/Artifact hash 只接受 64 位小写 hex；Source 非空 hash 强制绑定 retrieval version/time。
- path/filter/envelope/data/item parent ID 全量交叉校验；terminal/time、sequence、aggregate、artifact 组合矛盾均拒绝。

### 11.4 脱敏

- secrets、绝对路径、原始 args、stack、reasoning、system prompt 的 canary 测试。
- 未知工具参数默认完全不显示。
- Source quote 与 Artifact display name 有长度、字符和 scheme 限制。
- body 字节、JSON 深度、items/refs 数量、ID/URI/summary/quote 上限都有 oversized/deep payload 负向测试。

### 11.5 前端边界

- capability unavailable 时不请求不存在的资源端点。
- unavailable / forbidden / empty / stale / error 分支各有单测。
- 任一 projection 失败不清空其他已验证证据。
- stale cache 严格按 principal/session/kind/endpoint/parent/resource/filter/order/scope/schema/snapshot/page 隔离，并覆盖清除条件。
- `run=available` 但 route-call authority/endpoint 缺失的 capability fixture 必须拒绝；未安装不能映射为空列表。
- 无 projection 时 0 假任务、0 假成本、0 假 artifact、0 成功仪式。

## 12. 实施门与下一步

3A 实现需要三项彼此独立的新权限：

1. 允许建立当前缺失的 Run、Workspace、Source、Artifact 等稳定 authority（ID、生命周期、ownership、持久化）；
2. 明确可复用或新增的认证 principal / scope 机制，并规定 legacy data 处置；
3. 在 authority 与认证通过安全评审后，允许增加上述薄只读 Core projection endpoints。

在获得这三项授权前：

- 不修改 `src/astr/**` 或后端测试；
- 不创建假 `/v1/studio/*` mock 作为生产能力；
- 不进入依赖真实 projection 的 Workstream 3B；
- 可以继续 Workstream 4 的纯 Mobile 五域壳层，但 AI 工作台域必须显示“Studio 投影未启用”。

这不是产品失败，而是主权边界：界面宁可留白，也不把候选字段或契约声明伪装成已授权事实。
