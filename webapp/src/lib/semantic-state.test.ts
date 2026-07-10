import { describe, expect, it } from "vitest";

import {
  canAnimate,
  canCreateOrAdvanceTask,
  canSend,
  deriveProminentStatus,
  initialSemanticState,
  reduceSemanticState,
  type SemanticEvent,
  type SemanticState,
} from "./semantic-state";
import type {
  ConversationProjection,
  CoreStatus,
  CoreStatusProjection,
  IngestReceipt,
} from "./types";

describe("parallel semantic state", () => {
  it("starts each region from an explicit truthful baseline", () => {
    expect(initialSemanticState).toEqual({
      core: "cold",
      replySse: "closed",
      lifeSse: "closed",
      conversation: "empty",
      visualRuntime: "loading",
      visibility: "visible",
      motion: "full",
      safety: "normal",
      task: "none",
    });
  });

  it.each<{
    event: SemanticEvent;
    region: keyof SemanticState;
    value: SemanticState[keyof SemanticState];
  }>([
    { event: { type: "STATUS_OK" }, region: "core", value: "reachable" },
    { event: { type: "STATUS_FAIL" }, region: "core", value: "offline" },
    { event: { type: "INGEST_ACK" }, region: "conversation", value: "sending" },
    { event: { type: "INGEST_FAIL" }, region: "conversation", value: "error" },
    { event: { type: "REPLY_SSE_OPEN" }, region: "replySse", value: "open" },
    { event: { type: "REPLY_SSE_ERROR" }, region: "replySse", value: "retrying" },
    { event: { type: "LIFE_SSE_OPEN" }, region: "lifeSse", value: "open" },
    { event: { type: "LIFE_SSE_ERROR" }, region: "lifeSse", value: "retrying" },
    { event: { type: "STREAM_DELTA" }, region: "conversation", value: "streaming" },
    { event: { type: "STREAM_DONE" }, region: "conversation", value: "sending" },
    { event: { type: "SOUL_DECISION" }, region: "conversation", value: "final" },
    { event: { type: "WEBGL_READY" }, region: "visualRuntime", value: "ready" },
    { event: { type: "WEBGL_LOST" }, region: "visualRuntime", value: "contextLost" },
    { event: { type: "VISUAL_RETRY" }, region: "visualRuntime", value: "loading" },
    { event: { type: "REDUCE_ON" }, region: "motion", value: "reduced" },
    { event: { type: "REDUCE_OFF" }, region: "motion", value: "full" },
    { event: { type: "VISUAL_PAUSE" }, region: "motion", value: "paused" },
    { event: { type: "VISUAL_RESUME" }, region: "motion", value: "full" },
    { event: { type: "DOCUMENT_HIDDEN" }, region: "visibility", value: "hidden" },
    { event: { type: "DOCUMENT_VISIBLE" }, region: "visibility", value: "visible" },
    { event: { type: "ESTOP_REQUESTED" }, region: "safety", value: "stopRequested" },
    { event: { type: "ESTOP_ACK" }, region: "safety", value: "stoppedLatched" },
    { event: { type: "ESTOP_ACK_TIMEOUT" }, region: "safety", value: "stopUnknown" },
    { event: { type: "ESTOP_RESET_REQUESTED" }, region: "safety", value: "resetting" },
    { event: { type: "ESTOP_RESET_ACK" }, region: "safety", value: "normal" },
    {
      event: { type: "TASK_SNAPSHOT", task: "approvalRequired" },
      region: "task",
      value: "approvalRequired",
    },
    { event: { type: "TASK_EVENT", task: "running" }, region: "task", value: "running" },
  ])("handles $event.type without changing unrelated regions", ({ event, region, value }) => {
    const state = {
      ...initialSemanticState,
      core: "error",
      replySse: "connecting",
      lifeSse: "connecting",
      conversation: "idle",
      visualRuntime: "contextLost",
      visibility: "offscreen",
      motion: "paused",
      safety: "stopUnknown",
      task: "draft",
    } satisfies SemanticState;

    const next = reduceSemanticState(state, event);

    expect(next[region]).toBe(value);
    for (const key of Object.keys(state) as (keyof SemanticState)[]) {
      if (key !== region) expect(next[key]).toBe(state[key]);
    }
  });

  it("keeps conversation sending independent from device e-stop", () => {
    const stopped = {
      ...initialSemanticState,
      core: "reachable",
      safety: "stoppedLatched",
    } satisfies SemanticState;
    expect(canSend(stopped, { inputValid: true, isComposing: false })).toBe(true);
  });

  it("requires valid input, a reachable Core, and completed IME composition before sending", () => {
    const ready = { ...initialSemanticState, core: "reachable" } satisfies SemanticState;

    expect(canSend({ ...ready, core: "offline" }, { inputValid: true, isComposing: false })).toBe(
      false,
    );
    expect(canSend(ready, { inputValid: false, isComposing: false })).toBe(false);
    expect(canSend(ready, { inputValid: true, isComposing: true })).toBe(false);
  });

  it("requires the full visual conjunction before animation", () => {
    const ready = {
      ...initialSemanticState,
      visualRuntime: "ready",
      visibility: "visible",
      motion: "full",
    } satisfies SemanticState;
    expect(canAnimate(ready, true)).toBe(true);
    expect(canAnimate({ ...ready, motion: "paused" }, true)).toBe(false);
    expect(canAnimate({ ...ready, visibility: "hidden" }, true)).toBe(false);
    expect(canAnimate({ ...ready, visualRuntime: "contextLost" }, true)).toBe(false);
    expect(canAnimate(ready, false)).toBe(false);
  });

  it("fails closed for task side effects outside normal safety", () => {
    const state = {
      ...initialSemanticState,
      core: "reachable",
      safety: "stopUnknown",
    } satisfies SemanticState;
    expect(
      canCreateOrAdvanceTask(state, {
        authenticated: true,
        online: true,
        heartbeatFresh: true,
      }),
    ).toBe(false);
  });

  it.each([
    ["Core reachability", { core: "offline" }],
    ["authentication", { authenticated: false }],
    ["device connectivity", { online: false }],
    ["heartbeat freshness", { heartbeatFresh: false }],
  ] as const)("fails closed without %s evidence", (_label, unavailable) => {
    const state = {
      ...initialSemanticState,
      core: "reachable",
      safety: "normal",
    } satisfies SemanticState;
    const device = { authenticated: true, online: true, heartbeatFresh: true };

    if ("core" in unavailable) {
      expect(canCreateOrAdvanceTask({ ...state, ...unavailable }, device)).toBe(false);
    } else {
      expect(canCreateOrAdvanceTask(state, { ...device, ...unavailable })).toBe(false);
    }
  });

  it("allows task side effects only with the full positive evidence conjunction", () => {
    const state = {
      ...initialSemanticState,
      core: "reachable",
      safety: "normal",
    } satisfies SemanticState;

    expect(
      canCreateOrAdvanceTask(state, {
        authenticated: true,
        online: true,
        heartbeatFresh: true,
      }),
    ).toBe(true);
  });

  it("does not let visual context loss overwrite Core reachability", () => {
    const state = reduceSemanticState(
      { ...initialSemanticState, core: "reachable" },
      { type: "WEBGL_LOST" },
    );
    expect(state.core).toBe("reachable");
    expect(state.visualRuntime).toBe("contextLost");
  });

  it.each(["STREAM_DELTA", "STREAM_DONE"] as const)(
    "does not let late %s overwrite an authoritative decision",
    (type) => {
      const state = reduceSemanticState(
        { ...initialSemanticState, conversation: "final" },
        { type },
      );

      expect(state.conversation).toBe("final");
    },
  );

  it.each([
    [
      "safety",
      { safety: "stopUnknown", task: "approvalRequired", core: "offline" },
      "safety",
    ],
    ["approval", { task: "approvalRequired", conversation: "error" }, "approval"],
    ["terminal task outcome", { task: "terminal", core: "offline" }, "outcome"],
    ["blocking conversation error", { conversation: "error", core: "offline" }, "outcome"],
    ["Core", { core: "offline", replySse: "retrying" }, "core"],
    ["SSE", { replySse: "retrying", conversation: "streaming" }, "stream"],
    ["conversation", { conversation: "streaming" }, "conversation"],
    ["ready", {}, "ready"],
  ] as const)("derives %s at the specified prominence", (_label, patch, expected) => {
    const state = {
      ...initialSemanticState,
      core: "reachable",
      replySse: "open",
      lifeSse: "open",
      conversation: "idle",
      visualRuntime: "ready",
      ...patch,
    } satisfies SemanticState;

    expect(deriveProminentStatus(state)).toBe(expected);
  });

  it("keeps frontend projections limited to current authoritative sources", () => {
    const apiStatus = {
      soul_name: "justin",
      display_name: "露怀秋",
      local_llm_model: "local-model",
      cost_today_usd: 0,
      daily_budget_usd: 1,
      emotion: { loneliness: 0, talkativeness: 0, irritation: 0, excitement: 0 },
    } satisfies CoreStatus;
    const status = {
      internalHandle: apiStatus.soul_name,
      displayName: apiStatus.display_name,
      model: apiStatus.local_llm_model,
      costTodayUsd: apiStatus.cost_today_usd,
      dailyBudgetUsd: apiStatus.daily_budget_usd,
      emotion: apiStatus.emotion,
    } satisfies CoreStatusProjection;
    const receipt = { event_id: "evt_1", trace_id: "trc_1" } satisfies IngestReceipt;
    const conversation = {
      messages: [],
      receipt,
      provisionalText: "",
      provisionalActive: false,
      authoritativeDecision: null,
      error: null,
    } satisfies ConversationProjection;

    expect(status.internalHandle).toBe("justin");
    expect(conversation.receipt).toBe(receipt);
  });
});
