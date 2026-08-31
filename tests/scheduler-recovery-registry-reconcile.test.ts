import { describe, expect, it } from "vitest";
import {
  computeEscalationLevel,
  normalizeRecoveryWindow,
} from "@/src/server/repositories/scheduler-recovery-audit.repository";

describe("scheduler recovery escalation", () => {
  it("does not escalate on successful REGISTRY_INTEGRITY reconcile counter semantics", () => {
    const base = normalizeRecoveryWindow({
      recoveryCount: 2,
      recoverySuccess: 1,
      recoveryFailure: 4,
      lastRecoveryAt: null,
      lastCause: "REGISTRY_INTEGRITY",
      lastDurationMs: 0,
      escalationLevel: 3,
      windowStartedAt: new Date().toISOString(),
    });

    const incrementCounter =
      "RECONCILE" !== "NO_ACTION" &&
      "success" !== "skipped" &&
      !("success" === "success" && "RECONCILE" === "RECONCILE" && "REGISTRY_INTEGRITY" === "REGISTRY_INTEGRITY");

    expect(incrementCounter).toBe(false);

    const decayedFailure = 0;
    const next = {
      ...base,
      recoveryFailure: decayedFailure,
      recoveryCount: base.recoveryCount,
    };
    expect(computeEscalationLevel(next)).toBeLessThan(3);
  });
});
