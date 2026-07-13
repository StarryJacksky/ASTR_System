import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StrictMode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/system/AppShell";
import { initialSemanticState } from "@/lib/semantic-state";
import { semanticStore } from "@/lib/semantic-store";
import type { AstrEvent, ChatMessage, ConversationProjection } from "@/lib/types";

import {
  BOTTOM_FOLLOW_THRESHOLD_PX,
  FINAL_ANNOUNCEMENT_ID_CAPACITY,
  ConversationRegion,
  createBoundedIdLedger,
  getFinalAnnouncementLedgerForScope,
} from "./ConversationRegion";
import { LifeRegion } from "./LifeRegion";

const EMPTY_CONVERSATION: ConversationProjection = {
  messages: [],
  receipt: null,
  provisionalText: "",
  provisionalActive: false,
  authoritativeDecision: null,
  error: null,
};

let scrollHeight = 1_000;
let clientHeight = 200;

function message(overrides: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role" | "text">): ChatMessage {
  return { ts: Date.UTC(2026, 6, 11, 3, 4, 5), ...overrides };
}

function decision(id: string, traceId: string, text: string): AstrEvent {
  return {
    id,
    trace_id: traceId,
    type: "soul.decision",
    source: "soul.orchestrator",
    ts: "2026-07-11T03:04:05.000Z",
    payload: { reply_text: text },
  };
}

function conversation(
  overrides: Partial<ConversationProjection> = {},
): ConversationProjection {
  return { ...EMPTY_CONVERSATION, ...overrides };
}

describe("ConversationRegion", () => {
  beforeEach(() => {
    scrollHeight = 1_000;
    clientHeight = 200;
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
      () => scrollHeight,
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
      () => clientHeight,
    );
    semanticStore.setState({ ...initialSemanticState, announcement: null });
  });

  afterEach(() => {
    act(() => semanticStore.setState({ ...initialSemanticState, announcement: null }));
  });

  it("renders a semantic, non-live message list with author, text, and deterministic time", () => {
    const { container } = render(
      <ConversationRegion
        assistantLabel="露怀秋"
        announceFinal={vi.fn()}
        conversation={conversation({
          messages: [
            message({ id: "user-1", role: "user", text: "你好", platform: "web" }),
            message({
              id: "reply:trace-1",
              role: "qiuqiu",
              text: "晚上好",
              eventId: "decision-1",
              traceId: "trace-1",
            }),
          ],
        })}
      />,
    );

    const list = screen.getByRole("list", { name: "对话消息" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("你")).toBeVisible();
    expect(within(list).getByText("露怀秋")).toBeVisible();
    expect(within(list).getByText("你好")).toBeVisible();
    expect(within(list).getByText("晚上好")).toBeVisible();
    expect(within(list).getAllByText("2026-07-11 · 03:04 UTC")).toHaveLength(2);
    expect(container.querySelector("[aria-live], [role='status'], [role='alert'], [role='log']"))
      .toBeNull();
  });

  it("owns the single compact dialogue title rail and accepts its explicit layout action", () => {
    render(
      <ConversationRegion
        announceFinal={vi.fn()}
        conversation={EMPTY_CONVERSATION}
        headerAction={<button type="button">切换深聊布局</button>}
      />,
    );

    expect(screen.getAllByRole("heading", { level: 2, name: "对话" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "切换深聊布局" })).toBeVisible();
    expect(screen.queryByText("PRESENCE · DIALOGUE")).not.toBeInTheDocument();
  });

  it("omits invalid message time instead of fabricating a local or current timestamp", () => {
    render(
      <ConversationRegion
        announceFinal={vi.fn()}
        conversation={conversation({
          messages: [
            message({
              id: "invalid-time",
              role: "user",
              text: "时间未知",
              ts: Number.MAX_SAFE_INTEGER,
            }),
          ],
        })}
      />,
    );

    expect(screen.queryByRole("time")).not.toBeInTheDocument();
    expect(screen.getByText("时间未知")).toBeVisible();
  });

  it("labels late and external finals truthfully and falls back from a blank display name to Soul", () => {
    render(
      <ConversationRegion
        assistantLabel="   "
        announceFinal={vi.fn()}
        conversation={conversation({
          messages: [
            message({
              id: "external-ui",
              role: "qiuqiu",
              text: "外部记录",
              eventId: "external-event",
              external: true,
            }),
            message({
              id: "late-ui",
              role: "qiuqiu",
              text: "迟到记录",
              eventId: "late-event",
              lateFinal: true,
            }),
          ],
        })}
      />,
    );

    expect(screen.getAllByText("Soul")).toHaveLength(2);
    expect(screen.getByText("外部终稿")).toBeVisible();
    expect(screen.getByText("迟到终稿")).toBeVisible();
  });

  it("renders one provisional bubble and lets the final take over the same keyed node", () => {
    const { container, rerender } = render(
      <ConversationRegion
        announceFinal={vi.fn()}
        conversation={conversation({
          receipt: { event_id: "ingest-1", trace_id: "trace-1" },
          provisionalText: "临时回复",
          provisionalActive: true,
        })}
      />,
    );

    const provisionalNode = container.querySelector("[data-message-id='reply:trace-1']");
    expect(provisionalNode).toBeInTheDocument();
    expect(provisionalNode).toHaveTextContent("临时回复");
    expect(provisionalNode).toHaveTextContent("临时回复 · 尚未成为终稿");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);

    rerender(
      <ConversationRegion
        announceFinal={vi.fn()}
        conversation={conversation({
          receipt: { event_id: "ingest-1", trace_id: "trace-1" },
          provisionalText: "流已结束但终稿未到",
          provisionalActive: false,
        })}
      />,
    );
    expect(container.querySelector("[data-message-id='reply:trace-1']")).toBe(
      provisionalNode,
    );
    expect(provisionalNode).toHaveTextContent("等待终稿");

    const finalMessage = message({
      id: "reply:trace-1",
      role: "qiuqiu",
      text: "权威终稿",
      traceId: "trace-1",
      eventId: "decision-1",
    });
    rerender(
      <ConversationRegion
        announceFinal={vi.fn()}
        conversation={conversation({ messages: [finalMessage] })}
      />,
    );
    expect(container.querySelector("[data-message-id='reply:trace-1']")).toBe(
      provisionalNode,
    );
    expect(provisionalNode).toHaveTextContent("权威终稿");
    expect(provisionalNode).not.toHaveTextContent("等待终稿");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("announces each projected settled decision once across clones and Strict Mode", () => {
    const announce = vi.fn();
    const normal = message({
      id: "reply:trace-1",
      role: "qiuqiu",
      text: "正常终稿",
      traceId: "trace-1",
      eventId: "decision-1",
    });
    const { rerender } = render(
      <StrictMode>
        <ConversationRegion
          assistantLabel="Soul"
          announceFinal={announce}
          conversation={conversation({ messages: [{ ...normal }] })}
        />
      </StrictMode>,
    );

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith("Soul 回答完成：正常终稿", "polite");

    rerender(
      <StrictMode>
        <ConversationRegion
          assistantLabel="Soul"
          announceFinal={announce}
          conversation={conversation({ messages: [{ ...normal }] })}
        />
      </StrictMode>,
    );
    expect(announce).toHaveBeenCalledTimes(1);

    const external = message({
      id: "reply:external:decision-2",
      role: "qiuqiu",
      text: "外部终稿",
      eventId: "decision-2",
      external: true,
    });
    const retiredLate = message({
      id: "reply:retired",
      role: "qiuqiu",
      text: "旧请求迟到终稿",
      eventId: "decision-3",
      lateFinal: true,
      replyToMessageId: "old-user-message",
    });
    rerender(
      <StrictMode>
        <ConversationRegion
          assistantLabel="Soul"
          announceFinal={announce}
          conversation={conversation({
            messages: [{ ...normal }, { ...external }, { ...retiredLate }],
          })}
        />
      </StrictMode>,
    );

    expect(announce).toHaveBeenCalledTimes(3);
    expect(announce).toHaveBeenNthCalledWith(2, "Soul 的外部终稿：外部终稿", "polite");
    expect(announce).toHaveBeenNthCalledWith(3, "Soul 的迟到终稿：旧请求迟到终稿", "polite");
  });

  it("uses the global announcer without adding a second live region", () => {
    const announceSpy = vi.spyOn(semanticStore.getState(), "announce");
    const final = message({
      id: "reply:trace-global",
      role: "qiuqiu",
      text: "全局播报终稿",
      eventId: "decision-global",
    });
    const { container, rerender } = render(
      <AppShell>
        <main id="main-content">
          <ConversationRegion conversation={conversation({ messages: [final] })} />
          <LifeRegion
            events={[]}
            expanded={false}
            onExpandedChange={vi.fn()}
            streamState="open"
          />
        </main>
      </AppShell>,
    );

    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Soul 回答完成：全局播报终稿");
    expect(announceSpy).toHaveBeenCalledTimes(1);

    rerender(
      <AppShell>
        <main id="main-content">
          <ConversationRegion conversation={conversation({ messages: [{ ...final }] })} />
          <LifeRegion
            activity="正在阅读"
            events={[
              {
                ...decision("life-thought", "life-trace", "unused"),
                type: "agent.thought",
                payload: { text: "新的生活片段" },
              },
            ]}
            expanded={false}
            onExpandedChange={vi.fn()}
            streamState="open"
          />
        </main>
      </AppShell>,
    );
    expect(announceSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
  });

  it("keeps the announcement-id ledger observably bounded", () => {
    expect(FINAL_ANNOUNCEMENT_ID_CAPACITY).toBe(256);
    const ledger = createBoundedIdLedger(3);

    expect(ledger.remember("event-a")).toBe(true);
    expect(ledger.remember("event-a")).toBe(false);
    expect(ledger.remember("event-b")).toBe(true);
    expect(ledger.remember("event-c")).toBe(true);
    expect(ledger.size).toBe(3);
    expect(ledger.remember("event-d")).toBe(true);
    expect(ledger.size).toBe(3);
    expect(ledger.remember("event-a")).toBe(true);
    expect(ledger.size).toBe(3);
  });

  it("deduplicates one final event across instances and real remounts sharing a scope ledger", () => {
    const announce = vi.fn();
    const scope = {};
    const ledger = getFinalAnnouncementLedgerForScope(scope);
    const final = message({
      id: "reply:shared-scope",
      role: "qiuqiu",
      text: "同一权威终稿",
      eventId: "decision-shared-scope",
    });

    const first = render(
      <ConversationRegion
        announcementLedger={ledger}
        announceFinal={announce}
        conversation={conversation({ messages: [final] })}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = render(
      <ConversationRegion
        announcementLedger={getFinalAnnouncementLedgerForScope(scope)}
        announceFinal={announce}
        conversation={conversation({ messages: [{ ...final }] })}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  it("isolates final ledgers by owner scope", () => {
    const firstAnnounce = vi.fn();
    const secondAnnounce = vi.fn();
    const final = message({
      id: "reply:scope-isolation",
      role: "qiuqiu",
      text: "隔离终稿",
      eventId: "decision-scope-isolation",
    });

    render(
      <>
        <ConversationRegion
          announcementLedger={getFinalAnnouncementLedgerForScope({})}
          announceFinal={firstAnnounce}
          conversation={conversation({ messages: [final] })}
        />
        <ConversationRegion
          announcementLedger={getFinalAnnouncementLedgerForScope({})}
          announceFinal={secondAnnounce}
          conversation={conversation({ messages: [{ ...final }] })}
        />
      </>,
    );

    expect(firstAnnounce).toHaveBeenCalledTimes(1);
    expect(secondAnnounce).toHaveBeenCalledTimes(1);
  });

  it("shares one ledger without sharing two concurrent viewport scroll states", () => {
    const announce = vi.fn();
    const ledger = getFinalAnnouncementLedgerForScope({});
    const final = message({
      id: "reply:shared-ledger-local-scroll",
      role: "qiuqiu",
      text: "共享公告，不共享滚动",
      eventId: "decision-shared-ledger-local-scroll",
    });

    render(
      <>
        <ConversationRegion
          announcementLedger={ledger}
          announceFinal={announce}
          conversation={conversation({ messages: [final] })}
        />
        <ConversationRegion
          announcementLedger={ledger}
          announceFinal={announce}
          conversation={conversation({ messages: [{ ...final }] })}
        />
      </>,
    );

    expect(announce).toHaveBeenCalledTimes(1);
    const viewports = screen.getAllByRole("region", { name: "对话记录" });
    viewports[0].scrollTop = 100;
    fireEvent.scroll(viewports[0]);
    expect(screen.getAllByRole("button", { name: "回到最新" })).toHaveLength(1);
    expect(viewports[0]).toHaveAttribute("tabindex", "0");
    expect(viewports[1]).toHaveAttribute("tabindex", "0");
  });

  it("does not let a lagging subset viewport replay a shared final", () => {
    const announce = vi.fn();
    const ledger = getFinalAnnouncementLedgerForScope({});
    const first = message({
      id: "reply:shared-subset-a",
      role: "qiuqiu",
      text: "共享终稿 A",
      eventId: "decision-shared-subset-a",
    });
    const second = message({
      id: "reply:shared-subset-b",
      role: "qiuqiu",
      text: "共享终稿 B",
      eventId: "decision-shared-subset-b",
    });

    const viewportA = render(
      <ConversationRegion
        announcementLedger={ledger}
        announceFinal={announce}
        conversation={conversation({ messages: [first, second] })}
      />,
    );
    const viewportB = render(
      <ConversationRegion
        announcementLedger={ledger}
        announceFinal={announce}
        conversation={conversation({ messages: [{ ...first }] })}
      />,
    );

    viewportA.rerender(
      <ConversationRegion
        announcementLedger={ledger}
        announceFinal={announce}
        conversation={conversation({ messages: [{ ...first }, { ...second }] })}
      />,
    );

    expect(announce).toHaveBeenCalledTimes(2);
    viewportA.unmount();
    viewportB.unmount();
  });

  it("announces only one new entrant after disjoint viewports reconcile a shared ledger", () => {
    const announce = vi.fn();
    const ledger = getFinalAnnouncementLedgerForScope({});
    const aFinals = Array.from({ length: 256 }, (_, index) =>
      message({
        id: "reply:disjoint-a-" + index,
        role: "qiuqiu",
        text: "A 终稿 " + index,
        eventId: "decision:disjoint-a-" + index,
      }),
    );
    const bFinals = Array.from({ length: 256 }, (_, index) =>
      message({
        id: "reply:disjoint-b-" + index,
        role: "qiuqiu",
        text: "B 终稿 " + index,
        eventId: "decision:disjoint-b-" + index,
      }),
    );

    const viewportA = render(
      <ConversationRegion
        announcementLedger={ledger}
        announceFinal={announce}
        conversation={conversation({ messages: aFinals })}
      />,
    );
    const viewportB = render(
      <ConversationRegion
        announcementLedger={ledger}
        announceFinal={announce}
        conversation={conversation({ messages: bFinals })}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(512);

    viewportA.rerender(
      <ConversationRegion
        announcementLedger={ledger}
        announceFinal={announce}
        conversation={conversation({
          messages: aFinals.map((item) => ({ ...item })),
        })}
      />,
    );
    viewportB.rerender(
      <ConversationRegion
        announcementLedger={ledger}
        announceFinal={announce}
        conversation={conversation({
          messages: bFinals.map((item) => ({ ...item })),
        })}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(512);

    const aNew = message({
      id: "reply:disjoint-a-new",
      role: "qiuqiu",
      text: "A 新终稿",
      eventId: "decision:disjoint-a-new",
    });
    viewportA.rerender(
      <ConversationRegion
        announcementLedger={ledger}
        announceFinal={announce}
        conversation={conversation({
          messages: [...aFinals.map((item) => ({ ...item })), aNew],
        })}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(513);
    expect(announce).toHaveBeenLastCalledWith("Soul 回答完成：A 新终稿", "polite");

    viewportA.unmount();
    viewportB.unmount();
  });

  it("reconciles only the newest 256 finals so a remount cannot cascade-replay evicted history", () => {
    const announce = vi.fn();
    const scope = {};
    const finals = Array.from({ length: 257 }, (_, index) =>
      message({
        id: "reply:bounded-" + index,
        role: "qiuqiu",
        text: "终稿 " + index,
        eventId: "decision-bounded-" + index,
      }),
    );
    const first = render(
      <ConversationRegion
        announcementLedger={getFinalAnnouncementLedgerForScope(scope)}
        announceFinal={announce}
        conversation={conversation({
          messages: finals,
          authoritativeDecision: decision(
            "decision-bounded-0",
            "trace-bounded",
            "终稿 0",
          ),
        })}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(256);
    expect(announce).not.toHaveBeenCalledWith(
      expect.stringContaining("终稿 0"),
      "polite",
    );
    first.unmount();

    const second = render(
      <ConversationRegion
        announcementLedger={getFinalAnnouncementLedgerForScope(scope)}
        announceFinal={announce}
        conversation={conversation({
          messages: finals.map((item) => ({ ...item })),
          authoritativeDecision: decision(
            "decision-bounded-0",
            "trace-bounded",
            "终稿 0",
          ),
        })}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(256);
    second.unmount();
  });

  it("announces a newly inserted late final outside the unchanged tail window", () => {
    const announce = vi.fn();
    const ledger = getFinalAnnouncementLedgerForScope({});
    const oldUser = message({
      id: "user:late-window",
      role: "user",
      text: "旧请求",
    });
    const finals = Array.from({ length: 256 }, (_, index) =>
      message({
        id: "reply:late-window-" + index,
        role: "qiuqiu",
        text: "尾部终稿 " + index,
        eventId: "decision:late-window-" + index,
      }),
    );
    const { rerender } = render(
      <ConversationRegion
        announcementLedger={ledger}
        announceFinal={announce}
        conversation={conversation({ messages: [oldUser, ...finals] })}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(256);

    const lateFinal = message({
      id: "reply:late-window-inserted",
      role: "qiuqiu",
      text: "旧请求迟到终稿",
      eventId: "decision:late-window-inserted",
      lateFinal: true,
      replyToMessageId: oldUser.id,
    });
    rerender(
      <ConversationRegion
        announcementLedger={ledger}
        announceFinal={announce}
        conversation={conversation({
          messages: [{ ...oldUser }, lateFinal, ...finals.map((item) => ({ ...item }))],
        })}
      />,
    );

    expect(announce).toHaveBeenCalledTimes(257);
    expect(announce).toHaveBeenLastCalledWith(
      "Soul 的迟到终稿：旧请求迟到终稿",
      "polite",
    );

    rerender(
      <ConversationRegion
        announcementLedger={ledger}
        announceFinal={announce}
        conversation={conversation({
          messages: [
            { ...oldUser },
            { ...lateFinal },
            ...finals.map((item) => ({ ...item })),
          ],
        })}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(257);
  });

  it("counts a distinct authoritative fallback inside the same 256-event window", () => {
    const announce = vi.fn();
    const scope = {};
    const finals = Array.from({ length: 256 }, (_, index) =>
      message({
        id: "reply:fallback-window-" + index,
        role: "qiuqiu",
        text: "消息终稿 " + index,
        eventId: "decision:fallback-window-" + index,
      }),
    );
    const projection = conversation({
      messages: finals,
      authoritativeDecision: decision(
        "decision:distinct-fallback",
        "trace:distinct-fallback",
        "独立 fallback",
      ),
    });

    const first = render(
      <ConversationRegion
        announcementLedger={getFinalAnnouncementLedgerForScope(scope)}
        announceFinal={announce}
        conversation={projection}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(256);
    expect(announce).toHaveBeenCalledWith(
      "Soul 的权威终稿：独立 fallback",
      "polite",
    );
    expect(announce).not.toHaveBeenCalledWith(
      expect.stringContaining("消息终稿 0"),
      "polite",
    );
    first.unmount();

    const second = render(
      <ConversationRegion
        announcementLedger={getFinalAnnouncementLedgerForScope(scope)}
        announceFinal={announce}
        conversation={conversation({
          messages: finals.map((item) => ({ ...item })),
          authoritativeDecision: decision(
            "decision:distinct-fallback",
            "trace:distinct-fallback",
            "独立 fallback",
          ),
        })}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(256);
    second.rerender(
      <ConversationRegion
        announcementLedger={getFinalAnnouncementLedgerForScope(scope)}
        announceFinal={announce}
        conversation={conversation({
          messages: finals.map((item) => ({ ...item })),
          authoritativeDecision: null,
        })}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(257);
    expect(announce).toHaveBeenLastCalledWith(
      "Soul 回答完成：消息终稿 0",
      "polite",
    );

    second.rerender(
      <ConversationRegion
        announcementLedger={getFinalAnnouncementLedgerForScope(scope)}
        announceFinal={announce}
        conversation={conversation({
          messages: finals.map((item) => ({ ...item })),
          authoritativeDecision: null,
        })}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(257);
    second.unmount();
  });

  it("atomically reconciles the newest distinct ids without eviction cascades", () => {
    const ledger = createBoundedIdLedger(3);

    expect(ledger.reconcileWindow(["a", "b", "b", "c", "d"])).toEqual([
      "b",
      "c",
      "d",
    ]);
    expect(ledger.size).toBe(3);
    expect(ledger.reconcileWindow(["a", "b", "c"])).toEqual(["a"]);
    expect(ledger.size).toBe(3);
    expect(ledger.reconcileWindow(["a", "b", "c"])).toEqual([]);
  });

  it("resets the same mounted viewport when its owner ledger changes", () => {
    const announce = vi.fn();
    const firstLedger = getFinalAnnouncementLedgerForScope({});
    const secondLedger = getFinalAnnouncementLedgerForScope({});
    const final = message({
      id: "reply:owner-switch",
      role: "qiuqiu",
      text: "作用域切换终稿",
      eventId: "decision-owner-switch",
    });
    const { rerender } = render(
      <ConversationRegion
        announcementLedger={firstLedger}
        announceFinal={announce}
        conversation={conversation({ messages: [final] })}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(1);
    const viewport = screen.getByRole("region", { name: "对话记录" });
    viewport.scrollTop = 100;
    fireEvent.scroll(viewport);

    const update = message({
      id: "reply:owner-switch-update",
      role: "qiuqiu",
      text: "A owner 的未读终稿",
      eventId: "decision-owner-switch-update",
    });
    rerender(
      <ConversationRegion
        announcementLedger={firstLedger}
        announceFinal={announce}
        conversation={conversation({ messages: [final, update] })}
      />,
    );
    expect(
      screen.getByRole("button", { name: "回到最新，1 条未读更新" }),
    ).toBeVisible();
    expect(viewport.scrollTop).toBe(100);

    rerender(
      <ConversationRegion
        announcementLedger={secondLedger}
        announceFinal={announce}
        conversation={conversation({ messages: [{ ...final }] })}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("region", { name: "对话记录" })).toBe(viewport);
    expect(viewport.scrollTop).toBe(800);
    expect(screen.queryByRole("button", { name: /回到最新/ })).toBeNull();
  });

  it("announces a matching active-trace compatibility fallback exactly once", () => {
    const announce = vi.fn();
    const fallback = decision("fallback-decision", "active-trace", "兼容终稿");
    const { rerender } = render(
      <ConversationRegion
        announceFinal={announce}
        conversation={conversation({
          receipt: { event_id: "active-ingest", trace_id: "active-trace" },
          authoritativeDecision: fallback,
        })}
      />,
    );

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("Soul 的权威终稿：兼容终稿", "polite");
    rerender(
      <ConversationRegion
        announceFinal={announce}
        conversation={conversation({
          receipt: { event_id: "active-ingest", trace_id: "active-trace" },
          authoritativeDecision: {
            ...fallback,
            payload: { ...fallback.payload },
          },
        })}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("does not double announce when projection and compatibility fallback share one event", () => {
    const announce = vi.fn();
    const fallback = decision("same-decision", "same-trace", "同一终稿");
    render(
      <ConversationRegion
        announceFinal={announce}
        conversation={conversation({
          messages: [
            message({
              id: "reply:same-trace",
              role: "qiuqiu",
              text: "同一终稿",
              traceId: "same-trace",
              eventId: "same-decision",
            }),
          ],
          receipt: { event_id: "same-ingest", trace_id: "same-trace" },
          authoritativeDecision: fallback,
        })}
      />,
    );

    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("follows on initial render and restores follow for a new local user message", () => {
    const { rerender } = render(
      <ConversationRegion announceFinal={vi.fn()} conversation={EMPTY_CONVERSATION} />,
    );
    const viewport = screen.getByRole("region", { name: "对话记录" });
    expect(viewport.scrollTop).toBe(800);

    viewport.scrollTop = 120;
    fireEvent.scroll(viewport);
    expect(screen.getByRole("button", { name: "回到最新" })).toBeVisible();

    rerender(
      <ConversationRegion
        announceFinal={vi.fn()}
        conversation={conversation({
          receipt: { event_id: "ingest-assistant", trace_id: "trace-assistant" },
          provisionalText: "读者离开底部后抵达的回复",
          provisionalActive: true,
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "回到最新，1 条未读更新" })).toBeVisible();

    scrollHeight = 1_300;
    rerender(
      <ConversationRegion
        announceFinal={vi.fn()}
        conversation={conversation({
          messages: [message({ id: "user-new", role: "user", text: "我刚发送的消息" })],
        })}
      />,
    );
    expect(viewport.scrollTop).toBe(1_100);
    expect(screen.queryByRole("button", { name: /回到最新/ })).not.toBeInTheDocument();
  });

  it("uses the literal 72px threshold: 72 follows and 73 opts out", () => {
    expect(BOTTOM_FOLLOW_THRESHOLD_PX).toBe(72);
    const { rerender } = render(
      <ConversationRegion announceFinal={vi.fn()} conversation={EMPTY_CONVERSATION} />,
    );
    const viewport = screen.getByRole("region", { name: "对话记录" });

    viewport.scrollTop = 728;
    fireEvent.scroll(viewport);
    scrollHeight = 1_100;
    rerender(
      <ConversationRegion
        announceFinal={vi.fn()}
        conversation={conversation({
          receipt: { event_id: "ingest-72", trace_id: "trace-72" },
          provisionalText: "仍应跟随",
          provisionalActive: true,
        })}
      />,
    );
    expect(viewport.scrollTop).toBe(900);

    viewport.scrollTop = 827;
    fireEvent.scroll(viewport);
    expect(screen.getByRole("button", { name: "回到最新" })).toBeVisible();
  });

  it("treats deep-cloned unchanged snapshots as no content change and never refollows the same user id", () => {
    const announce = vi.fn();
    const initialMessages = [
      message({ id: "stable-user", role: "user", text: "同一条用户消息" }),
      message({
        id: "stable-reply",
        role: "qiuqiu",
        text: "同一条终稿",
        eventId: "stable-decision",
      }),
    ];
    const { rerender } = render(
      <ConversationRegion
        announceFinal={announce}
        conversation={conversation({ messages: initialMessages })}
      />,
    );
    const viewport = screen.getByRole("region", { name: "对话记录" });
    let observedScrollTop = 120;
    const scrollTopSetter = vi.fn((value: number) => {
      observedScrollTop = value;
    });
    Object.defineProperty(viewport, "scrollTop", {
      configurable: true,
      get: () => observedScrollTop,
      set: scrollTopSetter,
    });
    fireEvent.scroll(viewport);
    scrollTopSetter.mockClear();

    rerender(
      <ConversationRegion
        announceFinal={announce}
        conversation={conversation({ messages: initialMessages.map((item) => ({ ...item })) })}
      />,
    );

    expect(scrollTopSetter).not.toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(120);
    expect(screen.getByRole("button", { name: "回到最新" })).toBeVisible();
    expect(screen.queryByText(/未读更新/)).not.toBeInTheDocument();
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("manual scrolling back within 72px clears unread and makes the next delta follow", () => {
    const initial = conversation({
      receipt: { event_id: "manual-ingest", trace_id: "manual-trace" },
      provisionalText: "a",
      provisionalActive: true,
    });
    const { rerender } = render(
      <ConversationRegion announceFinal={vi.fn()} conversation={initial} />,
    );
    const viewport = screen.getByRole("region", { name: "对话记录" });
    viewport.scrollTop = 100;
    fireEvent.scroll(viewport);
    rerender(
      <ConversationRegion
        announceFinal={vi.fn()}
        conversation={conversation({
          ...initial,
          provisionalText: "ab",
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "回到最新，1 条未读更新" })).toBeVisible();

    viewport.scrollTop = 728;
    fireEvent.scroll(viewport);
    expect(screen.queryByRole("button", { name: /回到最新/ })).not.toBeInTheDocument();

    scrollHeight = 1_100;
    rerender(
      <ConversationRegion
        announceFinal={vi.fn()}
        conversation={conversation({
          ...initial,
          provisionalText: "abc",
        })}
      />,
    );
    expect(viewport.scrollTop).toBe(900);
  });

  it("keeps following when the user was within the 72px bottom threshold", () => {
    const { rerender } = render(
      <ConversationRegion announceFinal={vi.fn()} conversation={EMPTY_CONVERSATION} />,
    );
    const viewport = screen.getByRole("region", { name: "对话记录" });
    viewport.scrollTop = 800 - BOTTOM_FOLLOW_THRESHOLD_PX + 1;
    fireEvent.scroll(viewport);

    scrollHeight = 1_200;
    const provisional = conversation({
      receipt: { event_id: "ingest", trace_id: "trace-near" },
      provisionalText: "第一段",
      provisionalActive: true,
    });
    rerender(<ConversationRegion announceFinal={vi.fn()} conversation={provisional} />);
    expect(viewport.scrollTop).toBe(1_000);
  });

  it("freezes an opted-out reader through 1000 deltas and same-key final takeover", () => {
    const announce = vi.fn();
    const initial = conversation({
      receipt: { event_id: "ingest", trace_id: "trace-stream" },
      provisionalText: "a",
      provisionalActive: true,
    });
    const { rerender } = render(
      <ConversationRegion announceFinal={announce} conversation={initial} />,
    );
    const viewport = screen.getByRole("region", { name: "对话记录" });
    let observedScrollTop = 180;
    const scrollTopSetter = vi.fn((value: number) => {
      observedScrollTop = value;
    });
    Object.defineProperty(viewport, "scrollTop", {
      configurable: true,
      get: () => observedScrollTop,
      set: scrollTopSetter,
    });
    fireEvent.scroll(viewport);
    scrollTopSetter.mockClear();

    for (let index = 0; index < 1_000; index += 1) {
      scrollHeight = 1_001 + index;
      rerender(
        <ConversationRegion
          announceFinal={announce}
          conversation={conversation({
            receipt: { event_id: "ingest", trace_id: "trace-stream" },
            provisionalText: `a${"x".repeat(index + 1)}`,
            provisionalActive: true,
          })}
        />,
      );
    }

    expect(viewport.scrollTop).toBe(180);
    expect(scrollTopSetter).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "回到最新，1 条未读更新" })).toBeVisible();
    expect(announce).not.toHaveBeenCalled();

    scrollHeight = 2_200;
    rerender(
      <ConversationRegion
        announceFinal={announce}
        conversation={conversation({
          messages: [
            message({
              id: "reply:trace-stream",
              role: "qiuqiu",
              text: "权威终稿接管",
              eventId: "decision-stream",
              traceId: "trace-stream",
            }),
          ],
        })}
      />,
    );
    expect(viewport.scrollTop).toBe(180);
    expect(scrollTopSetter).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "回到最新，1 条未读更新" })).toBeVisible();
    expect(announce).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "回到最新，1 条未读更新" }));
    expect(viewport.scrollTop).toBe(2_000);
    expect(viewport).toHaveFocus();
    expect(screen.queryByRole("button", { name: /回到最新/ })).not.toBeInTheDocument();
  });

  it("counts each distinct settled assistant bubble exactly once", () => {
    const first = message({
      id: "reply:first",
      role: "qiuqiu",
      text: "第一条",
      eventId: "decision-first",
    });
    const { rerender } = render(
      <ConversationRegion announceFinal={vi.fn()} conversation={conversation({ messages: [first] })} />,
    );
    const viewport = screen.getByRole("region", { name: "对话记录" });
    viewport.scrollTop = 100;
    fireEvent.scroll(viewport);

    rerender(
      <ConversationRegion
        announceFinal={vi.fn()}
        conversation={conversation({
          messages: [
            first,
            message({
              id: "reply:second",
              role: "qiuqiu",
              text: "第二条",
              eventId: "decision-second",
              external: true,
            }),
            message({
              id: "reply:third",
              role: "qiuqiu",
              text: "第三条",
              eventId: "decision-third",
              external: true,
            }),
          ],
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "回到最新，2 条未读更新" })).toBeVisible();
  });

  it("bounds unread assistant ids at 256 and exposes truthful overflow", () => {
    const { rerender } = render(
      <ConversationRegion announceFinal={vi.fn()} conversation={EMPTY_CONVERSATION} />,
    );
    const viewport = screen.getByRole("region", { name: "对话记录" });
    viewport.scrollTop = 100;
    fireEvent.scroll(viewport);

    rerender(
      <ConversationRegion
        announceFinal={vi.fn()}
        conversation={conversation({
          messages: Array.from({ length: 257 }, (_, index) =>
            message({ id: `reply:${index}`, role: "qiuqiu", text: `终稿 ${index}` }),
          ),
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "回到最新，256+ 条未读更新" })).toBeVisible();
  });

  it("deduplicates announcements by event id rather than message id", () => {
    const announce = vi.fn();
    const first = message({
      id: "reply:first-id",
      role: "qiuqiu",
      text: "第一次投影",
      eventId: "shared-event",
    });
    const { rerender } = render(
      <ConversationRegion
        announceFinal={announce}
        conversation={conversation({ messages: [first] })}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(1);

    const secondMessageSameEvent = message({
      id: "reply:second-id",
      role: "qiuqiu",
      text: "同事件的第二个消息投影",
      eventId: "shared-event",
    });
    rerender(
      <ConversationRegion
        announceFinal={announce}
        conversation={conversation({ messages: [first, secondMessageSameEvent] })}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(1);

    const sameMessageNewEvent = {
      ...secondMessageSameEvent,
      text: "同消息 id 的新终稿事件",
      eventId: "new-event",
    };
    rerender(
      <ConversationRegion
        announceFinal={announce}
        conversation={conversation({ messages: [first, sameMessageNewEvent] })}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenLastCalledWith(
      "Soul 回答完成：同消息 id 的新终稿事件",
      "polite",
    );
  });

  it("does not use an old authoritative fallback to complete a new active trace", () => {
    const announce = vi.fn();
    render(
      <ConversationRegion
        announceFinal={announce}
        conversation={conversation({
          messages: [message({ id: "new-user", role: "user", text: "新的请求" })],
          receipt: { event_id: "new-ingest", trace_id: "new-trace" },
          authoritativeDecision: decision("old-decision", "old-trace", "旧请求终稿"),
        })}
      />,
    );

    expect(announce).not.toHaveBeenCalled();
  });

  it("locks scheduler, pure-renderer, accessibility, and responsive CSS source boundaries", () => {
    const conversationSource = readFileSync(
      resolve(process.cwd(), "src/features/presence/components/ConversationRegion.tsx"),
      "utf8",
    );
    const timelineSource = readFileSync(
      resolve(process.cwd(), "src/features/presence/components/MessageTimeline.tsx"),
      "utf8",
    );
    const lifeSource = readFileSync(
      resolve(process.cwd(), "src/features/presence/components/LifeRegion.tsx"),
      "utf8",
    );
    const cssSource = readFileSync(
      resolve(process.cwd(), "src/features/presence/components/PresenceTimelines.module.css"),
      "utf8",
    );
    const runtimeSources = `${conversationSource}\n${timelineSource}\n${lifeSource}`;

    expect(runtimeSources).not.toMatch(
      /requestAnimationFrame|setTimeout|setInterval|ResizeObserver|scrollIntoView|behavior\s*:\s*["']smooth["']|Date\.now/,
    );
    expect(timelineSource).not.toMatch(
      /useEffect|useLayoutEffect|useState|semanticStore|aria-live|role=["'](?:log|status|alert)["']/,
    );
    expect(conversationSource).toContain("tabIndex={0}");
    expect(runtimeSources).not.toContain('minWidth: "var(--touch-target)"');
    expect(runtimeSources).not.toContain('minHeight: "var(--touch-target)"');

    expect(cssSource).toMatch(/overflow-anchor:\s*none/);
    expect(cssSource).toMatch(/min-inline-size:\s*0/);
    expect(cssSource).toMatch(/overflow-wrap:\s*anywhere/);
    expect(cssSource).toMatch(/@media\s*\(max-width:\s*480px\)[\s\S]*max-inline-size:\s*92%/);
    expect(cssSource).toMatch(/min-block-size:\s*var\(--touch-target\)/);
    expect(cssSource).toMatch(/min-inline-size:\s*var\(--touch-target\)/);
    expect(cssSource).toMatch(
      /box-shadow:\s*var\(\s*--astr-timeline-assistant-shadow,\s*none\s*\)/,
    );
    expect(cssSource).toMatch(
      /box-shadow:\s*var\(\s*--astr-timeline-return-shadow,\s*none\s*\)/,
    );
    expect(cssSource).not.toContain("var(--glow-her-1)");
    expect(cssSource).not.toContain("var(--shadow-2)");

    const phaseRule = cssSource.match(/\.phase[\s\S]*?\{([^}]*)\}/)?.[1];
    expect(phaseRule).toContain("color: var(--astr-text-2)");
    expect(phaseRule).toContain("font-size: var(--type-0)");
    expect(phaseRule).toContain("line-height: var(--leading-body)");
    expect(phaseRule).not.toContain("var(--astr-text-3)");
    expect(phaseRule).not.toContain("var(--type--1)");

    expect(cssSource).not.toMatch(/\b(?:d?vh)\b/i);
    expect(cssSource).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(cssSource).not.toMatch(/\b(?:green|lime|emerald|chartreuse)\b/i);
  });
});
