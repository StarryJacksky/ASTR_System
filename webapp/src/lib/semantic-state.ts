export type CoreState = "cold" | "loading" | "reachable" | "offline" | "error";
export type StreamState = "connecting" | "open" | "retrying" | "closed";
export type ConversationState = "empty" | "idle" | "sending" | "streaming" | "final" | "error";
export type VisualRuntimeState = "loading" | "ready" | "contextLost";
export type VisibilityState = "visible" | "hidden" | "offscreen";
export type MotionState = "full" | "reduced" | "paused";
export type SafetyState =
  | "normal"
  | "stopRequested"
  | "stopUnknown"
  | "stoppedLatched"
  | "resetting";
export type TaskState =
  | "none"
  | "draft"
  | "queued"
  | "planning"
  | "approvalRequired"
  | "running"
  | "terminal";

export interface SemanticState {
  core: CoreState;
  replySse: StreamState;
  lifeSse: StreamState;
  conversation: ConversationState;
  visualRuntime: VisualRuntimeState;
  visibility: VisibilityState;
  motion: MotionState;
  safety: SafetyState;
  task: TaskState;
}

export const initialSemanticState: SemanticState = {
  core: "cold",
  replySse: "closed",
  lifeSse: "closed",
  conversation: "empty",
  visualRuntime: "loading",
  visibility: "visible",
  motion: "full",
  safety: "normal",
  task: "none",
};

export type SemanticEvent =
  | { type: "STATUS_LOADING" }
  | { type: "STATUS_OK" }
  | { type: "STATUS_FAIL" }
  | { type: "INGEST_STARTED" }
  | { type: "INGEST_ACK" }
  | { type: "INGEST_FAIL" }
  | { type: "REPLY_TIMEOUT" }
  | { type: "REPLY_SSE_CONNECTING" }
  | { type: "REPLY_SSE_OPEN" }
  | { type: "REPLY_SSE_ERROR" }
  | { type: "REPLY_SSE_CLOSED" }
  | { type: "LIFE_SSE_CONNECTING" }
  | { type: "LIFE_SSE_OPEN" }
  | { type: "LIFE_SSE_ERROR" }
  | { type: "LIFE_SSE_CLOSED" }
  | { type: "STREAM_DELTA" }
  | { type: "STREAM_DONE" }
  | { type: "SOUL_DECISION" }
  | { type: "WEBGL_READY" }
  | { type: "WEBGL_LOST" }
  | { type: "VISUAL_RETRY" }
  | { type: "REDUCE_ON" }
  | { type: "REDUCE_OFF" }
  | { type: "VISUAL_PAUSE" }
  | { type: "VISUAL_RESUME" }
  | { type: "DOCUMENT_HIDDEN" }
  | { type: "DOCUMENT_VISIBLE" }
  | { type: "ESTOP_REQUESTED" }
  | { type: "ESTOP_ACK" }
  | { type: "ESTOP_ACK_TIMEOUT" }
  | { type: "ESTOP_RESET_REQUESTED" }
  | { type: "ESTOP_RESET_ACK" }
  | { type: "ESTOP_STATUS_CHECK" }
  | { type: "ESTOP_STATUS_CLEAR" }
  | { type: "ESTOP_STATUS_LATCHED" }
  | { type: "TASK_SNAPSHOT"; task: TaskState }
  | { type: "TASK_EVENT"; task: TaskState };

export function assertNever(value: never): never {
  throw new Error(`Unhandled semantic event: ${JSON.stringify(value)}`);
}

export function reduceSemanticState(state: SemanticState, event: SemanticEvent): SemanticState {
  switch (event.type) {
    case "STATUS_LOADING":
      return { ...state, core: "loading" };
    case "STATUS_OK":
      return { ...state, core: "reachable" };
    case "STATUS_FAIL":
      return { ...state, core: "offline" };
    case "INGEST_STARTED":
      return { ...state, conversation: "sending" };
    case "INGEST_ACK":
      return { ...state, conversation: "sending" };
    case "INGEST_FAIL":
    case "REPLY_TIMEOUT":
      return { ...state, conversation: "error" };
    case "REPLY_SSE_CONNECTING":
      return { ...state, replySse: "connecting" };
    case "REPLY_SSE_OPEN":
      return { ...state, replySse: "open" };
    case "REPLY_SSE_ERROR":
      return { ...state, replySse: "retrying" };
    case "REPLY_SSE_CLOSED":
      return { ...state, replySse: "closed" };
    case "LIFE_SSE_CONNECTING":
      return { ...state, lifeSse: "connecting" };
    case "LIFE_SSE_OPEN":
      return { ...state, lifeSse: "open" };
    case "LIFE_SSE_ERROR":
      return { ...state, lifeSse: "retrying" };
    case "LIFE_SSE_CLOSED":
      return { ...state, lifeSse: "closed" };
    case "STREAM_DELTA":
      return state.conversation === "final" ? state : { ...state, conversation: "streaming" };
    case "STREAM_DONE":
      return state.conversation === "final" ? state : { ...state, conversation: "sending" };
    case "SOUL_DECISION":
      return { ...state, conversation: "final" };
    case "WEBGL_READY":
      return { ...state, visualRuntime: "ready" };
    case "WEBGL_LOST":
      return { ...state, visualRuntime: "contextLost" };
    case "VISUAL_RETRY":
      return { ...state, visualRuntime: "loading" };
    case "REDUCE_ON":
      return { ...state, motion: "reduced" };
    case "REDUCE_OFF":
      return { ...state, motion: "full" };
    case "VISUAL_PAUSE":
      return { ...state, motion: "paused" };
    case "VISUAL_RESUME":
      return { ...state, motion: "full" };
    case "DOCUMENT_HIDDEN":
      return { ...state, visibility: "hidden" };
    case "DOCUMENT_VISIBLE":
      return { ...state, visibility: "visible" };
    case "ESTOP_REQUESTED":
      return { ...state, safety: "stopRequested" };
    case "ESTOP_ACK":
      return { ...state, safety: "stoppedLatched" };
    case "ESTOP_ACK_TIMEOUT":
      return { ...state, safety: "stopUnknown" };
    case "ESTOP_RESET_REQUESTED":
      return { ...state, safety: "resetting" };
    case "ESTOP_RESET_ACK":
      return { ...state, safety: "normal" };
    case "ESTOP_STATUS_CHECK":
      return { ...state, safety: "stopUnknown" };
    case "ESTOP_STATUS_CLEAR":
      return { ...state, safety: "normal" };
    case "ESTOP_STATUS_LATCHED":
      return { ...state, safety: "stoppedLatched" };
    case "TASK_SNAPSHOT":
    case "TASK_EVENT":
      return { ...state, task: event.task };
    default:
      return assertNever(event);
  }
}

export function canSend(
  state: SemanticState,
  input: { inputValid: boolean; isComposing: boolean },
): boolean {
  return state.core === "reachable" && input.inputValid && !input.isComposing;
}

export function canAnimate(state: SemanticState, ownsLease: boolean): boolean {
  return (
    state.visualRuntime === "ready" &&
    state.visibility === "visible" &&
    state.motion === "full" &&
    ownsLease
  );
}

/**
 * Preliminary UI discoverability only. This must never authorize a Task side effect:
 * it cannot prove a device session, stop_epoch, or policy revision. W5 owns that guard.
 */
export function canShowTaskAdvanceEntry(
  state: SemanticState,
  connectivityHints: { authenticated: boolean; online: boolean; heartbeatFresh: boolean },
): boolean {
  return (
    state.core === "reachable" &&
    state.safety === "normal" &&
    connectivityHints.authenticated &&
    connectivityHints.online &&
    connectivityHints.heartbeatFresh
  );
}

export function deriveProminentStatus(
  state: SemanticState,
): "safety" | "approval" | "outcome" | "core" | "stream" | "conversation" | "ready" {
  if (state.safety !== "normal") return "safety";
  if (state.task === "approvalRequired") return "approval";
  if (state.task === "terminal" || state.core === "error" || state.conversation === "error") {
    return "outcome";
  }
  if (state.core !== "reachable") return "core";
  if (state.replySse !== "open" || state.lifeSse !== "open") return "stream";
  if (state.conversation === "sending" || state.conversation === "streaming") {
    return "conversation";
  }
  return "ready";
}
