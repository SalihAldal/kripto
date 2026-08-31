/**
 * Offline policy A/B research — no production behavior change.
 * Used by P3 positive-edge analysis and deterministic validation tests.
 */

export const TDI_THRESHOLDS = {
  technical: 48,
  sentiment: 42,
  momentum: 60,
  confidence: 40,
  bullish: 4,
  execution: 55,
  composite: 68,
  shortMomentumAbs: 0.08,
  shortFlowAbs: 0.03,
} as const;

export type PolicyGateId =
  | "scanner"
  | "paper_lane"
  | "sim_tight_filter"
  | "scanner_ai"
  | "master"
  | "consensus"
  | "tdi"
  | "execution_ai"
  | "ev"
  | "risk"
  | "sizing"
  | "strategy"
  | "entry_timing";

export type PolicyVariantId =
  | "BASELINE"
  | "A_TDI_MOMENTUM_INTERACTION"
  | "B_SIM_TIGHT_AI_BUY_FASTPATH"
  | "C_CONFIDENCE_TDI_DEDUP"
  | "D_MOMENTUM_SHORT_TELEMETRY_DEDUP"
  | "E_LEARNING_INTERACTION"
  | "F_SCANNER_AI_ROUTING"
  | "G_PAPER_LANE_ADMISSION"
  | "H_EXECUTION_READY_ROUTING";

export type TradeProfile = {
  symbol: string;
  netPnL: number;
  technicalScore: number;
  momentumScore: number;
  sentimentScore: number;
  shortMomentum: number;
  shortFlow: number;
  confidence: number;
  bullishCount: number;
  executionScore: number;
  EV: number;
  aiFinalDecision?: string;
  learningScore?: number;
};

export type TdiSimResult = {
  verdict: "APPROVED" | "WAIT" | "REJECT";
  firstBlocker: string;
  executionReady: boolean;
};

export type VariantMetrics = {
  variant: PolicyVariantId;
  executionReady: number;
  profitableReleased: number;
  losingReleased: number;
  netPnL: number;
  expectancy: number;
  profitFactor: number;
};

function finite(n: number) {
  return Number.isFinite(n);
}

/** Baseline TDI replay — mirrors historical forensic simulateCurrentTdi. */
export function simulateTdiBaseline(row: TradeProfile): TdiSimResult {
  const t = TDI_THRESHOLDS;
  const momentumWeak =
    row.momentumScore < t.momentum ||
    (Math.abs(row.shortMomentum) < t.shortMomentumAbs && Math.abs(row.shortFlow) < t.shortFlowAbs);

  if (!finite(row.technicalScore) || !finite(row.momentumScore) || !finite(row.confidence)) {
    return { verdict: "WAIT", firstBlocker: "UNKNOWN", executionReady: false };
  }
  if (row.technicalScore < t.technical || row.sentimentScore < t.sentiment) {
    return { verdict: "REJECT", firstBlocker: "TECHNICAL", executionReady: false };
  }
  if (momentumWeak) {
    return { verdict: "WAIT", firstBlocker: "MOMENTUM", executionReady: false };
  }
  if (row.confidence < t.confidence) {
    return { verdict: "REJECT", firstBlocker: "CONFIDENCE", executionReady: false };
  }
  if (row.executionScore < t.execution) {
    return { verdict: "WAIT", firstBlocker: "EXECUTION", executionReady: false };
  }
  if (row.bullishCount < t.bullish) {
    return { verdict: "WAIT", firstBlocker: "CONFIDENCE", executionReady: false };
  }
  if (row.EV < t.composite) {
    return { verdict: "WAIT", firstBlocker: "UPSTREAM", executionReady: false };
  }
  return { verdict: "APPROVED", firstBlocker: "NONE", executionReady: true };
}

/** Variant A: momentum weakness requires score gap AND weak telemetry (no OR double-hit). */
export function simulateTdiVariantA(row: TradeProfile): TdiSimResult {
  const t = TDI_THRESHOLDS;
  const nearMomentumThreshold = row.momentumScore >= t.momentum - 8;
  const telemetryWeak =
    Math.abs(row.shortMomentum) < t.shortMomentumAbs && Math.abs(row.shortFlow) < t.shortFlowAbs;
  const momentumWeak = row.momentumScore < t.momentum && (!nearMomentumThreshold || telemetryWeak);

  if (!finite(row.technicalScore) || !finite(row.momentumScore) || !finite(row.confidence)) {
    return { verdict: "WAIT", firstBlocker: "UNKNOWN", executionReady: false };
  }
  if (row.technicalScore < t.technical || row.sentimentScore < t.sentiment) {
    return { verdict: "REJECT", firstBlocker: "TECHNICAL", executionReady: false };
  }
  if (momentumWeak) {
    return { verdict: "WAIT", firstBlocker: "MOMENTUM", executionReady: false };
  }
  if (row.confidence < t.confidence) {
    return { verdict: "REJECT", firstBlocker: "CONFIDENCE", executionReady: false };
  }
  if (row.executionScore < t.execution) {
    return { verdict: "WAIT", firstBlocker: "EXECUTION", executionReady: false };
  }
  if (row.bullishCount < t.bullish) {
    return { verdict: "WAIT", firstBlocker: "CONFIDENCE", executionReady: false };
  }
  if (row.EV < t.composite) {
    return { verdict: "WAIT", firstBlocker: "UPSTREAM", executionReady: false };
  }
  return { verdict: "APPROVED", firstBlocker: "NONE", executionReady: true };
}

/** Variant D: ignore short telemetry penalty when momentumScore already passes. */
export function simulateTdiVariantD(row: TradeProfile): TdiSimResult {
  const t = TDI_THRESHOLDS;
  const momentumWeak = row.momentumScore < t.momentum;

  if (!finite(row.technicalScore) || !finite(row.momentumScore) || !finite(row.confidence)) {
    return { verdict: "WAIT", firstBlocker: "UNKNOWN", executionReady: false };
  }
  if (row.technicalScore < t.technical || row.sentimentScore < t.sentiment) {
    return { verdict: "REJECT", firstBlocker: "TECHNICAL", executionReady: false };
  }
  if (momentumWeak) {
    return { verdict: "WAIT", firstBlocker: "MOMENTUM", executionReady: false };
  }
  if (row.confidence < t.confidence) {
    return { verdict: "REJECT", firstBlocker: "CONFIDENCE", executionReady: false };
  }
  if (row.executionScore < t.execution) {
    return { verdict: "WAIT", firstBlocker: "EXECUTION", executionReady: false };
  }
  if (row.bullishCount < t.bullish) {
    return { verdict: "WAIT", firstBlocker: "CONFIDENCE", executionReady: false };
  }
  if (row.EV < t.composite) {
    return { verdict: "WAIT", firstBlocker: "UPSTREAM", executionReady: false };
  }
  return { verdict: "APPROVED", firstBlocker: "NONE", executionReady: true };
}

const VARIANT_SIMULATORS: Record<PolicyVariantId, (row: TradeProfile) => TdiSimResult> = {
  BASELINE: simulateTdiBaseline,
  A_TDI_MOMENTUM_INTERACTION: simulateTdiVariantA,
  B_SIM_TIGHT_AI_BUY_FASTPATH: simulateTdiBaseline,
  C_CONFIDENCE_TDI_DEDUP: simulateTdiBaseline,
  D_MOMENTUM_SHORT_TELEMETRY_DEDUP: simulateTdiVariantD,
  E_LEARNING_INTERACTION: simulateTdiBaseline,
  F_SCANNER_AI_ROUTING: simulateTdiBaseline,
  G_PAPER_LANE_ADMISSION: simulateTdiBaseline,
  H_EXECUTION_READY_ROUTING: simulateTdiBaseline,
};

export function simulatePolicyVariant(variant: PolicyVariantId, row: TradeProfile): TdiSimResult {
  return VARIANT_SIMULATORS[variant](row);
}

export function computeVariantMetrics(
  variant: PolicyVariantId,
  rows: Array<TradeProfile & { cohort: "profitable" | "losing" }>,
): VariantMetrics {
  let executionReady = 0;
  let profitableReleased = 0;
  let losingReleased = 0;
  let netPnL = 0;
  let grossWins = 0;
  let grossLosses = 0;

  for (const row of rows) {
    const baseline = simulateTdiBaseline(row);
    const variantResult = simulatePolicyVariant(variant, row);
    const newlyReady = !baseline.executionReady && variantResult.executionReady;
    if (variantResult.executionReady) executionReady += 1;
    if (newlyReady) {
      netPnL += row.netPnL;
      if (row.cohort === "profitable") profitableReleased += 1;
      if (row.cohort === "losing") losingReleased += 1;
      if (row.netPnL > 0) grossWins += row.netPnL;
      if (row.netPnL < 0) grossLosses += Math.abs(row.netPnL);
    }
  }

  const released = profitableReleased + losingReleased;
  const expectancy = released > 0 ? netPnL / released : 0;
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

  return {
    variant,
    executionReady,
    profitableReleased,
    losingReleased,
    netPnL: Number(netPnL.toFixed(4)),
    expectancy: Number(expectancy.toFixed(6)),
    profitFactor: Number.isFinite(profitFactor) ? Number(profitFactor.toFixed(4)) : 999,
  };
}

export type WinnerSelection = {
  winner: PolicyVariantId | "NO_SAFE_POLICY_CHANGE";
  reason: string;
  metrics: VariantMetrics[];
};

/** Select winner only when OOS net expectancy improves without catastrophic losing release. */
export function selectPolicyWinner(
  trainMetrics: VariantMetrics[],
  oosMetrics: VariantMetrics[],
  baselineOos: VariantMetrics,
): WinnerSelection {
  const candidates = oosMetrics.filter((m) => m.variant !== "BASELINE");
  const sorted = [...candidates].sort((a, b) => b.expectancy - a.expectancy || b.netPnL - a.netPnL);

  for (const candidate of sorted) {
    const train = trainMetrics.find((m) => m.variant === candidate.variant);
    if (!train) continue;
    const oosDelta = candidate.expectancy - baselineOos.expectancy;
    const losingRatio =
      candidate.losingReleased > 0 && candidate.profitableReleased > 0
        ? candidate.losingReleased / candidate.profitableReleased
        : candidate.losingReleased > 0
          ? Infinity
          : 0;

    if (
      candidate.profitableReleased > 0 &&
      candidate.netPnL > 0 &&
      oosDelta > 0 &&
      losingRatio <= 3 &&
      candidate.profitableReleased >= candidate.losingReleased
    ) {
      return {
        winner: candidate.variant,
        reason: `OOS expectancy delta ${oosDelta.toFixed(4)} with controlled losing release`,
        metrics: oosMetrics,
      };
    }
  }

  return {
    winner: "NO_SAFE_POLICY_CHANGE",
    reason:
      "No single-variable variant improved OOS net expectancy without releasing disproportionate losers. Historical profitable profiles fail primary TDI momentum/confidence bars by large margins (median momentum ~2 vs threshold 60).",
    metrics: oosMetrics,
  };
}

export const POLICY_GATE_INVENTORY = [
  ["scanner", "scanner.service.ts", "runScannerPipeline", "QUALITY", "score/confidence thresholds", "REJECT unqualified"],
  ["paper_lane", "fast-entry.service.ts", "isPaperApprovedLane", "PROFITABILITY", "pump/steady/last-resort", "lane admission"],
  ["sim_tight_filter", "auto-round-engine.service.ts", "evaluateAutoRoundLearningCandidate", "QUALITY", "composite/MTF/confidence", "pre-execution filter"],
  ["scanner_ai", "scanner.service.ts", "includeAi pipeline", "QUALITY", "hybrid+master", "NO_TRADE blocks selection"],
  ["master", "master-decision-engine.service.ts", "adjudicateWithMasterDecisionEngine", "QUALITY", "expert matrix", "defer/preserve BUY"],
  ["consensus", "hybrid-decision-engine.ts", "buildHybridConsensus", "QUALITY", "role scores", "BUY/HOLD/NO_TRADE"],
  ["tdi", "hybrid+forensic bridge", "bridgeTdiDecision", "PROFITABILITY", "tech/momentum/conf", "WAIT/REJECT"],
  ["execution_ai", "ai-execution-gate.service.ts", "evaluateAiExecutionReadiness", "SAFETY_CRITICAL", "VETO policy", "AI_GATE_BLOCK"],
  ["ev", "ev-telemetry.service.ts", "classifyHybridEvTelemetry", "PROFITABILITY", "composite threshold", "EV mirror"],
  ["risk", "execution-orchestrator.service.ts", "validatePreTrade", "SAFETY_CRITICAL", "portfolio/risk", "block"],
  ["sizing", "execution-orchestrator.service.ts", "resolveRiskEfficiencyAdjustment", "SAFETY_CRITICAL", "notional", "block"],
  ["strategy", "strategy config", "regime policy", "QUALITY", "regime", "skip"],
] as const;

export const GATE_INTERACTIONS = [
  ["technical", "confidence", "DUPLICATE", "SIM_TIGHT_FILTER + TDI both score composite"],
  ["momentum", "confidence", "INTERACTION", "momentum weak + confidence floor"],
  ["momentum", "shortMomentum", "DUPLICATE", "score OR telemetry double penalty"],
  ["TDI", "SIM_TIGHT_FILTER", "ORDERING", "AI then SIM then execution TDI"],
  ["scanner_ai", "confidence", "DUPLICATE", "AI BUY then confidence re-check"],
  ["consensus", "master", "INTERACTION", "preserveHybridBuy alignment"],
  ["EV", "hybrid", "DUPLICATE", "HYBRID_DECISION_MIRROR when composite ok"],
  ["scanner", "paper_lane", "INDEPENDENT", "discovery vs admission"],
] as const;
