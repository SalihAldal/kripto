import { describe, expect, it } from "vitest";
import {
  classifyRoundTerminalOutcome,
  resolveReportFailReason,
} from "@/src/server/execution/round-terminal-outcome.service";

describe("round terminal outcome", () => {
  it("classifies handoff invalid separately from no eligible candidate", () => {
    const handoff = classifyRoundTerminalOutcome({
      reason: "HANDOFF_CANDIDATE_STALE: last update old",
      symbol: "ARBTRY",
    });
    expect(handoff.outcome).toBe("handoff_invalid");
    expect(handoff.runtimeStep).toBe("HANDOFF_REJECTED");

    const none = classifyRoundTerminalOutcome({
      reason: "NO_ELIGIBLE_CANDIDATE",
      symbol: null,
    });
    expect(none.outcome).toBe("no_eligible_candidate");
  });

  it("classifies symbol-selected AI failure separately", () => {
    const ai = classifyRoundTerminalOutcome({
      reason: "HANDOFF_AI_CONSENSUS_MISSING",
      symbol: "ARBTRY",
    });
    expect(ai.outcome).toBe("ai_missing");
    expect(ai.stage).toBe("ai_evaluation");
  });

  it("resolveReportFailReason prefers failReason then terminalReason", () => {
    expect(
      resolveReportFailReason({
        failReason: null,
        terminalReason: "selection:NO_ELIGIBLE_CANDIDATE:x",
        closeReason: "VALID_NO_CANDIDATE",
        runtimeStep: "NO_CANDIDATE",
        state: "tur_tamamlandi",
      }),
    ).toContain("NO_ELIGIBLE");
  });

  it("incomplete round is not categorized as unknown", () => {
    const outcome = classifyRoundTerminalOutcome({
      reason: "deadline",
      incomplete: true,
    });
    expect(outcome.outcome).toBe("round_incomplete");
  });
});
