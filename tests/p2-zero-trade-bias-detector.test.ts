import { describe, expect, it } from "vitest";
import { evaluateZeroTradeBias } from "@/src/server/execution/zero-trade-bias-detector";

describe("P2 zero-trade bias detector", () => {
  it("fails when strong fixtures exist but no paper opens", () => {
    const result = evaluateZeroTradeBias({
      strongPositiveFixtures: 4,
      totalMarketSequences: 12,
      discovered: 12,
      watching: 10,
      hot: 9,
      microAnalyzed: 8,
      microConfirmed: 6,
      executionReady: 4,
      entryEnter: 2,
      entryWait: 2,
      entryReject: 0,
      riskAllowed: 2,
      riskRejected: 0,
      executionAllowed: 2,
      executionRejected: 0,
      paperOpened: 0,
      paperClosed: 0,
      firstBlockerDistribution: { UNKNOWN: 1, ENTRY_QUALITY: 2 },
    });
    expect(result.status).toBe("FAIL");
    expect(result.firstLossStage).toBe("PERSISTENCE");
  });

  it("passes when pipeline reaches paper open", () => {
    const result = evaluateZeroTradeBias({
      strongPositiveFixtures: 4,
      totalMarketSequences: 12,
      discovered: 12,
      watching: 10,
      hot: 9,
      microAnalyzed: 8,
      microConfirmed: 6,
      executionReady: 4,
      entryEnter: 3,
      entryWait: 1,
      entryReject: 0,
      riskAllowed: 3,
      riskRejected: 0,
      executionAllowed: 3,
      executionRejected: 0,
      paperOpened: 2,
      paperClosed: 2,
      firstBlockerDistribution: { ENTRY_QUALITY: 1 },
    });
    expect(result.status).toBe("PASS");
    expect(result.unknownBlockerCount).toBe(0);
  });
});
