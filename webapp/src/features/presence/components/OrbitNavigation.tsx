"use client";

import styles from "./OrbitNavigation.module.css";

export const DESKTOP_ORBIT_PATH = "M 48 50 C 336 4 364 136 222 178 C 70 222 80 358 354 338";
export const COMPACT_ORBIT_PATH = "M 54 34 C 304 10 344 112 216 158 C 82 206 92 338 344 350";

export type PresenceOrbitEndpoint = "soul" | "dialogue" | "life" | "task";
type AvailableOrbitEndpoint = Exclude<PresenceOrbitEndpoint, "task">;

export interface OrbitNavigationProps {
  readonly activeEndpoint: PresenceOrbitEndpoint;
  readonly onNavigate: (endpoint: AvailableOrbitEndpoint) => void;
}

const CURRENT_ENDPOINT_COPY: Readonly<Record<AvailableOrbitEndpoint, string>> = {
  soul: "Soul",
  dialogue: "对话",
  life: "Life",
};

const AVAILABLE_ENDPOINTS: readonly {
  readonly id: AvailableOrbitEndpoint;
  readonly label: string;
  readonly accessibleLabel: string;
}[] = [
  { id: "soul", label: "Soul", accessibleLabel: "前往 Soul" },
  { id: "dialogue", label: "对话", accessibleLabel: "前往对话" },
  { id: "life", label: "Life", accessibleLabel: "前往 Life" },
];

export function OrbitNavigation({ activeEndpoint, onNavigate }: OrbitNavigationProps) {
  return (
    <nav aria-label="Presence 引力轨道" className={styles.orbitNavigation}>
      <svg
        aria-hidden="true"
        className={styles.orbitGraphic}
        focusable="false"
        preserveAspectRatio="none"
        viewBox="0 0 400 380"
      >
        <path
          className={styles.desktopPath}
          d={DESKTOP_ORBIT_PATH}
          data-orbit-path="desktop"
          pathLength="1"
        />
        <path
          className={styles.compactPath}
          d={COMPACT_ORBIT_PATH}
          data-orbit-path="compact"
          pathLength="1"
        />
      </svg>

      <p className={styles.currentEndpoint}>
        {activeEndpoint === "task"
          ? "Task 能力边界：远程任务尚未启用"
          : `当前轨道端点：${CURRENT_ENDPOINT_COPY[activeEndpoint]}`}
      </p>

      <ol className={styles.endpointList}>
        {AVAILABLE_ENDPOINTS.map((endpoint) => (
          <li
            className={styles.endpoint}
            data-orbit-endpoint={endpoint.id}
            key={endpoint.id}
          >
            <button
              aria-current={activeEndpoint === endpoint.id ? "page" : undefined}
              aria-label={endpoint.accessibleLabel}
              className={styles.endpointAction}
              onClick={() => onNavigate(endpoint.id)}
              type="button"
            >
              <span className={styles.endpointLabel}>{endpoint.label}</span>
            </button>
          </li>
        ))}
        <li
          className={styles.endpoint}
          data-orbit-endpoint="task"
        >
          <div
            aria-disabled="true"
            aria-label="Task 能力"
            className={styles.taskBoundary}
            role="group"
          >
            <span className={styles.taskCopy}>
              <span className={styles.endpointLabel}>Task</span>
              <span>远程任务尚未启用</span>
            </span>
          </div>
        </li>
      </ol>
    </nav>
  );
}
