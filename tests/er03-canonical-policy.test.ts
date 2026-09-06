import { describe, expect, it } from "vitest";
import {
  resolveCanonicalAdmissionVerdict,
  resolveExecutionAuthorization,
  sortCanonicalBlockers,
} from "@/src/server/execution/er03-canonical-policy";
import { evaluatePreSubmitExecution } from "@/src/server/execution/execution-intelligence.service";

describe("ER03 canonical policy", () => {
  it("keeps canonical blocker priority deterministic", () => {
    const sorted = sortCanonicalBlockers([
      { code: "SMART_ENTRY_REJECT" },
      { code: "NO_ELIGIBLE_STRATEGY" },
      { code: "QUALITY_GATE_REJECT" },
    ]);
    expect(sorted.map((row) => row.code)).toEqual([
      "NO_ELIGIBLE_STRATEGY",
      "QUALITY_GATE_REJECT",
      "SMART_ENTRY_REJECT",
    ]);
  });

  it("maps first blocker to WAIT or REJECT deterministically", () => {
    expect(resolveCanonicalAdmissionVerdict([])).toBe("ENTER");
    expect(resolveCanonicalAdmissionVerdict(["NO_ELIGIBLE_STRATEGY"])).toBe("WAIT");
    expect(resolveCanonicalAdmissionVerdict(["SMART_ENTRY_REJECT"])).toBe("REJECT");
  });

  it("separates paper authorization from live execution lock", () => {
    expect(
      resolveExecutionAuthorization({
        mode: "paper",
        strategyActivation: "PAPER_ELIGIBLE",
      }),
    ).toBe("PAPER_ELIGIBLE");
    expect(
      resolveExecutionAuthorization({
        mode: "paper",
        strategyActivation: "SHADOW_ONLY",
      }),
    ).toBe("SHADOW_ONLY");
    expect(
      resolveExecutionAuthorization({
        mode: "live",
        strategyActivation: "PAPER_ELIGIBLE",
      }),
    ).toBe("LIVE_DISABLED");
  });

  it("does not bypass pre-submit safety on paper mode inputs", () => {
    const blocked = evaluatePreSubmitExecution({
      side: "BUY",
      notional: 1000,
      bidDepth: 0,
      askDepth: 0,
      spreadPercent: 0.05,
      liquidityScore: 0.8,
      orderType: "MARKET",
      marketRegime: "RANGE_SIDEWAYS",
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain("depth unavailable");
  });
});
