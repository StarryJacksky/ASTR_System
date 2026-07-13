import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/system/AppShell";
import {
  PRESENCE_CONTROLLER_SERVER_SNAPSHOT,
  type PresenceControllerSnapshot,
} from "@/features/presence/controller/create-presence-controller";
import { initialSemanticState } from "@/lib/semantic-state";
import { semanticStore } from "@/lib/semantic-store";

import { createPresenceOwnerFixture } from "./presence.test-support";
import { TrustedMobilePresenceDomain } from "./TrustedMobilePresenceDomain";

function createSnapshot(
  overrides: Partial<PresenceControllerSnapshot> = {},
): PresenceControllerSnapshot {
  return Object.freeze({
    ...PRESENCE_CONTROLLER_SERVER_SNAPSHOT,
    semantic: Object.freeze({
      ...initialSemanticState,
      core: "reachable",
      replySse: "retrying",
      lifeSse: "open",
      conversation: "idle",
    }),
    status: Object.freeze({
      internalHandle: "sentinel_internal_handle",
      displayName: "  露怀秋  ",
      model: "sentinel_model",
      costTodayUsd: 123.45,
      dailyBudgetUsd: 999,
      emotion: Object.freeze({
        loneliness: 0,
        talkativeness: 0,
        irritation: 0,
        excitement: 0,
      }),
      activity: "正在整理今天的记忆",
    }),
    conversation: Object.freeze({
      messages: Object.freeze([]),
      receipt: null,
      provisionalText: "",
      provisionalActive: false,
      authoritativeDecision: null,
      error: null,
    }),
    draft: Object.freeze({
      revision: 0,
      text: "",
      selectionStart: 0,
      selectionEnd: 0,
    }),
    lifeEvents: Object.freeze([]),
    diagnostics: Object.freeze([]),
    ...overrides,
  });
}

describe("TrustedMobilePresenceDomain", () => {
  beforeEach(() => {
    semanticStore.setState({ ...initialSemanticState, announcement: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    act(() => {
      semanticStore.setState({ ...initialSemanticState, announcement: null });
    });
  });

  it("renders independent Core and stream facts, real conversation, and the sole global announcer", () => {
    const fixture = createPresenceOwnerFixture(createSnapshot());
    const { container } = render(
      <AppShell>
        <main id="main-content">
          <TrustedMobilePresenceDomain owner={fixture.owner} />
        </main>
      </AppShell>,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "与 露怀秋 对话" }),
    ).toBeVisible();
    const facts = screen.getByRole("group", { name: "Presence 连接事实" });
    expect(
      within(within(facts).getByText("Core").closest("div")!).getByText(
        "可达",
      ),
    ).toBeVisible();
    expect(
      within(within(facts).getByText("Reply SSE").closest("div")!).getByText(
        "重连中",
      ),
    ).toBeVisible();
    expect(
      within(within(facts).getByText("Life SSE").closest("div")!).getByText(
        "已连接",
      ),
    ).toBeVisible();
    expect(screen.getByText("此刻：正在整理今天的记忆")).toBeVisible();
    expect(screen.getByRole("region", { name: "对话记录" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "消息输入" })).toBeVisible();
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(container.innerHTML).not.toContain("sentinel_internal_handle");
    expect(container.innerHTML).not.toContain("sentinel_model");
    expect(container.innerHTML).not.toContain("123.45");
    expect(container.innerHTML).not.toContain("999");
  });

  it.each([
    ["cold", "未启动"],
    ["loading", "核验中"],
    ["reachable", "可达"],
    ["offline", "离线"],
    ["error", "状态错误"],
  ] as const)("maps Core %s to %s", (core, expected) => {
    const fixture = createPresenceOwnerFixture(
      createSnapshot({
        semantic: Object.freeze({
          ...initialSemanticState,
          core,
          replySse: "open",
          lifeSse: "closed",
          conversation: "final",
        }),
      }),
    );
    render(<TrustedMobilePresenceDomain owner={fixture.owner} />);
    const fact = screen.getByText("Core").closest("div");
    expect(fact).not.toBeNull();
    expect(within(fact!).getByText(expected)).toBeVisible();
  });

  it.each([
    ["connecting", "open", "连接中", "已连接"],
    ["open", "retrying", "已连接", "重连中"],
    ["retrying", "closed", "重连中", "未连接"],
    ["closed", "connecting", "未连接", "连接中"],
  ] as const)(
    "keeps Reply %s and Life %s independent from final conversation",
    (replySse, lifeSse, replyCopy, lifeCopy) => {
      const fixture = createPresenceOwnerFixture(
        createSnapshot({
          semantic: Object.freeze({
            ...initialSemanticState,
            core: "reachable",
            replySse,
            lifeSse,
            conversation: "final",
          }),
        }),
      );
      render(<TrustedMobilePresenceDomain owner={fixture.owner} />);
      const replyFact = screen.getByText("Reply SSE").closest("div");
      const lifeFact = screen.getByText("Life SSE").closest("div");
      expect(within(replyFact!).getByText(replyCopy)).toBeVisible();
      expect(within(lifeFact!).getByText(lifeCopy)).toBeVisible();
    },
  );

  it.each(["cold", "loading", "offline", "error"] as const)(
    "marks retained activity stale while Core is %s",
    (core) => {
      const fixture = createPresenceOwnerFixture(
        createSnapshot({
          semantic: Object.freeze({
            ...initialSemanticState,
            core,
            replySse: "closed",
            lifeSse: "closed",
            conversation: "idle",
          }),
        }),
      );
      render(<TrustedMobilePresenceDomain owner={fixture.owner} />);
      expect(
        screen.getByText("最近一次：正在整理今天的记忆（可能陈旧）"),
      ).toBeVisible();
    },
  );

  it.each([undefined, "", "   "])(
    "falls back to Soul and Core 未提供 without leaking the internal handle",
    (displayName) => {
      const base = createSnapshot();
      const fixture = createPresenceOwnerFixture(
        createSnapshot({
          status: Object.freeze({
            ...base.status!,
            displayName,
            activity: "   ",
          }),
        }),
      );
      const { container } = render(
        <TrustedMobilePresenceDomain owner={fixture.owner} />,
      );
      expect(
        screen.getByRole("heading", { level: 1, name: "与 Soul 对话" }),
      ).toBeVisible();
      expect(screen.getByText("Core 未提供")).toBeVisible();
      expect(container.innerHTML).not.toContain("sentinel_internal_handle");
    },
  );

  it("keeps a 50-message reader in place through stream and same-key final takeover", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(
      1_000,
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
    const announce = vi.spyOn(semanticStore.getState(), "announce");
    const messages = Object.freeze(
      Array.from({ length: 50 }, (_, index) => ({
        id: "mobile-history-" + index,
        role: "user" as const,
        text: "历史消息 " + index,
        ts: Date.UTC(2026, 6, 14, 0, index),
      })),
    );
    const fixture = createPresenceOwnerFixture(
      createSnapshot({
        conversation: Object.freeze({
          messages,
          receipt: null,
          provisionalText: "",
          provisionalActive: false,
          authoritativeDecision: null,
          error: null,
        }),
      }),
    );

    const { container } = render(
      <AppShell>
        <main id="main-content">
          <TrustedMobilePresenceDomain owner={fixture.owner} />
        </main>
      </AppShell>,
    );
    expect(
      within(screen.getByRole("list", { name: "对话消息" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(50);
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);

    const viewport = screen.getByRole("region", { name: "对话记录" });
    viewport.scrollTop = 100;
    fireEvent.scroll(viewport);

    act(() => {
      fixture.emit(
        createSnapshot({
          conversation: Object.freeze({
            messages,
            receipt: Object.freeze({
              event_id: "mobile-ingest",
              trace_id: "mobile-trace",
            }),
            provisionalText: "流式回复",
            provisionalActive: true,
            authoritativeDecision: null,
            error: null,
          }),
        }),
      );
    });
    expect(viewport.scrollTop).toBe(100);
    expect(
      screen.getByRole("button", { name: "回到最新，1 条未读更新" }),
    ).toBeVisible();

    act(() => {
      fixture.emit(
        createSnapshot({
          conversation: Object.freeze({
            messages: Object.freeze([
              ...messages,
              {
                id: "reply:mobile-trace",
                role: "qiuqiu" as const,
                text: "权威终稿",
                ts: Date.UTC(2026, 6, 14, 1, 0),
                traceId: "mobile-trace",
                eventId: "mobile-final",
              },
            ]),
            receipt: Object.freeze({
              event_id: "mobile-ingest",
              trace_id: "mobile-trace",
            }),
            provisionalText: "",
            provisionalActive: false,
            authoritativeDecision: null,
            error: null,
          }),
        }),
      );
    });
    expect(viewport.scrollTop).toBe(100);
    expect(announce).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: "回到最新，1 条未读更新" }),
    );
    expect(viewport.scrollTop).toBe(800);
    expect(viewport).toHaveFocus();
  });

  it("renders the static Soul Lens only at the conversation edge", () => {
    const fixture = createPresenceOwnerFixture(createSnapshot());
    render(<TrustedMobilePresenceDomain owner={fixture.owner} />);

    const dialogue = screen.getByRole("region", {
      name: "Mobile Presence 对话",
    });
    expect(dialogue.querySelector("[data-mobile-soul-mark]")).not.toBeNull();
    expect(
      screen
        .getByRole("heading", { level: 2, name: "对话" })
        .closest("header")
        ?.querySelector("[data-mobile-soul-mark]"),
    ).not.toBeNull();
    const decorativeSvgs = dialogue.querySelectorAll(
      "[data-mobile-soul-mark] svg",
    );
    expect(decorativeSvgs).toHaveLength(2);
    for (const svg of decorativeSvgs) {
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveAttribute("focusable", "false");
    }
    expect(
      screen
        .getByRole("heading", { level: 1 })
        .closest("header")
        ?.querySelector("[data-mobile-soul-mark]"),
    ).toBeNull();
  });

  it("keeps expanded Composer diagnostics reachable instead of clipping them", () => {
    const base = createSnapshot();
    const relatedDiagnostics = Object.freeze([
      ...Array.from({ length: 20 }, (_, index) => ({
        code: "UNBOUND_STREAM_DROPPED" as const,
        message: "unbound stream " + index,
        at: index,
        eventId: "unbound-" + index,
        traceId: "trace-" + index,
      })),
      {
        code: "INGEST_FAILED" as const,
        message: "ingest failed",
        at: 42,
      },
    ]);
    const fixture = createPresenceOwnerFixture(
      createSnapshot({
        conversation: Object.freeze({
          ...base.conversation,
          error: "ingest failed",
        }),
        diagnostics: relatedDiagnostics,
      }),
    );
    render(<TrustedMobilePresenceDomain owner={fixture.owner} />);
    fireEvent.click(screen.getByRole("button", { name: /诊断详情/ }));
    const diagnostics = screen.getByRole("list", { name: "最近相关诊断" });
    expect(diagnostics).toBeVisible();
    expect(within(diagnostics).getAllByRole("listitem")).toHaveLength(21);
  });
});
