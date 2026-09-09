import { describe, expect, it } from "vitest";
import { buildRiskReference } from "@/src/server/profitability/pr04-structural-stop";
import { buildExitPnlSnapshot } from "@/src/server/profitability/pr04-pnl-accounting";
import type { ExitPolicyState } from "@/src/server/profitability/pr04-types";
import { classifyPaperCampaign } from "@/src/server/trade-decision-core/paper-readiness-status.service";
function state() {
  return { entryFills: [{ price: 100, quantity: 2, fee: 2, atMs: 1 }], riskReference: { entryPrice: 100 }, remainingQuantity: 1.5,
    exitFills: [{ price: 110, quantity: .5, fee: .1, feeAsset: "QUOTE", filledAtMs: 2, fillId: "exit-1", side: "SELL", decisionKind: "PARTIAL_TAKE_PROFIT" }] } as unknown as ExitPolicyState;
}
describe("PR04 fee accounting and risk", () => {
  it("entry fees increase rather than decrease the loss at a structural stop", () => {
    const risk = buildRiskReference({ entryPrice: 100, initialStopPrice: 95, initialQuantity: 2, entryFee: 2, includesFeesInBreakEven: true, computedAtMs: 0 });
    expect(risk.initialRiskPerUnit).toBe(6); expect(risk.initialRiskNotional).toBe(12);
    expect(buildRiskReference({ entryPrice: 100, initialStopPrice: 95, initialQuantity: 0, entryFee: 2, includesFeesInBreakEven: true, computedAtMs: 0 }).quality).toBe("INSUFFICIENT_DATA");
  });
  it("allocates entry fees across partial realized and marked open PnL exactly once", () => {
    const s = state(), pnl = buildExitPnlSnapshot({ state: s, markPrice: 105, side: "LONG" });
    expect(pnl.realizedEntryFees).toBe(.5); expect(pnl.remainingEntryFees).toBe(1.5);
    expect(pnl.realizedNetPnl).toBeCloseTo(4.4); expect(pnl.unrealizedNetPnl).toBeCloseTo(6);
    const cashAndMarkPnl = -202 + 55 - .1 + 1.5 * 105;
    expect(pnl.realizedNetPnl! + pnl.unrealizedNetPnl!).toBeCloseTo(cashAndMarkPnl, 8);
    s.exitFills.push({ ...s.exitFills[0], price: 105, quantity: 1.5, fee: .3, filledAtMs: 3 }); s.remainingQuantity = 0;
    const closed = buildExitPnlSnapshot({ state: s, markPrice: 105, side: "LONG" });
    expect(closed.realizedEntryFees).toBe(2); expect(closed.remainingEntryFees).toBe(0); expect(closed.realizedNetPnl).toBeCloseTo(10.1);
  });
  it("keeps non-quote fee PnL unknown until canonical normalization", () => {
    const s = state(); s.exitFills[0].feeAsset = "BASE";
    const pnl = buildExitPnlSnapshot({ state: s, markPrice: 105, side: "LONG" });
    expect(pnl.realizedNetPnl).toBeNull(); expect(pnl.status).toBe("UNKNOWN");
    expect(pnl.reasonCodes).toContain("BASE_FEE_REQUIRES_SETTLEMENT_NORMALIZATION");
    expect(s.remainingQuantity).toBe(1.5);
  });
  it("charges known entry fees on a fully open position and rejects invalid fee evidence", () => {
    const s = state(); s.exitFills = []; s.remainingQuantity = 2;
    expect(buildExitPnlSnapshot({ state: s, markPrice: 100, side: "LONG" }).unrealizedNetPnl).toBe(-2);
    s.entryFills[0].fee = NaN;
    expect(buildExitPnlSnapshot({ state: s, markPrice: 100, side: "LONG" }).unrealizedNetPnl).toBeNull();
  });
  it("keeps paper preflight blocks and incomplete runs distinct from completed activity", () => {
    expect(classifyPaperCampaign({ phase: "PREFLIGHT_BLOCKED" })).toBe("PREFLIGHT_BLOCKED");
    expect(classifyPaperCampaign({ phase: "START_FAILED" })).toBe("START_FAILED");
    const done = { executionMode: "paper", liveTradingEnabled: "false", reachedTerminal: true, completedFullDuration: true, tradeCount: 0, openPositionCount: 0 };
    expect(classifyPaperCampaign(done)).toBe("COMPLETED_NO_TRADES");
    expect(classifyPaperCampaign({ ...done, tradeCount: 1 })).toBe("COMPLETED_WITH_ACTIVITY_NOT_PROFITABILITY_PROOF");
    expect(classifyPaperCampaign({ ...done, reachedTerminal: false })).toBe("INCOMPLETE_CAMPAIGN");
    expect(classifyPaperCampaign({ ...done, executionMode: "live" })).toBe("UNVERIFIED_EXECUTION_MODE");
  });
});
