export type RuntimeMetricName =
  | "app-raf"
  | "webgl-context"
  | "draw-calls"
  | "gpu-memory-mib"
  | "decoded-texture-mib";

export interface RuntimeMetric {
  name: RuntimeMetricName;
  value: number;
  at: number;
}

const MAX_RUNTIME_METRICS = 100;
const runtimeMetrics: RuntimeMetric[] = [];

export function recordRuntimeMetric(name: RuntimeMetricName, value: number, at?: number): void {
  const recordedAt = at ?? performance.now();
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(recordedAt) || recordedAt < 0) {
    return;
  }

  runtimeMetrics.push(Object.freeze({ name, value, at: recordedAt }));
  if (runtimeMetrics.length > MAX_RUNTIME_METRICS) {
    runtimeMetrics.splice(0, runtimeMetrics.length - MAX_RUNTIME_METRICS);
  }
}

export function readRuntimeMetrics(): readonly RuntimeMetric[] {
  return Object.freeze(runtimeMetrics.map((metric) => Object.freeze({ ...metric })));
}

export function clearRuntimeMetrics(): void {
  runtimeMetrics.length = 0;
}
