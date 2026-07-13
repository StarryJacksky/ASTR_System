import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MOBILE_SAFETY_SERVER_SNAPSHOT,
  type MobileChannelSnapshot,
  type MobileSafetyActions,
  type MobileSafetySnapshot,
} from "./create-mobile-safety-controller";
import type {
  MobileLocalAuditProjection,
  MobileLocalPolicyProjection,
  MobileLocalStatusProjection,
} from "./mobile-safety-types";
import type { MobileSafetyControllerOwner } from "./use-mobile-safety-controller";
import { TrustedMobileLocalSafetyDomain } from "./TrustedMobileLocalSafetyDomain";

type ChannelKey = keyof MobileSafetySnapshot;
type ChannelPhase = MobileChannelSnapshot<unknown>["phase"];
type SafetyValue =
  | MobileLocalStatusProjection
  | MobileLocalPolicyProjection
  | MobileLocalAuditProjection;

const VERIFIED_AT = "2026-07-14T01:02:03.456Z";

const READY_VALUES = Object.freeze({
  status: Object.freeze({
    stopped: false,
    pending_count: 3,
    audit_tail_count: 5,
  }),
  policy: Object.freeze({
    approval_mode: "ask" as const,
    headless_scope: "cwd" as const,
    max_steps_per_task: 12,
  }),
  audit: Object.freeze({
    audit_date: "2026-07-14",
    audit_total: 0,
    chain_valid: true,
  }),
});

const CHANNELS = [
  {
    key: "status",
    heading: "执行状态",
    action: "refreshStatus",
    readyAction: "重新读取状态",
    retryAction: "重试读取状态",
    error: "本机状态读取失败",
    witness: "停止状态：未闩锁",
  },
  {
    key: "policy",
    heading: "执行策略",
    action: "refreshPolicy",
    readyAction: "重新读取策略",
    retryAction: "重试读取策略",
    error: "本机策略读取失败",
    witness: "确认方式：每次请求确认",
  },
  {
    key: "audit",
    heading: "审计证据",
    action: "refreshAudit",
    readyAction: "重新读取审计",
    retryAction: "重试读取审计",
    error: "本机审计读取失败",
    witness: "当前审计文件 hash 链校验通过",
  },
] as const;

interface OwnerFixture {
  readonly owner: MobileSafetyControllerOwner;
  readonly actions: {
    readonly refreshStatus: ReturnType<typeof vi.fn>;
    readonly refreshPolicy: ReturnType<typeof vi.fn>;
    readonly refreshAudit: ReturnType<typeof vi.fn>;
  };
  readonly emit: (snapshot: MobileSafetySnapshot) => void;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TrustedMobileLocalSafetyDomain", () => {
  describe.each(CHANNELS)("$heading channel", (channel) => {
    it.each([
      ["idle", "尚未读取", false, false],
      ["loading", "读取中", false, false],
      ["ready", "已验证", true, true],
      ["refreshing", "刷新中 · 保留最近已验证值", true, false],
      ["stale", "可能陈旧", true, true],
      ["error", "读取失败", false, true],
    ] as const)(
      "renders %s truthfully without a fake disabled action",
      (phase, phaseCopy, hasValue, hasAction) => {
        const fixture = createOwnerFixture(
          snapshotFor(channel.key, phase, READY_VALUES[channel.key], channel.error),
        );
        render(<TrustedMobileLocalSafetyDomain owner={fixture.owner} />);
        const section = getChannelSection(channel.heading);

        expect(within(section).getByText(phaseCopy)).toBeVisible();
        if (hasValue) {
          expect(within(section).getByText(channel.witness)).toBeVisible();
          const verifiedAt = within(section).getByText(
            `已验证于：${VERIFIED_AT}`,
          );
          expect(verifiedAt).toBeVisible();
          expect(verifiedAt.tagName).toBe("TIME");
          expect(verifiedAt).toHaveAttribute("datetime", VERIFIED_AT);
        } else {
          expect(within(section).queryByText(channel.witness)).toBeNull();
          expect(section.textContent).not.toContain(VERIFIED_AT);
        }

        if (phase === "stale" || phase === "error") {
          expect(within(section).getByText(channel.error)).toBeVisible();
        } else {
          expect(within(section).queryByText(channel.error)).toBeNull();
        }

        const buttons = within(section).queryAllByRole("button");
        expect(buttons).toHaveLength(hasAction ? 1 : 0);
        for (const button of buttons) expect(button).not.toBeDisabled();

        if (hasAction) {
          const label = phase === "ready" ? channel.readyAction : channel.retryAction;
          fireEvent.click(within(section).getByRole("button", { name: label }));
          expect(fixture.actions[channel.action]).toHaveBeenCalledTimes(1);
          for (const [key, action] of Object.entries(fixture.actions)) {
            if (key !== channel.action) expect(action).not.toHaveBeenCalled();
          }
        }
      },
    );
  });

  it.each([
    [true, "本机执行层已闩锁"],
    [false, "停止状态：未闩锁"],
  ] as const)("maps stopped=%s without turning color into meaning", (stopped, copy) => {
    const fixture = createOwnerFixture(
      snapshotFor(
        "status",
        "ready",
        Object.freeze({ ...READY_VALUES.status, stopped }),
        "本机状态读取失败",
      ),
    );
    render(<TrustedMobileLocalSafetyDomain owner={fixture.owner} />);
    const section = getChannelSection("执行状态");

    expect(within(section).getByText(copy)).toBeVisible();
    expect(within(section).getByText("待处理：3")).toBeVisible();
    expect(within(section).getByText("审计尾部：5")).toBeVisible();
  });

  it.each(["idle", "loading", "error"] as const)(
    "keeps a %s status value unknown instead of implying safety or executability",
    (phase) => {
      const fixture = createOwnerFixture(
        snapshotFor("status", phase, READY_VALUES.status, "本机状态读取失败"),
      );
      render(<TrustedMobileLocalSafetyDomain owner={fixture.owner} />);
      const section = getChannelSection("执行状态");

      expect(within(section).getByText("停止状态：未知")).toBeVisible();
      expect(section.textContent).not.toMatch(/安全|未闩锁|可执行/);
    },
  );

  it.each([
    ["ask", "cwd", "每次请求确认", "当前目录"],
    ["audited", "folders", "按审计策略执行", "白名单目录"],
    ["auto", "full", "在策略边界内自动执行", "全电脑"],
  ] as const)(
    "maps policy %s/%s exhaustively",
    (approval_mode, headless_scope, approvalCopy, scopeCopy) => {
      const fixture = createOwnerFixture(
        snapshotFor(
          "policy",
          "ready",
          Object.freeze({
            approval_mode,
            headless_scope,
            max_steps_per_task: 17,
          }),
          "本机策略读取失败",
        ),
      );
      render(<TrustedMobileLocalSafetyDomain owner={fixture.owner} />);
      const section = getChannelSection("执行策略");

      expect(within(section).getByText(`确认方式：${approvalCopy}`)).toBeVisible();
      expect(within(section).getByText(`作用范围：${scopeCopy}`)).toBeVisible();
      expect(within(section).getByText("最大步骤：17")).toBeVisible();
    },
  );

  it.each([
    ["2026-07-14", 0, true, "审计日期：2026-07-14", "审计总数：0", "当前审计文件 hash 链校验通过"],
    [null, null, false, "审计日期：未提供", "审计总数：未提供", "链校验失败"],
    ["2026-07-13", 12, null, "审计日期：2026-07-13", "审计总数：12", "未提供链完整性证据"],
  ] as const)(
    "preserves audit null/zero and chain=%s evidence semantics",
    (audit_date, audit_total, chain_valid, dateCopy, totalCopy, chainCopy) => {
      const fixture = createOwnerFixture(
        snapshotFor(
          "audit",
          "ready",
          Object.freeze({ audit_date, audit_total, chain_valid }),
          "本机审计读取失败",
        ),
      );
      render(<TrustedMobileLocalSafetyDomain owner={fixture.owner} />);
      const section = getChannelSection("审计证据");

      expect(within(section).getByText(dateCopy)).toBeVisible();
      expect(within(section).getByText(totalCopy)).toBeVisible();
      expect(within(section).getByText(chainCopy)).toBeVisible();
    },
  );

  it("uses one h2, three h3 channels, one non-prefetched Control link, and no live-role theatre", () => {
    const fixture = createOwnerFixture(allReadySnapshot());
    const { container } = render(
      <TrustedMobileLocalSafetyDomain owner={fixture.owner} />,
    );

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "当前 Web 主机 · 本机可信入口",
      }),
    ).toBeVisible();
    expect(container.querySelectorAll("h1")).toHaveLength(0);
    expect(container.querySelectorAll("h2")).toHaveLength(1);
    expect(container.querySelectorAll("h3")).toHaveLength(3);
    const link = screen.getByRole("link", {
      name: "在 Control 查看本机安全控制",
    });
    expect(link).toHaveAttribute("href", "/admin/effector");
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(
      container.querySelectorAll(
        "[aria-live], [role='status'], [role='alert'], [role='log'], [role='marquee'], [role='timer'], marquee",
      ),
    ).toHaveLength(0);
    expect(container.textContent).not.toMatch(
      /我的电脑在线|远程设备|全部安全|安全通过|全局成功|读取成功/,
    );
  });

  it("projects only approved fields and never renders raw rows, paths, or hostile extras", () => {
    const status = Object.freeze({
      ...READY_VALUES.status,
      speaker: "SENTINEL_SPEAKER",
      pending: "SENTINEL_PENDING_ROW",
    }) as MobileLocalStatusProjection;
    const policy = Object.freeze({
      ...READY_VALUES.policy,
      path: "SENTINEL_PRIVATE_PATH",
      sandbox: "SENTINEL_SANDBOX",
    }) as MobileLocalPolicyProjection;
    const audit = Object.freeze({
      ...READY_VALUES.audit,
      audit_tail: "SENTINEL_RAW_AUDIT_ROW",
      overlay: "SENTINEL_OVERLAY_PATH",
    }) as MobileLocalAuditProjection;
    const fixture = createOwnerFixture(
      Object.freeze({
        status: makeChannel("ready", status, "本机状态读取失败"),
        policy: makeChannel("ready", policy, "本机策略读取失败"),
        audit: makeChannel("ready", audit, "本机审计读取失败"),
      }),
    );
    const { container } = render(
      <TrustedMobileLocalSafetyDomain owner={fixture.owner} />,
    );

    expect(container.innerHTML).not.toMatch(/SENTINEL_/);
  });
});

function createOwnerFixture(
  initialSnapshot: MobileSafetySnapshot,
): OwnerFixture {
  let snapshot = initialSnapshot;
  const listeners = new Set<() => void>();
  const actions = {
    refreshStatus: vi.fn(),
    refreshPolicy: vi.fn(),
    refreshAudit: vi.fn(),
  };
  const owner: MobileSafetyControllerOwner = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => MOBILE_SAFETY_SERVER_SNAPSHOT,
    actions: actions satisfies MobileSafetyActions,
  };
  return {
    owner,
    actions,
    emit(nextSnapshot) {
      snapshot = nextSnapshot;
      for (const listener of listeners) listener();
    },
  };
}

function makeChannel<T>(
  phase: ChannelPhase,
  value: T,
  error: string,
): MobileChannelSnapshot<T> {
  if (phase === "idle" || phase === "loading") {
    return Object.freeze({ phase, value: null, error: null, verified_at: null });
  }
  if (phase === "error") {
    return Object.freeze({
      phase,
      value: null,
      error,
      verified_at: null,
    });
  }
  if (phase === "stale") {
    return Object.freeze({
      phase,
      value,
      error,
      verified_at: VERIFIED_AT,
    });
  }
  return Object.freeze({
    phase,
    value,
    error: null,
    verified_at: VERIFIED_AT,
  });
}

function snapshotFor(
  key: ChannelKey,
  phase: ChannelPhase,
  value: SafetyValue,
  error: string,
): MobileSafetySnapshot {
  return Object.freeze({
    ...MOBILE_SAFETY_SERVER_SNAPSHOT,
    [key]: makeChannel(phase, value, error),
  }) as MobileSafetySnapshot;
}

function allReadySnapshot(): MobileSafetySnapshot {
  return Object.freeze({
    status: makeChannel("ready", READY_VALUES.status, "本机状态读取失败"),
    policy: makeChannel("ready", READY_VALUES.policy, "本机策略读取失败"),
    audit: makeChannel("ready", READY_VALUES.audit, "本机审计读取失败"),
  });
}

function getChannelSection(name: string): HTMLElement {
  const section = screen
    .getByRole("heading", { level: 3, name })
    .closest("section");
  if (!section) throw new Error(`Missing channel section: ${name}`);
  return section;
}
