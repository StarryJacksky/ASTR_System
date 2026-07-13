export interface MobileLocalStatusProjection {
  readonly stopped: boolean;
  readonly pending_count: number;
  readonly audit_tail_count: number;
}

export interface MobileLocalPolicyProjection {
  readonly approval_mode: "ask" | "audited" | "auto";
  readonly headless_scope: "cwd" | "folders" | "full";
  readonly max_steps_per_task: number;
}

export interface MobileLocalAuditProjection {
  readonly audit_date: string | null;
  readonly audit_total: number | null;
  readonly chain_valid: boolean | null;
}

export interface MobileSafetyClient {
  readonly status: (signal?: AbortSignal) => Promise<MobileLocalStatusProjection>;
  readonly policy: (signal?: AbortSignal) => Promise<MobileLocalPolicyProjection>;
  readonly audit: (signal?: AbortSignal) => Promise<MobileLocalAuditProjection>;
}
