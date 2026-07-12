import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState, type ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeToggle } from "@/components/astr/ThemeToggle";
import { AppShell } from "@/components/system/AppShell";
import type {
  PresenceControllerActions,
  SafetyEvidence,
} from "@/features/presence/controller/create-presence-controller";
import { initialSemanticState, type SemanticState } from "@/lib/semantic-state";
import type { CoreStatusProjection, EffectorStatus } from "@/lib/types";

import { PresenceHeader } from "./PresenceHeader";

const themeMocks = vi.hoisted(() => ({
  resolvedTheme: undefined as string | undefined,
  setTheme: vi.fn(),
}));

vi.mock("next-themes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-themes")>();
  return { ...actual, useTheme: () => themeMocks };
});

const STATUS: CoreStatusProjection = {
  internalHandle: "soul_internal_01",
  displayName: "露怀秋",
  model: "local-soul-14b",
  costTodayUsd: 1.25,
  dailyBudgetUsd: 8,
  emotion: {
    loneliness: 0.2,
    talkativeness: 0.7,
    irritation: 0.1,
    excitement: 0.4,
  },
  activity: "正在整理昨夜的观测记录",
};

const CLEAR_EFFECTOR: EffectorStatus = {
  stopped: false,
  pending: {},
  audit_tail: [],
};

function makeActions(): Pick<PresenceControllerActions, "estop" | "reset"> {
  return {
    estop: vi.fn().mockResolvedValue(true),
    reset: vi.fn().mockResolvedValue(true),
  };
}

function makeSemantic(overrides: Partial<SemanticState> = {}): SemanticState {
  return {
    ...initialSemanticState,
    core: "reachable",
    replySse: "open",
    lifeSse: "open",
    ...overrides,
  };
}

interface HarnessProps {
  semantic?: SemanticState;
  status?: CoreStatusProjection | null;
  safetyEvidence?: SafetyEvidence;
  effectorStatus?: EffectorStatus | null;
  actions?: Pick<PresenceControllerActions, "estop" | "reset">;
  settingsContent?: ReactNode;
  initialSettingsOpen?: boolean;
}

function HeaderHarness({
  semantic = makeSemantic(),
  status = STATUS,
  safetyEvidence = "clear",
  effectorStatus = CLEAR_EFFECTOR,
  actions = makeActions(),
  settingsContent,
  initialSettingsOpen = false,
}: HarnessProps) {
  const [settingsOpen, setSettingsOpen] = useState(initialSettingsOpen);

  return (
    <PresenceHeader
      semantic={semantic}
      status={status}
      safetyEvidence={safetyEvidence}
      effectorStatus={effectorStatus}
      actions={actions}
      settingsOpen={settingsOpen}
      onSettingsOpenChange={setSettingsOpen}
      settingsContent={settingsContent}
    />
  );
}

function renderHeader(props: HarnessProps = {}) {
  return render(<HeaderHarness {...props} />);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PresenceHeader", () => {
  it("renders four independent truth regions and keeps secondary identity details collapsed", () => {
    renderHeader({
      semantic: makeSemantic({ lifeSse: "retrying" }),
      safetyEvidence: "checking",
    });

    expect(within(screen.getByRole("group", { name: "Core 状态" })).getByText("Core 可达")).toBeVisible();
    expect(
      within(screen.getByRole("group", { name: "回复流状态" })).getByText("回复流已连接"),
    ).toBeVisible();
    expect(
      within(screen.getByRole("group", { name: "生活流状态" })).getByText(
        "生活流中断，正在重连；期间可能存在记录缺口",
      ),
    ).toBeVisible();
    expect(
      within(screen.getByRole("group", { name: "执行安全状态" })).getByText("安全状态核验中"),
    ).toBeVisible();
    expect(screen.queryByText("在线")).not.toBeInTheDocument();

    expect(screen.getByRole("heading", { level: 1, name: "星枢 ASTR" })).toBeVisible();
    expect(screen.getByTestId("presence-display-name")).toHaveTextContent("露怀秋");

    const details = screen.getByText("系统细节").closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(within(details as HTMLElement).getByText("soul_internal_01")).toBeInTheDocument();
    expect(within(details as HTMLElement).getByText("local-soul-14b")).toBeInTheDocument();
    expect(within(details as HTMLElement).getByText("$1.25 / $8.00")).toBeInTheDocument();
  });

  it("never promotes a blank display name or the internal handle into the person-name line", () => {
    renderHeader({ status: { ...STATUS, displayName: "   ", internalHandle: "private_handle" } });

    expect(screen.queryByTestId("presence-display-name")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("星枢 ASTR");
    expect(screen.getByText("private_handle").closest("details")).not.toHaveAttribute("open");
  });

  it("keeps a long unbroken display name inside a shrinkable, wrapping identity rail", () => {
    const longName = "SOVEREIGNIDENTITY".repeat(16);
    renderHeader({ status: { ...STATUS, displayName: longName } });

    expect(screen.getByTestId("presence-display-name")).toHaveTextContent(longName);

    const css = readFileSync(
      resolve(process.cwd(), "src/features/presence/components/PresenceHeader.module.css"),
      "utf8",
    );
    const source = readFileSync(
      resolve(process.cwd(), "src/features/presence/components/PresenceHeader.tsx"),
      "utf8",
    );
    expect(source).toMatch(/className=\{styles\.identityCopy\}/);
    expect(css).toMatch(/\.identityCopy\s*\{[\s\S]*?min-inline-size:\s*0/);
    expect(css).toMatch(/\.displayName\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
  });

  it.each([
    ["cold", "尚未启动"],
    ["loading", "读取中"],
    ["reachable", "Core 可达"],
    ["offline", "Core 不可达"],
    ["error", "状态错误"],
  ] as const)("projects the Core %s fact as %s", (core, expected) => {
    renderHeader({ semantic: makeSemantic({ core }) });

    expect(within(screen.getByRole("group", { name: "Core 状态" })).getByText(expected)).toBeVisible();
  });

  it.each([
    ["connecting", "回复流连接中", "生活流连接中"],
    ["open", "回复流已连接", "生活流已连接"],
    ["retrying", "回复流中断，正在重连；期间可能存在消息缺口", "生活流中断，正在重连；期间可能存在记录缺口"],
    ["closed", "回复流未连接", "生活流未连接"],
  ] as const)("keeps Reply and Life %s as separate facts", (stream, replyCopy, lifeCopy) => {
    renderHeader({ semantic: makeSemantic({ replySse: stream, lifeSse: stream }) });

    expect(within(screen.getByRole("group", { name: "回复流状态" })).getByText(replyCopy)).toBeVisible();
    expect(within(screen.getByRole("group", { name: "生活流状态" })).getByText(lifeCopy)).toBeVisible();
  });

  it.each([
    ["checking", "安全状态核验中"],
    ["clear", "执行层未闩锁"],
    ["latched", "急停已闩锁"],
    ["unknown", "执行层状态未知"],
  ] as const)("projects %s safety evidence independently from semantic normal", (safetyEvidence, expected) => {
    renderHeader({ semantic: makeSemantic({ safety: "normal" }), safetyEvidence });

    expect(
      within(screen.getByRole("group", { name: "执行安全状态" })).getByText(expected),
    ).toBeVisible();
  });

  it.each([
    ["stopRequested", "急停请求已发送，正在核验执行层"],
    ["stopUnknown", "安全操作结果未知，执行层状态可能不一致"],
    ["stoppedLatched", "急停已闩锁"],
    ["resetting", "正在核验急停复位结果"],
  ] as const)("lets semantic %s override less urgent safety evidence", (safety, expected) => {
    renderHeader({ semantic: makeSemantic({ safety }), safetyEvidence: "clear" });

    expect(
      within(screen.getByRole("group", { name: "执行安全状态" })).getByText(expected),
    ).toBeVisible();
  });

  it("keeps e-stop enabled offline with unknown evidence and calls only the controller action", async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    renderHeader({
      semantic: makeSemantic({ core: "offline" }),
      safetyEvidence: "unknown",
      effectorStatus: null,
      actions,
    });

    const estop = screen.getByRole("button", { name: "触发急停" });
    expect(estop).toBeEnabled();
    await user.click(estop);

    expect(actions.estop).toHaveBeenCalledTimes(1);
    expect(actions.reset).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText("执行层状态未知")).toBeVisible();
  });

  it("offers reset only from latched evidence and waits for snapshot truth after activation", async () => {
    const user = userEvent.setup();
    const actions = makeActions();

    const { rerender } = render(
      <HeaderHarness safetyEvidence="clear" actions={actions} effectorStatus={CLEAR_EFFECTOR} />,
    );
    expect(screen.queryByRole("button", { name: "复位急停" })).not.toBeInTheDocument();

    rerender(
      <HeaderHarness
        safetyEvidence="latched"
        actions={actions}
        effectorStatus={{ ...CLEAR_EFFECTOR, stopped: true }}
      />,
    );
    const reset = screen.getByRole("button", { name: "复位急停" });
    reset.focus();
    await user.click(reset);

    expect(actions.reset).toHaveBeenCalledTimes(1);
    expect(screen.getByText("急停已闩锁")).toBeVisible();
    expect(screen.getByRole("group", { name: "执行安全状态" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
    expect(screen.getByRole("group", { name: "执行安全状态" })).toHaveFocus();
  });

  it("fails closed after reset failure even with stale latched readback evidence", async () => {
    const user = userEvent.setup();
    const actions = {
      ...makeActions(),
      reset: vi.fn().mockResolvedValue(false),
    };
    const staleStopped = { ...CLEAR_EFFECTOR, stopped: true };
    const { rerender } = render(
      <HeaderHarness
        semantic={makeSemantic({ safety: "stoppedLatched" })}
        safetyEvidence="latched"
        effectorStatus={staleStopped}
        actions={actions}
      />,
    );

    await user.click(screen.getByRole("button", { name: "复位急停" }));
    expect(actions.reset).toHaveBeenCalledTimes(1);

    rerender(
      <HeaderHarness
        semantic={makeSemantic({ safety: "stopUnknown" })}
        safetyEvidence="latched"
        effectorStatus={staleStopped}
        actions={actions}
      />,
    );

    expect(screen.getByText("安全操作结果未知，执行层状态可能不一致")).toBeVisible();
    expect(screen.queryByRole("button", { name: "复位急停" })).not.toBeInTheDocument();
    expect(actions.reset).toHaveBeenCalledTimes(1);
  });

  it("keeps Control, theme, settings, motion, and safety controls at the constitutional target", async () => {
    const { container } = render(
      <AppShell>
        <main id="main-content">
          <HeaderHarness />
        </main>
      </AppShell>,
    );

    const controls = [
      screen.getByRole("link", { name: "Control" }),
      screen.getByRole("button", { name: "切换昼夜主题" }),
      screen.getByRole("button", { name: "打开设置" }),
      screen.getByRole("button", { name: "触发急停" }),
    ];
    for (const control of controls) {
      expect(control).toHaveStyle({
        minInlineSize: "var(--touch-target)",
        minBlockSize: "var(--touch-target)",
      });
    }

    const header = screen.getByRole("banner");
    await waitFor(() =>
      expect(within(header).getByRole("button", { name: "暂停视觉动效" })).toBeEnabled(),
    );
    expect(screen.getAllByRole("button", { name: "暂停视觉动效" })).toHaveLength(1);
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
  });

  it("opens a controlled modal, traps both Tab directions, and returns focus to the exact trigger", async () => {
    const user = userEvent.setup();
    renderHeader({
      settingsContent: (
        <>
          <button type="button">设置第一项</button>
          <button type="button">设置最后一项</button>
        </>
      ),
    });

    const trigger = screen.getByRole("button", { name: "打开设置" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "星枢设置" });
    const close = within(dialog).getByRole("button", { name: "关闭设置" });
    const last = within(dialog).getByRole("button", { name: "设置最后一项" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(close).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "关闭设置" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("recaptures Tab after focused settings children are removed or natively disabled", async () => {
    const { rerender } = render(
      <HeaderHarness
        initialSettingsOpen
        settingsContent={
          <>
            <button type="button">动态设置项</button>
            <button type="button">设置末项</button>
          </>
        }
      />,
    );

    const close = screen.getByRole("button", { name: "关闭设置" });
    const dynamic = screen.getByRole("button", { name: "动态设置项" });
    dynamic.focus();
    expect(dynamic).toHaveFocus();

    rerender(
      <HeaderHarness
        initialSettingsOpen
        settingsContent={<button type="button">设置末项</button>}
      />,
    );
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(close).toHaveFocus();

    rerender(
      <HeaderHarness
        initialSettingsOpen
        settingsContent={
          <>
            <button type="button">动态设置项</button>
            <button type="button">设置末项</button>
          </>
        }
      />,
    );
    const enabledDynamic = screen.getByRole("button", { name: "动态设置项" });
    enabledDynamic.focus();
    rerender(
      <HeaderHarness
        initialSettingsOpen
        settingsContent={
          <>
            <button type="button" disabled>
              动态设置项
            </button>
            <button type="button">设置末项</button>
          </>
        }
      />,
    );
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "设置末项" })).toHaveFocus();

    const trigger = screen.getByRole("button", { name: "打开设置" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("uses a flat two-line sovereign spine and safe compact geometry", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/features/presence/components/PresenceHeader.module.css"),
      "utf8",
    );
    const headerRule = css.match(/\.header\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const truthRule = css.match(/\.truthGrid\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(headerRule).toMatch(/grid-template-areas:\s*"identity identity"\s*"truth secondary"/);
    expect(headerRule).toMatch(/border-inline-start:/);
    expect(headerRule).toMatch(/border-inline-end:\s*0/);
    expect(headerRule).toMatch(/border-radius:\s*0/);
    expect(headerRule).toMatch(/box-shadow:\s*none/);
    expect(truthRule).toMatch(/border-radius:\s*0/);
    expect(css).toMatch(
      /@media \(max-width:\s*480px\)[\s\S]*?\.truthGrid\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*480px\)[\s\S]*?\.header\s*\{[^}]*grid-template-areas:\s*"identity identity"\s*"truth secondary"/,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*480px\)[\s\S]*?\.identityRail\s*\{[^}]*flex-wrap:\s*nowrap/,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*480px\)[\s\S]*?\.controlRail\s*\{[^}]*flex-wrap:\s*nowrap/,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*480px\)[\s\S]*?\.secondaryRail\s*\{[^}]*flex-direction:\s*column/,
    );
    for (const edge of ["top", "right", "bottom", "left"]) {
      expect(css).toContain(`env(safe-area-inset-${edge})`);
    }
  });

  it("keeps ThemeToggle server and hydrated markup independent from resolvedTheme", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/astr/ThemeToggle.tsx"),
      "utf8",
    );

    expect(source).toMatch(/<SunMoon\b/);
    expect(source).not.toMatch(/data-[\w-]+=\{resolvedTheme\}/);
    expect(source).not.toMatch(/className=\{[^}]*resolvedTheme/);
    expect(source).not.toMatch(/<Moon(?:\s|>)/);
    expect(source).not.toMatch(/<Sun(?:\s|>)/);
  });

  it("hydrates unresolved SSR into a light client theme without changing the tree", async () => {
    themeMocks.resolvedTheme = undefined;
    const tree = <ThemeToggle />;
    const host = document.createElement("div");
    host.innerHTML = renderToString(tree);
    document.body.append(host);
    const serverMarkup = host.innerHTML;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let root: ReturnType<typeof hydrateRoot> | null = null;

    themeMocks.resolvedTheme = "light";
    await act(async () => {
      root = hydrateRoot(host, tree);
      await Promise.resolve();
    });

    expect(within(host).getAllByRole("button", { name: "切换昼夜主题" })).toHaveLength(1);
    expect(host.querySelectorAll("svg")).toHaveLength(1);
    expect(host.innerHTML).toBe(serverMarkup);
    expect(consoleError.mock.calls.flat().join("\n")).not.toMatch(
      /hydration|did not match|server rendered html/i,
    );

    await act(async () => root?.unmount());
    host.remove();
    themeMocks.resolvedTheme = undefined;
  });
});
