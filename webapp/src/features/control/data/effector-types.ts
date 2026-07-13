export interface EffectorPolicy {
  readonly approval_mode: "ask" | "audited" | "auto";
  readonly headless_scope: "cwd" | "folders" | "full";
  readonly headless_cwd: string;
  readonly headless_folders: readonly string[];
  readonly app_whitelist: readonly string[];
  readonly login_sites_whitelist: readonly string[];
  readonly dangerous_categories: readonly string[];
  readonly dangerous_keywords: readonly string[];
  readonly max_steps_per_task: number;
  readonly sandbox_dir: string;
  readonly core_dangerous_categories: readonly string[];
  readonly core_dangerous_keywords: readonly string[];
  readonly locked: readonly string[];
  readonly overlay_path: string;
}

export type PolicyPatch = Partial<
  Pick<
    EffectorPolicy,
    | "approval_mode"
    | "headless_scope"
    | "headless_cwd"
    | "headless_folders"
    | "app_whitelist"
    | "login_sites_whitelist"
    | "dangerous_categories"
    | "dangerous_keywords"
    | "max_steps_per_task"
  >
>;

export interface EffectorAuditEntry {
  readonly [key: string]: unknown;
  readonly ts: string;
  readonly trace_id: string;
  readonly track: string;
  readonly description: string;
  readonly decision: string;
  readonly dangerous: boolean;
}

export interface EffectorAudit {
  readonly dates: readonly string[];
  readonly date: string | null;
  readonly entries: readonly EffectorAuditEntry[];
  readonly total?: number;
  readonly chain_valid: boolean | null;
}

export interface EffectorStatus {
  readonly stopped: boolean;
  readonly pending: Readonly<Record<string, unknown>>;
  readonly audit_tail: readonly Readonly<Record<string, unknown>>[];
}

export interface EffectorStopResult {
  readonly stopped: boolean;
}

export interface EffectorClient {
  readonly policy: (signal?: AbortSignal) => Promise<EffectorPolicy>;
  readonly patchPolicy: (patch: PolicyPatch, signal?: AbortSignal) => Promise<EffectorPolicy>;
  readonly audit: (
    date?: string,
    limit?: number,
    signal?: AbortSignal,
  ) => Promise<EffectorAudit>;
  readonly status: (signal?: AbortSignal) => Promise<EffectorStatus>;
  readonly estop: (signal?: AbortSignal) => Promise<EffectorStopResult>;
  readonly reset: (signal?: AbortSignal) => Promise<EffectorStopResult>;
}
