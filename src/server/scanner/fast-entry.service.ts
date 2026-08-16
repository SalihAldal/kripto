import type { AIDecision } from "@/src/types/ai";
import { logger } from "@/lib/logger";
import {
  PumpScanFailedError,
  recordPumpScanEvent,
  runBoundedLivePumpScan,
} from "@/src/server/scanner/pump-scan-lifecycle.service";
import { traceCandidateFailed, traceCandidateReject, traceCandidateWait } from "@/src/server/forensics/candidate-lifecycle.service";
import { env } from "@/lib/config";
import { getRuntimeExecutionContext } from "@/src/server/repositories/execution.repository";
import { getAdaptiveExecutionPolicy } from "@/src/server/metrics/performance.service";
import { runScannerPipeline } from "@/src/server/scanner/scanner.service";
import { buildMarketContext } from "@/src/server/scanner/market-context-builder";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";
import { formatAIRequest } from "@/src/server/scanner/ai-request-formatter";
import { runAIConsensusFromInput } from "@/src/server/ai/analysis-orchestrator";
import { getRuntimeStrategyParams } from "@/src/server/config/strategy-runtime.service";
import { resolveMinimumProtectedProfitPercent } from "@/src/server/execution/profit-thresholds";
import { evaluateMomentumBreakout, resolveEffectiveShortMomentum } from "@/src/server/scanner/momentum-breakout.service";
import { isFakeHourOnlyPump, isStrongHourPumpContext } from "@/src/server/trading-core/entry-filters/paper-entry-quality.service";
import {
  evaluatePumpEntrySafety,
  formatPumpEntrySafetyReason,
} from "@/src/server/trading-core/entry-filters/pump-entry-safety.service";
import {
  ensurePumpEarlyCatcherStarted,
  getActivePumpEarlyCandidate,
  getCachedPumpCandidates,
  resolveLiveTopGainerPumpCandidates,
  resolvePumpRoundMaxWaitSec,
  type PumpEarlyCandidate,
} from "@/src/server/scanner/pump-early-catcher.service";
import type { ScannerCandidate, ScannerPipelineResult } from "@/src/types/scanner";
import type { AsyncRuntimeTelemetry } from "@/src/server/execution/cooperative-async.service";
import {
  resolveAiConsensusTimeoutMs,
  resolveMarketContextTimeoutMs,
  startPeriodicRuntimeHeartbeat,
  withBoundedAwait,
} from "@/src/server/execution/cooperative-async.service";

export type FastEntryResult = {
  selected: ScannerCandidate | null;
  reason?: string;
  diagnostics?: {
    candidateCount: number;
    tradableCount: number;
    scannedTotal?: number;
    qualifiedTotal?: number;
    minConfidence: number;
    requireUnanimous: boolean;
    rejectionBreakdown?: {
      noAi: number;
      aiRejected: number;
      noTradeDecision: number;
      lowConfidence: number;
      highSpread: number;
      highFakeSpike: number;
      lowTradeVelocity: number;
      lowFlowImbalance: number;
    };
    sampleRejected?: Array<{
      symbol: string;
      decision: string;
      confidence: number;
      spreadPercent: number;
      fakeSpikeScore: number;
      shortFlowImbalance: number;
      tradeVelocity: number;
      marketRegime: string;
      notes: string[];
    }>;
  };
  scannedAt: string;
  evaluated: number;
};

type FastEntryOptions = {
  excludeSymbols?: string[];
  forcePaperProfile?: boolean;
  scanLimit?: number;
  scanCycles?: number;
  maxDurationSec?: number;
  skipInitialPumpPass?: boolean;
  runtime?: FastEntryRuntimeHooks;
};

export type FastEntryRuntimeHooks = {
  ensureActive?: () => void | Promise<void>;
  onPumpScan?: (scope: "cache" | "live", candidateCount: number, remaining: number) => void | Promise<void>;
  onPumpConfirmation?: (symbol: string, index: number, total: number) => void | Promise<void>;
  onAiAnalysis?: (symbol: string, phase: "started" | "completed", decision?: string) => void | Promise<void>;
  onCandidateRejected?: (symbol: string, reason: string) => void | Promise<void>;
  onFullScan?: (cycle: number, maxCycles: number) => void | Promise<void>;
  onScannerCheckpoint?: (info: {
    phase: "context" | "discovery" | "ranking" | "ai" | "consensus";
    processed: number;
    total: number;
    symbol?: string;
  }) => void | Promise<void>;
  onHeartbeat?: () => void | Promise<void>;
  onProgress?: () => void | Promise<void>;
  asyncTelemetry?: AsyncRuntimeTelemetry;
  shouldAbort?: () => void;
  abortSignal?: AbortSignal;
  selectionBudgetMs?: number;
  selectionDeadlineMs?: number;
  forceFreshScanner?: boolean;
  roundId?: string;
  runId?: string;
};

function buildScannerPipelineRuntime(
  runtime: FastEntryRuntimeHooks | undefined,
  attachIfRunning: boolean,
) {
  return {
    attachIfRunning,
    attachMaxWaitMs: env.AUTO_ROUND_SCANNER_ATTACH_MAX_WAIT_MS,
    preferLastResultOnAttachTimeout: attachIfRunning,
    maxCycleSec: env.AUTO_ROUND_SCANNER_MAX_CYCLE_SEC,
    phaseDeadlineMs: runtime?.selectionDeadlineMs,
    selectionDeadlineMs: runtime?.selectionDeadlineMs,
    selectionBudgetMs: runtime?.selectionBudgetMs,
    shouldAbort: runtime?.shouldAbort,
    abortSignal: runtime?.abortSignal,
    onHeartbeat: runtime?.onHeartbeat,
    onProgress: runtime?.onProgress,
    telemetry: runtime?.asyncTelemetry,
    onCheckpoint: runtime?.onScannerCheckpoint,
    roundId: runtime?.roundId,
    runId: runtime?.runId,
  };
}

function rankForFastEntry(candidate: ScannerCandidate) {
  const aiConfidence = candidate.ai?.finalConfidence ?? 0;
  const scannerScore = candidate.score.score;
  const momentumBreakout = evaluateMomentumBreakout(candidate.context);
  const shortMomentum = Number(candidate.context.metadata.shortMomentumPercent ?? 0);
  const flow = Math.abs(Number(candidate.context.metadata.shortFlowImbalance ?? 0));
  const velocity = Number(candidate.context.metadata.tradeVelocity ?? 0);
  const candleSignal = Math.abs(Number(candidate.context.shortCandleSignal ?? 0));
  const window = evaluateProfitWindow(candidate, false);
  const profitBoost = window.ok ? window.expectedProfitPercent * 5.5 : 0;
  const durationBonus = window.ok ? Math.max(-10, Math.min(10, (window.allowedDurationSec - window.suggestedDurationSec) / 45)) : -8;
  const breakoutBoost = momentumBreakout.ok ? momentumBreakout.score * 0.55 + (momentumBreakout.stage === "EARLY" ? 8 : momentumBreakout.stage === "ACTIVE" ? 5 : 0) : 0;
  return aiConfidence * 0.42 + scannerScore * 0.32 + shortMomentum * 28 + flow * 18 + velocity * 6 + candleSignal * 2 + profitBoost + durationBonus + breakoutBoost;
}

function isUnanimousDecision(candidate: ScannerCandidate, decision: AIDecision) {
  const outputs = candidate.ai?.outputs ?? [];
  const valid = outputs.filter((x) => x.ok && x.output).map((x) => x.output!.decision);
  if (valid.length < 3) return false;
  return valid.every((x) => x === decision);
}

function isTryQuotedSymbol(symbol: string) {
  return symbol.toUpperCase().endsWith("TRY");
}

function isPaperApprovedLane(candidate: ScannerCandidate) {
  const isPaper = env.EXECUTION_MODE === "paper";
  const explanation = String(candidate.ai?.explanation ?? "").toLowerCase();
  const meta = candidate.context.metadata;
  const change24h = Number(meta.topGainerChange24h ?? candidate.context.change24h ?? 0);
  const shortMomentum = Number(meta.shortMomentumPercent ?? 0);
  const hourMomentum = Number(meta.hourMomentumPercent ?? 0);
  const shortFlow = Number(meta.shortFlowImbalance ?? 0);
  const topGainerPump =
    Boolean(meta.topGainerDiscovery ?? false) ||
    Boolean(meta.pumpEarlyConfirmed ?? false) ||
    Boolean(meta.pumpContinuationMode ?? false) ||
    Boolean(meta.pumpIntradaySpike ?? false) ||
    Number(meta.topGainerPriorityScore ?? 0) >= (isPaper ? 50 : 70);
  // TRY: paper modda eşikler gevşetildi
  const metricPumpLane =
    topGainerPump &&
    (change24h >= (isPaper ? 1.5 : env.PUMP_INTRADAY_MIN_CHANGE_24H) ||
      (shortMomentum >= (isPaper ? 0.02 : 0.06) && hourMomentum >= (isPaper ? 0.2 : 0.5)) ||
      (hourMomentum >= (isPaper ? 0.3 : 0.8) && shortFlow >= (isPaper ? 0.01 : 0.03))) &&
    (shortMomentum >= (isPaper ? 0.01 : 0.05) || hourMomentum >= (isPaper ? 0.2 : 0.6)) &&
    shortFlow >= (isPaper ? 0.005 : 0.02);
  const compositeScore = resolveCandidateCompositeScore(candidate);
  const aiMissing = !candidate.ai || !(candidate.ai.roleScores?.some((r) => Number(r.score) > 0));
  const effectiveConfidence = aiMissing
    ? Number(candidate.score.confidence ?? 0)
    : Number(candidate.ai?.finalConfidence ?? candidate.score.confidence ?? 0);
  const effectiveRiskScore = aiMissing
    ? 70
    : Number(candidate.ai?.finalRiskScore ?? (isPaper ? 70 : 100));
  const steadyGainLane =
    (
      (candidate.ai?.finalDecision === "BUY" && !candidate.ai?.rejected) ||
      (isPaper && compositeScore >= 36 && effectiveConfidence >= 24)
    ) &&
    candidate.context.spreadPercent <= (isPaper ? 0.60 : 0.18) &&
    candidate.context.fakeSpikeScore <= (isPaper ? 4.5 : 2.4) &&
    effectiveRiskScore <= (isPaper ? 92 : 78) &&
    (shortMomentum >= (isPaper ? 0.001 : 0.02) || shortFlow >= (isPaper ? 0.001 : 0.01) || candidate.context.momentumPercent >= (isPaper ? 0.005 : 0.08));
  // Paper modda basit onay: makul spread + scanner skoru yeterlı
  const paperBasicLane =
    isPaper &&
    candidate.context.spreadPercent <= 0.80 &&
    candidate.score.score >= 28 &&
    candidate.context.fakeSpikeScore <= 5.0;
  return (
    explanation.includes("steady-gain") ||
    explanation.includes("pump_continuation") ||
    explanation.includes("pump_intraday") ||
    explanation.includes("pump_early") ||
    explanation.includes("pump catcher") ||
    explanation.includes("pump-continuation") ||
    explanation.includes("pump-intraday") ||
    metricPumpLane ||
    steadyGainLane ||
    paperBasicLane ||
    passesPaperLastResortQuality(candidate)
  );
}

function resolveCandidateCompositeScore(candidate: ScannerCandidate) {
  const roles = candidate.ai?.roleScores ?? [];
  const technical = Number(roles.find((row) => row.role === "AI-1_TECHNICAL")?.score ?? 0);
  const sentiment = Number(roles.find((row) => row.role === "AI-2_SENTIMENT")?.score ?? 0);
  const risk = Number(roles.find((row) => row.role === "AI-3_RISK")?.score ?? 0);
  const parts = [technical, sentiment, risk].filter((value) => value > 0);
  if (parts.length > 0) return parts.reduce((sum, value) => sum + value, 0) / parts.length;
  return Number(candidate.ai?.finalConfidence ?? candidate.score.confidence ?? 0);
}

function summarizePaperPumpCandidate(candidate: ScannerCandidate) {
  const meta = candidate.context.metadata;
  const breakout = evaluateMomentumBreakout(candidate.context);
  const change24h = Number(meta.topGainerChange24h ?? candidate.context.change24h ?? 0);
  const tapeMomentum = Number(meta.shortMomentumPercent ?? 0);
  const hourMomentum = Number(meta.hourMomentumPercent ?? 0);
  const shortFlow = Number(meta.shortFlowImbalance ?? 0);
  const topGainerPump =
    Boolean(meta.topGainerDiscovery ?? false) ||
    Boolean(meta.pumpEarlyConfirmed ?? false) ||
    Boolean(meta.pumpContinuationMode ?? false) ||
    Boolean(meta.pumpIntradaySpike ?? false) ||
    Number(meta.topGainerPriorityScore ?? 0) >= 70;
  const pumpSafety = evaluatePumpEntrySafety({
    context: candidate.context,
    tapeMomentum,
    hourMomentum,
    shortFlow,
    change24h,
    pumpStage: breakout.stage,
    marketRegime: String(meta.marketRegime ?? "RANGE_SIDEWAYS"),
    compositeAvg: resolveCandidateCompositeScore(candidate),
  });
  return {
    symbol: candidate.context.symbol,
    topGainerPump,
    change24h: Number(change24h.toFixed(2)),
    tapeMomentum: Number(tapeMomentum.toFixed(2)),
    hourMomentum: Number(hourMomentum.toFixed(2)),
    shortFlow: Number(shortFlow.toFixed(3)),
    spreadPercent: Number(candidate.context.spreadPercent.toFixed(3)),
    fakeSpikeScore: Number(candidate.context.fakeSpikeScore.toFixed(2)),
    marketRegime: String(meta.marketRegime ?? "RANGE_SIDEWAYS"),
    breakoutStage: breakout.stage,
    breakoutScore: Number((breakout.score ?? 0).toFixed(1)),
    pumpSafety: pumpSafety.ok ? "OK" : `${pumpSafety.bucket}:${pumpSafety.reason}`,
    aiDecision: candidate.ai?.finalDecision ?? "NO_AI",
    aiConfidence: Number((candidate.ai?.finalConfidence ?? 0).toFixed(1)),
    aiRisk: Number((candidate.ai?.finalRiskScore ?? 0).toFixed(1)),
  };
}

function summarizePumpEarlyCandidate(candidate: PumpEarlyCandidate) {
  const context = candidate.candidate.context;
  const meta = context.metadata;
  const change24h = Number(meta.topGainerChange24h ?? context.change24h ?? 0);
  return {
    symbol: context.symbol,
    mode: candidate.mode,
    priorityScore: Number(candidate.priorityScore.toFixed(1)),
    stage: candidate.assessment.stage,
    score: Number((Number(candidate.assessment.score ?? 0)).toFixed(1)),
    change24h: Number((Number(change24h)).toFixed(2)),
    shortMomentum: Number((Number(meta.shortMomentumPercent ?? 0)).toFixed(2)),
    hourMomentum: Number((Number(meta.hourMomentumPercent ?? 0)).toFixed(2)),
    shortFlow: Number((Number(meta.shortFlowImbalance ?? 0)).toFixed(3)),
    spreadPercent: Number(context.spreadPercent.toFixed(3)),
    fakeSpikeScore: Number(context.fakeSpikeScore.toFixed(2)),
    pumpRisk: Number((context.pumpRisk ?? 0).toFixed(1)),
    reason: candidate.reason,
  };
}

function isChopLikeCandidate(candidate: ScannerCandidate) {
  const meta = candidate.context.metadata;
  const phase = String(meta.regimeLifecyclePhase ?? "");
  const regime = String(meta.marketRegime ?? "RANGE_SIDEWAYS");
  return (
    Boolean(meta.regimeChopWarning) ||
    phase.includes("CHOP") ||
    phase.includes("CHAOS") ||
    regime === "RANGE_SIDEWAYS"
  );
}

function passesPaperLastResortQuality(candidate: ScannerCandidate) {
  const isPaper = env.EXECUTION_MODE === "paper";
  if (!isPaper && isChopLikeCandidate(candidate)) return false;
  if (isPaper) {
    const isStable = ["USDTTRY", "USDCTRY", "BUSDTRY", "TUSDTRY", "DAITRY"].includes(
      candidate.context.symbol.toUpperCase(),
    );
    return !isStable && candidate.context.spreadPercent <= 0.90 && candidate.score.score >= 25;
  }
  const composite = resolveCandidateCompositeScore(candidate);
  const confidence = Number(candidate.ai?.finalConfidence ?? candidate.score.confidence ?? 0);
  return composite >= 55 && confidence >= 52;
}

function normalizeEmergencySymbol(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return normalized;
  if (env.BINANCE_PLATFORM !== "tr") return normalized;
  if (normalized.endsWith("USDT")) return `${normalized.slice(0, -4)}TRY`;
  return normalized;
}

function isAiOutputDegraded(candidate: ScannerCandidate) {
  const outputs = candidate.ai?.outputs ?? [];
  const healthy = outputs.filter((x) => x.ok && x.output);
  if (healthy.length === 0) return false;
  return healthy.every((row) => {
    const meta = row.output?.metadata as Record<string, unknown> | undefined;
    const coverage = Number(meta?.remoteCoverage ?? (meta?.remote === true ? 1 : 0));
    if (Number.isFinite(coverage)) return coverage <= 0;
    return !Boolean(meta?.remote);
  });
}

function hasUnanimousDecision(candidate: ScannerCandidate) {
  const decision = candidate.ai?.finalDecision;
  if (decision !== "BUY" && decision !== "SELL") return false;
  const valid = candidate.ai?.outputs
    ?.filter((x) => x.ok && x.output)
    .map((x) => x.output!.decision) ?? [];
  if (valid.length < 3) return false;
  return valid.every((x) => x === decision);
}

function passesUltraPrecisionSpotGate(candidate: ScannerCandidate) {
  if (!env.AI_ULTRA_PRECISION_MODE) return true;
  const isEliteQuality = env.AI_QUALITY_PROFILE === "elite";
  const ai = candidate.ai;
  if (!ai) return false;
  if (ai.finalDecision !== "BUY" && ai.finalDecision !== "SELL") return false;
  if (ai.finalConfidence < env.AI_SPOT_MIN_CONFIDENCE_ULTRA) return false;
  if (ai.finalRiskScore > env.AI_ULTRA_MAX_RISK_SCORE_SPOT) return false;
  if (!hasUnanimousDecision(candidate)) return false;
  const shortMomentum = Number(candidate.context.metadata.shortMomentumPercent ?? 0);
  const shortFlow = Number(candidate.context.metadata.shortFlowImbalance ?? 0);
  const directionalAligned =
    ai.finalDecision === "BUY"
      ? shortMomentum > 0 && shortFlow > 0.05
      : shortMomentum < 0 && shortFlow < -0.05;
  if (!directionalAligned) return false;
  if (candidate.context.spreadPercent > (isEliteQuality ? 0.08 : 0.12)) return false;
  if (isEliteQuality && candidate.context.volatilityPercent > 1.6) return false;
  return true;
}

function extractProfitPercent(lastPrice: number, targetPrice: number | null, decision: AIDecision) {
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) return null;
  if (!Number.isFinite(targetPrice ?? NaN) || (targetPrice ?? 0) <= 0) return null;
  if (decision === "BUY") {
    return ((targetPrice! - lastPrice) / lastPrice) * 100;
  }
  if (decision === "SELL") {
    return ((lastPrice - targetPrice!) / lastPrice) * 100;
  }
  return null;
}

function evaluateProfitWindow(candidate: ScannerCandidate, relaxed: boolean) {
  const ai = candidate.ai;
  const decision = ai?.finalDecision;
  if (!ai || (decision !== "BUY" && decision !== "SELL")) {
    return { ok: false, expectedProfitPercent: 0, suggestedDurationSec: 0, allowedDurationSec: 0 };
  }
  const outputs = ai.outputs
    .filter((x) => x.ok && x.output)
    .map((x) => x.output!)
    .filter((x) => Number.isFinite(x.targetPrice ?? NaN) && Number.isFinite(x.estimatedDurationSec) && x.estimatedDurationSec > 0);
  const directional = outputs.filter((x) => x.decision === decision);
  const effectiveOutputs = directional.length > 0 ? directional : outputs;
  const profits = effectiveOutputs
    .map((x) => extractProfitPercent(candidate.context.lastPrice, x.targetPrice, decision))
    .filter((x): x is number => Number.isFinite(x));
  const durations = effectiveOutputs
    .map((x) => Number(x.estimatedDurationSec))
    .filter((x) => Number.isFinite(x) && x > 0);
  if (profits.length === 0 || durations.length === 0) {
    return { ok: false, expectedProfitPercent: 0, suggestedDurationSec: 0, allowedDurationSec: 0 };
  }

  const expectedProfitPercent = Number((profits.reduce((acc, x) => acc + x, 0) / profits.length).toFixed(4));
  const suggestedDurationSec = Math.round(durations.reduce((acc, x) => acc + x, 0) / durations.length);
  const minimumNetProtectedProfit = resolveMinimumProtectedProfitPercent();
  const minProfit = Math.max(
    minimumNetProtectedProfit,
    relaxed ? 1.2 : 0.5,
    env.EXECUTION_TARGET_MIN_PROFIT_PERCENT - (relaxed ? 1.25 : 0),
  );
  const highProfit = Math.max(minProfit + 0.5, env.EXECUTION_TARGET_HIGH_PROFIT_PERCENT);
  const maxProfit = env.EXECUTION_TARGET_MAX_PROFIT_PERCENT + (relaxed ? 1 : 0);
  const shortWindow = env.EXECUTION_TARGET_SHORT_WINDOW_SEC;
  const longWindow = env.EXECUTION_TARGET_LONG_WINDOW_SEC + (relaxed ? 240 : 0);
  const effectiveProfit = Math.max(minProfit, Math.min(expectedProfitPercent, highProfit));
  const allowedDurationSec =
    effectiveProfit <= minProfit
      ? shortWindow
      : effectiveProfit >= highProfit
        ? longWindow
        : Math.round(shortWindow + ((effectiveProfit - minProfit) / Math.max(highProfit - minProfit, 0.0001)) * (longWindow - shortWindow));

  const ok =
    expectedProfitPercent >= minProfit &&
    expectedProfitPercent <= maxProfit &&
    suggestedDurationSec <= allowedDurationSec;

  return { ok, expectedProfitPercent, suggestedDurationSec, allowedDurationSec };
}

function momentumWindowOk(candidate: ScannerCandidate, relaxed: boolean) {
  const breakout = evaluateMomentumBreakout(candidate.context);
  if (!breakout.ok) return false;
  if (!relaxed && breakout.stage === "LATE") return false;
  return breakout.direction === "BUY" || env.BINANCE_PLATFORM !== "tr";
}

function withMomentumBreakoutOverride(candidate: ScannerCandidate): ScannerCandidate {
  const breakout = evaluateMomentumBreakout(candidate.context);
  if (!breakout.ok || !candidate.ai || breakout.direction === "NONE") return candidate;
  if (candidate.ai.finalDecision === breakout.direction && !candidate.ai.rejected) return candidate;
  const confidence = Math.max(
    Number(candidate.ai.finalConfidence ?? 0),
    Number(candidate.ai.analysisScorecard?.confidenceScore ?? 0),
    Math.min(78, Math.max(58, breakout.score)),
  );
  return {
    ...candidate,
    ai: {
      ...candidate.ai,
      finalDecision: breakout.direction,
      finalConfidence: confidence,
      rejected: false,
      explanation: `${candidate.ai.explanation ?? "ai no-trade"} | momentum-breakout=${breakout.direction}, stage=${breakout.stage}, score=${breakout.score}`,
      analysisScorecard: candidate.ai.analysisScorecard
        ? {
            ...candidate.ai.analysisScorecard,
            direction: breakout.direction,
            confidenceScore: Math.max(Number(candidate.ai.analysisScorecard.confidenceScore ?? 0), confidence),
            riskLevel: candidate.ai.analysisScorecard.riskLevel === "HIGH" && breakout.stage !== "LATE" ? "MEDIUM" : candidate.ai.analysisScorecard.riskLevel,
          }
        : candidate.ai.analysisScorecard,
    },
  };
}

function resolvePumpAdaptiveDurationSec(context: ScannerCandidate["context"], requested?: number) {
  const requestedSec = Number(requested ?? 900);
  return resolvePumpRoundMaxWaitSec({
    baseMaxWaitSec: Math.max(requestedSec, 900),
    context,
    explanation: String(context.metadata.pumpEarlyCatcher ? "PUMP_EARLY" : ""),
  });
}

function tracePumpCandidateReject(symbol: string, reasonCode: string, reasonDetail: string) {
  traceCandidateReject({
    symbol,
    stage: "candidate",
    reasonCode,
    reasonDetail,
  });
}

function traceScanCycleWait(pool: ScannerCandidate[], reasonCode: string, reasonDetail: string) {
  traceCandidateWait({
    symbol: pool[0]?.context.symbol ?? "SCAN_CYCLE",
    stage: "scanner",
    reasonCode,
    reasonDetail,
  });
}

async function confirmPumpEarlyCandidate(input: {
  base: ScannerCandidate;
  runtimeStrategy: Awaited<ReturnType<typeof getRuntimeStrategyParams>>;
  maxDurationSec?: number;
  mode?: "early" | "continuation" | "intraday";
  runtime?: FastEntryRuntimeHooks;
}) {
  const stopHeartbeat = startPeriodicRuntimeHeartbeat(input.runtime?.onHeartbeat);
  try {
    await input.runtime?.ensureActive?.();
    input.runtime?.shouldAbort?.();
    const liveContext = await withBoundedAwait(
      `pump-context:${input.base.context.symbol}`,
      buildMarketContext(input.base.context.symbol, { lite: false, priority: "critical" }),
      resolveMarketContextTimeoutMs(),
      input.runtime?.asyncTelemetry,
    );
  const adaptiveDurationSec = resolvePumpAdaptiveDurationSec(liveContext, input.maxDurationSec);
  const breakout = evaluateMomentumBreakout(liveContext);
  const tapeMomentum = Number(liveContext.metadata.shortMomentumPercent ?? 0);
  const hourMomentum = Number(liveContext.metadata.hourMomentumPercent ?? 0);
  const shortMomentum = resolveEffectiveShortMomentum(liveContext);
  const marketRegime = String(liveContext.metadata.marketRegime ?? "RANGE_SIDEWAYS");
  const shortFlow = Number(liveContext.metadata.shortFlowImbalance ?? 0);
  const tradeVelocity = Number(liveContext.metadata.tradeVelocity ?? 0);
  const change24h = Number(liveContext.metadata.topGainerChange24h ?? liveContext.change24h ?? 0);
  const maxMove = Math.max(Math.abs(shortMomentum), Math.abs(liveContext.momentumPercent));
  const isIntraday =
    input.mode === "intraday" ||
    Boolean(liveContext.metadata.pumpIntradaySpike ?? input.base.context.metadata.pumpIntradaySpike);
  const isContinuation =
    input.mode === "continuation" ||
    isIntraday ||
    Boolean(liveContext.metadata.pumpContinuationMode ?? input.base.context.metadata.pumpContinuationMode);
  const isPaperMode = env.EXECUTION_MODE === "paper";
  const minMomentum = isIntraday
    ? env.PUMP_INTRADAY_MIN_SHORT_MOMENTUM
    : env.PUMP_CONTINUATION_MIN_SHORT_MOMENTUM;
  const minFlow = isIntraday ? env.PUMP_INTRADAY_MIN_FLOW : env.PUMP_CONTINUATION_MIN_FLOW;
  const minChange24h = isIntraday ? env.PUMP_INTRADAY_MIN_CHANGE_24H : env.PUMP_CONTINUATION_MIN_CHANGE_24H;
  const stillEarly =
    breakout.direction === "BUY" &&
    breakout.ok &&
    breakout.stage !== "LATE" &&
    maxMove <= env.PUMP_EARLY_CATCHER_MAX_CHASE_PERCENT &&
    liveContext.fakeSpikeScore <= (isPaperMode ? 4.0 : 2.15) &&
    liveContext.pumpRisk <= (isPaperMode ? 92 : 72) &&
    liveContext.spreadPercent <= (isPaperMode ? 0.4 : 0.24) &&
    shortFlow >= (isPaperMode ? 0.005 : 0.045) &&
    tradeVelocity >= (isPaperMode ? 0.03 : 0.25);
  const minTapeForContinuation = isPaperMode
    ? (change24h >= 15 ? 0.02 : change24h >= 8 ? 0.01 : minMomentum * 0.3)
    : (change24h >= 28 ? 0.55 : change24h >= 18 ? 0.35 : change24h >= 12 ? 0.2 : minMomentum);
  const tapeLedMomentum =
    tapeMomentum >= minTapeForContinuation ||
    (isPaperMode && change24h >= 6 && tapeMomentum >= -0.05) ||
    (tapeMomentum >= 0.12 && hourMomentum >= 2 && shortFlow >= 0.45) ||
    (tapeMomentum >= 0.08 && hourMomentum >= 2.8 && shortFlow >= 0.55);
  const stillContinuation =
    isContinuation &&
    change24h >= (isPaperMode ? Math.min(minChange24h, 2) : minChange24h) &&
    change24h <= env.PUMP_CONTINUATION_MAX_CHANGE_24H &&
    tapeLedMomentum &&
    shortFlow >= (isPaperMode ? 0.003 : minFlow) &&
    tapeMomentum > (isPaperMode ? -0.15 : -0.02) &&
    liveContext.spreadPercent <= (isPaperMode ? 0.5 : isIntraday ? 0.3 : 0.28) &&
    liveContext.fakeSpikeScore <= (isPaperMode ? 4.5 : isIntraday ? 3 : 2.8) &&
    liveContext.pumpRisk <= (isPaperMode ? 94 : isIntraday ? 88 : 85) &&
    tradeVelocity >= (isPaperMode ? 0.02 : isIntraday ? 0.04 : 0.06);
  if (!stillEarly && !stillContinuation) {
    tracePumpCandidateReject(
      input.base.context.symbol,
      "PUMP_NOT_EARLY_OR_CONTINUATION",
      "Candidate failed early/continuation gate",
    );
    return null;
  }

  const pumpSafety = evaluatePumpEntrySafety({
    context: liveContext,
    tapeMomentum,
    hourMomentum,
    shortFlow,
    change24h,
    pumpStage: breakout.stage,
    marketRegime,
    compositeAvg: 0,
  });
  if (!pumpSafety.ok) {
    const safetyOverride =
      (isPaperMode && change24h >= 4 && liveContext.pumpRisk <= 95 && liveContext.spreadPercent <= 0.5) ||
      (change24h >= minChange24h &&
        breakout.ok &&
        (breakout.stage === "EARLY" || breakout.stage === "ACTIVE") &&
        (breakout.score >= 82 || isStrongHourPumpContext({ change24h, hourMomentum, tapeMomentum, shortFlow })) &&
        tapeMomentum >= 0.12 &&
        hourMomentum >= 0.6 &&
        shortFlow >= 0.12 &&
        liveContext.spreadPercent <= 0.32 &&
        liveContext.fakeSpikeScore <= 3.2 &&
        liveContext.pumpRisk <= 86);
    if (!safetyOverride) {
      tracePumpCandidateReject(
        input.base.context.symbol,
        "PUMP_SAFETY_FAILED",
        pumpSafety.reason ?? "Pump safety check failed",
      );
      return null;
    }
  }

  const score = scoreContext(liveContext);
  const aiInput = await formatAIRequest(
    liveContext,
    {
      ...input.runtimeStrategy,
      scannerScore: score.score,
      maxDurationSec: adaptiveDurationSec,
      pumpEarlyCatcher: true,
      pumpAdaptiveDurationSec: adaptiveDurationSec,
      executionIntent: "PUMP_MARKET_BUY",
    },
    undefined,
  );
  await input.runtime?.onAiAnalysis?.(liveContext.symbol, "started");
  const ai = await withBoundedAwait(
    `pump-ai:${liveContext.symbol}`,
    runAIConsensusFromInput(aiInput),
    resolveAiConsensusTimeoutMs(),
    input.runtime?.asyncTelemetry,
  );
  await input.runtime?.onAiAnalysis?.(liveContext.symbol, "completed", ai.finalDecision);
  const riskVeto = Boolean(ai.roleScores?.find((row) => row.role === "AI-3_RISK")?.veto);
  const roleScores = ai.roleScores ?? [];
  const technicalRole = Number(roleScores.find((row) => row.role === "AI-1_TECHNICAL")?.score ?? 0);
  const sentimentRole = Number(roleScores.find((row) => row.role === "AI-2_SENTIMENT")?.score ?? 0);
  const riskRole = Number(roleScores.find((row) => row.role === "AI-3_RISK")?.score ?? 0);
  const compositeParts = [technicalRole, sentimentRole, riskRole].filter((value) => value > 0);
  const compositeAvg =
    compositeParts.length > 0 ? compositeParts.reduce((sum, value) => sum + value, 0) / compositeParts.length : 0;
  const weakPumpAiProfile =
    stillContinuation &&
    change24h < 28 &&
    (technicalRole < 48 || compositeAvg < 54 || (technicalRole < 52 && sentimentRole < 58));
  const weakPumpRangeMomentum =
    stillContinuation &&
    marketRegime === "RANGE_SIDEWAYS" &&
    !(
      change24h >= 15 &&
      hourMomentum >= 1 &&
      tapeMomentum >= 0.12 &&
      shortFlow >= 0.25 &&
      compositeAvg >= 60
    ) &&
    (change24h < 28 || shortMomentum < 0.55 || shortFlow < 0.12);
  const weakPumpRangeStructure =
    stillContinuation &&
    marketRegime === "RANGE_SIDEWAYS" &&
    (compositeAvg < 62 || Number(liveContext.metadata.mtfAlignment ?? ai.decisionPayload?.timeframeAnalysis?.alignmentScore ?? 0) < 50);
  const weakPumpRocketContinuation =
    stillContinuation &&
    marketRegime === "ROCKET_PUMP" &&
    !(
      change24h >= 15 &&
      hourMomentum >= 1 &&
      tapeMomentum >= 0.12 &&
      shortFlow >= 0.25 &&
      compositeAvg >= 62
    ) &&
    (breakout.score < 85 ||
      shortMomentum < 0.75 ||
      shortFlow < 0.28 ||
      compositeAvg < 64 ||
      technicalRole < 62);
  const weakPumpLateTapeChase =
    stillContinuation &&
    breakout.stage === "LATE" &&
    tapeMomentum < 0.35 &&
    !isStrongHourPumpContext({ change24h, hourMomentum, tapeMomentum, shortFlow });
  const weakPumpCalmRegime =
    stillContinuation &&
    marketRegime === "LOW_VOLATILITY_CALM" &&
    (tapeMomentum < 0.45 || breakout.stage === "LATE" || compositeAvg < 66) &&
    !isStrongHourPumpContext({ change24h, hourMomentum, tapeMomentum, shortFlow });
  const weakPumpHourOnlyMomentum =
    isFakeHourOnlyPump({
      hourMomentum,
      tapeMomentum,
      shortFlow,
      marketRegime,
      pumpStage: breakout.stage,
    });
  if (
    weakPumpAiProfile ||
    weakPumpRangeMomentum ||
    weakPumpRangeStructure ||
    weakPumpRocketContinuation ||
    weakPumpLateTapeChase ||
    weakPumpCalmRegime ||
    weakPumpHourOnlyMomentum
  ) {
    tracePumpCandidateReject(
      input.base.context.symbol,
      "PUMP_WEAK_PROFILE",
      "Pump weak profile composite gate",
    );
    return null;
  }
  const pumpSafetyFinal = evaluatePumpEntrySafety({
    context: liveContext,
    tapeMomentum,
    hourMomentum,
    shortFlow,
    change24h,
    pumpStage: breakout.stage,
    marketRegime,
    compositeAvg,
  });
  if (!pumpSafetyFinal.ok) {
    tracePumpCandidateReject(
      input.base.context.symbol,
      "PUMP_SAFETY_FINAL_FAILED",
      pumpSafetyFinal.reason ?? "Final pump safety check failed",
    );
    return null;
  }
  if (riskVeto || ai.finalRiskScore > (stillContinuation ? 82 : 78)) {
    tracePumpCandidateReject(
      input.base.context.symbol,
      riskVeto ? "PUMP_RISK_VETO" : "PUMP_RISK_SCORE_HIGH",
      riskVeto ? "AI risk veto" : `finalRiskScore=${ai.finalRiskScore}`,
    );
    return null;
  }
  const aiBuy = ai.finalDecision === "BUY" && !ai.rejected && ai.finalConfidence >= (stillContinuation ? 40 : 45);
  const highQualityOverride =
    !aiBuy &&
    ai.finalRiskScore <= (stillContinuation ? 72 : 64) &&
    breakout.score >= (stillContinuation ? 75 : 72) &&
    shortMomentum >= (stillContinuation ? 0.75 : 1.2) &&
    shortFlow >= (stillContinuation ? 0.28 : 0.08);
  const continuationOverride =
    stillContinuation &&
    !aiBuy &&
    !riskVeto &&
    change24h >= minChange24h &&
    shortMomentum >= Math.max(minMomentum, 0.55) &&
    ai.finalRiskScore <= 80 &&
    String(liveContext.metadata.marketRegime ?? "RANGE_SIDEWAYS") !== "RANGE_SIDEWAYS";
  const strongGainerBypass =
    stillContinuation &&
    !aiBuy &&
    !riskVeto &&
    change24h >= 28 &&
    shortMomentum >= 0.55 &&
    shortFlow >= 0.12 &&
    liveContext.spreadPercent <= 0.32 &&
    ai.finalRiskScore <= 82 &&
    compositeAvg >= 62 &&
    (technicalRole >= 52 || change24h >= 35);
  if (!aiBuy && !highQualityOverride && !continuationOverride && !strongGainerBypass) {
    tracePumpCandidateReject(
      input.base.context.symbol,
      "PUMP_NO_BUY_SIGNAL",
      `AI decision=${ai.finalDecision}, rejected=${ai.rejected}`,
    );
    return null;
  }

  const confidence = aiBuy
    ? Math.max(ai.finalConfidence, Math.min(stillContinuation ? 76 : 82, breakout.score || change24h * 0.55))
    : Math.min(stillContinuation ? 72 : 78, Math.max(stillContinuation ? 52 : 62, breakout.score || change24h * 0.45));
  const laneTag = isIntraday ? "PUMP_INTRADAY" : stillContinuation ? "PUMP_CONTINUATION" : "PUMP_EARLY_CATCHER";
  return {
    rank: 1,
    context: {
      ...liveContext,
      metadata: {
        ...liveContext.metadata,
        pumpEarlyCatcher: true,
        pumpEarlyConfirmed: true,
        pumpContinuationMode: stillContinuation,
        pumpIntradaySpike: isIntraday,
        pumpEarlyOrderType: "MARKET",
        pumpEarlyMaxDurationSec: adaptiveDurationSec,
        pumpAdaptiveDurationSec: adaptiveDurationSec,
      },
    },
    score,
    ai: {
      ...ai,
      finalDecision: "BUY" as AIDecision,
      finalConfidence: Number(confidence.toFixed(2)),
      rejected: false,
      rejectReason: undefined,
      explanation: `${ai.explanation} | ${laneTag} market-buy priority: ${breakout.stage}, score=${breakout.score}, 24h=${change24h.toFixed(2)}%, short=${tapeMomentum.toFixed(2)}%, hour=${hourMomentum.toFixed(2)}%, flow=${shortFlow.toFixed(3)}`,
      analysisScorecard: ai.analysisScorecard
        ? {
            ...ai.analysisScorecard,
            direction: "BUY",
            confidenceScore: Math.max(ai.analysisScorecard.confidenceScore, confidence),
            riskLevel: ai.analysisScorecard.riskLevel === "HIGH" ? "MEDIUM" : ai.analysisScorecard.riskLevel,
            timeHorizonMinutes: Math.max(ai.analysisScorecard.timeHorizonMinutes, Math.round(adaptiveDurationSec / 60)),
          }
        : ai.analysisScorecard,
    },
  } satisfies ScannerCandidate;
  } finally {
    stopHeartbeat();
  }
}

function selectTradableCandidates(
  candidates: ScannerCandidate[],
  policy: { minConfidence: number; requireUnanimous: boolean },
  options?: { relaxed?: boolean; paperMode?: boolean },
) {
  const relaxed = options?.relaxed ?? false;
  const paperMode = options?.paperMode ?? false;
  const baseMinConfidence = env.AI_ULTRA_PRECISION_MODE
    ? Math.max(policy.minConfidence, env.AI_SPOT_MIN_CONFIDENCE_ULTRA)
    : policy.minConfidence;
  const minConfidence = relaxed ? Math.max(50, baseMinConfidence - 25) : baseMinConfidence;
  const maxSpike = relaxed ? 2.8 : 2.2;
  const baseMaxSpread = Math.max(0.12, env.SCANNER_MAX_SPREAD_PERCENT);
  const maxSpread = relaxed ? Math.min(0.35, baseMaxSpread + 0.07) : Math.min(0.3, baseMaxSpread);
  // tradeVelocity skoru bazi sembollerde oldukca dusuk scale donuyor; production'da asiri elememek icin esik yumusatildi.
  const minVelocity = relaxed ? 0.015 : 0.035;
  const minFlow = relaxed ? 0.012 : 0.02;

  const normalized = candidates
    .map<ScannerCandidate | null>((candidate) => {
      if (!candidate.ai) return null;
      if (env.EXECUTION_MODE === "live" && env.BINANCE_PLATFORM === "tr" && candidate.ai.finalDecision !== "BUY") {
        const breakout = evaluateMomentumBreakout(candidate.context);
        if (!breakout.ok || breakout.direction !== "BUY") return null;
      }
      if (!candidate.ai.rejected && (candidate.ai.finalDecision === "BUY" || candidate.ai.finalDecision === "SELL")) {
        return candidate;
      }
      const breakout = evaluateMomentumBreakout(candidate.context);
      if (!breakout.ok) return null;
      const regime = String(candidate.context.metadata.marketRegime ?? "RANGE_SIDEWAYS");
      if (paperMode && regime === "RANGE_SIDEWAYS") return null;
      if (paperMode && breakout.score < 58) return null;
      if (paperMode) {
        const roles = candidate.ai.roleScores ?? [];
        const sentiment = Number(roles.find((row) => row.role === "AI-2_SENTIMENT")?.score ?? 0);
        if (sentiment > 0 && sentiment < 58) return null;
      }
      return withMomentumBreakoutOverride(candidate);
    })
    .filter((x): x is ScannerCandidate => Boolean(x));

  return normalized
    .map((candidate) => ({
      candidate,
      window: evaluateProfitWindow(candidate, relaxed),
    }))
    .filter(({ candidate }) => {
      const degraded = isAiOutputDegraded(candidate);
      const candidateMinConfidence = degraded
        ? Math.max(40, minConfidence - 16)
        : minConfidence;
      return (candidate.ai?.finalConfidence ?? 0) >= candidateMinConfidence;
    })
    .filter(({ candidate }) => candidate.context.fakeSpikeScore <= maxSpike)
    .filter(({ candidate }) => {
      const regime = String(candidate.context.metadata.marketRegime ?? "RANGE_SIDEWAYS");
      const tfAlignment = Number(candidate.ai?.decisionPayload?.timeframeAnalysis?.alignmentScore ?? 0);
      const volume = Number(candidate.context.volume24h ?? 0);
      let adaptiveSpreadLimit = maxSpread;
      if (regime === "HIGH_VOLATILITY_CHAOS" || regime === "NEWS_DRIVEN_UNSTABLE") {
        adaptiveSpreadLimit = Math.min(adaptiveSpreadLimit, relaxed ? 0.2 : 0.16);
      }
      if (volume >= env.SCANNER_MIN_VOLUME_24H * 6 && tfAlignment >= 72) {
        adaptiveSpreadLimit = Math.min(0.35, adaptiveSpreadLimit + 0.04);
      }
      const breakout = evaluateMomentumBreakout(candidate.context);
      return candidate.context.spreadPercent <= adaptiveSpreadLimit || (breakout.ok && candidate.context.spreadPercent <= 0.22);
    })
    .filter(({ candidate }) => Number(candidate.context.metadata.tradeVelocity ?? 0) >= minVelocity)
    .filter(({ candidate }) => Math.abs(Number(candidate.context.metadata.shortFlowImbalance ?? 0)) >= minFlow)
    .filter(({ candidate }) => String(candidate.context.metadata.marketRegime ?? "RANGE_SIDEWAYS") !== "LOW_VOLUME_DEAD_MARKET")
    .filter(({ candidate }) => {
      const regime = String(candidate.context.metadata.marketRegime ?? "RANGE_SIDEWAYS");
      if (regime !== "HIGH_VOLATILITY_CHAOS" && regime !== "NEWS_DRIVEN_UNSTABLE") return true;
      const breakout = evaluateMomentumBreakout(candidate.context);
      return breakout.ok || (candidate.context.spreadPercent <= 0.12 && candidate.context.fakeSpikeScore <= 1.8);
    })
    .filter(({ candidate }) => {
      const regime = String(candidate.context.metadata.marketRegime ?? "RANGE_SIDEWAYS");
      if (regime !== "LOW_VOLATILITY_CALM") return true;
      const shortMomentum = Math.abs(Number(candidate.context.metadata.shortMomentumPercent ?? 0));
      return shortMomentum >= 0.08;
    })
    .filter(({ candidate, window }) => window.ok || momentumWindowOk(candidate, relaxed))
    .filter(({ candidate }) =>
      policy.requireUnanimous ? isUnanimousDecision(candidate, candidate.ai?.finalDecision ?? "HOLD") : true,
    )
    .filter(({ candidate }) => passesUltraPrecisionSpotGate(candidate))
    .sort((a, b) => rankForFastEntry(b.candidate) - rankForFastEntry(a.candidate))
    .map((row) => row.candidate);
}

function hasEnoughExpectedProfit(candidate: ScannerCandidate, relaxed = false) {
  return evaluateProfitWindow(candidate, relaxed).ok;
}

function buildNoTradeDiagnostics(
  candidates: ScannerCandidate[],
  minConfidence: number,
  scannedTotal?: number,
  qualifiedTotal?: number,
): NonNullable<FastEntryResult["diagnostics"]> {
  const fallbackCount = candidates.length;
  const effectiveScanned = scannedTotal && scannedTotal > 0 ? scannedTotal : fallbackCount;
  const effectiveQualified = qualifiedTotal && qualifiedTotal > 0 ? qualifiedTotal : fallbackCount;
  const breakdown = {
    noAi: 0,
    aiRejected: 0,
    noTradeDecision: 0,
    lowConfidence: 0,
    highSpread: 0,
    highFakeSpike: 0,
    lowTradeVelocity: 0,
    lowFlowImbalance: 0,
  };

  const sampleRejected: Array<{
    symbol: string;
    decision: string;
    confidence: number;
    spreadPercent: number;
    fakeSpikeScore: number;
    shortFlowImbalance: number;
    tradeVelocity: number;
    marketRegime: string;
    notes: string[];
  }> = [];

  for (const row of candidates) {
    const notes: string[] = [];
    if (!row.ai) {
      breakdown.noAi += 1;
      notes.push("ai_missing");
    } else {
      if (row.ai.rejected) {
        breakdown.aiRejected += 1;
        notes.push("ai_rejected");
      }
      if (row.ai.finalDecision !== "BUY" && row.ai.finalDecision !== "SELL") {
        breakdown.noTradeDecision += 1;
        notes.push(`decision_${row.ai.finalDecision}`);
      }
      if ((row.ai.finalConfidence ?? 0) < minConfidence) {
        breakdown.lowConfidence += 1;
        notes.push(`conf_${Number(row.ai.finalConfidence ?? 0).toFixed(2)}<${minConfidence}`);
      }
    }

    if (row.context.spreadPercent > 0.18) {
      breakdown.highSpread += 1;
      notes.push(`spread_${row.context.spreadPercent.toFixed(4)}`);
    }
    if (row.context.fakeSpikeScore > 2.2) {
      breakdown.highFakeSpike += 1;
      notes.push(`fakeSpike_${row.context.fakeSpikeScore.toFixed(2)}`);
    }
    const velocity = Number(row.context.metadata.tradeVelocity ?? 0);
    if (velocity < 0.12) {
      breakdown.lowTradeVelocity += 1;
      notes.push(`velocity_${velocity.toFixed(3)}`);
    }
    const flow = Math.abs(Number(row.context.metadata.shortFlowImbalance ?? 0));
    if (flow < 0.03) {
      breakdown.lowFlowImbalance += 1;
      notes.push(`flow_${flow.toFixed(3)}`);
    }

    if (notes.length > 0 && sampleRejected.length < 6) {
      sampleRejected.push({
        symbol: row.context.symbol,
        decision: row.ai?.finalDecision ?? "NO_AI",
        confidence: Number(row.ai?.finalConfidence ?? 0),
        spreadPercent: Number(row.context.spreadPercent.toFixed(4)),
        fakeSpikeScore: Number(row.context.fakeSpikeScore.toFixed(2)),
        shortFlowImbalance: Number(row.context.metadata.shortFlowImbalance ?? 0),
        tradeVelocity: Number(row.context.metadata.tradeVelocity ?? 0),
        marketRegime: String(row.context.metadata.marketRegime ?? "RANGE_SIDEWAYS"),
        notes,
      });
    }
  }

  return {
    candidateCount: candidates.length,
    tradableCount: 0,
    scannedTotal: effectiveScanned,
    qualifiedTotal: effectiveQualified,
    minConfidence,
    requireUnanimous: false,
    rejectionBreakdown: breakdown,
    sampleRejected,
  };
}

function selectRecoveryCandidatesFromRoleSignals(candidates: ScannerCandidate[], minConfidence: number) {
  const minRecoveryConfidence = Math.max(46, minConfidence - 14);
  return candidates
    .filter((candidate) => candidate.ai && !candidate.ai.rejected)
    .filter((candidate) => {
      const ai = candidate.ai!;
      if ((ai.finalConfidence ?? 0) < minRecoveryConfidence) return false;
      if ((ai.finalRiskScore ?? 100) > 42) return false;
      if (candidate.context.spreadPercent > 0.12) return false;
      if (candidate.context.volatilityPercent > 2.4) return false;
      if (candidate.context.volume24h < env.SCANNER_MIN_VOLUME_24H * 2) return false;
      const tf = ai.decisionPayload?.timeframeAnalysis;
      if (!tf?.trendAligned || !tf?.entrySuitable) return false;
      if (Number(tf.alignmentScore ?? 0) < 70) return false;
      const vetoBlockedBy = ai.decisionPayload?.consensusEngine?.vetoStatus?.blockedBy ?? [];
      if (Array.isArray(vetoBlockedBy) && vetoBlockedBy.includes("AI-3_RISK")) return false;
      const roleScores = ai.roleScores ?? [];
      const tech = roleScores.find((x) => x.role === "AI-1_TECHNICAL");
      const sentiment = roleScores.find((x) => x.role === "AI-2_SENTIMENT");
      const risk = roleScores.find((x) => x.role === "AI-3_RISK");
      const sentimentSupport = sentiment && (sentiment.decision === "BUY" || sentiment.score >= 68);
      const technicalNotWeak = tech && tech.score >= 45;
      const riskNotVeto = risk && !risk.veto && risk.score >= 48;
      return Boolean(sentimentSupport && technicalNotWeak && riskNotVeto);
    })
    .sort((a, b) => {
      const aAi = a.ai!;
      const bAi = b.ai!;
      const aSent = aAi.roleScores?.find((x) => x.role === "AI-2_SENTIMENT")?.score ?? 0;
      const bSent = bAi.roleScores?.find((x) => x.role === "AI-2_SENTIMENT")?.score ?? 0;
      const aAlign = Number(aAi.decisionPayload?.timeframeAnalysis?.alignmentScore ?? 0);
      const bAlign = Number(bAi.decisionPayload?.timeframeAnalysis?.alignmentScore ?? 0);
      const aScore = aSent * 0.4 + aAlign * 0.3 + a.score.score * 0.3;
      const bScore = bSent * 0.4 + bAlign * 0.3 + b.score.score * 0.3;
      return bScore - aScore;
    });
}

function isBlockedByHardRisk(candidate: ScannerCandidate) {
  const ai = candidate.ai;
  const roleRisk = ai?.roleScores?.find((x) => x.role === "AI-3_RISK");
  const blockedBy = ai?.decisionPayload?.consensusEngine?.vetoStatus?.blockedBy ?? [];
  return Boolean(roleRisk?.veto || (Array.isArray(blockedBy) && blockedBy.includes("AI-3_RISK")));
}

function selectPaperLearningMicroCandidates(candidates: ScannerCandidate[], minConfidence: number) {
  const minLearningConfidence = Math.max(25, minConfidence - 18);
  return candidates
    .filter((candidate) => candidate.ai)
    .filter((candidate) => isTryQuotedSymbol(candidate.context.symbol))
    .filter((candidate) => candidate.context.spreadPercent <= 0.18)
    .filter((candidate) => candidate.context.fakeSpikeScore <= 2.4)
    .filter((candidate) => Number(candidate.context.volume24h ?? 0) >= env.SCANNER_MIN_VOLUME_24H * 0.8)
    .filter((candidate) => {
      const regime = String(candidate.context.metadata.marketRegime ?? "RANGE_SIDEWAYS");
      return regime !== "LOW_VOLUME_DEAD_MARKET" && regime !== "HIGH_VOLATILITY_CHAOS" && regime !== "NEWS_DRIVEN_UNSTABLE" && regime !== "RANGE_SIDEWAYS";
    })
    .filter((candidate) => {
      const timeframe = candidate.ai?.decisionPayload?.timeframeAnalysis;
      const lifecycle = String(candidate.context.metadata.regimeLifecyclePhase ?? "");
      const flow = Math.abs(Number(candidate.context.metadata.shortFlowImbalance ?? 0));
      const velocity = Number(candidate.context.metadata.tradeVelocity ?? 0);
      if (!timeframe) return true;
      if (timeframe.conflict && Number(timeframe.alignmentScore ?? 0) < 30) return false;
      if (Number(timeframe.alignmentScore ?? 0) <= 0 && lifecycle === "STABLE" && flow >= 0.08 && velocity >= 0.008) {
        return true;
      }
      return Number(timeframe.alignmentScore ?? 0) >= 20;
    })
    .filter((candidate) => !isBlockedByHardRisk(candidate) || Number(candidate.ai?.finalRiskScore ?? 0) < 78)
    .filter((candidate) => Number(candidate.ai?.finalRiskScore ?? 100) <= 78)
    .filter((candidate) => Number(candidate.ai?.finalConfidence ?? 0) >= minLearningConfidence)
    .filter((candidate) => {
      const roleScores = candidate.ai?.roleScores ?? [];
      const technical = Number(roleScores.find((x) => x.role === "AI-1_TECHNICAL")?.score ?? 0);
      const sentiment = Number(roleScores.find((x) => x.role === "AI-2_SENTIMENT")?.score ?? 0);
      const risk = Number(roleScores.find((x) => x.role === "AI-3_RISK")?.score ?? 0);
      const riskVeto = Boolean(roleScores.find((x) => x.role === "AI-3_RISK")?.veto);
      const regime = String(candidate.context.metadata.marketRegime ?? "RANGE_SIDEWAYS");
      const weakRoleData = technical <= 0 && sentiment <= 0 && risk <= 0;
      if (weakRoleData) return false;
      if (riskVeto) return false;
      if (technical < 56 || sentiment < 56 || risk < 60) return false;
      if (regime === "RANGE_SIDEWAYS") {
        const composite = (technical + sentiment + risk) / 3;
        if (sentiment < 60 || composite < 64) return false;
      }
      return true;
    })
    .filter((candidate) => Number(candidate.context.metadata.tradeVelocity ?? 0) >= 0.006)
    .filter((candidate) => {
      const shortMomentum = Number(candidate.context.metadata.shortMomentumPercent ?? 0);
      const shortFlow = Number(candidate.context.metadata.shortFlowImbalance ?? 0);
      return shortFlow >= 0.08 || shortMomentum >= 0.035;
    })
    .map((candidate) => {
      const ai = candidate.ai!;
      const roleScores = ai.roleScores ?? [];
      const technical = roleScores.find((x) => x.role === "AI-1_TECHNICAL");
      const sentiment = roleScores.find((x) => x.role === "AI-2_SENTIMENT");
      const risk = roleScores.find((x) => x.role === "AI-3_RISK");
      const directionalBias = "BUY";
      const explanation = [
        ai.explanation ?? "paper learning micro candidate",
        `learning-micro=${directionalBias}`,
        `tech=${Number(technical?.score ?? 0).toFixed(1)}`,
        `sentiment=${Number(sentiment?.score ?? 0).toFixed(1)}`,
        `risk=${Number(risk?.score ?? 0).toFixed(1)}`,
      ].join(" | ");
      return {
        ...candidate,
        ai: {
          ...ai,
          finalDecision: directionalBias as AIDecision,
          finalConfidence: Math.max(50, Number(ai.finalConfidence ?? 0)),
          rejected: false,
          explanation,
          decisionPayload: ai.decisionPayload
            ? {
                ...ai.decisionPayload,
                executionAction: "OPEN",
                executionReason: "paper-learning-micro",
                noTradeMode: undefined,
              }
            : ai.decisionPayload,
          analysisScorecard: ai.analysisScorecard
            ? {
                ...ai.analysisScorecard,
                direction: directionalBias === "BUY" ? "BUY" : "SELL",
                confidenceScore: Math.max(50, Number(ai.analysisScorecard.confidenceScore ?? ai.finalConfidence ?? 0)),
                riskLevel: ai.analysisScorecard.riskLevel === "HIGH" ? "MEDIUM" : ai.analysisScorecard.riskLevel,
              }
            : ai.analysisScorecard,
        },
      } satisfies ScannerCandidate;
    })
    .sort((a, b) => rankForFastEntry(b) - rankForFastEntry(a));
}

function selectPaperSteadyGainCandidates(candidates: ScannerCandidate[], minConfidence: number) {
  const minComposite = 66;
  return candidates
    .filter((candidate) => candidate.ai && !candidate.ai.rejected)
    .filter((candidate) => candidate.ai?.finalDecision === "BUY")
    .filter((candidate) => isTryQuotedSymbol(candidate.context.symbol))
    .filter((candidate) => candidate.context.spreadPercent <= 0.14)
    .filter((candidate) => candidate.context.fakeSpikeScore <= 2.2)
    .filter((candidate) => Number(candidate.context.volume24h ?? 0) >= env.SCANNER_MIN_VOLUME_24H * 0.85)
    .filter((candidate) => !isBlockedByHardRisk(candidate))
    .filter((candidate) => Number(candidate.ai?.finalRiskScore ?? 100) <= 66)
    .filter((candidate) => Number(candidate.ai?.finalConfidence ?? 0) >= Math.max(52, minConfidence))
    .filter((candidate) => {
      const regime = String(candidate.context.metadata.marketRegime ?? "RANGE_SIDEWAYS");
      return regime !== "HIGH_VOLATILITY_CHAOS" && regime !== "NEWS_DRIVEN_UNSTABLE" && regime !== "LOW_VOLUME_DEAD_MARKET";
    })
    .filter((candidate) => {
      const roleScores = candidate.ai?.roleScores ?? [];
      const technical = Number(roleScores.find((x) => x.role === "AI-1_TECHNICAL")?.score ?? 0);
      const sentiment = Number(roleScores.find((x) => x.role === "AI-2_SENTIMENT")?.score ?? 0);
      const risk = Number(roleScores.find((x) => x.role === "AI-3_RISK")?.score ?? 0);
      const composite = (technical + sentiment + risk) / 3;
      const mtf = Number(candidate.ai?.decisionPayload?.timeframeAnalysis?.alignmentScore ?? 0);
      const regime = String(candidate.context.metadata.marketRegime ?? "RANGE_SIDEWAYS");
      const shortMomentum = Math.max(
        Number(candidate.context.metadata.shortMomentumPercent ?? 0),
        Number(candidate.context.metadata.hourMomentumPercent ?? 0),
      );
      const shortFlow = Number(candidate.context.metadata.shortFlowImbalance ?? 0);
      if (composite < minComposite || sentiment < 60 || technical < 52 || risk < 58) return false;
      if (regime === "RANGE_SIDEWAYS" && (composite < 70 || (mtf > 0 && mtf < 48))) return false;
      if (regime !== "RANGE_SIDEWAYS" && mtf > 0 && mtf < 48) return false;
      if (shortMomentum < 0.03 && shortFlow < 0.018) return false;
      return true;
    })
    .map((candidate) => {
      const ai = candidate.ai!;
      return {
        ...candidate,
        ai: {
          ...ai,
          finalDecision: "BUY" as AIDecision,
          rejected: false,
          explanation: `${ai.explanation ?? "steady gain candidate"} | steady-gain=1h | target=0.85-1.0%`,
        },
      } satisfies ScannerCandidate;
    })
    .sort((a, b) => rankForFastEntry(b) - rankForFastEntry(a));
}

function selectPaperPumpLaneCandidates(candidates: ScannerCandidate[], minConfidence: number) {
  return candidates
    .filter((candidate) => candidate.ai && !candidate.ai.rejected)
    .filter((candidate) => isTryQuotedSymbol(candidate.context.symbol))
    .filter((candidate) => !isBlockedByHardRisk(candidate))
    .map<ScannerCandidate | null>((candidate) => {
      const ai = candidate.ai!;
      const meta = candidate.context.metadata;
      const breakout = evaluateMomentumBreakout(candidate.context);
      const tapeMomentum = Number(meta.shortMomentumPercent ?? 0);
      const hourMomentum = Number(meta.hourMomentumPercent ?? 0);
      const shortMomentum = resolveEffectiveShortMomentum(candidate.context);
      const shortFlow = Number(meta.shortFlowImbalance ?? 0);
      const change24h = Number(meta.topGainerChange24h ?? candidate.context.change24h ?? 0);
      const marketRegime = String(meta.marketRegime ?? "RANGE_SIDEWAYS");
      const topGainerPump =
        Boolean(meta.topGainerDiscovery ?? false) ||
        Boolean(meta.pumpEarlyConfirmed ?? false) ||
        Boolean(meta.pumpContinuationMode ?? false) ||
        Boolean(meta.pumpIntradaySpike ?? false) ||
        Number(meta.topGainerPriorityScore ?? 0) >= 70;
      const roleScores = ai.roleScores ?? [];
      const technical = Number(roleScores.find((x) => x.role === "AI-1_TECHNICAL")?.score ?? 0);
      const sentiment = Number(roleScores.find((x) => x.role === "AI-2_SENTIMENT")?.score ?? 0);
      const risk = Number(roleScores.find((x) => x.role === "AI-3_RISK")?.score ?? 0);
      const compositeParts = [technical, sentiment, risk].filter((value) => value > 0);
      const compositeAvg =
        compositeParts.length > 0 ? compositeParts.reduce((sum, value) => sum + value, 0) / compositeParts.length : 0;
      const riskVeto = isBlockedByHardRisk(candidate);
      const pumpSafety = evaluatePumpEntrySafety({
        context: candidate.context,
        tapeMomentum,
        hourMomentum,
        shortFlow,
        change24h,
        pumpStage: breakout.stage,
        marketRegime,
        compositeAvg,
      });
      const relaxedSafety =
        !pumpSafety.ok &&
        change24h >= env.PUMP_INTRADAY_MIN_CHANGE_24H &&
        breakout.ok &&
        (breakout.stage === "EARLY" || breakout.stage === "ACTIVE") &&
        (breakout.score >= 55 || (tapeMomentum >= 0.12 && hourMomentum >= 0.5)) &&
        shortFlow >= 0.04 &&
        candidate.context.spreadPercent <= 0.38 &&
        candidate.context.fakeSpikeScore <= 3.8;
      const isEarlyStage = breakout.stage === "EARLY" || breakout.stage === "ACTIVE";
      // metricPump: breakout score >= 58 VEYA 24h >= 5% + makul tape/flow yeterlı
      const metricPump =
        topGainerPump &&
        ((breakout.ok && isEarlyStage && breakout.score >= 58) ||
          (change24h >= 5 && tapeMomentum >= 0.15 && shortFlow >= 0.06 && hourMomentum >= 0.5) ||
          (change24h >= 3 && tapeMomentum >= 0.25 && shortFlow >= 0.08));
      const strongPump =
        change24h >= 16 &&
        (breakout.ok || tapeMomentum >= 0.55 || hourMomentum >= 2.2) &&
        shortFlow >= 0.18;
      const confidenceOk =
        Number(ai.finalConfidence ?? 0) >= Math.max(40, minConfidence - 6) ||
        (strongPump && Number(ai.finalConfidence ?? 0) >= 36);
      const riskOk = !riskVeto && Number(ai.finalRiskScore ?? 100) <= (strongPump ? 78 : 72);

      if ((!pumpSafety.ok && !relaxedSafety) || !riskOk || !confidenceOk) return null;
      if (candidate.context.spreadPercent > 0.32 || candidate.context.fakeSpikeScore > 3) return null;
      if (Number(candidate.context.volume24h ?? 0) < env.SCANNER_MIN_VOLUME_24H * 0.5) return null;
      if (!metricPump && !strongPump) return null;

      const confidence = Math.max(
        Number(ai.finalConfidence ?? 0),
        Math.min(74, Math.max(52, (breakout.score || 0) * 0.72, change24h * 1.4 + Math.max(0, tapeMomentum) * 10)),
      );
      return {
        ...candidate,
        ai: {
          ...ai,
          finalDecision: "BUY" as AIDecision,
          finalConfidence: Number(confidence.toFixed(2)),
          rejected: false,
          rejectReason: undefined,
          explanation:
            `${ai.explanation ?? "paper pump candidate"} | pump-metric-lane=1 | ` +
            `24h=${change24h.toFixed(2)}%, short=${tapeMomentum.toFixed(2)}%, hour=${hourMomentum.toFixed(2)}%, flow=${shortFlow.toFixed(3)}`,
          analysisScorecard: ai.analysisScorecard
            ? {
                ...ai.analysisScorecard,
                direction: "BUY",
                confidenceScore: Math.max(ai.analysisScorecard.confidenceScore, confidence),
                riskLevel: ai.analysisScorecard.riskLevel === "HIGH" ? "MEDIUM" : ai.analysisScorecard.riskLevel,
              }
            : ai.analysisScorecard,
        },
      } satisfies ScannerCandidate;
    })
    .filter((candidate): candidate is ScannerCandidate => Boolean(candidate))
    .sort((a, b) => rankForFastEntry(b) - rankForFastEntry(a));
}

function resolveChaosAdaptiveMinConfidence(baseMinConfidence: number, candidates: ScannerCandidate[]) {
  if (candidates.length === 0) return { minConfidence: baseMinConfidence, loweredBy: 0 };
  const noTradeLike = candidates.filter((x) => {
    if (!x.ai) return true;
    if (x.ai.rejected) return true;
    return x.ai.finalDecision !== "BUY" && x.ai.finalDecision !== "SELL";
  }).length;
  const chaosLike = candidates.filter((x) => {
    const regime = String(x.context.metadata.marketRegime ?? "RANGE_SIDEWAYS");
    return regime === "HIGH_VOLATILITY_CHAOS" || regime === "NEWS_DRIVEN_UNSTABLE" || regime === "RANGE_SIDEWAYS";
  }).length;
  const noTradeRatio = noTradeLike / Math.max(candidates.length, 1);
  const chaosRatio = chaosLike / Math.max(candidates.length, 1);
  if (noTradeRatio < 0.85) return { minConfidence: baseMinConfidence, loweredBy: 0 };
  let loweredBy = 0;
  if (chaosRatio >= 0.5) loweredBy = 4;
  else if (chaosRatio >= 0.3) loweredBy = 2;
  const minConfidence = Math.max(54, baseMinConfidence - loweredBy);
  return { minConfidence, loweredBy };
}

async function confirmFocusedCandidate(
  candidate: ScannerCandidate,
  runtimeStrategy: Awaited<ReturnType<typeof getRuntimeStrategyParams>>,
  minConfidence: number,
) {
  try {
    const context = await buildMarketContext(candidate.context.symbol);
    const score = scoreContext(context);
    const aiInput = await formatAIRequest(
      context,
      {
        scannerScore: score.score,
        ...runtimeStrategy,
      },
      undefined,
    );
    const ai = await withBoundedAwait(
      `focus-ai-consensus:${candidate.context.symbol}`,
      runAIConsensusFromInput(aiInput),
      resolveAiConsensusTimeoutMs(),
    );
    if (ai.rejected) {
      traceCandidateReject({
        symbol: candidate.context.symbol,
        stage: "ai",
        reasonCode: "AI_REJECTED",
        reasonDetail: ai.rejectReason ?? "AI rejected candidate",
      });
      return null;
    }
    if (ai.finalDecision !== "BUY" && ai.finalDecision !== "SELL") {
      traceCandidateReject({
        symbol: candidate.context.symbol,
        stage: "consensus",
        reasonCode: "AI_NO_TRADE",
        reasonDetail: `AI decision=${ai.finalDecision}`,
      });
      return null;
    }
    if ((ai.finalConfidence ?? 0) < minConfidence) {
      traceCandidateReject({
        symbol: candidate.context.symbol,
        stage: "decision",
        reasonCode: "LOW_CONFIDENCE",
        reasonDetail: `confidence=${ai.finalConfidence ?? 0} < ${minConfidence}`,
      });
      return null;
    }
    return {
      ...candidate,
      context,
      score,
      ai,
    };
  } catch (error) {
    traceCandidateFailed({
      symbol: candidate.context.symbol,
      stage: "ai",
      reasonCode: "AI_ANALYSIS_FAILED",
      reasonDetail: (error as Error).message,
    });
    return null;
  }
}

async function pickFocusedCandidate(
  candidates: ScannerCandidate[],
  runtimeStrategy: Awaited<ReturnType<typeof getRuntimeStrategyParams>>,
  minConfidence: number,
  options?: { allowExisting?: boolean },
) {
  let bestExisting: ScannerCandidate | null = null;
  let bestExistingScore = -Infinity;
  for (const candidate of candidates) {
    const confirmed = await confirmFocusedCandidate(candidate, runtimeStrategy, minConfidence);
    if (confirmed) return confirmed;
    if (options?.allowExisting && candidate.ai) {
      const decisionOk = candidate.ai.finalDecision === "BUY" || candidate.ai.finalDecision === "SELL";
      const confidenceOk = (candidate.ai.finalConfidence ?? 0) >= minConfidence;
      if (decisionOk && confidenceOk) {
        const score = rankForFastEntry(candidate);
        if (score > bestExistingScore) {
          bestExisting = candidate;
          bestExistingScore = score;
        }
      }
    }
  }
  return bestExisting;
}

async function buildEmergencyCandidates(strategyParams?: Record<string, unknown>): Promise<ScannerCandidate[]> {
  const runtimeStrategy = await getRuntimeStrategyParams();
  const effectiveStrategy = { ...runtimeStrategy, ...(strategyParams ?? {}) };
  const fallbackSymbols = env.SCANNER_WATCHLIST.split(",")
    .map((x) => normalizeEmergencySymbol(x))
    .filter(Boolean)
    .slice(0, 12);

  const symbols =
    fallbackSymbols.length > 0
      ? fallbackSymbols
      : env.BINANCE_PLATFORM === "tr"
        ? ["BTCTRY", "ETHTRY", "SOLTRY", "BNBTRY", "XRPTRY"]
        : ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
  const rows: ScannerCandidate[] = [];

  for (const symbol of symbols) {
    try {
      const context = await buildMarketContext(symbol);
      const score = scoreContext(context);
      const aiInput = await formatAIRequest(
        context,
        {
          scannerScore: score.score,
          ...effectiveStrategy,
        },
        undefined,
      );
      const ai = await runAIConsensusFromInput(aiInput);
      rows.push({
        rank: rows.length + 1,
        context,
        score,
        ai,
      });
    } catch {
      // continue with next symbol
    }
  }

  return rows.sort((a, b) => rankForFastEntry(b) - rankForFastEntry(a)).map((row, index) => ({ ...row, rank: index + 1 }));
}

async function selectPumpFastEntry(input: {
  excludedSymbols: Set<string>;
  runtimeStrategy: Awaited<ReturnType<typeof getRuntimeStrategyParams>>;
  maxDurationSec?: number;
  minConfidence: number;
  includeLiveScan?: boolean;
  runtime?: FastEntryRuntimeHooks;
}): Promise<FastEntryResult | null> {
  const tryList = async (
    candidates: Awaited<ReturnType<typeof getCachedPumpCandidates>>,
    scope: "cache" | "live",
  ) => {
    const eligible = candidates.filter(
      (row) => !input.excludedSymbols.has(row.candidate.context.symbol.toUpperCase()),
    );
    await input.runtime?.onPumpScan?.(scope, candidates.length, eligible.length);
    for (let index = 0; index < eligible.length; index += 1) {
      const pumpCandidate = eligible[index];
      await input.runtime?.ensureActive?.();
      input.runtime?.shouldAbort?.();
      const symbol = pumpCandidate.candidate.context.symbol.toUpperCase();
      await input.runtime?.onPumpConfirmation?.(symbol, index + 1, eligible.length);
      const pumpSelected = await confirmPumpEarlyCandidate({
        base: pumpCandidate.candidate,
        runtimeStrategy: input.runtimeStrategy,
        maxDurationSec: input.maxDurationSec,
        mode: pumpCandidate.mode,
        runtime: input.runtime,
      }).catch((error) => {
        traceCandidateFailed({
          symbol,
          stage: "candidate",
          reasonCode: "PUMP_CONFIRM_FAILED",
          reasonDetail: (error as Error).message,
        });
        return null;
      });
      if (pumpSelected) {
        return {
          selected: pumpSelected,
          reason: `Pump Catcher [${pumpCandidate.mode}] (${scope}): ${pumpCandidate.reason}`,
          diagnostics: {
            candidateCount: candidates.length,
            tradableCount: 1,
            scannedTotal: 0,
            qualifiedTotal: 1,
            minConfidence: input.minConfidence,
            requireUnanimous: false,
          },
          scannedAt: new Date().toISOString(),
          evaluated: index + 1,
        } satisfies FastEntryResult;
      }
      await input.runtime?.onCandidateRejected?.(
        symbol,
        `Pump confirmation NO_TRADE (${pumpCandidate.mode})`,
      );
      traceCandidateReject({
        symbol,
        stage: "candidate",
        reasonCode: "PUMP_CONFIRM_NO_TRADE",
        reasonDetail: `Pump confirmation NO_TRADE (${pumpCandidate.mode})`,
      });
    }
    return null;
  };

  logger.info(
    {
      reason: "pump-catcher-start",
      minConfidence: input.minConfidence,
      includeLiveScan: Boolean(input.includeLiveScan),
      excludedCount: input.excludedSymbols.size,
    },
    "Pump Catcher selection attempt",
  );
  recordPumpScanEvent({
    kind: "start",
    scope: "cache",
    message: "Pump fast entry selection started",
    meta: { excludedCount: input.excludedSymbols.size },
  });
  const cached = getCachedPumpCandidates(24);
  recordPumpScanEvent({
    kind: "cache_scan",
    scope: "cache",
    candidateCount: cached.length,
    message: `Pump cache scan complete (${cached.length} candidates)`,
  });
  const cachedHit = await tryList(cached, "cache");
  if (cachedHit) return cachedHit;
  if (cached.length === 0) {
    logger.info(
      { reason: "pump-catcher-empty", scope: "cache", candidateCount: 0 },
      "Pump Catcher cache empty",
    );
  } else {
    logger.info(
      {
        reason: "pump-catcher-scan",
        scope: "cache",
        candidateCount: cached.length,
        sample: cached.slice(0, 3).map((candidate) => summarizePumpEarlyCandidate(candidate)),
      },
      "Pump Catcher cache scanned; no selection",
    );
  }
  if (input.includeLiveScan) {
    await input.runtime?.ensureActive?.();
    input.runtime?.shouldAbort?.();
    let liveCandidates: Awaited<ReturnType<typeof resolveLiveTopGainerPumpCandidates>> = [];
    try {
      liveCandidates = await runBoundedLivePumpScan(
        "resolveLiveTopGainerPumpCandidates",
        () => resolveLiveTopGainerPumpCandidates({ limit: 24 }),
        {
          selectionDeadlineMs: input.runtime?.selectionDeadlineMs,
          telemetry: input.runtime?.asyncTelemetry,
          scope: "live",
        },
      );
    } catch (error) {
      if (error instanceof PumpScanFailedError) {
        recordPumpScanEvent({
          kind: "failed",
          scope: "live",
          blockKind: error.blockKind,
          message: error.message,
        });
        throw error;
      }
      throw error;
    }
    const liveHit = await tryList(liveCandidates, "live");
    if (liveHit) return liveHit;
    if (liveCandidates.length === 0) {
      logger.info(
        { reason: "pump-catcher-empty", scope: "live", candidateCount: 0 },
        "Pump Catcher live scan empty",
      );
    } else {
      logger.info(
        {
          reason: "pump-catcher-scan",
          scope: "live",
          candidateCount: liveCandidates.length,
          sample: liveCandidates.slice(0, 3).map((candidate) => summarizePumpEarlyCandidate(candidate)),
        },
        "Pump Catcher live scan scanned; no selection",
      );
    }
  }
  recordPumpScanEvent({
    kind: "end",
    scope: "live",
    message: "Pump fast entry selection finished without match",
  });
  traceCandidateWait({
    symbol: "PUMP_SCAN",
    stage: "scanner",
    reasonCode: "PUMP_NO_MATCH",
    reasonDetail: "Pump cache and live scan exhausted without confirmation",
  });
  return null;
}

export async function getBestFastEntry(options?: FastEntryOptions): Promise<FastEntryResult> {
  ensurePumpEarlyCatcherStarted();
  const originalCycleLimit = env.SCANNER_CYCLE_SYMBOL_LIMIT;
  const requestedScanLimit = Number(options?.scanLimit ?? env.EXECUTION_MANUAL_SCAN_SYMBOL_LIMIT);
  const manualCycleLimit = Math.min(
    env.SCANNER_MAX_SYMBOLS,
    Math.max(100, Number.isFinite(requestedScanLimit) ? requestedScanLimit : env.EXECUTION_MANUAL_SCAN_SYMBOL_LIMIT),
  );
  const shouldAdjustManualScan = originalCycleLimit !== manualCycleLimit;
  if (shouldAdjustManualScan) {
    (env as unknown as { SCANNER_CYCLE_SYMBOL_LIMIT: number }).SCANNER_CYCLE_SYMBOL_LIMIT = manualCycleLimit;
  }
  try {
  const runtime = await getRuntimeExecutionContext().catch(() => null);
  const runtimeStrategy = await getRuntimeStrategyParams();
  const policy = await getAdaptiveExecutionPolicy(runtime?.user.id);
  const effectivePolicy = {
    ...policy,
    minConfidence: Math.max(
      40,
      Math.min(99, Number(runtimeStrategy.aiScoreThreshold ?? policy.minConfidence ?? 60)),
    ),
    requireUnanimous: Boolean(policy.requireUnanimous ?? env.EXECUTION_FAST_REQUIRE_UNANIMOUS),
  };
  const usePaperProfile = options?.forcePaperProfile || env.EXECUTION_MODE === "paper";
  const executionMode = usePaperProfile ? "paper" : env.EXECUTION_MODE;
  const strategyParams = { ...runtimeStrategy, executionMode };
  if (!usePaperProfile && Number(options?.maxDurationSec ?? 0) > 0 && Number(options?.maxDurationSec ?? 0) <= 3600) {
    effectivePolicy.minConfidence = Math.min(effectivePolicy.minConfidence, 55);
    effectivePolicy.requireUnanimous = false;
  }
  if (usePaperProfile) {
    effectivePolicy.minConfidence = Math.max(35, Math.min(48, effectivePolicy.minConfidence));
    effectivePolicy.requireUnanimous = false;
  }
  if (effectivePolicy.requireUnanimous === undefined || effectivePolicy.requireUnanimous === null) {
    effectivePolicy.requireUnanimous = false;
  }
  const focusMinConfidence = usePaperProfile
    ? Math.max(48, effectivePolicy.minConfidence - 4)
    : effectivePolicy.minConfidence;

  const excludedSymbols = new Set((options?.excludeSymbols ?? []).map((x) => x.trim().toUpperCase()).filter(Boolean));
  const maxScanCycles = Math.max(1, Math.min(8, Number(options?.scanCycles ?? 3)));
  let scan: ScannerPipelineResult | null = null;
  let lastResult: FastEntryResult | null = null;

  const pumpHit = options?.skipInitialPumpPass
    ? null
    : await selectPumpFastEntry({
        excludedSymbols,
        runtimeStrategy: strategyParams,
        maxDurationSec: options?.maxDurationSec,
        minConfidence: effectivePolicy.minConfidence,
        includeLiveScan: true,
        runtime: options?.runtime,
      });
  if (pumpHit) return pumpHit;

  const tradableOptions = { paperMode: usePaperProfile };
  const useScannerAttach = !(options?.runtime?.forceFreshScanner ?? false);

  for (let cycle = 0; cycle < maxScanCycles; cycle += 1) {
    await options?.runtime?.ensureActive?.();
    options?.runtime?.shouldAbort?.();
    await options?.runtime?.onFullScan?.(cycle + 1, maxScanCycles);
    if (!scan || scan.candidates.length === 0 || cycle > 0) {
      scan = await runScannerPipeline(undefined, {
        includeAi: true,
        persist: false,
        persistRejected: false,
        executionMode,
        runtime: buildScannerPipelineRuntime(options?.runtime, useScannerAttach),
      });
    }
    if (scan.totalSymbols === 0 || scan.candidates.length === 0) {
      scan = await runScannerPipeline(undefined, {
        includeAi: true,
        persist: false,
        persistRejected: false,
        executionMode,
        runtime: buildScannerPipelineRuntime(options?.runtime, false),
      });
    }
    const candidatePoolRaw =
      scan.candidates.length > 0 ? scan.candidates : await buildEmergencyCandidates(strategyParams);
    const candidatePool =
      excludedSymbols.size > 0
        ? candidatePoolRaw.filter((row) => !excludedSymbols.has(row.context.symbol.toUpperCase()))
        : candidatePoolRaw;

    const primary = selectTradableCandidates(candidatePool, effectivePolicy, tradableOptions);
    let tradable = usePaperProfile
      ? primary.filter(isPaperApprovedLane)
      : primary;
    let fallbackUsed = false;
    if (!usePaperProfile && !env.AI_ULTRA_DISABLE_RELAXED_FALLBACK && tradable.length === 0 && candidatePool.length > 0) {
      const relaxed = selectTradableCandidates(
        candidatePool,
        {
            minConfidence: Math.max(46, effectivePolicy.minConfidence - 10),
          requireUnanimous: false,
        },
        { relaxed: true, paperMode: usePaperProfile },
      );
      if (relaxed.length > 0) {
        tradable = relaxed;
      }
    }
    if (!usePaperProfile && !env.AI_ULTRA_DISABLE_RELAXED_FALLBACK && tradable.length === 0) {
      const focusedPoolRaw = (await buildEmergencyCandidates(strategyParams)).filter(
        (row) => !excludedSymbols.has(row.context.symbol.toUpperCase()),
      );
      const focusedPool = focusedPoolRaw.filter(
        (x) =>
          isTryQuotedSymbol(x.context.symbol) &&
          Number(x.context.volume24h ?? 0) >= env.SCANNER_MIN_VOLUME_24H * 2,
      );
      const chaosAdaptive = resolveChaosAdaptiveMinConfidence(
        effectivePolicy.minConfidence,
        focusedPool.length > 0 ? focusedPool : focusedPoolRaw,
      );
      if (focusedPool.length > 0) {
        const focusedTradable = selectTradableCandidates(
          focusedPool,
          {
            minConfidence: Math.max(46, chaosAdaptive.minConfidence - 8),
            requireUnanimous: false,
          },
          { relaxed: true, paperMode: usePaperProfile },
        );
        if (focusedTradable.length > 0) {
          tradable = focusedTradable;
          fallbackUsed = true;
        }
      }
    }
    if (!usePaperProfile && !env.AI_ULTRA_DISABLE_RELAXED_FALLBACK && tradable.length === 0) {
      const recovery = selectRecoveryCandidatesFromRoleSignals(candidatePool, effectivePolicy.minConfidence);
      if (recovery.length > 0) {
        tradable = recovery;
        fallbackUsed = true;
      }
    }
    if (tradable.length === 0 && candidatePool.length <= 2) {
      if (!usePaperProfile && !env.AI_ULTRA_DISABLE_RELAXED_FALLBACK) {
      const lowCountRelaxed = selectTradableCandidates(
        candidatePool,
        { ...effectivePolicy, minConfidence: Math.max(50, effectivePolicy.minConfidence - 8) },
        { relaxed: true, paperMode: usePaperProfile },
      );
      if (lowCountRelaxed.length > 0) {
        tradable = lowCountRelaxed;
      }
      }
    }

    if (tradable.length === 0 && usePaperProfile) {
      const pumpRetry = await selectPumpFastEntry({
        excludedSymbols,
        runtimeStrategy: strategyParams,
        maxDurationSec: options?.maxDurationSec,
        minConfidence: effectivePolicy.minConfidence,
        includeLiveScan: true,
      });
      if (pumpRetry) return pumpRetry;
    }

    if (!usePaperProfile && tradable.length === 0 && candidatePool.length < 3) {
      const retryScan = await runScannerPipeline(undefined, {
        includeAi: true,
        persist: false,
        persistRejected: false,
        executionMode,
      });
      const retryPoolRaw =
        retryScan.candidates.length > 0 ? retryScan.candidates : await buildEmergencyCandidates(strategyParams);
      const retryPool =
        excludedSymbols.size > 0
          ? retryPoolRaw.filter((row) => !excludedSymbols.has(row.context.symbol.toUpperCase()))
          : retryPoolRaw;
      const retryTradable = selectTradableCandidates(retryPool, effectivePolicy, tradableOptions);
      if (retryTradable.length > 0) {
        const focusSelected = await pickFocusedCandidate(
          retryTradable,
          strategyParams,
          focusMinConfidence,
          { allowExisting: usePaperProfile },
        );
        if (focusSelected) {
          return {
            selected: focusSelected,
            diagnostics: {
              candidateCount: retryPool.length,
              tradableCount: retryTradable.length,
              scannedTotal: retryScan.totalSymbols,
              qualifiedTotal: retryScan.qualifiedSymbols,
              minConfidence: effectivePolicy.minConfidence,
              requireUnanimous: effectivePolicy.requireUnanimous,
            },
            scannedAt: retryScan.scannedAt,
            evaluated: retryScan.aiEvaluatedSymbols,
          };
        }
      }
      tradable = retryTradable;
    }

    const fallbackScanned = scan.totalSymbols > 0 ? scan.totalSymbols : candidatePool.length;
    const fallbackQualified = scan.qualifiedSymbols > 0 ? scan.qualifiedSymbols : candidatePool.length;
    const diagnostics = {
      candidateCount: candidatePool.length,
      tradableCount: tradable.length,
      scannedTotal: fallbackScanned,
      qualifiedTotal: fallbackQualified,
      minConfidence: effectivePolicy.minConfidence,
      requireUnanimous: effectivePolicy.requireUnanimous,
    };

    if (tradable.length === 0 && usePaperProfile) {
      const pumpBeforeSteady = await selectPumpFastEntry({
        excludedSymbols,
        runtimeStrategy: strategyParams,
        maxDurationSec: options?.maxDurationSec,
        minConfidence: effectivePolicy.minConfidence,
        includeLiveScan: true,
      });
      if (pumpBeforeSteady) return pumpBeforeSteady;

      const pumpMetricLane = selectPaperPumpLaneCandidates(candidatePool, effectivePolicy.minConfidence);
      if (pumpMetricLane.length > 0) {
        return {
          selected: pumpMetricLane[0],
          reason: "Paper pump metric lane: top-gainer/momentum candidate.",
          diagnostics: {
            ...diagnostics,
            tradableCount: pumpMetricLane.length,
          },
          scannedAt: scan.scannedAt,
          evaluated: scan.aiEvaluatedSymbols,
        };
      }

      const steadyGain = selectPaperSteadyGainCandidates(candidatePool, effectivePolicy.minConfidence);
      if (steadyGain.length > 0) {
        return {
          selected: steadyGain[0],
          reason: "Paper steady-gain lane: 1h quality target (~0.85-1%).",
          diagnostics: {
            ...diagnostics,
            tradableCount: steadyGain.length,
          },
          scannedAt: scan.scannedAt,
          evaluated: scan.aiEvaluatedSymbols,
        };
      }

      const lastResort = candidatePool
        .filter(passesPaperLastResortQuality)
        .sort((a, b) => rankForFastEntry(b) - rankForFastEntry(a));
      if (lastResort.length > 0) {
        return {
          selected: lastResort[0],
          reason: "Paper last-resort lane: quality fallback (non pump/steady).",
          diagnostics: {
            ...diagnostics,
            tradableCount: lastResort.length,
          },
          scannedAt: scan.scannedAt,
          evaluated: scan.aiEvaluatedSymbols,
        };
      }

      const pumpDiagnostics = candidatePool
        .slice()
        .sort((a, b) => rankForFastEntry(b) - rankForFastEntry(a))
        .slice(0, 3)
        .map((candidate) => summarizePaperPumpCandidate(candidate));
      logger.info(
        {
          reason: "paper-no-trade",
          scanned: diagnostics.scannedTotal ?? 0,
          candidates: diagnostics.candidateCount,
          sample: pumpDiagnostics,
        },
        "Paper pump lane empty; diagnostics snapshot",
      );

      lastResult = {
        selected: null,
        reason:
          `Paper NO_TRADE: pump ve steady-gain adayi yok (tur ${cycle + 1}/${maxScanCycles}, scanned=${diagnostics.scannedTotal ?? 0}, candidates=${diagnostics.candidateCount}).`,
        diagnostics: {
          ...diagnostics,
          tradableCount: 0,
        },
        scannedAt: scan.scannedAt,
        evaluated: scan.aiEvaluatedSymbols,
      };
      traceScanCycleWait(
        candidatePool,
        "PAPER_NO_TRADE",
        lastResult.reason,
      );
      continue;
    }

    if (tradable.length === 0) {
      const noTradeDiagnostics = buildNoTradeDiagnostics(
        candidatePool,
        diagnostics.minConfidence,
        scan.totalSymbols,
        scan.qualifiedSymbols,
      );
      lastResult = {
        selected: null,
        reason:
          `No suitable short-horizon candidate (tradable=${diagnostics.tradableCount}/${diagnostics.candidateCount}, scanned=${diagnostics.scannedTotal ?? 0}, qualified=${diagnostics.qualifiedTotal ?? 0}, minConf=${diagnostics.minConfidence}, unanimous=${diagnostics.requireUnanimous ? "on" : "off"})` +
          ` | noTradeDecision=${noTradeDiagnostics.rejectionBreakdown?.noTradeDecision ?? 0}` +
          ` lowConf=${noTradeDiagnostics.rejectionBreakdown?.lowConfidence ?? 0}` +
          ` highSpread=${noTradeDiagnostics.rejectionBreakdown?.highSpread ?? 0}`,
        diagnostics: {
          ...diagnostics,
          rejectionBreakdown: noTradeDiagnostics.rejectionBreakdown,
          sampleRejected: noTradeDiagnostics.sampleRejected,
        },
        scannedAt: scan.scannedAt,
        evaluated: scan.aiEvaluatedSymbols,
      };
      traceScanCycleWait(candidatePool, "NO_TRADABLE_CANDIDATE", lastResult.reason);
      continue;
    }

    const focusSelected = await pickFocusedCandidate(
      tradable,
      strategyParams,
      focusMinConfidence,
      { allowExisting: usePaperProfile },
    );
    if (!focusSelected) {
      lastResult = {
        selected: null,
        reason: "Focus confirmation failed for selected candidates.",
        diagnostics,
        scannedAt: scan.scannedAt,
        evaluated: scan.aiEvaluatedSymbols,
      };
      traceScanCycleWait(tradable, "FOCUS_CONFIRM_FAILED", lastResult.reason);
      continue;
    }
    if (usePaperProfile && !isPaperApprovedLane(focusSelected)) {
      lastResult = {
        selected: null,
        reason: "Paper NO_TRADE: scanner adayi pump/steady-gain degil.",
        diagnostics,
        scannedAt: scan.scannedAt,
        evaluated: scan.aiEvaluatedSymbols,
      };
      traceScanCycleWait([focusSelected], "PAPER_LANE_MISMATCH", lastResult.reason);
      continue;
    }
    return {
      selected: focusSelected,
      diagnostics,
      reason: fallbackUsed ? "Focused major-pair fallback selected candidate." : undefined,
      scannedAt: scan.scannedAt,
      evaluated: scan.aiEvaluatedSymbols,
    };
  }

  return (
    lastResult ?? {
      selected: null,
      reason:
        "Paper NO_TRADE: pump ve steady-gain adayi yok (tum tarama turlari bitti). Kaybetmektense tur atlandi.",
      diagnostics: {
        candidateCount: 0,
        tradableCount: 0,
        scannedTotal: 0,
        qualifiedTotal: 0,
        minConfidence: effectivePolicy.minConfidence,
        requireUnanimous: effectivePolicy.requireUnanimous,
      },
      scannedAt: new Date().toISOString(),
      evaluated: 0,
    }
  );
  } finally {
    if (shouldAdjustManualScan) {
      (env as unknown as { SCANNER_CYCLE_SYMBOL_LIMIT: number }).SCANNER_CYCLE_SYMBOL_LIMIT = originalCycleLimit;
    }
  }
}

export async function getPumpFastEntry(input: {
  excludeSymbols?: string[];
  maxDurationSec?: number;
  minConfidence?: number;
  includeLiveScan?: boolean;
  runtime?: FastEntryRuntimeHooks;
}): Promise<FastEntryResult> {
  ensurePumpEarlyCatcherStarted();
  const runtimeStrategy = await getRuntimeStrategyParams();
  const excludedSymbols = new Set((input.excludeSymbols ?? []).map((x) => x.trim().toUpperCase()).filter(Boolean));
  return (
    (await selectPumpFastEntry({
      excludedSymbols,
      runtimeStrategy,
      maxDurationSec: input.maxDurationSec,
      minConfidence: input.minConfidence ?? 45,
      includeLiveScan: input.includeLiveScan ?? true,
      runtime: input.runtime,
    })) ?? {
      selected: null,
      reason: "Pump cache bos",
      scannedAt: new Date().toISOString(),
      evaluated: 0,
    }
  );
}
