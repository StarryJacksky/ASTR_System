export type StudioProjectionId =
  | "workspace"
  | "run"
  | "tool"
  | "trace"
  | "source"
  | "artifact";

export type StudioProjectionLabel =
  | "Workspace"
  | "Run"
  | "Tool"
  | "Trace"
  | "Source"
  | "Artifact";

export interface StudioProjectionTaxonomyEntry {
  readonly id: StudioProjectionId;
  readonly label: StudioProjectionLabel;
  readonly purpose: string;
  readonly state: "unavailable";
}

function defineStudioProjection<const T extends StudioProjectionTaxonomyEntry>(
  projection: T,
): Readonly<T> {
  return Object.freeze(projection);
}

const projections = [
  defineStudioProjection({
    id: "workspace",
    label: "Workspace",
    purpose: "未来工作空间证据类型",
    state: "unavailable",
  }),
  defineStudioProjection({
    id: "run",
    label: "Run",
    purpose: "未来运行证据类型",
    state: "unavailable",
  }),
  defineStudioProjection({
    id: "tool",
    label: "Tool",
    purpose: "未来工具证据类型",
    state: "unavailable",
  }),
  defineStudioProjection({
    id: "trace",
    label: "Trace",
    purpose: "未来轨迹证据类型",
    state: "unavailable",
  }),
  defineStudioProjection({
    id: "source",
    label: "Source",
    purpose: "未来来源证据类型",
    state: "unavailable",
  }),
  defineStudioProjection({
    id: "artifact",
    label: "Artifact",
    purpose: "未来产物证据类型",
    state: "unavailable",
  }),
] as const satisfies readonly StudioProjectionTaxonomyEntry[];

export const STUDIO_PROJECTIONS = Object.freeze(projections);
