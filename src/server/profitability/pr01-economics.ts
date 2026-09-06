import { computeFeeEdgeMetrics } from "@/src/server/forensics/fee-edge-metrics.service";
import {
  PR01_POLICY_VERSION,
  PR01_SCHEMA_VERSION,
  type CostCoverageLevel,
  type ExpectancyEvidenceStatus,
  type TradeEconomicsRecord,
} from "@/src/server/profitability/pr01-types";

export type TradeEconomicsInput = {
  candidateId?: string | null;
  decisionId?: string | null;
  strategyId?: string | null;
  featureSnapshotId?: string | null;
  venue?: string;
  symbol?: string;
  quoteCurrency?: string;
  decisionAtMs?: number | null;
  intendedNotional?: number | null;
  intendedQuantity?: number | null;
  horizonMin?: number | null;
  expectedMovePercent?: number | null;
  expectedMoveSource?: string;
  expectedMoveQuality?: TradeEconomicsRecord["expectedMove"]["quality"];
  aiConfidenceScore?: number | null;
  entryPrice?: number | null;
  takeProfitPercent?: number | null;
  takerFeeRate?: number | null;
  entrySlippagePct?: number | null;
  exitSlippagePct?: number | null;
  costSource?: CostCoverageLevel;
  grossMovePct?: number | null;
  mfePct?: number | null;
  realizedNetPnl?: number | null;
  realizedNetReturnPct?: number | null;
  winRate?: number | null;
  avgWinPct?: number | null;
  avgLossPct?: number | null;
  expectancyEvidenceRef?: string | null;
  fillPriceIncludesSpread?: boolean;
};

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

export function resolveCostCoverageLevel(source?: CostCoverageLevel): CostCoverageLevel {
  if (source === "MEASURED" || source === "CONFIGURED_ASSUMPTION" || source === "MODELED") return source;
  return "UNKNOWN";
}

export function buildTradeEconomicsRecord(input: TradeEconomicsInput): TradeEconomicsRecord {
  const reasonCodes: string[] = [];
  const entryPrice = Number(input.entryPrice ?? 0);
  const quantity = Number(input.intendedQuantity ?? 0);
  const takeProfitPercent = Number(input.takeProfitPercent ?? input.expectedMovePercent ?? 0);
  const costLevel = resolveCostCoverageLevel(input.costSource);

  let entryFee: number | null = null;
  let exitFee: number | null = null;
  let breakEvenMovePct: number | null = null;
  let scenarioNetReturnPct: number | null = null;
  let moveViable: boolean | null = null;

  if (costLevel === "UNKNOWN") {
    reasonCodes.push("COST_UNKNOWN");
  } else if (entryPrice > 0 && quantity > 0 && takeProfitPercent > 0) {
    const feeMetrics = computeFeeEdgeMetrics({
      entryPrice,
      quantity,
      takeProfitPercent,
      stopLossPercent: 1,
      takerFeeRate: input.takerFeeRate ?? undefined,
    });
    entryFee = feeMetrics.estimatedEntryFee;
    exitFee = feeMetrics.estimatedExitFee;
    breakEvenMovePct =
      entryPrice > 0 ? round((feeMetrics.estimatedRoundTripFees / (entryPrice * quantity)) * 100, 4) : null;
    scenarioNetReturnPct = takeProfitPercent > 0
      ? round(takeProfitPercent - (breakEvenMovePct ?? 0), 4)
      : null;
    moveViable = scenarioNetReturnPct != null ? scenarioNetReturnPct > 0 : null;
  } else {
    reasonCodes.push("INSUFFICIENT_COST_INPUT");
  }

  const entryExecutionCost =
    input.fillPriceIncludesSpread
      ? 0
      : input.entrySlippagePct != null && entryPrice > 0
        ? round(entryPrice * (input.entrySlippagePct / 100), 6)
        : null;
  const exitExecutionCost =
    input.fillPriceIncludesSpread
      ? 0
      : input.exitSlippagePct != null && entryPrice > 0
        ? round(entryPrice * (input.exitSlippagePct / 100), 6)
        : null;

  if (input.fillPriceIncludesSpread && (input.entrySlippagePct || input.exitSlippagePct)) {
    reasonCodes.push("SPREAD_ALREADY_IN_FILL");
  }

  let expectancyStatus: ExpectancyEvidenceStatus = "UNKNOWN";
  if (input.winRate != null && input.avgWinPct != null && input.avgLossPct != null) {
    expectancyStatus = "PROVEN";
  } else if (input.expectancyEvidenceRef) {
    expectancyStatus = "INSUFFICIENT_EVIDENCE";
  }

  const expectedMoveQuality =
    input.aiConfidenceScore != null && input.expectedMoveSource?.includes("ai.score")
      ? "MODEL_ESTIMATE"
      : input.expectedMoveQuality ?? (input.expectedMovePercent == null ? "MISSING" : "VALID");

  if (input.aiConfidenceScore != null && input.expectedMovePercent == null) {
    reasonCodes.push("AI_SCORE_NOT_EXPECTED_MOVE");
  }

  const grossMovePct = input.grossMovePct ?? input.mfePct ?? null;
  const moveViabilityStatus =
    moveViable == null ? "UNKNOWN" : moveViable ? "PASS" : "FAIL";

  return {
    schemaVersion: PR01_SCHEMA_VERSION,
    candidateId: input.candidateId ?? null,
    decisionId: input.decisionId ?? null,
    strategyId: input.strategyId ?? null,
    policyVersion: PR01_POLICY_VERSION,
    featureSnapshotId: input.featureSnapshotId ?? null,
    venue: input.venue ?? "UNKNOWN",
    symbol: input.symbol ?? "UNKNOWN",
    quoteCurrency: input.quoteCurrency ?? "UNKNOWN",
    decisionAtMs: input.decisionAtMs ?? null,
    intendedNotional: input.intendedNotional ?? (entryPrice > 0 && quantity > 0 ? round(entryPrice * quantity) : null),
    intendedQuantity: quantity > 0 ? quantity : null,
    horizonMin: input.horizonMin ?? null,
    expectedMove: {
      value: input.expectedMovePercent ?? null,
      source: input.expectedMoveSource ?? "UNKNOWN",
      asOfMs: input.decisionAtMs ?? null,
      quality: expectedMoveQuality,
    },
    costCoverage: {
      level: costLevel,
      entryFee,
      exitFee,
      entryExecutionCost,
      exitExecutionCost,
      latencyAssumptionMs: null,
      quality: costLevel,
      reasonCodes: costLevel === "UNKNOWN" ? ["COST_UNKNOWN"] : [],
    },
    moveViability: {
      grossMovePct,
      breakEvenMovePct,
      scenarioNetReturnPct,
      viable: moveViable,
      status: moveViabilityStatus,
    },
    expectancy: {
      status: expectancyStatus,
      winRate: input.winRate ?? null,
      avgWinPct: input.avgWinPct ?? null,
      avgLossPct: input.avgLossPct ?? null,
      evidenceRef: input.expectancyEvidenceRef ?? null,
    },
    realizedNet: {
      status: input.realizedNetPnl != null || input.realizedNetReturnPct != null ? "OBSERVED" : "NOT_OBSERVED",
      netPnl: input.realizedNetPnl ?? null,
      netReturnPct: input.realizedNetReturnPct ?? null,
      source: input.realizedNetPnl != null || input.realizedNetReturnPct != null ? "ER04_SETTLEMENT" : "UNKNOWN",
    },
    mfePct: input.mfePct ?? null,
    status: reasonCodes.length > 0 ? "PARTIAL" : "OK",
    reasonCodes,
  };
}

export function assertEconomicsSeparation(record: TradeEconomicsRecord) {
  return {
    costCoverageOnly: record.costCoverage.level,
    moveViabilityOnly: record.moveViability.status,
    expectancyOnly: record.expectancy.status,
    realizedOnly: record.realizedNet.status,
    mfeIsNotRealizedProfit: record.mfePct != null && record.realizedNet.netReturnPct == null,
  };
}
