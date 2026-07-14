export type ControlDomain = "system" | "soul";
export type ControlModuleStatus = "available" | "planned";

export interface ControlModule {
  readonly id: string;
  readonly href: `/admin/${string}`;
  readonly domain: ControlDomain;
  readonly title: string;
  readonly subtitle: string;
  readonly index: string;
  readonly status: ControlModuleStatus;
  readonly summary: string;
  readonly contracts: readonly string[];
  readonly prerequisite: string;
  readonly questions: readonly string[];
  readonly authorityRequirements: readonly string[];
  readonly relatedModuleIds: readonly string[];
}

function defineControlModule<const T extends ControlModule>(module: T): Readonly<T> {
  Object.freeze(module.contracts);
  Object.freeze(module.questions);
  Object.freeze(module.authorityRequirements);
  Object.freeze(module.relatedModuleIds);
  return Object.freeze(module);
}

const modules = [
  defineControlModule({
    id: "dashboard",
    href: "/admin/dashboard",
    domain: "system",
    title: "系统概览",
    subtitle: "总星图",
    index: "A01",
    status: "planned",
    summary: "汇总可验证的系统健康、成本与安全事实。",
    contracts: [],
    prerequisite: "需要独立的 Admin health projection。",
    questions: [
      "哪些系统健康、成本与安全事实应进入当前汇总？",
      "每项汇总事实的权威来源、观察时间与覆盖范围是什么？",
    ],
    authorityRequirements: [
      "需要独立且带来源、观察时间与覆盖范围的 Admin health projection。",
      "需要经授权的成本与安全聚合口径及其版本。",
    ],
    relatedModuleIds: ["logs-trace", "effector"],
  }),
  defineControlModule({
    id: "platform-gateway",
    href: "/admin/platform-gateway",
    domain: "system",
    title: "平台与网关",
    subtitle: "航道",
    index: "A02",
    status: "planned",
    summary: "管理平台适配与网关连接。",
    contracts: [],
    prerequisite: "需要授权后的 gateway projection。",
    questions: [
      "当前主体可见的平台与网关边界是什么？",
      "每条连接的适配器版本、认证状态与最近观察时间是什么？",
    ],
    authorityRequirements: [
      "需要授权后的 gateway projection，包含稳定 ID、适配器版本、连接状态与观察时间。",
      "需要 principal scope 与凭据脱敏规则；不得暴露密钥。",
    ],
    relatedModuleIds: ["plugins-skills-mcp", "sessions-people"],
  }),
  defineControlModule({
    id: "model-router",
    href: "/admin/model-router",
    domain: "system",
    title: "Provider 与模型路由",
    subtitle: "星门",
    index: "A03",
    status: "planned",
    summary: "查看 Provider、模型与路由事实。",
    contracts: [],
    prerequisite: "需要 model-router projection 与版本合同。",
    questions: [
      "某个 Run 与 trace 应由哪条规则选择 Provider、模型与成本层级？",
      "降级或 fallback 如何绑定到同一条可审计路由记录？",
    ],
    authorityRequirements: [
      "需要按 Run 与 trace 绑定且版本化的 model-router projection。",
      "需要路由字段映射及 Provider capability 与新鲜度证据。",
    ],
    relatedModuleIds: ["logs-trace", "settings"],
  }),
  defineControlModule({
    id: "plugins-skills-mcp",
    href: "/admin/plugins-skills-mcp",
    domain: "system",
    title: "插件、Skills 与 MCP",
    subtitle: "工具舱",
    index: "A04",
    status: "planned",
    summary: "查看扩展、技能与工具主机状态。",
    contracts: [],
    prerequisite: "需要 capability-scoped plugin and MCP projection。",
    questions: [
      "当前主体可见哪些 Plugin、Skill 与 MCP host 能力？",
      "每项能力的清单版本、信任来源与权限边界是什么？",
    ],
    authorityRequirements: [
      "需要 capability-scoped Plugin、Skill 与 MCP projection，包含稳定 ID、manifest digest 与版本。",
      "需要 principal scope、权限声明与来源证明。",
    ],
    relatedModuleIds: ["platform-gateway", "effector"],
  }),
  defineControlModule({
    id: "sessions-people",
    href: "/admin/sessions-people",
    domain: "system",
    title: "会话与人物",
    subtitle: "名册",
    index: "A05",
    status: "planned",
    summary: "查看主体、会话与人物关系。",
    contracts: [],
    prerequisite: "需要 principal-scoped session and people projection。",
    questions: [
      "当前主体可以查看哪些会话与人物档案？",
      "会话、principal 与人物关系通过什么稳定标识和来源建立？",
    ],
    authorityRequirements: [
      "需要 principal-scoped session and people projection，包含稳定 ID、关系类型与观察时间。",
      "需要字段脱敏、留存范围与来源版本。",
    ],
    relatedModuleIds: ["memory", "logs-trace"],
  }),
  defineControlModule({
    id: "schedule",
    href: "/admin/schedule",
    domain: "system",
    title: "调度计划",
    subtitle: "星历",
    index: "A06",
    status: "planned",
    summary: "查看计划任务与触发来源。",
    contracts: [],
    prerequisite: "需要 schedule projection 与取消语义。",
    questions: [
      "哪些计划条目与触发来源应进入当前主体的视图？",
      "每项计划何时再次评估，如何证明其失效或被撤销？",
    ],
    authorityRequirements: [
      "需要授权的 schedule projection，包含规则、时区、触发来源与 revision。",
      "需要明确的撤销与失效语义，以及 trace 或 audit 关联。",
    ],
    relatedModuleIds: ["sessions-people", "logs-trace"],
  }),
  defineControlModule({
    id: "logs-trace",
    href: "/admin/logs-trace",
    domain: "system",
    title: "日志与 Trace",
    subtitle: "回声档案",
    index: "A07",
    status: "planned",
    summary: "按授权范围检查因果轨迹。",
    contracts: [],
    prerequisite: "需要通用 TraceProjection 与脱敏规则。",
    questions: [
      "给定 trace_id，完整因果链应包含哪些事件与父子关系？",
      "哪些字段因权限或脱敏规则不可见，所用规则版本是什么？",
    ],
    authorityRequirements: [
      "需要通用 TraceProjection，包含 event 或 span、parent、source、timestamp 与结果语义。",
      "需要 principal scope、分页边界与版本化脱敏规则。",
    ],
    relatedModuleIds: ["dashboard", "effector"],
  }),
  defineControlModule({
    id: "settings",
    href: "/admin/settings",
    domain: "system",
    title: "系统设置",
    subtitle: "定标室",
    index: "A08",
    status: "planned",
    summary: "查看可安全暴露的系统设置。",
    contracts: [],
    prerequisite: "需要字段级读写权限与 revision。",
    questions: [
      "每个可安全暴露字段的有效值、来源层与 revision 是什么？",
      "当前主体对每个字段具有什么可见性与权限级别？",
    ],
    authorityRequirements: [
      "需要字段级设置 projection，明确敏感度、来源层、有效值与 revision。",
      "需要字段级读写 scope；密钥只能呈现是否配置，不能呈现内容。",
    ],
    relatedModuleIds: ["setup", "platform-gateway"],
  }),
  defineControlModule({
    id: "resources-knowledge",
    href: "/admin/resources-knowledge",
    domain: "system",
    title: "资源与知识",
    subtitle: "藏书穹顶",
    index: "A09",
    status: "planned",
    summary: "查看资源、索引与知识来源。",
    contracts: [],
    prerequisite: "需要资源与知识的只读 projection。",
    questions: [
      "哪些资源、索引与知识来源处于当前授权范围？",
      "每项内容的来源、digest、索引 revision 与新鲜度如何证明？",
    ],
    authorityRequirements: [
      "需要只读 Resource 与 Knowledge projection，包含稳定 ID、来源、digest、索引 revision 与观察时间。",
      "需要 principal scope、脱敏及许可与保留口径。",
    ],
    relatedModuleIds: ["memory", "training"],
  }),
  defineControlModule({
    id: "setup",
    href: "/admin/setup",
    domain: "system",
    title: "安装与初始化",
    subtitle: "点火序列",
    index: "A10",
    status: "planned",
    summary: "检查安装、依赖与初始化阶段。",
    contracts: [],
    prerequisite: "需要幂等 setup state machine。",
    questions: [
      "安装与初始化应被划分为哪些可验证阶段？",
      "哪些依赖、schema 或数据前置条件必须给出证据？",
    ],
    authorityRequirements: [
      "需要幂等 setup state machine 的只读 projection，包含阶段、检查结果、错误码与 revision。",
      "需要版本化安装清单及依赖与 schema 兼容性证据。",
    ],
    relatedModuleIds: ["settings", "platform-gateway"],
  }),
  defineControlModule({
    id: "soul",
    href: "/admin/soul",
    domain: "soul",
    title: "Soul 配置",
    subtitle: "灵魂档案",
    index: "S01",
    status: "planned",
    summary: "查看 Soul 身份、版本与纯度事实。",
    contracts: [],
    prerequisite: "需要只读 SoulPackage projection。",
    questions: [
      "SoulPackage 的 identity、soul_version、schema_version 与 embodiment 应如何证明？",
      "宪法、目录不变量与纯度校验应由哪份可追溯结果证明？",
    ],
    authorityRequirements: [
      "需要来自 manifest 与验证结果的只读、版本化 SoulPackage projection。",
      "需要 manifest digest、validator version、校验时间与敏感字段授权边界。",
    ],
    relatedModuleIds: ["memory", "migration"],
  }),
  defineControlModule({
    id: "memory",
    href: "/admin/memory",
    domain: "soul",
    title: "记忆系统",
    subtitle: "深空存档",
    index: "S02",
    status: "planned",
    summary: "查看记忆层、来源与保留策略。",
    contracts: [],
    prerequisite: "需要授权后的 Memory projection。",
    questions: [
      "当前授权范围应包含哪些记忆层与记录类型？",
      "每条记录的来源、形成时间、留存策略与 revision 是什么？",
    ],
    authorityRequirements: [
      "需要授权后的 Memory projection，包含稳定 ID、layer、type、source、createdAt 与 retention policy。",
      "需要 principal scope、provenance、revision 与观察时间。",
    ],
    relatedModuleIds: ["sessions-people", "resources-knowledge"],
  }),
  defineControlModule({
    id: "emotion",
    href: "/admin/emotion",
    domain: "soul",
    title: "情绪系统",
    subtitle: "潮汐仪",
    index: "S03",
    status: "planned",
    summary: "查看情绪模型与衰减来源。",
    contracts: [],
    prerequisite: "需要 emotion history projection。",
    questions: [
      "情绪状态应由哪些输入事件、模型版本与时间点推导？",
      "各维度的基线、衰减规则与历史变化如何追溯？",
    ],
    authorityRequirements: [
      "需要 emotion history projection，包含向量、基线、衰减参数、模型版本与观察时间。",
      "需要关联输入 trace 或 event 的来源及访问范围。",
    ],
    relatedModuleIds: ["soul", "memory"],
  }),
  defineControlModule({
    id: "moa-teaching",
    href: "/admin/moa-teaching",
    domain: "soul",
    title: "MoA 与教学",
    subtitle: "议事庭",
    index: "S04",
    status: "planned",
    summary: "查看讨论、教学与裁决证据。",
    contracts: [],
    prerequisite: "需要 MoA and teaching projection。",
    questions: [
      "一次讨论应由哪些席位参与，各自贡献的证据是什么？",
      "合并纪要、Soul 决断与教学记录如何通过 trace 对齐？",
    ],
    authorityRequirements: [
      "需要 MoA 与 teaching projection，包含 trace_id、席位结果、合并纪要与 decision reference。",
      "需要 teaching record 的来源事件、版本与持久化 provenance。",
    ],
    relatedModuleIds: ["logs-trace", "training"],
  }),
  defineControlModule({
    id: "training",
    href: "/admin/training",
    domain: "soul",
    title: "训练",
    subtitle: "飞轮",
    index: "S05",
    status: "planned",
    summary: "查看训练集、轮次与产物。",
    contracts: [],
    prerequisite: "需要可追溯 training run contract。",
    questions: [
      "一次 training run 应绑定哪个 dataset digest、配置与基模型版本？",
      "产物应由哪组评估基线、指标与 lineage 证明可追溯？",
    ],
    authorityRequirements: [
      "需要可追溯 training run contract，绑定 dataset、配置、模型、产物 digest 与 run state。",
      "需要版本化评估报告、基线与产物 lineage。",
    ],
    relatedModuleIds: ["moa-teaching", "soul"],
  }),
  defineControlModule({
    id: "voice",
    href: "/admin/voice",
    domain: "soul",
    title: "声音与声纹",
    subtitle: "声纹室",
    index: "S06",
    status: "planned",
    summary: "查看声音模型、声纹与权限边界。",
    contracts: [],
    prerequisite: "现有 Presence voiceprint 合同不足以构成 Admin 模块。",
    questions: [
      "一个 embodiment 可关联哪些 ASR、TTS、VAD 与 voiceprint 模型版本？",
      "声纹登记、阈值与主体授权的可见边界是什么？",
    ],
    authorityRequirements: [
      "需要独立的 Admin VoiceProjection；现有 Presence voice 与 voiceprint 状态不足。",
      "需要模型 digest、版本、配置来源、观察时间及不暴露 embedding 的授权规则。",
    ],
    relatedModuleIds: ["soul", "sessions-people"],
  }),
  defineControlModule({
    id: "effector",
    href: "/admin/effector",
    domain: "soul",
    title: "执行策略与审计",
    subtitle: "丁册",
    index: "S07",
    status: "available",
    summary: "管理执行策略、安全底线、急停与审计链。",
    contracts: [
      "GET /v1/admin/effector/policy",
      "PUT /v1/admin/effector/policy",
      "GET /v1/admin/effector/audit",
      "GET /v1/effector/status",
      "POST /v1/effector/estop",
      "POST /v1/effector/estop/reset",
    ],
    prerequisite: "现有 Core 合同已提供。",
    questions: [
      "当前有效策略、锁定安全底线与 overlay 来源是什么？",
      "急停状态与审计链的最终权威回读是什么？",
    ],
    authorityRequirements: [
      "现有 GET/PUT /v1/admin/effector/policy 与 GET /v1/effector/status 提供策略及权威回读。",
      "现有 GET /v1/admin/effector/audit、POST /v1/effector/estop 与 POST /v1/effector/estop/reset；POST ACK 后仍由 status GET 定权。",
    ],
    relatedModuleIds: ["logs-trace", "settings"],
  }),
  defineControlModule({
    id: "migration",
    href: "/admin/migration",
    domain: "soul",
    title: "灵魂迁移",
    subtitle: "远航封装",
    index: "S08",
    status: "planned",
    summary: "查看灵魂包迁移、校验与回滚。",
    contracts: [],
    prerequisite: "需要签名迁移包、兼容性与回滚合同。",
    questions: [
      "源包与目标 embodiment 的 schema 和版本兼容性应如何判定？",
      "package digest、continuity report 与可恢复锚点如何共同证明迁移边界？",
    ],
    authorityRequirements: [
      "需要签名 migration package projection，包含 manifest、schema、source、target、digest 与校验结果。",
      "需要 compatibility 与 rollback contract，绑定 ContinuityReport、trace 与恢复锚点。",
    ],
    relatedModuleIds: ["soul", "training"],
  }),
] as const satisfies readonly ControlModule[];

export type ControlModuleId = (typeof modules)[number]["id"];

export const CONTROL_MODULES = Object.freeze(modules);

export function getControlModule(id: string): ControlModule | undefined {
  return CONTROL_MODULES.find((module) => module.id === id);
}

export function getControlModulesByDomain(domain: ControlDomain): readonly ControlModule[] {
  return CONTROL_MODULES.filter((module) => module.domain === domain);
}
