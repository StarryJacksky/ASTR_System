import { describe, expect, it } from "vitest";

import { auditDecisionColor } from "./audit-decision";

describe("Control audit decision semantics", () => {
  it.each([
    ["deny", "var(--astr-danger)"],
    ["confirm", "var(--astr-warning)"],
    ["allow", "var(--astr-action)"],
    ["complete", "var(--astr-action)"],
  ])("maps %s without using a green success role", (decision, expected) => {
    expect(auditDecisionColor(decision)).toBe(expected);
  });
});
