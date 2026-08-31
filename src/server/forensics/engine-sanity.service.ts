import { resolveMinimumProtectedProfitPercent } from "@/src/server/execution/profit-thresholds";
import { buildHybridDecision } from "@/src/server/ai/hybrid-decision-engine";
import { resolveMtfAlignmentContract, resolvePumpRiskContract } from "@/src/server/decision-engine/decision-contract.service";
import type { PreflightCheckResult } from "@/src/server/forensics/forensic.types";

export type EngineSanityReport = {
  ok: boolean;
  checks: PreflightCheckResult[];
};

function pass(code: string, detail: string, metadata?: Record<string, unknown>): PreflightCheckResult {
  return { status: "PASS", reasonCode: code, reasonDetail: detail, timestamp: new Date().toISOString(), metadata };
}

function fail(code: string, detail: string, metadata?: Record<string, unknown>): PreflightCheckResult {
  return { status: "FAIL", reasonCode: code, reasonDetail: detail, timestamp: new Date().toISOString(), metadata };
}

export function runEngineSanityChecks(): EngineSanityReport {
  const checks: PreflightCheckResult[] = [];

  try {
    const minProfit = resolveMinimumProtectedProfitPercent();
    if (!Number.isFinite(minProfit) || minProfit < 0) {
      checks.push(fail("ENGINE_PROFIT_THRESHOLD_INVALID", `Invalid min protected profit: ${minProfit}`));
    } else {
      checks.push(pass("ENGINE_PROFIT_THRESHOLD_OK", `resolveMinimumProtectedProfitPercent=${minProfit}`));
    }
  } catch (error) {
    checks.push(fail("ENGINE_PROFIT_THRESHOLD_ERROR", (error as Error).message));
  }

  try {
    const mtf = resolveMtfAlignmentContract({ aiAlignment: undefined, contextAlignment: null });
    if (mtf.status !== "UNAVAILABLE" || mtf.score !== null) {
      checks.push(fail("ENGINE_MTF_CONTRACT_INVALID", JSON.stringify(mtf)));
    } else {
      checks.push(pass("ENGINE_MTF_CONTRACT_OK", "UNAVAILABLE does not coerce to 0"));
    }
  } catch (error) {
    checks.push(fail("ENGINE_MTF_CONTRACT_ERROR", (error as Error).message));
  }

  try {
    const pump = resolvePumpRiskContract({ futuresDegraded: true });
    if (pump.status !== "UNAVAILABLE" || pump.score !== null) {
      checks.push(fail("ENGINE_PUMP_CONTRACT_INVALID", JSON.stringify(pump)));
    } else {
      checks.push(pass("ENGINE_PUMP_CONTRACT_OK", "degraded futures does not coerce to 100"));
    }
  } catch (error) {
    checks.push(fail("ENGINE_PUMP_CONTRACT_ERROR", (error as Error).message));
  }

  try {
    const hybrid = buildHybridDecision({
      analysisInput: {
        symbol: "BTCTRY",
        lastPrice: 100,
        klines: [],
        volume24h: 1_000_000,
        orderBookSummary: { bestBid: 99.9, bestAsk: 100.1, bidDepth: 100, askDepth: 100 },
        recentTradesSummary: { buySellRatio: 1.02 },
        spread: 0.05,
        volatility: 1,
        marketSignals: {},
        strategyParams: {},
        riskSettings: {},
      },
      technicalResults: [],
      momentumResults: [],
      riskResults: [],
      allOutputs: [],
    });
    if (!hybrid || typeof hybrid.finalDecision !== "string") {
      checks.push(fail("ENGINE_HYBRID_INVALID", "buildHybridDecision returned invalid payload"));
    } else {
      checks.push(pass("ENGINE_HYBRID_OK", `hybridDecision=${hybrid.finalDecision}`));
    }
  } catch (error) {
    checks.push(fail("ENGINE_HYBRID_ERROR", (error as Error).message));
  }

  return { ok: checks.every((c) => c.status === "PASS"), checks };
}
