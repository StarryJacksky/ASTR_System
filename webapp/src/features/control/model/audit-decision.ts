export function auditDecisionColor(decision: string): string {
  if (decision === "deny") return "var(--astr-danger)";
  if (decision === "confirm") return "var(--astr-warning)";
  return "var(--astr-action)";
}
