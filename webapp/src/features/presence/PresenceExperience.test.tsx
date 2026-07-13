import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/system/AppShell";
import {
  PRESENCE_CONTROLLER_SERVER_SNAPSHOT,
  type PresenceControllerActions,
  type PresenceControllerSnapshot,
} from "@/features/presence/controller/create-presence-controller";
import { initialSemanticState } from "@/lib/semantic-state";
import { semanticStore } from "@/lib/semantic-store";

const controllerMocks = vi.hoisted(() => ({
  owner: {},
  usePresenceController: vi.fn(),
}));

const visualBridgeMocks = vi.hoisted(() => ({
  jewel: vi.fn((props?: unknown) => {
    void props;
    return null;
  }),
  visibility: vi.fn((props: unknown) => {
    void props;
    return null;
  }),
}));

vi.mock("@/features/presence/controller/use-presence-controller", () => ({
  get presenceControllerOwner() {
    return controllerMocks.owner;
  },
  usePresenceController: controllerMocks.usePresenceController,
}));

vi.mock("./visual/JewelRuntimeBridge", () => ({
  JewelRuntimeBridge: visualBridgeMocks.jewel,
}));

vi.mock("./visual/PresenceVisibilityBridge", () => ({
  PresenceVisibilityBridge: visualBridgeMocks.visibility,
}));

import { PresenceExperience } from "./PresenceExperience";

const actions: PresenceControllerActions = {
  updateDraft: vi.fn(),
  send: vi.fn(async () => true),
  retryFailed: vi.fn(async () => true),
  transcribe: vi.fn(async () => ({ text: "转写文本" })),
  estop: vi.fn(async () => true),
  reset: vi.fn(async () => true),
};

function createSnapshot(
  overrides: Partial<PresenceControllerSnapshot> = {},
): PresenceControllerSnapshot {
  const base: PresenceControllerSnapshot = {
    ...PRESENCE_CONTROLLER_SERVER_SNAPSHOT,
    semantic: {
      ...initialSemanticState,
      core: "reachable",
      replySse: "open",
      lifeSse: "open",
      conversation: "final",
      visualRuntime: "loading",
    },
    status: {
      internalHandle: "astr_internal_only",
      displayName: "澄月",
      model: "astr-local",
      costTodayUsd: 1.25,
      dailyBudgetUsd: 8,
      emotion: {
        loneliness: 0.2,
        talkativeness: 0.6,
        irritation: 0.1,
        excitement: 0.4,
      },
      activity: "正在整理记忆",
    },
    conversation: {
      messages: [
        {
          id: "user-1",
          role: "user",
          text: "今晚好吗",
          platform: "web",
          ts: Date.UTC(2026, 6, 11, 3, 4, 5),
        },
        {
          id: "reply:trace-1",
          role: "qiuqiu",
          text: "我在这里。",
          ts: Date.UTC(2026, 6, 11, 3, 4, 6),
          eventId: "decision-1",
          traceId: "trace-1",
        },
      ],
      receipt: null,
      provisionalText: "",
      provisionalActive: false,
      authoritativeDecision: null,
      error: null,
    },
    draft: {
      revision: 7,
      text: "还想再说一句",
      selectionStart: 7,
      selectionEnd: 7,
    },
    lifeEvents: [
      {
        id: "thought-1",
        ts: "2026-07-11T03:04:05.000Z",
        type: "agent.thought",
        source: "soul.orchestrator",
        trace_id: "trace-life-1",
        payload: { text: "正在整理今晚的上下文" },
      },
    ],
    safetyEvidence: "clear",
    effectorStatus: {
      stopped: false,
      pending: {},
      audit_tail: [],
    },
    diagnostics: [],
  };

  return Object.freeze({
    ...base,
    ...overrides,
    semantic: Object.freeze({ ...(overrides.semantic ?? base.semantic) }),
  });
}

describe("PresenceExperience", () => {
  beforeEach(() => {
    controllerMocks.owner = {};
    controllerMocks.usePresenceController.mockReset();
    vi.clearAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute("data-visual-motion");
    semanticStore.setState({ ...initialSemanticState, announcement: null });
    controllerMocks.usePresenceController.mockReturnValue({
      snapshot: createSnapshot(),
      actions,
    });
  });

  it("projects one controller snapshot into a semantic, spacious Presence page", () => {
    const { container } = render(<PresenceExperience />);

    expect(controllerMocks.usePresenceController).toHaveBeenCalledTimes(1);
    expect(controllerMocks.usePresenceController).toHaveBeenCalledWith(
      controllerMocks.owner,
    );
    expect(visualBridgeMocks.jewel).toHaveBeenCalledTimes(1);
    expect(visualBridgeMocks.visibility).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("main")).toHaveAttribute("data-orbit-state", "dialogue");
    expect(screen.getByRole("main")).toHaveAttribute(
      "data-sse-state",
      "reply:open|life:open",
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(3);
    expect(screen.getByRole("link", { name: "跳到消息输入" })).toHaveAttribute(
      "href",
      "#presence-message-input",
    );
    expect(screen.getByRole("textbox", { name: "消息输入" })).toHaveAttribute(
      "id",
      "presence-message-input",
    );
    expect(screen.getByRole("textbox", { name: "消息输入" })).toHaveValue("还想再说一句");
    expect(screen.getAllByRole("heading", { level: 2, name: "对话" })).toHaveLength(1);
    expect(screen.queryByText("对话主场 / DIALOGUE")).not.toBeInTheDocument();
    expect(screen.queryByText("PRESENCE · DIALOGUE")).not.toBeInTheDocument();
    expect(screen.getByText("今晚好吗")).toBeVisible();
    expect(screen.getByText("我在这里。")).toBeVisible();
    expect(screen.getByText("正在整理今晚的上下文")).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "澄月" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "astr_internal_only" })).not.toBeInTheDocument();
    expect(container.querySelector("canvas")).toBeNull();
    const visibilityProps = visualBridgeMocks.visibility.mock.calls[0]?.[0] as
      | { readonly targetRef?: { readonly current: Element | null } }
      | undefined;
    expect(visibilityProps?.targetRef?.current).toBe(
      container.querySelector("[data-presence-soul]"),
    );
  });

  it("changes layout only from explicit deep-chat intent and never unmounts Soul", () => {
    const firstSnapshot = createSnapshot();
    controllerMocks.usePresenceController.mockReturnValue({ snapshot: firstSnapshot, actions });
    const view = render(<PresenceExperience />);
    const main = screen.getByRole("main");
    const soul = view.container.querySelector("[data-presence-soul]");
    const toggle = screen.getByRole("button", { name: "切换深聊布局" });

    expect(main).toHaveAttribute("data-presence-layout", "balanced");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(soul).toBeInTheDocument();

    controllerMocks.usePresenceController.mockReturnValue({
      snapshot: createSnapshot({
        semantic: { ...firstSnapshot.semantic, replySse: "retrying" },
        conversation: {
          ...firstSnapshot.conversation,
          messages: [
            ...firstSnapshot.conversation.messages,
            {
              id: "reply:external",
              role: "qiuqiu",
              text: "新的外部终稿",
              ts: Date.UTC(2026, 6, 11, 3, 5),
              eventId: "decision-external",
              external: true,
            },
          ],
        },
      }),
      actions,
    });
    view.rerender(<PresenceExperience />);
    expect(main).toHaveAttribute("data-presence-layout", "balanced");

    fireEvent.click(toggle);
    expect(main).toHaveAttribute("data-presence-layout", "deep");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(view.container.querySelector("[data-presence-soul]")).toBe(soul);

    view.rerender(<PresenceExperience />);
    expect(main).toHaveAttribute("data-presence-layout", "deep");
    expect(view.container.querySelector("[data-presence-soul]")).toBe(soul);
  });

  it("opens Life only by intent, focuses its island, and returns to the orbit initiator", () => {
    const { container } = render(<PresenceExperience />);
    const lifeButton = screen.getByRole("button", { name: "前往 Life" });
    const island = screen.getByRole("region", { name: "生活密度岛" });
    const islandFocus = vi.spyOn(island, "focus");
    const initiatorFocus = vi.spyOn(lifeButton, "focus");

    expect(island).toHaveAttribute("data-expanded", "false");
    expect(lifeButton).not.toHaveAttribute("aria-current");

    fireEvent.click(lifeButton);
    expect(screen.getByRole("main")).toHaveAttribute("data-orbit-state", "life");
    expect(island).toHaveAttribute("data-expanded", "true");
    expect(lifeButton).toHaveAttribute("aria-current", "page");
    expect(island).toHaveFocus();
    expect(islandFocus).toHaveBeenLastCalledWith();

    fireEvent.click(screen.getByRole("button", { name: "收起生活记录" }));
    expect(island).toHaveAttribute("data-expanded", "false");
    expect(lifeButton).toHaveFocus();
    expect(initiatorFocus).toHaveBeenLastCalledWith();
    expect(container.querySelector("[data-presence-life-island]")).toBe(island);
  });

  it("announces factual offline and visual-loss transitions once across clones and Strict Mode", () => {
    const announce = vi.spyOn(semanticStore.getState(), "announce");
    const emptyConversation = {
      messages: [],
      receipt: null,
      provisionalText: "",
      provisionalActive: false,
      authoritativeDecision: null,
      error: null,
    } as const;
    let snapshot = createSnapshot({ conversation: emptyConversation });
    controllerMocks.usePresenceController.mockImplementation(() => ({ snapshot, actions }));
    const view = render(
      <StrictMode>
        <PresenceExperience />
      </StrictMode>,
    );
    expect(announce).not.toHaveBeenCalled();

    snapshot = createSnapshot({
      conversation: emptyConversation,
      semantic: {
        ...snapshot.semantic,
        core: "offline",
        replySse: "retrying",
        visualRuntime: "contextLost",
      },
    });
    view.rerender(
      <StrictMode>
        <PresenceExperience />
      </StrictMode>,
    );

    expect(announce).toHaveBeenCalledWith("Core 不可达", "polite");
    expect(announce).toHaveBeenCalledWith(
      "回复流连接中断；断线期间消息可能不完整",
      "polite",
    );
    expect(announce).toHaveBeenCalledWith(
      "视觉呈现暂不可用；已保持静态 Soul",
      "polite",
    );
    const transitionCallCount = announce.mock.calls.length;

    snapshot = createSnapshot({
      conversation: emptyConversation,
      semantic: Object.freeze({ ...snapshot.semantic }),
    });
    view.rerender(
      <StrictMode>
        <PresenceExperience />
      </StrictMode>,
    );
    expect(announce).toHaveBeenCalledTimes(transitionCallCount);
  });

  it("announces Life gaps and safety readback transitions without claiming execution", () => {
    const announce = vi.spyOn(semanticStore.getState(), "announce");
    let snapshot = createSnapshot();
    controllerMocks.usePresenceController.mockImplementation(() => ({ snapshot, actions }));
    const view = render(<PresenceExperience />);

    snapshot = createSnapshot({
      semantic: {
        ...snapshot.semantic,
        lifeSse: "retrying",
        safety: "stopRequested",
      },
    });
    view.rerender(<PresenceExperience />);

    expect(announce).toHaveBeenCalledWith(
      "生活流连接中断；断线期间记录可能不完整",
      "polite",
    );
    expect(announce).toHaveBeenCalledWith(
      "急停请求已发送，正在核验执行层",
      "assertive",
    );

    snapshot = createSnapshot({
      semantic: {
        ...snapshot.semantic,
        safety: "stopUnknown",
      },
      safetyEvidence: "unknown",
    });
    view.rerender(<PresenceExperience />);

    expect(announce).toHaveBeenCalledWith(
      "安全操作结果未知，执行层状态可能不一致",
      "assertive",
    );
    expect(announce).not.toHaveBeenCalledWith(expect.stringMatching(/已急停|已复位/), "assertive");
  });

  it("does not announce an unknown safety result while startup readback is still checking", () => {
    const announce = vi.spyOn(semanticStore.getState(), "announce");
    let snapshot = createSnapshot();
    controllerMocks.usePresenceController.mockImplementation(() => ({ snapshot, actions }));
    const view = render(<PresenceExperience />);
    announce.mockClear();

    snapshot = createSnapshot({
      semantic: { ...snapshot.semantic, safety: "stopUnknown" },
      safetyEvidence: "checking",
    });
    view.rerender(<PresenceExperience />);
    expect(announce).not.toHaveBeenCalledWith(
      "安全操作结果未知，执行层状态可能不一致",
      "assertive",
    );

    snapshot = createSnapshot({
      semantic: { ...snapshot.semantic },
      safetyEvidence: "unknown",
    });
    view.rerender(<PresenceExperience />);
    expect(announce).toHaveBeenCalledWith(
      "安全操作结果未知，执行层状态可能不一致",
      "assertive",
    );
  });

  it("announces reset success only after authoritative clear readback", () => {
    const announce = vi.spyOn(semanticStore.getState(), "announce");
    let snapshot = createSnapshot({
      semantic: { ...createSnapshot().semantic, safety: "stoppedLatched" },
      safetyEvidence: "latched",
    });
    controllerMocks.usePresenceController.mockImplementation(() => ({ snapshot, actions }));
    const view = render(<PresenceExperience />);
    announce.mockClear();

    snapshot = createSnapshot({
      semantic: { ...snapshot.semantic, safety: "resetting" },
      safetyEvidence: "latched",
    });
    view.rerender(<PresenceExperience />);
    expect(announce).toHaveBeenCalledWith("正在核验急停复位结果", "polite");

    snapshot = createSnapshot({
      semantic: { ...snapshot.semantic, safety: "normal" },
      safetyEvidence: "checking",
    });
    view.rerender(<PresenceExperience />);
    expect(announce).not.toHaveBeenCalledWith("急停复位已由执行层确认", "polite");

    snapshot = createSnapshot({
      semantic: { ...snapshot.semantic },
      safetyEvidence: "clear",
    });
    view.rerender(<PresenceExperience />);
    expect(announce).toHaveBeenCalledWith("急停复位已由执行层确认", "polite");
    const clearCount = announce.mock.calls.filter(
      ([message]) => message === "急停复位已由执行层确认",
    ).length;

    snapshot = createSnapshot({
      semantic: { ...snapshot.semantic },
      safetyEvidence: "clear",
    });
    view.rerender(<PresenceExperience />);
    expect(
      announce.mock.calls.filter(([message]) => message === "急停复位已由执行层确认"),
    ).toHaveLength(clearCount);

    snapshot = createSnapshot({
      semantic: { ...snapshot.semantic, safety: "resetting" },
      safetyEvidence: "latched",
    });
    view.rerender(<PresenceExperience />);
    snapshot = createSnapshot({
      semantic: { ...snapshot.semantic, safety: "stopRequested" },
      safetyEvidence: "checking",
    });
    view.rerender(<PresenceExperience />);
    snapshot = createSnapshot({
      semantic: { ...snapshot.semantic, safety: "normal" },
      safetyEvidence: "clear",
    });
    view.rerender(<PresenceExperience />);
    expect(
      announce.mock.calls.filter(([message]) => message === "急停复位已由执行层确认"),
    ).toHaveLength(clearCount);
  });

  it("announces an ingest failure once and assertively through the global live region", async () => {
    const emptyConversation = {
      messages: [],
      receipt: null,
      provisionalText: "",
      provisionalActive: false,
      authoritativeDecision: null,
      error: null,
    } as const;
    let snapshot = createSnapshot({ conversation: emptyConversation });
    controllerMocks.usePresenceController.mockImplementation(() => ({ snapshot, actions }));
    const view = render(
      <AppShell>
        <PresenceExperience />
      </AppShell>,
    );

    snapshot = createSnapshot({
      semantic: { ...snapshot.semantic, conversation: "error" },
      conversation: {
        ...emptyConversation,
        messages: [
          {
            id: "reply:external:decision-503",
            role: "qiuqiu",
            text: "未绑定 ACK 的外部权威终稿。",
            ts: Date.UTC(2026, 6, 11, 3, 5),
            eventId: "decision-503",
            external: true,
          },
        ],
        error: "ingest returned HTTP 503",
      },
      diagnostics: [
        {
          code: "INGEST_FAILED",
          message: "ingest returned HTTP 503",
          at: Date.UTC(2026, 6, 11, 3, 5),
        },
      ],
    });
    view.rerender(
      <AppShell>
        <PresenceExperience />
      </AppShell>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveTextContent("发送失败：ingest returned HTTP 503");
    expect(view.container.querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(
      screen.getByText("发送失败：ingest returned HTTP 503", { selector: "p" }),
    ).toBeVisible();
    const announcementId = alert
      .querySelector("[data-announcement-id]")
      ?.getAttribute("data-announcement-id");

    snapshot = createSnapshot({
      ...snapshot,
      semantic: { ...snapshot.semantic },
      conversation: {
        ...snapshot.conversation,
        messages: snapshot.conversation.messages.map((message) => ({ ...message })),
      },
      lifeEvents: [...snapshot.lifeEvents],
    });
    view.rerender(
      <AppShell>
        <PresenceExperience />
      </AppShell>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "发送失败：ingest returned HTTP 503",
    );
    expect(
      screen
        .getByRole("alert")
        .querySelector("[data-announcement-id]")
        ?.getAttribute("data-announcement-id"),
    ).toBe(announcementId);
  });

  it("composes with AppShell without duplicating main, pause, or live-region ownership", async () => {
    const { container } = render(
      <AppShell>
        <PresenceExperience />
      </AppShell>,
    );

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /暂停视觉动/ })).toHaveLength(1),
    );
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);

    expect(screen.getByRole("status")).toHaveTextContent("回答完成");
  });

  it("keeps the route as a minimal synchronous Server Component boundary", () => {
    const pageSource = readFileSync(resolve(process.cwd(), "src/app/page.tsx"), "utf8");

    expect(pageSource).not.toMatch(/["']use client["']/);
    expect(pageSource).toMatch(/import\s+\{?\s*PresenceExperience\s*\}?\s+from/);
    expect(pageSource.match(/<PresenceExperience\s*\/>/g)).toHaveLength(1);
    expect(pageSource).toMatch(/export\s+default\s+function\s+\w+\s*\(/);
    expect(pageSource).not.toMatch(/export\s+default\s+async\s+function/);
    const disallowedPagePattern = new RegExp(
      [
        "useState",
        "useEffect",
        "useMemo",
        "useRef",
        "framer-motion",
        "\\bfetch\\s*\\(",
        "use" + "Core",
        "use" + "EventStream",
        "use" + "ReplyStream",
        "use" + "Status",
        "components\\/astr\\/(?:MessageTimeline|LifeArea|StatusBar|Starfield|FlameCore|Live2DStage)",
      ].join("|"),
    );
    expect(pageSource).not.toMatch(disallowedPagePattern);
  });

  it("locks the responsive material constitution and forbids premature visual runtimes", () => {
    const experienceCss = readFileSync(
      resolve(process.cwd(), "src/features/presence/PresenceExperience.module.css"),
      "utf8",
    );
    const timelineCss = readFileSync(
      resolve(process.cwd(), "src/features/presence/components/PresenceTimelines.module.css"),
      "utf8",
    );
    const tokens = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");
    const globals = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const runtimeSources = [
      "src/features/presence/PresenceExperience.tsx",
      "src/features/presence/components/PresenceHeader.tsx",
      "src/features/presence/components/OrbitNavigation.tsx",
      "src/features/presence/components/SoulPresence.tsx",
      "src/features/presence/components/StaticSoulLens.tsx",
    ]
      .map((file) => readFileSync(resolve(process.cwd(), file), "utf8"))
      .join("\n");

    expect(experienceCss).toMatch(/min-block-size:\s*100dvh/);
    expect(experienceCss).toMatch(/var\(--layout-container-max\)/);
    expect(experienceCss).toMatch(/env\(safe-area-inset-top\)/);
    expect(experienceCss).toMatch(/env\(safe-area-inset-right\)/);
    expect(experienceCss).toMatch(/env\(safe-area-inset-bottom\)/);
    expect(experienceCss).toMatch(/env\(safe-area-inset-left\)/);
    expect(experienceCss).toMatch(/minmax\(0,\s*58fr\)[\s\S]*minmax\([^,]+,\s*42fr\)/);
    expect(experienceCss).toMatch(/minmax\(0,\s*72fr\)[\s\S]*minmax\([^,]+,\s*28fr\)/);
    expect(experienceCss).toMatch(/@media\s*\(max-width:\s*768px\)/);
    expect(experienceCss).toMatch(/@media\s*\(max-width:\s*390px\)/);
    expect(experienceCss).toMatch(
      /\.composerSkip\s*\{[^}]*transform:\s*translateY\(calc\(-180%\s*-\s*var\(--touch-target\)\s*-\s*var\(--space-4\)\)\)/,
    );
    expect(experienceCss).toMatch(
      /\.dialogueSurface\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto/,
    );
    const dialogueSurfaceRule = experienceCss.match(
      /^\.dialogueSurface\s*\{([^}]*)\}/m,
    )?.[1];
    expect(dialogueSurfaceRule).toMatch(
      /--astr-composer-surface:\s*linear-gradient\([\s\S]*?color-mix\(/,
    );
    expect(dialogueSurfaceRule).toMatch(
      /--astr-composer-accent-line:\s*linear-gradient\(/,
    );
    expect(dialogueSurfaceRule).toMatch(
      /--astr-composer-shadow:\s*inset\s+0\s+1px\s+0\s+color-mix\(/,
    );
    expect(dialogueSurfaceRule).toMatch(
      /--astr-timeline-assistant-shadow:\s*var\(--glow-her-1\)/,
    );
    expect(dialogueSurfaceRule).toMatch(
      /--astr-timeline-return-shadow:\s*var\(--shadow-2\)/,
    );
    expect(experienceCss).toMatch(/prefers-reduced-motion[\s\S]*transition-duration:\s*0ms/);
    expect(experienceCss).toMatch(/data-visual-motion=["']paused["'][\s\S]*transition-duration:\s*0ms/);
    expect(experienceCss).toMatch(
      /data-visual-jewel-active=["']false["'][\s\S]*data-presence-visual-surface[\s\S]*opacity:\s*0/,
    );
    expect(tokens).toMatch(/--motion-medium:\s*320ms/);
    expect(globals).toMatch(
      /\.astr-ambient\s*\{[\s\S]*?--astr-ambient-opacity-min:\s*0\.8;[\s\S]*?--astr-ambient-opacity-max:\s*1;/,
    );
    expect(globals).toMatch(
      /\[data-theme="light"\]\s+\.astr-ambient\s*\{[\s\S]*?--astr-ambient-opacity-min:\s*0\.28;[\s\S]*?--astr-ambient-opacity-max:\s*0\.35;/,
    );
    expect(globals).toMatch(
      /@keyframes\s+astr-aurora[\s\S]*?opacity:\s*var\(--astr-ambient-opacity-min\)[\s\S]*?opacity:\s*var\(--astr-ambient-opacity-max\)/,
    );
    expect(globals).not.toMatch(
      /\[data-theme="light"\]\s+\.astr-ambient\s*\{[^}]*opacity:\s*0\.35/,
    );
    expect(experienceCss).toMatch(/var\(--motion-medium\)/);
    expect(experienceCss).not.toContain("--motion-slow");
    expect(experienceCss).toMatch(/lifeIsland\[data-expanded=["']true["']\][\s\S]*margin-block-start:\s*calc\(-1\s*\*\s*var\(--space-5\)\)/);
    expect(timelineCss).toMatch(/@media\s*\(max-width:\s*480px\)[\s\S]*max-inline-size:\s*92%/);
    expect(experienceCss).not.toMatch(/(?:^|[^d])100vh|h-screen/);
    expect(experienceCss).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
    expect(experienceCss).not.toMatch(/\b(?:green|lime|emerald|chartreuse)\b/i);
    expect(runtimeSources).not.toMatch(
      /requestAnimationFrame|getContext|PIXI|pixi|Live2D|Ticker\.shared|IntersectionObserver|ResizeObserver/,
    );
    expect(runtimeSources.match(/<JewelRuntimeBridge\s*\/>/g)).toHaveLength(1);
    expect(runtimeSources.match(/<PresenceVisibilityBridge\b/g)).toHaveLength(1);
  });
});
