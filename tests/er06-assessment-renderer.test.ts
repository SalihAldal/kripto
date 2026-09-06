import { describe, expect, it } from "vitest";
import { evaluateRecoveryAssessment, type AssessmentCheck } from "@/src/server/forensics/er01-telemetry-verdict";

describe("ER06 assessment renderer contract", () => {
  it("keeps fail-closed NO_GO when any required check is blocked", () => {
    const checks: AssessmentCheck[] = [
      {
        checkId: "typecheck",
        required: true,
        status: "PASS",
        evidenceSource: "tsc",
        inspectedHead: "head-1",
        inspectedWorktreeFingerprint: "dirty-1",
      },
      {
        checkId: "db-persistence",
        required: true,
        status: "BLOCKED",
        evidenceSource: "vitest",
        inspectedHead: "head-1",
        inspectedWorktreeFingerprint: "dirty-1",
      },
    ];
    const out = evaluateRecoveryAssessment(checks);
    expect(out.phase1Verdict).toBe("PARTIAL");
    expect(out.nextPaperPreflight).toBe("NO_GO");
    expect(out.profitabilityEvidence).toBe("NOT_EVALUATED");
  });
});
