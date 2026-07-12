import type {
  MotionState,
  VisibilityState,
  VisualRuntimeState,
} from "@/lib/semantic-state";

export const COMPACT_VISUAL_MAX_WIDTH = 768;

export type StaticVisualStatus =
  | "ssr"
  | "notConfigured"
  | "loading"
  | "ready"
  | "compact"
  | "reduced"
  | "paused"
  | "hidden"
  | "offscreen"
  | "contextLost"
  | "retryRequired"
  | "unavailable";

export type StaticVisualAnnouncement = "off" | "polite";
export type WebglAvailability = "unknown" | "available" | "unavailable";

export interface StaticVisualCopy {
  readonly label: string;
  readonly description: string;
  readonly retryLabel: "重试视觉" | null;
}

export interface StaticVisualState {
  readonly status: StaticVisualStatus;
  /** Allows a cold runtime import/start; false does not order an existing owner to unmount. */
  readonly dynamicEligible: boolean;
  /** True only when the current semantic facts permit the owned ticker to advance. */
  readonly animationAllowed: boolean;
  readonly retryAvailable: boolean;
  /** Advisory signal for the existing global announcer; never create a local aria-live region. */
  readonly announcement: StaticVisualAnnouncement;
  readonly copy: StaticVisualCopy;
}

export interface StaticVisualServerInput {
  readonly renderEnvironment: "server";
}

export interface StaticVisualBrowserInput {
  readonly renderEnvironment: "browser";
  readonly sceneConfigured: boolean;
  readonly viewportWidth: number;
  /** A capability fact, not a Host-side getContext probe. Unknown lets the sole runtime try. */
  readonly webglAvailability: WebglAvailability;
  readonly visibility: VisibilityState;
  readonly motion: MotionState;
  readonly visualRuntime: VisualRuntimeState;
  readonly retryRequired: boolean;
}

export type StaticVisualInput = StaticVisualServerInput | StaticVisualBrowserInput;

const states = {
  ssr: createState({
    status: "ssr",
    label: "星枢灵魂透镜",
    description: "静态灵魂透镜已就绪。",
  }),
  notConfigured: createState({
    status: "notConfigured",
    label: "星枢灵魂透镜（静态）",
    description: "动态视觉场尚未接入，当前显示静态代表帧。",
  }),
  loading: createState({
    status: "loading",
    dynamicEligible: true,
    announcement: "polite",
    label: "星枢灵魂透镜正在准备",
    description: "视觉场正在载入，当前显示静态代表帧。",
  }),
  ready: createState({
    status: "ready",
    dynamicEligible: true,
    animationAllowed: true,
    label: "星枢灵魂透镜已就绪",
    description: "动态视觉场已就绪。",
  }),
  compact: createState({
    status: "compact",
    label: "星枢灵魂透镜（静态）",
    description: "紧凑屏幕使用静态代表帧。",
  }),
  reduced: createState({
    status: "reduced",
    label: "星枢灵魂透镜（减少动态）",
    description: "已按系统偏好减少视觉动态。",
  }),
  paused: createState({
    status: "paused",
    label: "星枢灵魂透镜（已暂停）",
    description: "视觉动态已暂停。",
  }),
  hidden: createState({
    status: "hidden",
    label: "星枢灵魂透镜（静态）",
    description: "页面不可见，视觉动态已停止。",
  }),
  offscreen: createState({
    status: "offscreen",
    label: "星枢灵魂透镜（静态）",
    description: "灵魂透镜不在视口内，视觉动态已停止。",
  }),
  contextLost: createState({
    status: "contextLost",
    announcement: "polite",
    label: "星枢灵魂透镜暂时不可用",
    description: "动态视觉连接已中断，当前显示静态代表帧。",
  }),
  retryRequired: createState({
    status: "retryRequired",
    retryAvailable: true,
    announcement: "polite",
    label: "星枢灵魂透镜需要重试",
    description: "动态视觉恢复失败，当前显示静态代表帧。",
    retryLabel: "重试视觉",
  }),
  unavailable: createState({
    status: "unavailable",
    label: "星枢灵魂透镜（静态）",
    description: "此环境无法启用动态视觉，当前显示静态代表帧。",
  }),
} satisfies Readonly<Record<StaticVisualStatus, StaticVisualState>>;

const retryBlockedState = createState({
  status: "retryRequired",
  announcement: "polite",
  label: "星枢灵魂透镜需要重试",
  description: "动态视觉恢复失败；当前环境暂不允许重试，仍显示静态代表帧。",
});

/**
 * Derives visual eligibility only from explicit facts supplied by the caller.
 * It deliberately performs no DOM or timer reads so SSR and hydration share the
 * same fail-closed contract.
 */
export function deriveStaticVisualState(
  input: StaticVisualInput | null | undefined,
): StaticVisualState {
  if (!isRecord(input)) return states.unavailable;
  if (input.renderEnvironment === "server") return states.ssr;
  if (!isValidBrowserInput(input)) return states.unavailable;
  if (!input.sceneConfigured) return states.notConfigured;

  if (input.retryRequired) {
    return canAttemptDynamic(input) ? states.retryRequired : retryBlockedState;
  }
  if (input.visualRuntime === "contextLost") return states.contextLost;
  if (input.webglAvailability === "unavailable") return states.unavailable;
  if (input.visibility === "hidden") return states.hidden;
  if (input.visibility === "offscreen") return states.offscreen;
  if (input.motion === "reduced") return states.reduced;
  if (input.motion === "paused") return states.paused;
  if (input.viewportWidth <= COMPACT_VISUAL_MAX_WIDTH) return states.compact;
  return input.visualRuntime === "loading" ? states.loading : states.ready;
}

interface CreateStateInput {
  readonly status: StaticVisualStatus;
  readonly dynamicEligible?: boolean;
  readonly animationAllowed?: boolean;
  readonly retryAvailable?: boolean;
  readonly announcement?: StaticVisualAnnouncement;
  readonly label: string;
  readonly description: string;
  readonly retryLabel?: "重试视觉" | null;
}

function createState({
  status,
  dynamicEligible = false,
  animationAllowed = false,
  retryAvailable = false,
  announcement = "off",
  label,
  description,
  retryLabel = null,
}: CreateStateInput): StaticVisualState {
  const copy = Object.freeze({ label, description, retryLabel });
  return Object.freeze({
    status,
    dynamicEligible,
    animationAllowed,
    retryAvailable,
    announcement,
    copy,
  });
}

function isValidBrowserInput(input: unknown): input is StaticVisualBrowserInput {
  return (
    isRecord(input) &&
    input.renderEnvironment === "browser" &&
    typeof input.sceneConfigured === "boolean" &&
    typeof input.viewportWidth === "number" &&
    Number.isFinite(input.viewportWidth) &&
    input.viewportWidth >= 0 &&
    isWebglAvailability(input.webglAvailability) &&
    isVisibility(input.visibility) &&
    isMotion(input.motion) &&
    isVisualRuntime(input.visualRuntime) &&
    typeof input.retryRequired === "boolean"
  );
}

function canAttemptDynamic(input: StaticVisualBrowserInput): boolean {
  return (
    input.webglAvailability !== "unavailable" &&
    input.visibility === "visible" &&
    input.motion === "full" &&
    input.viewportWidth > COMPACT_VISUAL_MAX_WIDTH
  );
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

function isVisibility(value: unknown): value is VisibilityState {
  return value === "visible" || value === "hidden" || value === "offscreen";
}

function isMotion(value: unknown): value is MotionState {
  return value === "full" || value === "reduced" || value === "paused";
}

function isVisualRuntime(value: unknown): value is VisualRuntimeState {
  return value === "loading" || value === "ready" || value === "contextLost";
}

function isWebglAvailability(value: unknown): value is WebglAvailability {
  return value === "unknown" || value === "available" || value === "unavailable";
}
