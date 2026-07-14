import { describe, expect, it } from "vitest";

import {
  CONTROL_MODULES,
  getControlModule,
  getControlModulesByDomain,
} from "./control-modules";

const EXPECTED_IDS = [
  "dashboard",
  "platform-gateway",
  "model-router",
  "plugins-skills-mcp",
  "sessions-people",
  "schedule",
  "logs-trace",
  "settings",
  "resources-knowledge",
  "setup",
  "soul",
  "memory",
  "emotion",
  "moa-teaching",
  "training",
  "voice",
  "effector",
  "migration",
] as const;

const EXPECTED_HREFS = EXPECTED_IDS.map((id) => `/admin/${id}`);

type ExpectedModuleId = (typeof EXPECTED_IDS)[number];

interface ReadinessProbe {
  readonly questions?: readonly string[];
  readonly authorityRequirements?: readonly string[];
  readonly relatedModuleIds?: readonly string[];
}

const EXPECTED_READINESS = {
  dashboard: {
    question: /健康|成本/,
    authority: /Admin health projection/,
    related: ["logs-trace", "effector"],
  },
  "platform-gateway": {
    question: /平台|网关/,
    authority: /gateway projection/,
    related: ["plugins-skills-mcp", "sessions-people"],
  },
  "model-router": {
    question: /Provider|模型/,
    authority: /model-router projection/,
    related: ["logs-trace", "settings"],
  },
  "plugins-skills-mcp": {
    question: /Plugin|Skill|MCP/,
    authority: /capability-scoped/,
    related: ["platform-gateway", "effector"],
  },
  "sessions-people": {
    question: /会话|人物/,
    authority: /session and people projection/,
    related: ["memory", "logs-trace"],
  },
  schedule: {
    question: /计划|触发/,
    authority: /schedule projection/,
    related: ["sessions-people", "logs-trace"],
  },
  "logs-trace": {
    question: /trace_id|因果/,
    authority: /TraceProjection/,
    related: ["dashboard", "effector"],
  },
  settings: {
    question: /字段|revision/,
    authority: /字段级设置 projection/,
    related: ["setup", "platform-gateway"],
  },
  "resources-knowledge": {
    question: /资源|知识/,
    authority: /Resource 与 Knowledge projection/,
    related: ["memory", "training"],
  },
  setup: {
    question: /安装|初始化/,
    authority: /setup state machine/,
    related: ["settings", "platform-gateway"],
  },
  soul: {
    question: /SoulPackage|soul_version/,
    authority: /SoulPackage projection/,
    related: ["memory", "migration"],
  },
  memory: {
    question: /记忆层|记录/,
    authority: /Memory projection/,
    related: ["sessions-people", "resources-knowledge"],
  },
  emotion: {
    question: /情绪|衰减/,
    authority: /emotion history projection/,
    related: ["soul", "memory"],
  },
  "moa-teaching": {
    question: /讨论|教学/,
    authority: /MoA 与 teaching projection/,
    related: ["logs-trace", "training"],
  },
  training: {
    question: /training run|dataset/,
    authority: /training run contract/,
    related: ["moa-teaching", "soul"],
  },
  voice: {
    question: /ASR|TTS|声纹/,
    authority: /Admin VoiceProjection/,
    related: ["soul", "sessions-people"],
  },
  effector: {
    question: /策略|急停/,
    authority: /\/v1\/admin\/effector/,
    related: ["logs-trace", "settings"],
  },
  migration: {
    question: /迁移|兼容/,
    authority: /migration package projection/,
    related: ["soul", "training"],
  },
} as const satisfies Readonly<Record<ExpectedModuleId, {
  readonly question: RegExp;
  readonly authority: RegExp;
  readonly related: readonly ExpectedModuleId[];
}>>;

describe("Control module registry", () => {
  it("defines the exact 18-route IA once", () => {
    expect(CONTROL_MODULES.map(({ id }) => id)).toEqual(EXPECTED_IDS);
    expect(CONTROL_MODULES.map(({ href }) => href)).toEqual(EXPECTED_HREFS);
    expect(getControlModulesByDomain("system")).toHaveLength(10);
    expect(getControlModulesByDomain("soul")).toHaveLength(8);
  });

  it("exposes only the existing Effector web contract", () => {
    expect(
      CONTROL_MODULES.filter(({ status }) => status === "available").map(({ id }) => id),
    ).toEqual(["effector"]);
    expect(getControlModule("effector")?.contracts).toEqual([
      "GET /v1/admin/effector/policy",
      "PUT /v1/admin/effector/policy",
      "GET /v1/admin/effector/audit",
      "GET /v1/effector/status",
      "POST /v1/effector/estop",
      "POST /v1/effector/estop/reset",
    ]);
  });

  it("defines distinct, truthful readiness evidence for every dossier", () => {
    const questionSets: string[] = [];

    for (const entry of CONTROL_MODULES) {
      const readiness = entry as typeof entry & ReadinessProbe;
      const expected = EXPECTED_READINESS[entry.id];
      const questions = readiness.questions ?? [];
      const authorityRequirements = readiness.authorityRequirements ?? [];
      const relatedModuleIds = readiness.relatedModuleIds ?? [];

      expect(questions.length, `${entry.id} question count`).toBeGreaterThanOrEqual(2);
      expect(questions.length, `${entry.id} question count`).toBeLessThanOrEqual(3);
      expect(questions.every((question) => question.trim().length > 0 && question.endsWith("？")))
        .toBe(true);
      expect(questions.join(" "), `${entry.id} question anchor`).toMatch(expected.question);

      expect(authorityRequirements.length, `${entry.id} authority count`).toBeGreaterThanOrEqual(1);
      expect(authorityRequirements.every((requirement) => requirement.trim().length > 0))
        .toBe(true);
      expect(
        authorityRequirements.join(" "),
        `${entry.id} authority anchor`,
      ).toMatch(expected.authority);

      expect(relatedModuleIds, `${entry.id} related dossiers`).toEqual(expected.related);
      expect(relatedModuleIds.length).toBeGreaterThanOrEqual(1);
      expect(relatedModuleIds.length).toBeLessThanOrEqual(2);
      expect(new Set(relatedModuleIds).size).toBe(relatedModuleIds.length);
      expect(relatedModuleIds).not.toContain(entry.id);
      expect(relatedModuleIds.every((id) => EXPECTED_IDS.includes(id as ExpectedModuleId)))
        .toBe(true);

      if (entry.status === "planned") {
        expect(
          [entry.summary, entry.prerequisite, ...authorityRequirements].join(" "),
          `${entry.id} must not claim runtime success`,
        ).not.toMatch(/已(?:启用|连接|完成|验证)|运行中|成功|当前值/);
      }

      questionSets.push(JSON.stringify(questions));
    }

    expect(new Set(questionSets).size).toBe(CONTROL_MODULES.length);
  });

  it("freezes the registry, module records, and every nested contract array", () => {
    expect(Object.isFrozen(CONTROL_MODULES)).toBe(true);

    for (const entry of CONTROL_MODULES) {
      const readiness = entry as typeof entry & ReadinessProbe;
      expect(Object.isFrozen(entry), `${entry.id} record`).toBe(true);
      expect(Object.isFrozen(entry.contracts), `${entry.id} contracts`).toBe(true);
      expect(Object.isFrozen(readiness.questions), `${entry.id} questions`).toBe(true);
      expect(
        Object.isFrozen(readiness.authorityRequirements),
        `${entry.id} authority requirements`,
      ).toBe(true);
      expect(Object.isFrozen(readiness.relatedModuleIds), `${entry.id} related modules`).toBe(true);
    }
  });

  it("returns undefined for an unknown module", () => {
    expect(getControlModule("remote-task")).toBeUndefined();
  });
});
