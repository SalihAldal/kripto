import { logger } from "@/lib/logger";
import { env } from "@/lib/config";
import { prisma } from "@/src/server/db/prisma";
import { listPersistedExecutionEvents, publishExecutionEvent } from "@/src/server/execution/execution-event-bus";
import {
  closePositionManually,
  ensureOpenPositionMonitors,
  executeAnalyzeAndTrade,
} from "@/src/server/execution/execution-orchestrator.service";
import { normalizeExecutionTerminalReason } from "@/src/server/execution/execution-failure-contract";
import { evaluateMomentumBreakout } from "@/src/server/scanner/momentum-breakout.service";
import { resolvePumpRoundMaxWaitSec } from "@/src/server/scanner/pump-early-catcher.service";
import type { ScannerCandidate } from "@/src/types/scanner";
import type { FastEntryResult } from "@/src/server/scanner/fast-entry.service";
import {
  evaluatePaperEntryQuality,
  formatPaperEntryQualityReason,
  getBtcMarketFilterSnapshot,
  isFakeHourOnlyPump,
  isStrongHourPumpContext,
} from "@/src/server/trading-core/entry-filters/paper-entry-quality.service";
import {
  evaluatePumpEntrySafety,
  formatPumpEntrySafetyReason,
} from "@/src/server/trading-core/entry-filters/pump-entry-safety.service";
import {
  compareAndSetSchedulerLease,
  createAutoRoundJob,
  deleteAutoRoundRun,
  findRunningAutoRoundJob,
  findStoppableAutoRoundJob,
  getAutoRoundRunById,
  getAutoRoundJobById,
  listAutoRoundJobs,
  listRunningAutoRoundJobs,
  getAutoRoundJobStats,
  getAutoRoundRunFilterCounts,
  listAutoRoundRunsPaginated,
  loadSchedulerLease,
  acquireOrCreateRoundRun,
  type AutoRoundHistoryFilter,
  type AutoRoundState,
  persistRoundOwnershipRecord,
  updateAutoRoundJob,
  updateAutoRoundRun,
} from "@/src/server/repositories/auto-round.repository";
import {
  transactionallyCompleteRound,
  transactionallyFailRound,
  auditAutoRoundIntegrity,
} from "@/src/server/repositories/auto-round-integrity.repository";
import { isBlockingAiDecision } from "@/src/server/execution/ai-execution-gate.service";
import { isTopGainerPumpSignal } from "@/src/server/scanner/paper-lane-profile";
import {
  isTerminalNonExecutableReason,
  recordCandidateFunnelStage,
} from "@/src/server/forensics/candidate-funnel-trace.service";
import {
  classifyRoundTerminalOutcome,
  formatTerminalReason,
  toRoundRuntimeStep,
  type RoundTerminalOutcome,
} from "@/src/server/execution/round-terminal-outcome.service";
import { classifyTerminalReason } from "@/src/server/execution/p7-paper-strategy-contract";
import { shouldBindSymbolOnTerminalFail } from "@/src/server/execution/auto-round-terminal-policy";
import { getPositionById, getRuntimeExecutionContext, getEmergencyStopState, listOpenPositionsByUser } from "@/src/server/repositories/execution.repository";
import { writeStructuredLog } from "@/src/server/observability/structured-log";
import { runPaperSessionPreflight } from "@/src/server/forensics/paper-preflight.service";
import { ensureMarketDataDaemonStarted } from "@/src/server/market-data/spine/daemon-worker";
import { ensureScannerWorkerStarted } from "@/src/server/scanner/scanner-worker.service";
import { getCanonicalCandidateStore } from "@/src/server/candidate/candidate-store.service";
import { beginForensicPaperSession } from "@/src/server/forensics/forensic-bridge.service";
import { attachForensicRound, getForensicSession, getOrCreateForensicSession } from "@/src/server/forensics/forensic-context";
import { buildCampaignId } from "@/src/server/forensics/campaign-identity.service";
import { runRoundForensicExport } from "@/src/server/forensics/forensic-export-runner.service";
import { traceCandidateReject, traceCandidateTraded } from "@/src/server/forensics/candidate-lifecycle.service";
import { terminalizeOpenAiCandidates } from "@/src/server/forensics/ai-runtime.service";
import { ensureRoundHangSnapshotForAbnormalTerminal } from "@/src/server/forensics/round-progress-watchdog.service";
import { getSafeModeState, persistRoundState } from "@/src/server/recovery/failsafe-recovery.service";
import {
  calculateNetProfitPercent,
  isSuccessfulNetExit,
  resolveMinimumProtectedProfitPercent,
} from "@/src/server/execution/profit-thresholds";
import {
  cancelRoundSelection,
  clearRoundCancellation,
  patchRoundRuntimeProgress,
  readRuntimeFromMetadata,
  registerRoundCancellation,
} from "@/src/server/execution/round-runtime.service";
import {
  resolveCooperativeScanLimit,
  runCooperativeRoundSelection,
} from "@/src/server/execution/round-selection.service";
import { resolveRoundWatchdogStaleMs } from "@/src/server/execution/cooperative-async.service";
import {
  assertSchedulerLoopOwnership,
  atomicSpawnScheduler,
  getProcessOwnerId,
  getSchedulerLeaseSnapshot,
  getSchedulerRegistrySnapshot,
  hasLocalSchedulerLoop,
  isSchedulerLeaseLive,
  type LeasePersistence,
  touchSchedulerLease,
} from "@/src/server/execution/scheduler-ownership.service";
import {
  configureSchedulerRecovery,
  executeSchedulerRecovery,
  executeSchedulerRecoveryForRunningJobs,
  getProductionHealthSnapshot,
  getRecoveryTimeline,
} from "@/src/server/execution/scheduler-recovery.service";
import {
  atomicStartSchedulerWatchdog,
  stopSchedulerWatchdog,
} from "@/src/server/execution/scheduler-watchdog.service";
import type { AtomicSpawnResult, SchedulerLoopContext } from "@/src/server/execution/scheduler-ownership.types";
import {
  applyAdaptiveThresholds,
  resolveAdaptiveEntryDecision,
  summarizeEntryDecisionForMetadata,
} from "@/src/server/execution/entry-decision-engine.service";
import { classifyAiNoResponseScope, evaluateScannerPolicy } from "@/src/server/execution/scanner-false-block-policy.service";
import {
  atomicAcquireRoundOwnership,
  getActiveRoundOwnershipForJob,
  getRoundOwnershipRecord,
  getRoundRegistrySnapshot,
  recoverRoundRegistryFromRuns,
  releaseRoundOwnership,
  transitionRoundLifecycle,
} from "@/src/server/execution/round-registry.service";

type StartRoundInput = {
  userId?: string;
  totalRounds: number;
  budgetPerTrade: number;
  targetProfitPct: number;
  stopLossPct: number;
  maxWaitSec: number;
  coinSelectionMode: string;
  aiMode: string;
  allowRepeatCoin: boolean;
  mode: "manual" | "auto";
};

const inProgressRoundStates: AutoRoundState[] = ["tariyor", "coin_secildi", "alim_yapildi", "satis_bekleniyor"];

function terminalizeAiForRuns(
  runs: Array<{ id: string; roundNo: number }>,
  reasonCode: string,
  cancelReason: string,
) {
  let closed = 0;
  for (const run of runs) {
    const terminalized = terminalizeOpenAiCandidates({
      roundId: String(run.roundNo),
      runId: run.id,
      reasonCode,
      cancelReason,
      signalPropagated: true,
    });
    closed += terminalized.length;
  }
  return closed;
}

function buildSchedulerLeasePersistence(): LeasePersistence {
  return {
    loadLease: loadSchedulerLease,
    persistLease: async ({ jobId, lease, expectedVersion }) =>
      compareAndSetSchedulerLease({ jobId, lease, expectedVersion }),
  };
}

const schedulerLeasePersistence = buildSchedulerLeasePersistence();

function sortInProgressRuns(
  runs: Array<{ id: string; state: string; startedAt: Date; endedAt?: Date | null; symbol?: string | null; metadata?: unknown }>,
) {
  return runs
    .filter(
      (run) =>
        !run.endedAt && inProgressRoundStates.includes(run.state as AutoRoundState),
    )
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

async function ensureSingleSchedulerLoop(jobId: string): Promise<AtomicSpawnResult> {
  return atomicSpawnScheduler(jobId, (ctx) => runRoundJob(jobId, ctx), schedulerLeasePersistence);
}

function buildRoundOwnerId(ctx: SchedulerLoopContext) {
  return `${ctx.ownerId}:g${ctx.generation}`;
}

function resolveAutoRoundSelectionBudgetSec() {
  return Math.max(300, Math.min(3600, env.AUTO_ROUND_SELECTION_BUDGET_SEC));
}

function resolveAutoRoundMaxSelectionAttempts() {
  return Math.max(1, Math.min(15, env.AUTO_ROUND_MAX_SELECTION_ATTEMPTS));
}

function resolveAutoRoundScanCycles() {
  return Math.max(1, Math.min(4, env.AUTO_ROUND_SCAN_CYCLES));
}

function isPumpCatcherSelection(selected: ScannerCandidate) {
  const meta = selected.context.metadata;
  const explanation = String(selected.ai?.explanation ?? "");
  return (
    Boolean(meta.pumpEarlyCatcher) ||
    Boolean(meta.pumpEarlyConfirmed) ||
    Boolean(meta.pumpContinuationMode) ||
    Boolean(meta.pumpIntradaySpike) ||
    explanation.includes("PUMP_") ||
    explanation.includes("Pump Catcher") ||
    explanation.toLowerCase().includes("pump-")
  );
}

function shouldSkipLearningFilterForSelection(selected: ScannerCandidate, selectionSource: string) {
  if (!env.AUTO_ROUND_PUMP_SKIP_LEARNING_FILTER) return false;
  return selectionSource === "pump-cache" || isPumpCatcherSelection(selected);
}

function normalizeLearningTag(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function resolveLearningHorizon(maxWaitSec: number) {
  if (maxWaitSec <= 600) return "SCALP_5M";
  if (maxWaitSec <= 900) return "INTRADAY_15M";
  if (maxWaitSec <= 1800) return "SHORT_30M";
  if (maxWaitSec <= 3600) return "INTRADAY_1H";
  if (maxWaitSec <= 14_400) return "INTRADAY_4H";
  return "SESSION";
}

function signedLearningBucket(value: number, deadZone: number, strong: number) {
  if (Math.abs(value) < deadZone) return "flat";
  if (value >= strong) return "strong_positive";
  if (value > 0) return "positive";
  if (value <= -strong) return "strong_negative";
  return "negative";
}

function bucketLearningValue(value: number, buckets: Array<[number, string]>) {
  for (const [limit, label] of buckets) {
    if (value <= limit) return label;
  }
  return buckets[buckets.length - 1]?.[1] ?? "unknown";
}

function normalizeRejectBucket(reason: string) {
  const lower = reason.toLowerCase();
  if (lower.includes("dump tespiti") || lower.includes("sert satis") || lower.includes("dump_")) return "DUMP_TESPITI";
  if (lower.includes("hour negatif") || lower.includes("hour zayif") || lower.includes("hour/tape")) return "HOUR_NEGATIF";
  if (lower.includes("tepe") || lower.includes("asiri uzama") || lower.includes("yorgun") || lower.includes("pump bitmis")) return "TEPE_KOVASI";
  if (lower.includes("calm") && lower.includes("tape")) return "CALM_OLU_TAPE";
  if (lower.includes("tape yetersiz") || lower.includes("tape negatif")) return "TAPE_YETERSIZ";
  if (lower.includes("ema trend") || lower.includes("ema uyumsuz")) return "EMA_UYUMSUZ";
  if (lower.includes("hacim yetersiz")) return "HACIM_YETERSIZ";
  if (lower.includes("btc ema") || lower.includes("btc rsi") || lower.includes("btc trend")) return "BTC_TREND_NEGATIF";
  if (lower.includes("volatilite limiti") || lower.includes("atr/")) return "VOLATILITE_YUKSEK";
  if (lower.includes("kalite skoru")) return "KALITE_SKORU_DUSUK";
  if (lower.includes("momentum teyitsiz")) return "MOMENTUM_TEYITSIZ";
  if (lower.includes("pump late") || lower.includes("pump calm") || lower.includes("hour-only")) return "PUMP_WEAK_ENTRY";
  if (lower.includes("low_confidence") || lower.includes("guven skoru")) return "LOW_CONFIDENCE";
  if (lower.includes("mtf") || lower.includes("timeframe")) return "MTF_CONFLICT";
  if (lower.includes("hedef penceresi") || lower.includes("target")) return "AI_TARGET_WINDOW";
  if (lower.includes("ai-3") || lower.includes("risk veto")) return "AI3_VETO";
  if (lower.includes("spread") || lower.includes("risk gate") || lower.includes("liquidity")) return "RISK_GATE";
  if (lower.includes("data quality") || lower.includes("veri")) return "DATA_QUALITY";
  if (lower.includes("acik pozisyon")) return "OPEN_POSITION_BLOCK";
  return "OTHER";
}

function resolveCampaignIdFromJob(job: { id: string; metadata?: unknown }) {
  const metadata = ((job.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const existing = String(metadata.campaignId ?? "").trim();
  if (existing) return existing;
  return buildCampaignId({ jobId: job.id });
}

function formatExecutionRejectReason(
  result: Awaited<ReturnType<typeof executeAnalyzeAndTrade>> | null,
  fallback: string,
) {
  return normalizeExecutionTerminalReason({
    rejectReason: result?.rejectReason,
    details: (result?.details as Record<string, unknown> | null) ?? null,
    fallback,
  });
}

function classifyRoundTerminal(reason: string) {
  const parsed = classifyTerminalReason(reason);
  if (isTerminalNonExecutableReason(reason)) {
    return { ...parsed, decision: "WAIT" as const };
  }
  return parsed;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRoundHorizonProfile(maxWaitSec: number) {
  if (maxWaitSec <= 900) {
    return {
      label: "15m",
      targetFloorPct: 0.55,
      stopFloorPct: 0.35,
      minConfidence: 58,
      minScannerScore: 52,
      minScannerConfidence: 54,
      minMtfAlignment: 48,
      minShortMomentum: 0.02,
      minShortFlow: 0,
      maxRiskScore: 66,
      maxSpreadPercent: 0.12,
      maxFakeSpikeScore: 1.8,
      maxPumpRisk: 62,
      maxVolatilityPercent: 2.8,
      maxRegimeTransitionProbability: 72,
      maxRegimeChaosProbability: 68,
    };
  }
  if (maxWaitSec <= 1800) {
    return {
      label: "30m",
      targetFloorPct: 0.65,
      stopFloorPct: 0.45,
      minConfidence: 60,
      minScannerScore: 54,
      minScannerConfidence: 56,
      minMtfAlignment: 50,
      minShortMomentum: 0.03,
      minShortFlow: 0.005,
      maxRiskScore: 64,
      maxSpreadPercent: 0.11,
      maxFakeSpikeScore: 1.7,
      maxPumpRisk: 60,
      maxVolatilityPercent: 2.6,
      maxRegimeTransitionProbability: 68,
      maxRegimeChaosProbability: 64,
    };
  }
  if (maxWaitSec <= 3600) {
    return {
      label: "1h",
      targetFloorPct: 0.88,
      stopFloorPct: 0.55,
      minConfidence: 62,
      minScannerScore: 56,
      minScannerConfidence: 58,
      minMtfAlignment: 52,
      minShortMomentum: 0.04,
      minShortFlow: 0.01,
      maxRiskScore: 62,
      maxSpreadPercent: 0.1,
      maxFakeSpikeScore: 1.6,
      maxPumpRisk: 58,
      maxVolatilityPercent: 2.4,
      maxRegimeTransitionProbability: 64,
      maxRegimeChaosProbability: 60,
    };
  }
  if (maxWaitSec <= 14_400) {
    return {
      label: "4h",
      targetFloorPct: 1.2,
      stopFloorPct: 0.75,
      minConfidence: 65,
      minScannerScore: 60,
      minScannerConfidence: 60,
      minMtfAlignment: 58,
      minShortMomentum: 0.03,
      minShortFlow: 0.005,
      maxRiskScore: 60,
      maxSpreadPercent: 0.12,
      maxFakeSpikeScore: 1.8,
      maxPumpRisk: 58,
      maxVolatilityPercent: 2.2,
      maxRegimeTransitionProbability: 60,
      maxRegimeChaosProbability: 56,
    };
  }
  return {
    label: "session",
    targetFloorPct: 1.5,
    stopFloorPct: 0.9,
    minConfidence: 66,
    minScannerScore: 62,
    minScannerConfidence: 62,
    minMtfAlignment: 60,
    minShortMomentum: 0.02,
    minShortFlow: 0,
    maxRiskScore: 58,
    maxSpreadPercent: 0.12,
    maxFakeSpikeScore: 1.6,
    maxPumpRisk: 54,
    maxVolatilityPercent: 2,
    maxRegimeTransitionProbability: 58,
    maxRegimeChaosProbability: 54,
  };
}

function resolveEntryLane(explanation: string) {
  const text = explanation.toUpperCase();
  if (text.includes("PUMP_CONTINUATION") || text.includes("PUMP_INTRADAY") || text.includes("PUMP_EARLY") || text.includes("PUMP CATCHER")) {
    return "pump-lane";
  }
  if (text.includes("STEADY-GAIN")) return "steady-gain";
  return "scanner";
}

function resolvePaperRoundProfile(profile: ReturnType<typeof resolveRoundHorizonProfile>) {
  return {
    ...profile,
    minConfidence: Math.max(38, profile.minConfidence - 22),
    minScannerScore: Math.max(38, profile.minScannerScore - 18),
    minScannerConfidence: Math.max(40, profile.minScannerConfidence - 18),
    minMtfAlignment: 0,
    minShortMomentum: 0,
    minShortFlow: -1,
    maxRiskScore: Math.min(82, profile.maxRiskScore + 18),
    // TRY çiftlerinde spread doğal olarak yüksektir; 0.18 → 0.28
    maxSpreadPercent: Math.min(0.28, profile.maxSpreadPercent + 0.16),
    maxFakeSpikeScore: Math.min(2.6, profile.maxFakeSpikeScore + 0.8),
    // pumpRisk 88→96; AI yokken pump sinyali abartılı gelir
    maxPumpRisk: Math.min(96, profile.maxPumpRisk + 36),
    maxVolatilityPercent: Math.min(5, profile.maxVolatilityPercent + 2),
    maxRegimeTransitionProbability: Math.min(98, profile.maxRegimeTransitionProbability + 34),
    maxRegimeChaosProbability: Math.min(98, profile.maxRegimeChaosProbability + 38),
  };
}

async function evaluatePreTradeLearningMemory(input: {
  selected: NonNullable<FastEntryResult["selected"]>;
  maxWaitSec: number;
  paperMode?: boolean;
}) {
  const paperMode = input.paperMode ?? true;
  const ai = input.selected.ai;
  const context = input.selected.context;
  const symbol = context.symbol.toUpperCase();
  const decision = String(ai?.finalDecision ?? "HOLD").toUpperCase();
  const marketRegime = String(context.metadata.marketRegime ?? "RANGE_SIDEWAYS");
  const strategy = String(context.metadata.marketRegimeStrategy ?? "RANGE_MEAN_REVERSION");
  const horizon = resolveLearningHorizon(input.maxWaitSec);
  const shortFlow = Number(context.metadata.shortFlowImbalance ?? 0);
  const shortMomentum = Number(context.metadata.shortMomentumPercent ?? 0);
  const tradeVelocity = Number(context.metadata.tradeVelocity ?? 0);
  const spreadPercent = Number(context.spreadPercent ?? 0);
  const momentumBreakout = context.metadata.momentumBreakout as Record<string, unknown> | undefined;
  const breakoutOk = momentumBreakout?.ok === true || String(ai?.explanation ?? "").includes("momentum-breakout=BUY");
  const regimeTag = `regime:${normalizeLearningTag(marketRegime)}`;
  const strategyTag = `strategy:${normalizeLearningTag(strategy)}`;
  const momentumTag = `momentum:${signedLearningBucket(shortMomentum, 0.04, 0.18)}`;
  const flowTag = `flow:${signedLearningBucket(shortFlow, 0.015, 0.08)}`;
  const velocityTag = `velocity:${bucketLearningValue(tradeVelocity, [[0.005, "slow"], [0.025, "normal"], [0.08, "fast"], [999, "hyper"]])}`;
  const spreadTag = `spread:${bucketLearningValue(spreadPercent, [[0.08, "tight"], [0.18, "normal"], [0.35, "wide"], [999, "extreme"]])}`;
  const breakoutTag = `momentum_breakout:${breakoutOk ? "yes" : "no"}`;
  const reasons: string[] = [];
  let minConfidenceDelta = 0;
  let hardBlock = false;

  if (decision !== "BUY") {
    return {
      hardBlock: false,
      minConfidenceDelta: 0,
      reasons: ["learning-memory-skipped-non-buy"],
      memory: { exactSymbolLosses: 0, badMemoryCount: 0, riskyPatternCount: 0 },
    };
  }

  const since = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const [recentSameSymbolLosses, memories, riskyPatterns] = await Promise.all([
    prisma.learningTrade.findMany({
      where: {
        symbol,
        horizon: horizon as never,
        outcome: "LOSS",
        closeReason: { in: ["REVERSE_SIGNAL", "MOMENTUM_FADE", "STOP_LOSS"] },
        closedAt: { gte: since },
      },
      orderBy: { closedAt: "desc" },
      take: 4,
    }).catch(() => []),
    prisma.aIAnalysisMemory.findMany({
      where: {
        horizon: horizon as never,
        decision: "BUY",
        OR: [
          { symbol },
          { marketRegime },
        ],
      },
      orderBy: { lastSeenAt: "desc" },
      take: 12,
    }).catch(() => []),
    prisma.learningPatternStats.findMany({
      where: {
        AND: [
          { patternKey: { contains: regimeTag } },
          { patternKey: { contains: strategyTag } },
          { patternKey: { contains: flowTag } },
          { patternKey: { contains: spreadTag } },
        ],
      },
      orderBy: [{ sampleCount: "desc" }, { updatedAt: "desc" }],
      take: 16,
    }).catch(() => []),
  ]);

  if (recentSameSymbolLosses.length >= 2) {
    hardBlock = true;
    reasons.push(`same-symbol-loss-cooldown:${symbol},count=${recentSameSymbolLosses.length}`);
  } else if (recentSameSymbolLosses.length === 1) {
    minConfidenceDelta = Math.max(minConfidenceDelta, paperMode ? 6 : 8);
    reasons.push(`same-symbol-loss-tighten:${symbol}`);
  }

  const sameSymbolMemory = memories.find((row) => row.symbol.toUpperCase() === symbol);
  if (sameSymbolMemory) {
    const sampleCount = Number(sameSymbolMemory.sampleCount ?? 0);
    const winRate = Number(sameSymbolMemory.winRate ?? 0);
    const avgReturn = Number(sameSymbolMemory.avgReturn ?? 0);
    const hardSampleFloor = paperMode ? 15 : 8;
    const tightenSampleFloor = paperMode ? 6 : 3;
    if (sampleCount >= hardSampleFloor && winRate < 30 && avgReturn < 0) {
      hardBlock = true;
      reasons.push(`symbol-memory-bad:${symbol},winrate=${winRate.toFixed(1)},avg=${avgReturn.toFixed(3)}`);
    } else if (sampleCount >= tightenSampleFloor && winRate < 35 && avgReturn < 0) {
      minConfidenceDelta = Math.max(minConfidenceDelta, paperMode ? 4 : 8);
      reasons.push(`symbol-memory-tighten:${symbol},winrate=${winRate.toFixed(1)}`);
    }
  }

  const broadBadMemory = memories.filter((row) => {
    const sampleCount = Number(row.sampleCount ?? 0);
    const winRate = Number(row.winRate ?? 0);
    const avgReturn = Number(row.avgReturn ?? 0);
    return row.symbol.toUpperCase() !== symbol && sampleCount >= 10 && winRate < 25 && avgReturn < -0.2;
  });
  if (broadBadMemory.length >= 2) {
    minConfidenceDelta = Math.max(minConfidenceDelta, 5);
    reasons.push("regime-memory-broad-weak-edge");
  }

  const riskyPattern = riskyPatterns.find((row) => {
    const sampleCount = Number(row.sampleCount ?? 0);
    const winrate = Number(row.winrate ?? 0);
    const expectancy = Number(row.expectancyPercent ?? 0);
    const verdict = String(row.lastCriticVerdict ?? "").toUpperCase();
    const key = String(row.patternKey ?? "");
    const closeMatch =
      key.includes(momentumTag) ||
      key.includes(velocityTag) ||
      key.includes(breakoutTag);
    const learnedBadPattern =
      sampleCount >= 2 &&
      closeMatch &&
      winrate <= 25 &&
      expectancy <= -0.25;
    const criticBlockedPattern =
      sampleCount >= (paperMode ? 6 : 2) &&
      closeMatch &&
      winrate < 30 &&
      expectancy < 0 &&
      (verdict === "BLOCK" || verdict === "PAUSE_SETUP");
    const singleSampleDanger =
      sampleCount >= 1 &&
      expectancy <= -1 &&
      (key.includes("pump_early:yes") ||
        key.includes("regime:low_volatility_calm") ||
        key.includes("quality:reject"));
    return learnedBadPattern || criticBlockedPattern || singleSampleDanger;
  });
  if (riskyPattern) {
    const riskySampleCount = Number(riskyPattern.sampleCount ?? 0);
    const riskyWinrate = Number(riskyPattern.winrate ?? 0);
    const riskyExpectancy = Number(riskyPattern.expectancyPercent ?? 0);
    if (paperMode && riskySampleCount < 3) {
      minConfidenceDelta = Math.max(minConfidenceDelta, riskyExpectancy <= -1 ? 10 : 6);
      reasons.push(`pattern-stats-tighten:sample=${riskyPattern.sampleCount},winrate=${Number(riskyPattern.winrate ?? 0).toFixed(1)}`);
    } else if (riskyWinrate <= 20 && riskyExpectancy <= -0.35) {
      hardBlock = true;
      reasons.push(`pattern-stats-block:sample=${riskyPattern.sampleCount},winrate=${riskyWinrate.toFixed(1)},expectancy=${riskyExpectancy.toFixed(3)}`);
    } else {
      minConfidenceDelta = Math.max(minConfidenceDelta, 8);
      reasons.push(`pattern-stats-tighten:sample=${riskyPattern.sampleCount},winrate=${riskyWinrate.toFixed(1)},expectancy=${riskyExpectancy.toFixed(3)}`);
    }
  } else {
    const softRisk = riskyPatterns.find((row) => {
      const sampleCount = Number(row.sampleCount ?? 0);
      const expectancy = Number(row.expectancyPercent ?? 0);
      const verdict = String(row.lastCriticVerdict ?? "").toUpperCase();
      return sampleCount >= 1 && expectancy < 0 && (verdict === "BLOCK" || verdict === "PAUSE_SETUP");
    });
    if (softRisk) {
      minConfidenceDelta = Math.max(minConfidenceDelta, 6);
      reasons.push(`pattern-stats-tighten:sample=${softRisk.sampleCount}`);
    }
  }

  return {
    hardBlock,
    minConfidenceDelta,
    reasons: reasons.length > 0 ? reasons : ["learning-memory-ok"],
    memory: {
      exactSymbolLosses: recentSameSymbolLosses.length,
      badMemoryCount: broadBadMemory.length + (sameSymbolMemory ? 1 : 0),
      riskyPatternCount: riskyPatterns.length,
    },
  };
}

async function evaluateAutoRoundLearningCandidate(input: {
  selected: NonNullable<FastEntryResult["selected"]>;
  maxWaitSec: number;
  targetProfitPct: number;
  consecutiveRejections?: number;
}) {
  const profile = resolvePaperRoundProfile(resolveRoundHorizonProfile(input.maxWaitSec));
  const adaptiveThresholds = applyAdaptiveThresholds({
    baseMinConfidence: profile.minConfidence,
    baseMinQualityScore: 60,
    baseMinScannerScore: profile.minScannerScore,
    baseMinScannerConfidence: profile.minScannerConfidence,
    consecutiveRejections: input.consecutiveRejections ?? 0,
  });
  const btcSnapshot = await getBtcMarketFilterSnapshot().catch(() => null);
  const ai = input.selected.ai;
  const context = input.selected.context;
  const confidence = Number(ai?.analysisScorecard?.confidenceScore ?? ai?.finalConfidence ?? 0);
  const analysisScorecard = ai?.analysisScorecard as Record<string, unknown> | undefined;
  const riskScore = Number(ai?.finalRiskScore ?? analysisScorecard?.riskScore ?? 0);
  const scannerScore = Number(input.selected.score.score ?? 0);
  const scannerConfidence = Number(input.selected.score.confidence ?? 0);
  const mtfFromAiRaw = ai?.decisionPayload?.timeframeAnalysis?.alignmentScore;
  const mtfFromContextRaw = context.metadata.mtfAlignmentScore;
  const mtfFromAi = mtfFromAiRaw !== undefined && mtfFromAiRaw !== null && Number.isFinite(Number(mtfFromAiRaw));
  const mtfFromContext =
    mtfFromContextRaw !== undefined && mtfFromContextRaw !== null && Number.isFinite(Number(mtfFromContextRaw));
  const mtfAlignment = mtfFromAi ? Number(mtfFromAiRaw) : mtfFromContext ? Number(mtfFromContextRaw) : null;
  const mtfUnavailable = mtfAlignment === null;
  const shortMomentumRaw = context.metadata.shortMomentumPercent;
  const shortMomentumPresent = shortMomentumRaw !== undefined && shortMomentumRaw !== null && Number.isFinite(Number(shortMomentumRaw));
  const shortMomentum = shortMomentumPresent ? Number(shortMomentumRaw) : 0;
  const hourMomentum = Number(context.metadata.hourMomentumPercent ?? 0);
  const effectiveShortMomentum = Math.max(shortMomentum, hourMomentum);
  const shortFlowRaw = context.metadata.shortFlowImbalance;
  const shortFlowPresent = shortFlowRaw !== undefined && shortFlowRaw !== null && Number.isFinite(Number(shortFlowRaw));
  const shortFlow = shortFlowPresent ? Number(shortFlowRaw) : 0;
  const shortTradeCount = Number(context.metadata.shortTradeCount ?? 0);
  const hasReliableShortTelemetry =
    shortTradeCount >= 3 || (shortMomentumPresent && shortFlowPresent && Math.abs(shortMomentum) + Math.abs(shortFlow) > 0);
  const staleShortTelemetry =
    !hasReliableShortTelemetry &&
    shortTradeCount <= 0 &&
    Math.abs(shortMomentum) <= 0.000001 &&
    Math.abs(shortFlow) <= 0.000001;
  const volumeRatio20Raw = context.metadata.volumeRatio20;
  const hasVolumeTelemetry = volumeRatio20Raw !== undefined && volumeRatio20Raw !== null && Number.isFinite(Number(volumeRatio20Raw));
  const regimeTransitionProbability = Number(context.metadata.regimeTransitionProbability ?? 0);
  const regimeChaosProbability = Number(context.metadata.regimeChaosProbability ?? 0);
  const regimeLifecyclePhase = String(context.metadata.regimeLifecyclePhase ?? "");
  const regimeChopWarning = Boolean(context.metadata.regimeChopWarning ?? false);
  const regimeUnstableBreakout = Boolean(context.metadata.regimeUnstableBreakoutCondition ?? false);
  const explanation = String(ai?.explanation ?? "");
  const roleScores = ai?.roleScores ?? [];
  const technicalRoleScore = Number(roleScores.find((row) => row.role === "AI-1_TECHNICAL")?.score ?? 0);
  const sentimentRoleScore = Number(roleScores.find((row) => row.role === "AI-2_SENTIMENT")?.score ?? 0);
  const riskRoleScore = Number(roleScores.find((row) => row.role === "AI-3_RISK")?.score ?? 0);
  const roleRiskVeto = Boolean(roleScores.find((row) => row.role === "AI-3_RISK")?.veto);
  const hasRoleScores = roleScores.some((r) => Number(r.score) > 0);
  const hasMtfFromAi = mtfFromAi && Number(mtfFromAiRaw) > 0;
  // aiMissing: roleScores yoksa AI eksik sayılır (momentum-breakout override durumu dahil)
  const aiMissing = !ai || !hasRoleScores;
  const paperExplorationCandidate = true;
  const learningMicroCandidate = explanation.includes("learning-micro");
  const steadyGainCandidate = explanation.includes("steady-gain");
  const momentumBreakoutFallback = explanation.includes("momentum-breakout=BUY");
  const lastResortCandidate = explanation.includes("last-resort");
  const ultimateFallbackCandidate = explanation.includes("ultimate=");
  const rangeSideways = String(context.metadata.marketRegime ?? "RANGE_SIDEWAYS") === "RANGE_SIDEWAYS";
  const rocketPump = String(context.metadata.marketRegime ?? "") === "ROCKET_PUMP";
  const pumpBreakoutScore = Number(
    evaluateMomentumBreakout(context).score ??
      /score=([\d.]+)/.exec(explanation)?.[1] ??
      0,
  );
  const compositeAvg = (() => {
    const parts = [technicalRoleScore, sentimentRoleScore, riskRoleScore].filter((value) => value > 0);
    if (parts.length > 0) return parts.reduce((sum, value) => sum + value, 0) / parts.length;
    if (confidence > 0) return confidence;
    return scannerScore;
  })();
  const topGainerPump = isTopGainerPumpSignal(context.metadata as Record<string, unknown>, true);
  const change24h = Number(context.metadata.topGainerChange24h ?? context.change24h ?? 0);
  const pumpLaneCandidate =
    topGainerPump &&
    (explanation.includes("PUMP_CONTINUATION") ||
      explanation.includes("PUMP_INTRADAY") ||
      explanation.includes("PUMP_EARLY") ||
      explanation.includes("pump-intraday") ||
      explanation.includes("pump-continuation") ||
      change24h >= env.PUMP_INTRADAY_MIN_CHANGE_24H);
  const strongPumpContinuation = topGainerPump && effectiveShortMomentum >= 0.12 && shortFlow >= 0.02;
  const targetEdgeAfterSpread = input.targetProfitPct - context.spreadPercent * 2;
  // dataDegraded: AI tüm rol skorları eksikse VEYA klasik tape+flow verisi bozuksa
  const dataDegraded =
    (!hasRoleScores && (mtfUnavailable || mtfAlignment <= 0)) ||
    !hasReliableShortTelemetry ||
    ((!mtfUnavailable && mtfAlignment <= 0) &&
      Math.abs(shortMomentum) < 0.02 &&
      (Math.abs(shortFlow) >= 0.95 || Math.abs(shortFlow) <= 0.001));
  const effectiveMinConfidence = adaptiveThresholds.minConfidence;
  const effectiveMinScannerScore = adaptiveThresholds.minScannerScore;
  const effectiveMinScannerConfidence = adaptiveThresholds.minScannerConfidence;
  const effectiveMinQualityScore = adaptiveThresholds.minQualityScore;
  const effectiveMinMtfAlignment = profile.minMtfAlignment;
  const effectiveMinShortMomentum = profile.minShortMomentum;
  const effectiveMinShortFlow = profile.minShortFlow;
  const effectiveMaxRiskScore = profile.maxRiskScore;
  const effectiveMaxSpreadPercent = profile.maxSpreadPercent;
  const effectiveMaxPumpRisk = profile.maxPumpRisk;
  const effectiveMaxVolatilityPercent = profile.maxVolatilityPercent;
  const effectiveMaxRegimeTransitionProbability = profile.maxRegimeTransitionProbability;
  const effectiveMaxRegimeChaosProbability = profile.maxRegimeChaosProbability;
  const learningMemory = await evaluatePreTradeLearningMemory({
    selected: input.selected,
    maxWaitSec: input.maxWaitSec,
    paperMode: true,
  }).catch((error) => ({
    hardBlock: false,
    minConfidenceDelta: 0,
    reasons: [`learning-memory-error:${(error as Error).message}`],
    memory: { exactSymbolLosses: 0, badMemoryCount: 0, riskyPatternCount: 0 },
  }));
  const learningAdjustedMinConfidence = effectiveMinConfidence + learningMemory.minConfidenceDelta;
  if (pumpLaneCandidate) {
    const tapeMomentum = Number(context.metadata.shortMomentumPercent ?? 0);
    const marketRegime = String(context.metadata.marketRegime ?? "RANGE_SIDEWAYS");
    const pumpStage = String(context.metadata.pumpBreakoutStage ?? evaluateMomentumBreakout(context).stage);
    const strongHourPump =
      change24h >= 15 &&
      hourMomentum >= 1 &&
      tapeMomentum >= 0.12 &&
      shortFlow >= 0.25 &&
      compositeAvg >= 60;
    const weakPumpEntry =
      change24h < 28 &&
      (compositeAvg < 54 || technicalRoleScore < 48 || (technicalRoleScore < 52 && sentimentRoleScore < 58));
    const weakPumpRangeEntry =
      rangeSideways &&
      !strongHourPump &&
      (change24h < 28 ||
        effectiveShortMomentum < 0.55 ||
        shortFlow < 0.12 ||
        (!mtfUnavailable && mtfAlignment < 50) ||
        compositeAvg < 62);
    const weakPumpRocketEntry =
      rocketPump &&
      !strongHourPump &&
      (pumpBreakoutScore < 85 ||
        effectiveShortMomentum < 0.75 ||
        shortFlow < 0.28 ||
        compositeAvg < 64 ||
        technicalRoleScore < 62);
    const weakPumpLateTapeChase =
      pumpStage === "LATE" &&
      tapeMomentum < 0.35 &&
      !isStrongHourPumpContext({ change24h, hourMomentum, tapeMomentum, shortFlow });
    const weakPumpCalmRegime =
      marketRegime === "LOW_VOLATILITY_CALM" &&
      (tapeMomentum < 0.45 || pumpStage === "LATE" || compositeAvg < 66) &&
      !isStrongHourPumpContext({ change24h, hourMomentum, tapeMomentum, shortFlow });
    const weakPumpHourOnlyMomentum =
      !dataDegraded &&
      isFakeHourOnlyPump({
        hourMomentum,
        tapeMomentum,
        shortFlow,
        marketRegime,
        pumpStage,
      });
    const pumpReasons = [
      ai?.finalDecision === "SELL" ? `AI SELL sinyali (${ai?.finalDecision ?? "unknown"})` : "",
      weakPumpEntry
        ? `pump zayif AI profili (tech=${technicalRoleScore.toFixed(1)}, composite=${compositeAvg.toFixed(1)}, 24h=${change24h.toFixed(2)}%)`
        : "",
      weakPumpRangeEntry
        ? `pump RANGE zayif (24h=${change24h.toFixed(2)}%, short=${shortMomentum.toFixed(3)}%, flow=${shortFlow.toFixed(3)})`
        : "",
      weakPumpRocketEntry
        ? `pump ROCKET zayif (score=${pumpBreakoutScore.toFixed(1)}, hour=${hourMomentum.toFixed(3)}%, short=${shortMomentum.toFixed(3)}%, flow=${shortFlow.toFixed(3)}, composite=${compositeAvg.toFixed(1)})`
        : "",
      weakPumpLateTapeChase
        ? `pump LATE tape zayif (stage=${pumpStage}, tape=${tapeMomentum.toFixed(3)}%)`
        : "",
      weakPumpCalmRegime
        ? `pump CALM rejim riskli (tape=${tapeMomentum.toFixed(3)}%, stage=${pumpStage}, composite=${compositeAvg.toFixed(1)})`
        : "",
      weakPumpHourOnlyMomentum
        ? `pump hour-only momentum (tape=${tapeMomentum.toFixed(3)}%, hour=${hourMomentum.toFixed(3)}%)`
        : "",
      learningMemory.hardBlock ? `learning memory block (${learningMemory.reasons.join("; ")})` : "",
      !learningMemory.hardBlock && learningMemory.minConfidenceDelta >= 8
        ? `learning memory tighten (${learningMemory.reasons.join("; ")})`
        : "",
      context.spreadPercent > 0.35 ? `spread ${context.spreadPercent.toFixed(4)}% > 0.35%` : "",
      context.fakeSpikeScore > 3.2 ? `fake spike ${context.fakeSpikeScore.toFixed(2)} > 3.2` : "",
    ].filter(Boolean);
    const entryQuality = evaluatePaperEntryQuality({
      context,
      side: "BUY",
      tapeMomentum,
      hourMomentum,
      shortFlow,
      pumpStage,
      compositeAvg,
      btcSnapshot,
      pumpLane: true,
      dataDegraded,
      adaptiveMinScoreDelta: adaptiveThresholds.relaxation.minQualityScoreDelta,
      minScore: strongHourPump ? 52 : 58,
    });
    if (!entryQuality.ok) {
      pumpReasons.push(formatPaperEntryQualityReason(entryQuality));
    }
    const pumpSafety = evaluatePumpEntrySafety({
      context,
      tapeMomentum,
      hourMomentum,
      shortFlow,
      change24h,
      pumpStage,
      marketRegime,
      compositeAvg,
    });
    if (!pumpSafety.ok) {
      pumpReasons.push(formatPumpEntrySafetyReason(pumpSafety));
    }
    const pumpDecision = resolveAdaptiveEntryDecision({
      reasons: pumpReasons,
      compositeAvg,
      consecutiveRejections: input.consecutiveRejections ?? 0,
      dataDegraded,
      confidence,
      effectiveConfidenceFloor: learningAdjustedMinConfidence,
      effectiveQualityFloor: effectiveMinQualityScore,
    });
    return {
      ok: pumpDecision.ok,
      profile,
      reason: pumpDecision.ok ? "pump-lane-ok" : pumpReasons.join(" | "),
      entryDecision: summarizeEntryDecisionForMetadata(pumpDecision),
      entryQuality,
      metrics: {
        confidence,
        riskScore,
        scannerScore,
        scannerConfidence,
        mtfAlignment,
        shortMomentum,
        shortFlow,
        spreadPercent: context.spreadPercent,
        volatilityPercent: context.volatilityPercent,
        fakeSpikeScore: context.fakeSpikeScore,
        pumpRisk: context.pumpRisk,
        regimeTransitionProbability,
        regimeChaosProbability,
        regimeLifecyclePhase,
        regimeChopWarning,
        regimeUnstableBreakout,
        topGainerPump,
        change24h,
        pumpLaneCandidate,
        strongPumpContinuation,
        paperExplorationCandidate,
        learningMicroCandidate,
        momentumBreakoutFallback,
        lastResortCandidate,
        ultimateFallbackCandidate,
        compositeAvg,
        chopLikeRegime: regimeChopWarning || regimeLifecyclePhase.includes("CHOP") || rangeSideways,
        technicalRoleScore,
        sentimentRoleScore,
        riskRoleScore,
        roleRiskVeto,
        weakLearningMicro: false,
        riskyRangeBreakout: false,
        targetEdgeAfterSpread,
        learningMemory,
      },
    };
  }
  const weakLearningMicro = false;
  const chopLikeRegime =
    regimeChopWarning ||
    regimeLifecyclePhase.includes("CHOP") ||
    regimeLifecyclePhase.includes("CHAOS") ||
    rangeSideways;
  const lowVolCalm = String(context.metadata.marketRegime ?? "RANGE_SIDEWAYS") === "LOW_VOLATILITY_CALM";
  const riskyRangeBreakout =
    (momentumBreakoutFallback || lastResortCandidate || ultimateFallbackCandidate) &&
    chopLikeRegime &&
    compositeAvg < 58 &&
    !strongPumpContinuation;
  // Momentum-breakout RANGE_SIDEWAYS: aiMissing ise composite/breakoutScore ile muafiyet
  const riskyMomentumRangeBreakout =
    momentumBreakoutFallback &&
    rangeSideways &&
    !strongPumpContinuation &&
    !(aiMissing && pumpBreakoutScore >= 60 && compositeAvg >= 50) &&
    !(aiMissing && compositeAvg >= 58);
  // Sentiment zayıf: sadece gerçek AI skoru varsa kontrol et
  const riskyMomentumWeakSentiment =
    momentumBreakoutFallback &&
    hasRoleScores &&
    sentimentRoleScore > 0 &&
    sentimentRoleScore < 58 &&
    !strongPumpContinuation;
  // Last-resort: aiMissing ve makul composite varsa range/calm/chop'ta geçsin
  const riskyLastResortPaper =
    lastResortCandidate &&
    (rangeSideways || lowVolCalm || chopLikeRegime) &&
    !strongPumpContinuation &&
    !(aiMissing && compositeAvg >= 52);
  const riskyLearningMicroRange =
    learningMicroCandidate && rangeSideways && !strongPumpContinuation;
  // roleScores yoksa (aiMissing) sentiment ve MTF bloğu çalıştırılmaz; composite/momentum eşikleri gevşer
  const riskyNonPumpQuality =
    !pumpLaneCandidate &&
    !steadyGainCandidate &&
    !strongPumpContinuation &&
      (compositeAvg < (aiMissing ? 46 : 54) ||
      (hasRoleScores && sentimentRoleScore > 0 && sentimentRoleScore < 48) ||
      (hasMtfFromAi && mtfAlignment !== null && mtfAlignment < 35) ||
      (hasReliableShortTelemetry && shortMomentum < (aiMissing ? 0.008 : 0.015)) ||
      (hasReliableShortTelemetry && shortFlow < (aiMissing ? 0.003 : 0.008)));
  const riskySteadyGainQuality =
    steadyGainCandidate &&
    (compositeAvg < 52 ||
      (hasRoleScores && sentimentRoleScore > 0 && sentimentRoleScore < 44) ||
      (hasMtfFromAi && mtfAlignment !== null && mtfAlignment < 30) ||
      (hasReliableShortTelemetry && shortMomentum < 0.008) ||
      (hasReliableShortTelemetry && shortFlow < 0.004));
  const riskySteadyGainRangeSideways =
    steadyGainCandidate &&
    rangeSideways &&
    ((!mtfUnavailable && mtfAlignment < 35) || compositeAvg < 58);
  const riskySteadyGainNoEdge =
    steadyGainCandidate &&
    (targetEdgeAfterSpread < 0.2 ||
      (rangeSideways && hasReliableShortTelemetry && shortMomentum < 0.025 && shortFlow < 0.01));
  const roleConsensusWeak =
    roleRiskVeto ||
    (technicalRoleScore > 0 && technicalRoleScore < 38) ||
    (sentimentRoleScore > 0 && sentimentRoleScore < 38) ||
    (riskRoleScore > 0 && riskRoleScore < 42);
  const reasons = [
    ai?.finalDecision === "SELL" ? `AI SELL sinyali (${ai?.finalDecision ?? "unknown"})` : "",
    ai?.finalDecision !== "BUY" && ai?.finalDecision !== "SELL" && confidence < 34 && !aiMissing
      ? `AI karar zayif (${ai?.finalDecision ?? "unknown"}, conf=${confidence.toFixed(1)})`
      : "",
    learningMemory.hardBlock ? `learning memory block (${learningMemory.reasons.join("; ")})` : "",
    weakLearningMicro
      ? `learning-micro zayif consensus (tech=${technicalRoleScore.toFixed(1)}, sentiment=${sentimentRoleScore.toFixed(1)}, risk=${riskRoleScore.toFixed(1)}, conf=${confidence.toFixed(1)})`
      : "",
    riskyRangeBreakout
      ? `range/chop fallback riskli (composite=${compositeAvg.toFixed(1)}, conf=${confidence.toFixed(1)})`
      : "",
    riskyLearningMicroRange ? "learning-micro RANGE_SIDEWAYS paper blok" : "",
    riskyNonPumpQuality
      ? `non-pump kalite dusuk (composite=${compositeAvg.toFixed(1)}, sentiment=${sentimentRoleScore.toFixed(1)}, mtf=${mtfUnavailable ? "UNAVAILABLE" : mtfAlignment.toFixed(1)})`
      : "",
    riskySteadyGainQuality
      ? `steady-gain kalite dusuk (composite=${compositeAvg.toFixed(1)}, mtf=${mtfUnavailable ? "UNAVAILABLE" : mtfAlignment.toFixed(1)})`
      : "",
    riskySteadyGainRangeSideways
      ? `steady-gain RANGE blok (mtf=${mtfUnavailable ? "UNAVAILABLE" : mtfAlignment.toFixed(1)}, composite=${compositeAvg.toFixed(1)})`
      : "",
    riskySteadyGainNoEdge
      ? `steady-gain edge yetersiz (targetEdge=${targetEdgeAfterSpread.toFixed(3)}%, momentum=${shortMomentum.toFixed(3)})`
      : "",
    riskyMomentumRangeBreakout ? "momentum-breakout RANGE_SIDEWAYS paper blok" : "",
    riskyMomentumWeakSentiment
      ? `momentum-breakout zayif sentiment (${sentimentRoleScore.toFixed(1)} < 58)`
      : "",
    riskyLastResortPaper ? "last-resort paper blok (range/calm/chop)" : "",
    lastResortCandidate && compositeAvg < (aiMissing ? 48 : 55)
      ? `last-resort composite zayif (${compositeAvg.toFixed(1)} < ${aiMissing ? 48 : 55})`
      : "",
    lastResortCandidate && chopLikeRegime && !aiMissing ? "last-resort chop/range rejimi" : "",
    ultimateFallbackCandidate ? "ultimate fallback devre disi (paper kalite)" : "",
    momentumBreakoutFallback && chopLikeRegime && compositeAvg < (aiMissing ? 52 : 68) && !strongPumpContinuation
      ? `momentum breakout chop/range zayif (${compositeAvg.toFixed(1)})`
      : "",
    roleConsensusWeak
      ? `AI role consensus zayif (tech=${technicalRoleScore.toFixed(1)}, sentiment=${sentimentRoleScore.toFixed(1)}, risk=${riskRoleScore.toFixed(1)})`
      : "",
    !aiMissing && confidence < learningAdjustedMinConfidence
      ? `confidence ${confidence.toFixed(2)} < ${learningAdjustedMinConfidence}`
      : "",
    scannerScore < effectiveMinScannerScore ? `scanner ${scannerScore.toFixed(2)} < ${effectiveMinScannerScore}` : "",
    scannerConfidence < effectiveMinScannerConfidence
      ? `scanner confidence ${scannerConfidence.toFixed(2)} < ${effectiveMinScannerConfidence}`
      : "",
    mtfUnavailable ? "MTF UNAVAILABLE (explicit contract)" : "",
    mtfAlignment !== null &&
    mtfAlignment < effectiveMinMtfAlignment &&
    !dataDegraded &&
    effectiveMinMtfAlignment > 0
      ? `MTF ${mtfAlignment.toFixed(2)} < ${effectiveMinMtfAlignment}`
      : "",
    riskScore > effectiveMaxRiskScore ? `risk ${riskScore.toFixed(2)} > ${effectiveMaxRiskScore}` : "",
    context.spreadPercent > effectiveMaxSpreadPercent ? `spread ${context.spreadPercent.toFixed(4)}% > ${effectiveMaxSpreadPercent}%` : "",
    context.fakeSpikeScore > profile.maxFakeSpikeScore ? `fake spike ${context.fakeSpikeScore.toFixed(2)} > ${profile.maxFakeSpikeScore}` : "",
    String(context.metadata.pumpRiskStatus ?? "AVAILABLE") !== "AVAILABLE"
      ? "pump risk UNAVAILABLE (explicit contract)"
      : "",
    context.pumpRisk > effectiveMaxPumpRisk && !strongPumpContinuation
      ? `pump risk ${context.pumpRisk.toFixed(2)} > ${effectiveMaxPumpRisk}${
          Boolean(context.metadata.pumpRiskCapped) ? ` (raw=${Number(context.metadata.pumpRiskRawScore ?? 0).toFixed(2)}, capped)` : ""
        }`
      : "",
    context.volatilityPercent > effectiveMaxVolatilityPercent && !strongPumpContinuation
      ? `volatility ${context.volatilityPercent.toFixed(4)}% > ${effectiveMaxVolatilityPercent}%`
      : "",
    !dataDegraded &&
    (shortMomentum < effectiveMinShortMomentum || shortFlow < effectiveMinShortFlow)
      ? `momentum/flow zayif (${shortMomentum.toFixed(4)}, ${shortFlow.toFixed(4)})`
      : "",
    targetEdgeAfterSpread < (aiMissing ? 0.08 : 0.18) ? `net hedef edge zayif (${targetEdgeAfterSpread.toFixed(4)}%)` : "",
    regimeTransitionProbability > effectiveMaxRegimeTransitionProbability && !strongPumpContinuation
      ? `regime transition ${regimeTransitionProbability.toFixed(2)} > ${effectiveMaxRegimeTransitionProbability}`
      : "",
    regimeChaosProbability > effectiveMaxRegimeChaosProbability && !strongPumpContinuation
      ? `regime chaos ${regimeChaosProbability.toFixed(2)} > ${effectiveMaxRegimeChaosProbability}`
      : "",
    regimeChopWarning && !strongPumpContinuation && !dataDegraded ? "regime chop warning" : "",
    regimeUnstableBreakout && !strongPumpContinuation && !dataDegraded ? "unstable breakout condition" : "",
    !dataDegraded &&
    (regimeLifecyclePhase.includes("CHAOS") || regimeLifecyclePhase.includes("CHOP"))
      ? `regime lifecycle risk (${regimeLifecyclePhase})`
      : "",
  ].filter(Boolean);
  // aiMissing: BTC/EMA/hacim verileri olsa bile AI rol skoru eksik olduğu için eşiği düşür
  const entryQuality = evaluatePaperEntryQuality({
    context,
    side: "BUY",
    tapeMomentum: shortMomentum,
    hourMomentum,
    shortFlow,
    pumpStage: String(context.metadata.pumpBreakoutStage ?? ""),
    compositeAvg,
    btcSnapshot,
    pumpLane: aiMissing,
    dataDegraded,
    adaptiveMinScoreDelta: adaptiveThresholds.relaxation.minQualityScoreDelta,
    minScore: aiMissing ? Math.max(40, effectiveMinQualityScore - 8) : strongPumpContinuation ? 56 : effectiveMinQualityScore,
  });
  if (!entryQuality.ok) {
    reasons.push(formatPaperEntryQualityReason(entryQuality));
  }
  const rawEntryDecision = resolveAdaptiveEntryDecision({
    reasons,
    compositeAvg,
    consecutiveRejections: input.consecutiveRejections ?? 0,
    dataDegraded,
    confidence,
    effectiveConfidenceFloor: learningAdjustedMinConfidence,
    effectiveQualityFloor: effectiveMinQualityScore,
  });
  const blockerTrail = [
    rawEntryDecision.primaryBlocker,
    ...rawEntryDecision.secondaryBlockers,
  ].filter((x): x is string => typeof x === "string" && x.length > 0);
  const scannerPolicy = evaluateScannerPolicy({
    blockers: blockerTrail,
    hasShortTelemetry: hasReliableShortTelemetry,
    hasVolumeTelemetry,
    staleShortTelemetry,
  });
  const entryDecision =
    !rawEntryDecision.ok && scannerPolicy.action === "DEFER"
      ? {
          ...rawEntryDecision,
          ok: true,
          primaryBlocker: null,
          secondaryBlockers: [],
        }
      : rawEntryDecision;
  return {
    ok: entryDecision.ok,
    profile,
    reason: entryDecision.ok
      ? scannerPolicy.action === "DEFER" && blockerTrail.length > 0
        ? `entry-deferred:${scannerPolicy.reasonCodes.join(",") || "UNKNOWN_DATA_OR_DUPLICATE"}`
        : "entry-accepted"
      : reasons.join(" | "),
    entryDecision: summarizeEntryDecisionForMetadata(entryDecision),
    entryQuality,
    metrics: {
      confidence,
      riskScore,
      scannerScore,
      scannerConfidence,
      mtfAlignment: mtfAlignment ?? 0,
      mtfStatus: mtfUnavailable ? "UNAVAILABLE" : "AVAILABLE",
      mtfSource: mtfFromAi ? "AI" : mtfFromContext ? "MARKET_CONTEXT" : "NONE",
      shortMomentum,
      shortFlow,
      spreadPercent: context.spreadPercent,
      volatilityPercent: context.volatilityPercent,
      fakeSpikeScore: context.fakeSpikeScore,
      pumpRisk: context.pumpRisk,
      regimeTransitionProbability,
      regimeChaosProbability,
      regimeLifecyclePhase,
      regimeChopWarning,
      regimeUnstableBreakout,
      topGainerPump,
      strongPumpContinuation,
      paperExplorationCandidate,
      learningMicroCandidate,
      momentumBreakoutFallback,
      lastResortCandidate,
      ultimateFallbackCandidate,
      compositeAvg,
      chopLikeRegime,
      technicalRoleScore,
      sentimentRoleScore,
      riskRoleScore,
      roleRiskVeto,
      weakLearningMicro,
      riskyRangeBreakout,
      riskyLearningMicroRange,
      riskyNonPumpQuality,
      riskySteadyGainQuality,
      riskyMomentumRangeBreakout,
      riskyMomentumWeakSentiment,
      riskyLastResortPaper,
      targetEdgeAfterSpread,
      learningMemory,
      hasReliableShortTelemetry,
      staleShortTelemetry,
      hasVolumeTelemetry,
      scannerPolicyAction: scannerPolicy.action,
      scannerPolicyClasses: scannerPolicy.classes,
      scannerPolicyReasonCodes: scannerPolicy.reasonCodes,
    },
  };
}

function toStateText(state: AutoRoundState) {
  return state.replaceAll("_", " ");
}

async function reconcileRegistryIntegrityForJob(jobId: string, ownerId: string) {
  const job = await getAutoRoundJobById(jobId);
  if (!job) return { reconciled: false };

  const report = recoverRoundRegistryFromRuns({
    jobId,
    ownerId,
    runs: job.rounds ?? [],
    inProgressStates: inProgressRoundStates,
    onDuplicateRun: async (runId) => {
      await transactionallyFailRound({
        jobId,
        runId,
        reason: "Duplicate in-progress run consolidated by registry reconcile",
        rejectBucket: "registry",
      }).catch(() => null);
    },
  });

  const integrity = await auditAutoRoundIntegrity(jobId);
  if (integrity?.orphanActiveRunId) {
    const activeRun =
      (job.rounds ?? []).find(
        (run) => !run.endedAt && inProgressRoundStates.includes(run.state as AutoRoundState),
      ) ?? null;
    await updateAutoRoundJob({
      jobId,
      activeRunId: activeRun?.id ?? null,
      activeState: activeRun ? (activeRun.state as AutoRoundState) : "bekliyor",
    }).catch(() => null);
  }

  for (const ownership of getActiveRoundOwnershipForJob(jobId)) {
    const record = getRoundOwnershipRecord(jobId, ownership.roundNo);
    if (record) {
      await persistRoundOwnershipRecord({ jobId, record }).catch(() => null);
    }
  }

  return {
    reconciled: report.duplicatesConsolidated > 0 || report.staleReleased > 0 || Boolean(integrity?.orphanActiveRunId),
    report,
  };
}

async function reconcileStaleWaitingRunsForJob(jobId: string) {
  const job = await getAutoRoundJobById(jobId);
  if (!job) return;
  const now = Date.now();
  let failedInc = 0;
  let lastError: string | null = null;

  for (const run of job.rounds) {
    if (run.state !== "satis_bekleniyor") continue;
    const meta = (run.metadata as Record<string, unknown> | null) ?? {};
    const runMaxWaitSec = Number(meta.maxWaitSec ?? job.maxWaitSec ?? 0);
    const startedAtMs = new Date(run.startedAt).getTime();
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(runMaxWaitSec) || runMaxWaitSec <= 0) continue;
    const overdueMs = now - (startedAtMs + runMaxWaitSec * 1000);
    if (overdueMs <= 0) continue;

    const positionId = String(meta.positionId ?? "");
    if (positionId) {
      await closePositionManually({
        positionId,
        reason: "MANUAL_CLOSE",
      }).catch(() => null);
    }

    const reason = `Max bekleme suresi asildi (${runMaxWaitSec}s) - watchdog`;
    await updateAutoRoundRun({
      runId: run.id,
      state: "sure_doldu",
      failReason: reason,
      result: "failed",
      endedAt: new Date(),
      metadata: {
        ...meta,
        watchdogRecoveredAt: new Date().toISOString(),
      },
    });
    failedInc += 1;
    lastError = reason;
  }

  if (failedInc > 0) {
    await updateAutoRoundJob({
      jobId: job.id,
      failedRounds: job.failedRounds + failedInc,
      activeState: "sure_doldu",
      lastError: lastError ?? job.lastError,
    }).catch(() => null);
  }
}

async function setJobState(jobId: string, state: AutoRoundState, message: string, context?: Record<string, unknown>) {
  const job = await getAutoRoundJobById(jobId);
  if (!job) return;
  const roundNo = Number(context?.roundNo ?? job.currentRound ?? 0);
  const runId = typeof context?.runId === "string" ? context.runId : undefined;
  const selectionAttempt = Number(context?.selectionAttempt ?? 0);
  if (job.activeState !== state) {
    await updateAutoRoundJob({
      jobId,
      activeState: state,
    });
  }
  publishExecutionEvent({
    executionId: `round-job-${jobId}`,
    symbol: undefined,
    stage: "round-engine",
    status: state === "tur_basarisiz" ? "FAILED" : state === "tur_tamamlandi" ? "SUCCESS" : "RUNNING",
    level: state === "tur_basarisiz" ? "ERROR" : "INFO",
    message,
    context: {
      jobId,
      currentRound: roundNo || job.currentRound,
      roundNo: roundNo || job.currentRound,
      runId,
      selectionAttempt: Number.isFinite(selectionAttempt) && selectionAttempt > 0 ? selectionAttempt : undefined,
      totalRounds: job.totalRounds,
      activeState: toStateText(state),
      ...context,
    },
  });
  await writeStructuredLog({
    level: state === "tur_basarisiz" ? "ERROR" : state === "sure_doldu" ? "WARN" : "INFO",
    source: "auto-round-engine",
    message,
    actionType: state === "tur_tamamlandi" ? "round_completed" : "round_status",
    status: state === "tur_basarisiz" ? "FAILED" : state === "tur_tamamlandi" ? "SUCCESS" : "RUNNING",
    transactionId: jobId,
    context: {
      jobId,
      roundNo: roundNo || job.currentRound,
      runId,
      selectionAttempt: Number.isFinite(selectionAttempt) && selectionAttempt > 0 ? selectionAttempt : undefined,
      state,
      ...context,
    },
  });
  await persistRoundState({
    userId: job.userId,
    jobId,
    roundNo: roundNo || job.currentRound,
    state,
    symbol: typeof context?.symbol === "string" ? context.symbol : undefined,
    status: state === "tur_basarisiz" ? "FAILED" : state === "tur_tamamlandi" ? "SUCCESS" : "RUNNING",
  }).catch(() => null);
}

async function resolveTradingPauseState(userId: string, paperMode: boolean) {
  if (paperMode) {
    return { paused: false as const, reason: null, kind: null };
  }
  const safeMode = await getSafeModeState(userId);
  if (safeMode.enabled) {
    return {
      paused: true as const,
      reason: safeMode.reason ?? "Safe mode active",
      kind: "safe_mode" as const,
    };
  }
  if (await getEmergencyStopState(userId)) {
    return {
      paused: true as const,
      reason:
        "Emergency stop aktif — System Command veya POST /api/trades/emergency-stop { enabled: false } ile kapat",
      kind: "emergency_stop" as const,
    };
  }
  return { paused: false as const, reason: null, kind: null };
}

function isPaperAutoRoundJob(job: { aiMode: string }) {
  return job.aiMode.toLowerCase() === "learning" || env.EXECUTION_MODE === "paper";
}

function buildSelectionReason(selected: ScannerCandidate | null) {
  const explanation = String(selected?.ai?.explanation ?? "scanner + ai consensus").trim();
  const finalDecision = String(selected?.ai?.finalDecision ?? "").toUpperCase();
  if (
    finalDecision &&
    finalDecision !== "NO_TRADE" &&
    finalDecision !== "HOLD" &&
    explanation.toUpperCase().includes("NO_TRADE RESOLVED")
  ) {
    return `FINAL_DECISION=${finalDecision} | ${explanation}`;
  }
  return explanation;
}

async function haltAutoRoundJobForPause(jobId: string, reason: string) {
  cancelRoundSelection(jobId, reason);
  stopSchedulerWatchdog(jobId);
  const job = await getAutoRoundJobById(jobId);
  if (job) {
    terminalizeAiForRuns(
      (job.rounds ?? []).map((run) => ({ id: run.id, roundNo: Number(run.roundNo ?? 0) })).filter((run) => run.roundNo > 0),
      "JOB_PAUSED",
      reason,
    );
    for (const run of job.rounds ?? []) {
      if (inProgressRoundStates.includes(run.state as AutoRoundState) && !run.endedAt) {
        await updateAutoRoundRun({
          runId: run.id,
          state: "tur_basarisiz",
          failReason: reason,
          result: "failed",
          endedAt: new Date(),
        }).catch(() => null);
      }
    }
  }
  clearRoundCancellation(jobId);
  await updateAutoRoundJob({
    jobId,
    status: "STOPPED",
    stopRequested: true,
    activeState: "bekliyor",
    finishedAt: new Date(),
    lastError: reason,
  });
  await setJobState(jobId, "bekliyor", `Tur motoru durduruldu: ${reason}`, { reason });
}

async function failRound(input: {
  jobId: string;
  runId: string;
  reason: string;
  symbol?: string;
  confidence?: number;
  roundOwnerId?: string;
  activeState?: AutoRoundState;
}) {
  const job = await getAutoRoundJobById(input.jobId);
  if (!job) return;
  const campaignId = resolveCampaignIdFromJob(job);
  const rejectBucket = normalizeRejectBucket(input.reason);
  const existingRun = await getAutoRoundRunById(input.runId).catch(() => null);
  const ownership =
    getActiveRoundOwnershipForJob(input.jobId).find((row) => row.runId === input.runId)?.roundOwner ??
    input.roundOwnerId;
  let releasedRecord = getRoundRegistrySnapshot().entries.find(
    (row) => row.jobId === input.jobId && row.runId === input.runId,
  ) ?? null;

  if (existingRun?.roundNo && ownership) {
    await releaseRoundOwnership({
      jobId: input.jobId,
      roundNo: existingRun.roundNo,
      runId: input.runId,
      ownerId: ownership,
      finalStatus: "ROUND_FAILED",
    }).catch(() => null);
    releasedRecord =
      getRoundRegistrySnapshot().entries.find(
        (row) => row.jobId === input.jobId && row.roundNo === existingRun.roundNo,
      ) ?? releasedRecord;
  }

  const runtime = readRuntimeFromMetadata((existingRun?.metadata as Record<string, unknown> | null) ?? null);
  if (existingRun?.roundNo) {
    terminalizeAiForRuns(
      [{ id: input.runId, roundNo: existingRun.roundNo }],
      "ROUND_FAILED",
      input.reason,
    );
  }
  if (existingRun) {
    ensureRoundHangSnapshotForAbnormalTerminal({
      sessionId: input.jobId,
      roundId: String(existingRun.roundNo ?? job.currentRound),
      runId: input.runId,
      jobId: input.jobId,
      nowIso: new Date().toISOString(),
      startedAt: existingRun.startedAt ? new Date(existingRun.startedAt).toISOString() : null,
      endedAt: new Date().toISOString(),
      terminalReason: input.reason,
      currentStage: runtime?.step ? String(runtime.step) : "FAILED",
      currentCandidate: runtime?.currentCandidate ? String(runtime.currentCandidate) : undefined,
      runtime: (runtime ?? {}) as unknown as Record<string, unknown>,
      activeRetries: Number(runtime?.retryCount ?? 0),
      activeAI: Number(runtime?.aiProcessed ?? 0),
      activeScannerWork: Number(runtime?.scannerSymbolsProcessed ?? runtime?.candidatesProcessed ?? 0),
      activePumpWork: Number(runtime?.pumpProcessed ?? 0),
      activeDBWork: Number(runtime?.dbTransientFailures ?? 0),
    });
  }

  await transactionallyFailRound({
    jobId: input.jobId,
    runId: input.runId,
    reason: input.reason,
    symbol: shouldBindSymbolOnTerminalFail(input.reason, input.symbol),
    confidence: input.confidence,
    rejectBucket,
    activeState: input.activeState ?? "tur_basarisiz",
    ownership: releasedRecord,
  });

  await setJobState(input.jobId, input.activeState ?? "tur_basarisiz", `Tur basarisiz: ${input.reason}`, {
    runId: input.runId,
    roundNo: existingRun?.roundNo ?? job.currentRound,
    reason: input.reason,
    rejectBucket,
    symbol: input.symbol,
  });

  const forensicSession =
    getForensicSession() ??
    getOrCreateForensicSession({ sessionId: input.jobId, jobId: input.jobId, campaignId });
  if (forensicSession && existingRun) {
    await runRoundForensicExport({
      session: forensicSession,
      campaignId,
      roundId: String(existingRun.roundNo ?? job.currentRound),
      runId: input.runId,
      jobId: input.jobId,
      roundNo: existingRun.roundNo ?? job.currentRound,
      startedAt: existingRun.startedAt,
      endedAt: new Date(),
      symbol: shouldBindSymbolOnTerminalFail(input.reason, input.symbol ?? existingRun?.symbol ?? undefined),
      failReason: input.reason,
      result: "failed",
      userId: job.userId,
      terminalState: input.activeState ?? "tur_basarisiz",
      currentStage: runtime?.step ? String(runtime.step) : "FAILED",
      lastProgressAt: runtime?.lastProgressAt ? String(runtime.lastProgressAt) : null,
      heartbeatAt: runtime?.heartbeatAt ? String(runtime.heartbeatAt) : null,
      elapsedMs: runtime?.elapsedMs != null ? Number(runtime.elapsedMs) : null,
      selectionBudgetMs: runtime?.selectionBudgetMs != null ? Number(runtime.selectionBudgetMs) : null,
    });
  }
}

async function completeNoTradeRound(input: {
  jobId: string;
  runId: string;
  reason: string;
  roundOwnerId?: string;
  symbol?: string | null;
  candidateId?: string | null;
  terminalOutcome?: RoundTerminalOutcome;
}) {
  const job = await getAutoRoundJobById(input.jobId);
  const run = await getAutoRoundRunById(input.runId).catch(() => null);
  if (!job || !run) return;
  const campaignId = resolveCampaignIdFromJob(job);
  const outcome =
    input.terminalOutcome ??
    classifyRoundTerminalOutcome({
      reason: input.reason,
      symbol: input.symbol ?? run.symbol,
      candidateId: input.candidateId ?? null,
    });
  const terminalReason = formatTerminalReason(outcome);
  const ownership =
    getActiveRoundOwnershipForJob(input.jobId).find((row) => row.runId === input.runId)?.roundOwner ??
    input.roundOwnerId;
  let releasedRecord = getRoundOwnershipRecord(input.jobId, run.roundNo) ?? null;
  if (ownership) {
    await releaseRoundOwnership({
      jobId: input.jobId,
      roundNo: run.roundNo,
      runId: input.runId,
      ownerId: ownership,
      finalStatus: "ROUND_COMPLETED",
    }).catch(() => null);
    releasedRecord = getRoundOwnershipRecord(input.jobId, run.roundNo) ?? releasedRecord;
  }
  await transactionallyCompleteRound({
    jobId: input.jobId,
    runId: input.runId,
    ownership: releasedRecord,
    runPatch: {
      state: "tur_tamamlandi",
      netPnl: 0,
      feeTotal: 0,
      result: "no_trade",
      metadata: {
        closeReason: outcome.closeReason,
        terminalReason,
        terminalOutcome: outcome,
      },
    },
  });
  await updateAutoRoundRun({
    runId: input.runId,
    failReason: terminalReason,
  }).catch(() => null);
  await setJobState(input.jobId, "tur_tamamlandi", `Tur tamamlandi (trade yok): ${terminalReason}`, {
    runId: input.runId,
    roundNo: run.roundNo,
    reason: terminalReason,
  });
  const forensicSession =
    getForensicSession() ??
    getOrCreateForensicSession({ sessionId: input.jobId, jobId: input.jobId, campaignId });
  await runRoundForensicExport({
    session: forensicSession,
    campaignId,
    roundId: String(run.roundNo),
    runId: input.runId,
    jobId: input.jobId,
    roundNo: run.roundNo,
    startedAt: run.startedAt,
    endedAt: new Date(),
    symbol: input.symbol ?? run.symbol ?? null,
    failReason: terminalReason,
    result: "no_trade",
    userId: job.userId,
    terminalState: "tur_tamamlandi",
    currentStage: outcome.runtimeStep,
    lastProgressAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    elapsedMs: null,
    selectionBudgetMs: null,
  });
}

async function tryRecoverStaleOpenPaperPositions(input: {
  userId: string;
  maxWaitSec: number;
  openPositions: Awaited<ReturnType<typeof listOpenPositionsByUser>>;
}) {
  const closed: string[] = [];
  const kept: string[] = [];
  const thresholdSec = Math.max(180, input.maxWaitSec + 60);
  for (const pos of input.openPositions) {
    const metadata = (pos.metadata as Record<string, unknown> | null) ?? {};
    const isPaper = String(metadata.mode ?? "").toLowerCase() === "paper";
    const openedAtMs = new Date(pos.openedAt).getTime();
    const ageSec = Number.isFinite(openedAtMs) ? Math.floor((Date.now() - openedAtMs) / 1000) : 0;
    if (!isPaper || ageSec < thresholdSec) {
      kept.push(`${pos.tradingPair.symbol}(${ageSec}s)`);
      continue;
    }
    const closeResult = await closePositionManually({
      positionId: pos.id,
      reason: "MANUAL_CLOSE",
    }).catch(() => ({ closed: false }));
    if ((closeResult as { closed?: boolean }).closed) {
      closed.push(pos.tradingPair.symbol);
    } else {
      kept.push(`${pos.tradingPair.symbol}(${ageSec}s)`);
    }
  }
  return {
    closed,
    kept,
  };
}

async function waitPositionClosed(input: {
  jobId: string;
  runId: string;
  positionId: string;
  executionId?: string;
  maxWaitSec: number;
  roundNo?: number;
  totalRounds?: number;
  positionOpenedAtMs?: number;
}) {
  const deadline = Date.now() + Math.max(30, input.maxWaitSec) * 1000;
  const openedAtMs = input.positionOpenedAtMs ?? Date.now();
  while (Date.now() < deadline) {
    const holdSec = Math.floor((Date.now() - openedAtMs) / 1000);
    if (input.roundNo && input.totalRounds) {
      await patchRoundRuntimeProgress({
        jobId: input.jobId,
        runId: input.runId,
        roundNo: input.roundNo,
        totalRounds: input.totalRounds,
        maxSelectionAttempts: resolveAutoRoundMaxSelectionAttempts(),
        patch: {
          step: "POSITION_MONITORING",
          message: `Pozisyon izleniyor (${holdSec}/${input.maxWaitSec}s)`,
          currentPipeline: "position-monitor",
          positionHoldSec: holdSec,
          positionMaxWaitSec: input.maxWaitSec,
          executionPhasePct: 100,
        },
      }).catch(() => null);
    }
    const position = await getPositionById(input.positionId);
    if (!position) {
      return { ok: false as const, reason: "Pozisyon bulunamadi" };
    }
    if (position.status === "CLOSED") {
      const events = input.executionId
        ? await listPersistedExecutionEvents({ executionId: input.executionId, limit: 25 }).catch(() => [])
        : [];
      const settlement = events.find((row) => row.stage === "settlement" && row.status === "SUCCESS");
      const summary = settlement?.context?.tradeSummary as
        | {
            exitPrice?: number;
            quantity?: number;
            netPnl?: number;
            roePercent?: number;
            closeReason?: string;
          }
        | undefined;
      const positionMeta = (position.metadata as Record<string, unknown> | null) ?? {};
      const closeReason = String(summary?.closeReason ?? positionMeta.closeReason ?? "");
      const state: AutoRoundState = closeReason === "STOP_LOSS" ? "zarar_durdur_calisti" : "satis_gerceklesti";
      return {
        ok: true as const,
        state,
        sellPrice: Number(summary?.exitPrice ?? position.closePrice ?? 0),
        sellQty: Number(summary?.quantity ?? position.quantity ?? 0),
        netPnl: Number(summary?.netPnl ?? position.realizedPnl ?? 0),
        roePercent: Number(
          summary?.roePercent ??
            calculateNetProfitPercent({
              side: position.side,
              entryPrice: position.entryPrice,
              exitPrice: Number(summary?.exitPrice ?? position.closePrice ?? 0),
            }),
        ),
        feeTotal: Number(position.feeTotal ?? 0),
        closeReason: closeReason || "TIMEOUT_OR_MANUAL",
      };
    }
    await sleep(2_000);
  }

  await closePositionManually({
    positionId: input.positionId,
    reason: "MANUAL_CLOSE",
  }).catch(() => null);
  return { ok: false as const, reason: "sure_doldu" };
}

async function runRoundJob(jobId: string, ctx: SchedulerLoopContext) {
  const roundOwnerId = buildRoundOwnerId(ctx);
  try {
    while (!ctx.signal.aborted) {
      assertSchedulerLoopOwnership(jobId, ctx);
      await touchSchedulerLease(jobId, ctx, schedulerLeasePersistence);
      const job = await getAutoRoundJobById(jobId);
      if (!job) break;

      recoverRoundRegistryFromRuns({
        jobId,
        ownerId: roundOwnerId,
        runs: job.rounds ?? [],
        inProgressStates: inProgressRoundStates,
        onDuplicateRun: async (runId) => {
          await failRound({
            jobId,
            runId,
            reason: "Duplicate in-progress run consolidated by round registry recovery",
          });
        },
      });

      if (job.stopRequested || ctx.signal.aborted) {
        cancelRoundSelection(jobId, "Tur motoru durduruldu");
        terminalizeAiForRuns(
          (job.rounds ?? []).map((run) => ({ id: run.id, roundNo: Number(run.roundNo ?? 0) })).filter((run) => run.roundNo > 0),
          "JOB_STOP_REQUESTED",
          "Tur motoru durduruldu",
        );
        clearRoundCancellation(jobId);
        await updateAutoRoundJob({
          jobId,
          status: "STOPPED",
          activeState: "bekliyor",
          finishedAt: new Date(),
          lastError: null,
        });
        await setJobState(jobId, "bekliyor", "Tur motoru kullanici tarafindan durduruldu");
        break;
      }

      const pause = await resolveTradingPauseState(job.userId, isPaperAutoRoundJob(job));
      if (pause.paused) {
        await haltAutoRoundJobForPause(jobId, pause.reason ?? "Trading paused");
        break;
      }

      const doneCount = job.completedRounds + job.failedRounds;
      if (doneCount >= job.totalRounds) {
        terminalizeAiForRuns(
          (job.rounds ?? []).map((run) => ({ id: run.id, roundNo: Number(run.roundNo ?? 0) })).filter((run) => run.roundNo > 0),
          "JOB_COMPLETED",
          "Tum hedef turlar tamamlandi",
        );
        clearRoundCancellation(jobId);
        await updateAutoRoundJob({
          jobId,
          status: "COMPLETED",
          activeState: "tur_tamamlandi",
          finishedAt: new Date(),
        });
        await setJobState(jobId, "tur_tamamlandi", "Tum hedef turlar tamamlandi");
        break;
      }

      const activeOwnership = getActiveRoundOwnershipForJob(jobId)[0];
      const runningRun = activeOwnership
        ? (job.rounds ?? []).find((run) => run.id === activeOwnership.runId)
        : sortInProgressRuns(job.rounds ?? [])[0];
      if (runningRun) {
        const runMeta = (runningRun.metadata as Record<string, unknown> | null) ?? {};
        const startedAtMs = new Date(runningRun.startedAt).getTime();
        let ageSec = Number.isFinite(startedAtMs) ? Math.floor((Date.now() - startedAtMs) / 1000) : 0;
        const runtime = readRuntimeFromMetadata(runMeta);
        const heartbeatAgeSec = runtime?.heartbeatAt
          ? Math.floor((Date.now() - new Date(runtime.heartbeatAt).getTime()) / 1000)
          : ageSec;
        const selectionBudgetSec = resolveAutoRoundSelectionBudgetSec();
        const executionPhaseStates: AutoRoundState[] = ["coin_secildi", "alim_yapildi", "satis_bekleniyor"];
        let staleLimitSec: number;
        if (runningRun.state === "tariyor" && !runningRun.symbol) {
          staleLimitSec = Math.max(300, selectionBudgetSec + 60);
        } else if (executionPhaseStates.includes(runningRun.state as AutoRoundState)) {
          const phaseAnchor =
            typeof runMeta.coinSelectedAt === "string"
              ? runMeta.coinSelectedAt
              : runtime?.heartbeatAt ?? runningRun.startedAt;
          const phaseStartMs = new Date(phaseAnchor).getTime();
          ageSec = Number.isFinite(phaseStartMs) ? Math.floor((Date.now() - phaseStartMs) / 1000) : ageSec;
          const runMaxWaitSec = Number(runMeta.maxWaitSec ?? job.maxWaitSec ?? 900);
          staleLimitSec = Math.max(300, runMaxWaitSec + 120);
        } else {
          staleLimitSec = Math.max(300, job.maxWaitSec + 120);
        }
        const heartbeatStaleSec = Math.max(45, Math.floor(resolveRoundWatchdogStaleMs() / 1000));
        if (
          ageSec > staleLimitSec ||
          (runningRun.state === "tariyor" && heartbeatAgeSec > heartbeatStaleSec)
        ) {
          await failRound({
            jobId,
            runId: runningRun.id,
            reason:
              heartbeatAgeSec > heartbeatStaleSec && ageSec <= staleLimitSec
                ? `Tur heartbeat zaman asimi (state=${runningRun.state}, heartbeatAge=${heartbeatAgeSec}s)`
                : `Tur zaman asimi (state=${runningRun.state}, age=${ageSec}s)`,
            symbol: runningRun.symbol ?? undefined,
          });
          clearRoundCancellation(jobId);
          continue;
        }
        await sleep(1_500);
        continue;
      }

      assertSchedulerLoopOwnership(jobId, ctx);
      const roundNo = doneCount + 1;
      const campaignId = resolveCampaignIdFromJob(job);
      const horizonProfile = resolveRoundHorizonProfile(job.maxWaitSec);
      const perRoundTargetProfitPct = Number(
        Math.max(
          resolveMinimumProtectedProfitPercent(),
          horizonProfile.targetFloorPct,
          Math.min(5, job.targetProfitPct / Math.max(1, job.totalRounds)),
        ).toFixed(4),
      );
      const perRoundStopLossPct = Number(
        Math.max(horizonProfile.stopFloorPct, Math.min(5, job.stopLossPct / Math.max(1, job.totalRounds))).toFixed(4),
      );

      const ownershipSeed = {
        jobId,
        roundNo,
        roundOwner: roundOwnerId,
        runId: "",
        status: "ROUND_CREATED" as const,
        version: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const acquired = await atomicAcquireRoundOwnership({
        jobId,
        roundNo,
        ownerId: roundOwnerId,
        persistAcquire: async () => {
          const persisted = await acquireOrCreateRoundRun({
            jobId,
            roundNo,
            ownerId: roundOwnerId,
            ownership: { ...ownershipSeed, status: "OWNERSHIP_ACQUIRED", runId: "pending" },
            state: "tariyor",
            metadata: {
              campaignId,
              targetProfitPct: perRoundTargetProfitPct,
              totalTargetProfitPct: job.targetProfitPct,
              stopLossPct: perRoundStopLossPct,
              totalStopLossPct: job.stopLossPct,
              maxWaitSec: job.maxWaitSec,
              horizonProfile: horizonProfile.label,
              budgetPerTrade: job.budgetPerTrade,
              roundOwnerId,
            },
          });
          return {
            action: persisted.action,
            runId: persisted.run.id,
          };
        },
      });
      if (!acquired.record) {
        await sleep(500);
        continue;
      }
      const run = await getAutoRoundRunById(acquired.record.runId);
      if (!run) {
        await sleep(500);
        continue;
      }
      attachForensicRound({ runId: run.id, roundId: String(roundNo), jobId, campaignId });
      await updateAutoRoundJob({
        jobId,
        currentRound: roundNo,
        lastError: null,
        activeState: "tariyor",
      });
      await setJobState(jobId, "tariyor", `Tur ${roundNo}/${job.totalRounds}: piyasa taraniyor`, {
        roundNo,
        runId: run.id,
      });

      let openPositions = await listOpenPositionsByUser(job.userId);
      if (openPositions.length > 0) {
        const recovery = await tryRecoverStaleOpenPaperPositions({
          userId: job.userId,
          maxWaitSec: job.maxWaitSec,
          openPositions,
        });
        if (recovery.closed.length > 0) {
          await setJobState(jobId, "bekliyor", "Stale paper pozisyonlar kapatildi, tur devam edecek", {
            recoveredSymbols: recovery.closed,
          });
          openPositions = await listOpenPositionsByUser(job.userId);
        }
      }
      if (openPositions.length > 0) {
        await failRound({
          jobId,
          runId: run.id,
          reason: `Acik pozisyon varken yeni tur baslatilamaz (${openPositions.map((x) => x.tradingPair.symbol).join(", ")})`,
        });
        continue;
      }

      clearRoundCancellation(jobId);
      registerRoundCancellation(jobId);
      await transitionRoundLifecycle({
        jobId,
        roundNo,
        runId: run.id,
        ownerId: roundOwnerId,
        status: "SELECTION_RUNNING",
      }).catch(() => null);
      const usedSymbols =
        ((job.metadata as { usedSymbols?: string[] } | null)?.usedSymbols ?? []).map((x) => String(x).toUpperCase());
      const excludedSymbols = new Set<string>(job.allowRepeatCoin ? [] : usedSymbols);
      let selected: ScannerCandidate | null = null;
      let symbol = "";
      let execution: Awaited<ReturnType<typeof executeAnalyzeAndTrade>> | null = null;
      let lastRejectReason = "";
      let roundMaxWaitSec = job.maxWaitSec;
      const maxSelectionAttempts = resolveAutoRoundMaxSelectionAttempts();
      const selectionBudgetMs = resolveAutoRoundSelectionBudgetSec() * 1000;
      const scanCycleCount = resolveAutoRoundScanCycles();
      const scanLimit = resolveCooperativeScanLimit();
      const selectionStartedAt = Date.now();
      let selectionSource = "scanner";
      const jobMeta = ((job.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
      let consecutiveFilterRejections = Number(jobMeta.consecutiveFilterRejections ?? 0);
      let aiNoResponseStreak = 0;
      const loadLatestRunMetadata = async () =>
        (((await getAutoRoundRunById(run.id).catch(() => null))?.metadata as Record<string, unknown> | null) ??
          {}) as Record<string, unknown>;

      for (let attempt = 0; attempt < maxSelectionAttempts; attempt += 1) {
        if (Date.now() - selectionStartedAt >= selectionBudgetMs) {
          lastRejectReason = `Tur secim suresi doldu (${resolveAutoRoundSelectionBudgetSec()}s)`;
          break;
        }
        const paperLearningJob = job.aiMode.toLowerCase() === "learning";
        const executionMode = paperLearningJob ? "paper" : env.EXECUTION_MODE;

        const cooperative = await runCooperativeRoundSelection({
          jobId,
          runId: run.id,
          roundNo,
          totalRounds: job.totalRounds,
          attempt,
          maxAttempts: maxSelectionAttempts,
          selectionStartedAt,
          selectionBudgetMs,
          excludedSymbols: Array.from(excludedSymbols),
          forcePaperProfile: executionMode === "paper",
          maxDurationSec: job.maxWaitSec,
          scanLimit,
          scanCycles: attempt === 0 ? scanCycleCount : 1,
          includeLivePumpScan: attempt === 0,
        });
        selected = cooperative.selected;
        if (cooperative.aborted) {
          lastRejectReason = cooperative.reason;
          const withinSelectionBudget = Date.now() - selectionStartedAt < selectionBudgetMs;
          const recoveryRetryReason =
            lastRejectReason.includes("Recovery restart current stage") ||
            lastRejectReason.includes("Runtime progress stale") ||
            lastRejectReason.includes("Runtime heartbeat stale") ||
            lastRejectReason.includes("No progress within stall threshold") ||
            lastRejectReason.includes("PROGRESS_STALL_GRACE");
          if (recoveryRetryReason && withinSelectionBudget && attempt + 1 < maxSelectionAttempts) {
            publishExecutionEvent({
              executionId: `round-job-${jobId}`,
              stage: "round-engine",
              status: "RUNNING",
              level: "WARN",
              message: `Selection interrupted (${lastRejectReason}); retrying within budget`,
              context: { jobId, runId: run.id, roundNo, attempt: attempt + 1, lastRejectReason },
            });
            clearRoundCancellation(jobId);
            registerRoundCancellation(jobId);
            continue;
          }
          break;
        }
        if (selected) {
          selectionSource =
            cooperative.source === "pump-cache" ||
            cooperative.source === "pump-live" ||
            cooperative.source === "opportunity"
              ? cooperative.source
              : "scanner";
        } else {
          lastRejectReason = cooperative.reason ?? "Uygun coin secilemedi";
          traceCandidateReject({
            symbol: cooperative.selected?.context.symbol ?? "NO_CANDIDATE",
            stage: "decision",
            reasonCode: cooperative.reason?.includes("PUMP_SCAN_FAILED") ? "PUMP_SCAN_FAILED" : "NO_CANDIDATE",
            reasonDetail: lastRejectReason,
          });
          if (lastRejectReason.includes("VALID_NO_CANDIDATE")) {
            break;
          }
          if (attempt + 1 < maxSelectionAttempts) continue;
          break;
        }
        symbol = selected.context.symbol.toUpperCase();
        const aiFinalDecision = String(selected.ai?.finalDecision ?? "");
        recordCandidateFunnelStage({
          symbol,
          stage: "scanner_ai",
          verdict: aiFinalDecision || "MISSING",
          reasonCode: "SCANNER_AI_EVALUATED",
          reasonDetail: "Scanner pipeline includeAi=true produced candidate.ai before selection gate",
          runId: run.id,
          roundId: String(roundNo),
        });
        if (isBlockingAiDecision(aiFinalDecision)) {
          recordCandidateFunnelStage({
            symbol,
            stage: "scanner_ai",
            verdict: aiFinalDecision || "MISSING",
            reasonCode: "AI_ADVISORY",
            reasonDetail: `AI decision=${aiFinalDecision || "EMPTY"} is advisory; canonical path continues`,
            runId: run.id,
            roundId: String(roundNo),
          });
        }
        if (!job.allowRepeatCoin && usedSymbols.includes(symbol)) {
          excludedSymbols.add(symbol);
          lastRejectReason = `${symbol} tekrar alimi engellendi`;
          traceCandidateReject({
            symbol,
            stage: "decision",
            reasonCode: "REPEAT_COIN_BLOCKED",
            reasonDetail: lastRejectReason,
          });
          continue;
        }
        const learningLane = executionMode === "paper";
        if (learningLane && !shouldSkipLearningFilterForSelection(selected, selectionSource)) {
          const learningFit = await evaluateAutoRoundLearningCandidate({
            selected,
            maxWaitSec: job.maxWaitSec,
            targetProfitPct: perRoundTargetProfitPct,
            consecutiveRejections: consecutiveFilterRejections + attempt,
          });
          if (!learningFit.ok) {
            // P1: learning memory is advisory-only for admission.
            await setJobState(jobId, "tariyor", `Tur ${roundNo}: ${symbol} learning advisory warning`, {
              roundNo,
              runId: run.id,
              selectionSource,
              reason: learningFit.reason,
              profile: learningFit.profile.label,
              primaryBlocker: learningFit.entryDecision?.primaryBlocker,
            });
          }
        } else if (learningLane && shouldSkipLearningFilterForSelection(selected, selectionSource)) {
          await setJobState(jobId, "tariyor", `Tur ${roundNo}: ${symbol} pump lane (learning filtresi atlandi)`, {
            roundNo,
            runId: run.id,
            selectionSource,
          });
        }

        const latestRunMeta = await loadLatestRunMetadata();
        const selectedReason = buildSelectionReason(selected);
        await updateAutoRoundRun({
          runId: run.id,
          state: "coin_secildi",
          symbol,
          selectedReason,
          metadata: {
            ...latestRunMeta,
            selectionAttempt: attempt + 1,
            excludedSymbols: Array.from(excludedSymbols),
            confidence: Number(selected.ai?.finalConfidence ?? selected.ai?.analysisScorecard?.confidenceScore ?? 0),
            aiFinalDecision: String(selected.ai?.finalDecision ?? ""),
            aiConsensusDecision: String(selected.ai?.finalConsensusDecision ?? ""),
            aiVetoStatus: String(selected.ai?.vetoStatus ?? ""),
            horizonProfile: horizonProfile.label,
            consecutiveFilterRejections: 0,
            coinSelectedAt: new Date().toISOString(),
          },
        });
        await updateAutoRoundJob({
          jobId,
          metadata: {
            ...jobMeta,
            consecutiveFilterRejections: 0,
          },
        }).catch(() => null);
        await setJobState(jobId, "coin_secildi", `Tur ${roundNo}: ${symbol} secildi`, {
          roundNo,
          runId: run.id,
          selectedReason: selected.ai?.explanation,
          selectionAttempt: attempt + 1,
        });

        roundMaxWaitSec = resolvePumpRoundMaxWaitSec({
          baseMaxWaitSec: job.maxWaitSec,
          context: selected.context,
          explanation: selected.ai?.explanation,
        });

      const pumpMeta = selected.context.metadata;
      const pumpSelected =
        Boolean(pumpMeta.pumpEarlyConfirmed) ||
        Boolean(pumpMeta.pumpContinuationMode) ||
        Boolean(pumpMeta.pumpIntradaySpike) ||
        Boolean(pumpMeta.pumpEarlyCatcher) ||
        String(selected.ai?.explanation ?? "").includes("PUMP_");
      const adjustedStopLossPct = pumpSelected
        ? executionMode === "paper"
          ? Math.max(perRoundStopLossPct, env.EXECUTION_PAPER_PUMP_MAX_LOSS_CUT_PERCENT)
          : Math.max(perRoundStopLossPct, env.EXECUTION_DEFAULT_STOP_LOSS_PERCENT)
        : perRoundStopLossPct;

        await patchRoundRuntimeProgress({
          jobId,
          runId: run.id,
          roundNo,
          totalRounds: job.totalRounds,
          maxSelectionAttempts,
          patch: {
            step: "SYMBOL_SELECTED",
            message: `Tur ${roundNo}: ${symbol} execution pre-check`,
            currentSymbol: symbol,
            currentPipeline: "execution",
            executionPhasePct: 5,
          },
        }).catch(() => null);
        await transitionRoundLifecycle({
          jobId,
          roundNo,
          runId: run.id,
          ownerId: roundOwnerId,
          status: "EXECUTION_RUNNING",
        }).catch(() => null);

        recordCandidateFunnelStage({
          symbol,
          stage: "scanner_ai",
          verdict: String(selected.ai?.finalDecision ?? "MISSING"),
          reasonCode: "SCANNER_AI_EXECUTABLE",
          reasonDetail: "Scanner AI passed selection gate; execution pipeline will evaluate TDI/hybrid",
          runId: run.id,
          roundId: String(roundNo),
        });

        execution = await executeAnalyzeAndTrade({
          requestedSymbol: symbol,
          requestedQuoteAmountTry: job.budgetPerTrade,
          takeProfitPercent: perRoundTargetProfitPct,
        stopLossPercent: adjustedStopLossPct,
          maxDurationSec: roundMaxWaitSec,
          bypassCoinCooldown: true,
          bypassIdempotency: true,
          preselectedCandidate: selected,
          learningLane,
          executionMode,
          campaignId: resolveCampaignIdFromJob(job),
          roundId: String(roundNo),
          runId: run.id,
          sessionId: jobId,
        });
        if (execution?.opened && execution.positionId) {
          break;
        }
        lastRejectReason = formatExecutionRejectReason(execution, "Alim acilisi basarisiz");
        const rejectReasonLower = lastRejectReason.toLowerCase();
        if (rejectReasonLower.includes("cooldown")) {
          aiNoResponseStreak = 0;
          excludedSymbols.add(symbol);
          continue;
        }
        if (rejectReasonLower.includes("ai_no_response")) {
          aiNoResponseStreak += 1;
          const aiFailureScope = classifyAiNoResponseScope({
            rejectReason: lastRejectReason,
            hasHealthyProvider: false,
            providerFailureCount: aiNoResponseStreak,
          });
          excludedSymbols.add(symbol);
          if (attempt + 1 < maxSelectionAttempts && (aiFailureScope === "CANDIDATE_LOCAL_FAILURE" || aiFailureScope === "ROUND_GLOBAL_FAILURE")) {
            continue;
          }
        } else {
          aiNoResponseStreak = 0;
        }
        break;
      }

      if (!selected || !execution?.opened || !execution.positionId) {
        const reason = !selected ? "NO_ELIGIBLE_CANDIDATE" : (lastRejectReason || "Alim acilisi basarisiz");
        const terminal = classifyRoundTerminal(reason);
        const terminalOutcome = classifyRoundTerminalOutcome({
          reason,
          symbol: selected?.context.symbol ?? run.symbol,
          candidateId: String(selected?.context.metadata.opportunityCandidateId ?? "") || null,
        });
        const noCandidateLike =
          !selected ||
          terminalOutcome.outcome === "no_eligible_candidate" ||
          reason.includes("Microstructure engine produced no confirmed candidate") ||
          terminal.decision === "WAIT";
        if (noCandidateLike) {
          const noCandidateObservationMs =
            process.env.NODE_ENV === "test"
              ? 2_000
              : Math.min(
                  120_000,
                  Math.max(30_000, Math.floor(Math.max(60, job.maxWaitSec) * 150)),
                );
          const observeStart = Date.now();
          while (Date.now() - observeStart < noCandidateObservationMs) {
            await patchRoundRuntimeProgress({
              jobId,
              runId: run.id,
              roundNo,
              totalRounds: job.totalRounds,
              maxSelectionAttempts,
              patch: {
                step: toRoundRuntimeStep(terminalOutcome),
                message: `Tur ${roundNo}: ${terminalOutcome.closeReason} observe (${Math.floor((Date.now() - observeStart) / 1000)}s)`,
                currentPipeline: "opportunity-engine",
              },
            }).catch(() => null);
            await sleep(2_000);
          }
          await completeNoTradeRound({
            jobId,
            runId: run.id,
            reason: formatTerminalReason(terminalOutcome),
            roundOwnerId,
            symbol: selected?.context.symbol ?? run.symbol,
            candidateId: String(selected?.context.metadata.opportunityCandidateId ?? "") || null,
            terminalOutcome,
          });
          continue;
        }
        await failRound({
          jobId,
          runId: run.id,
          reason: `${terminal.reasonCode}:${reason}`,
          symbol:
            selected && execution && !isTerminalNonExecutableReason(reason)
              ? symbol
              : undefined,
          confidence: Number(selected?.ai?.finalConfidence ?? selected?.ai?.analysisScorecard?.confidenceScore ?? 0),
        });
        continue;
      }

      const openedPosition = await getPositionById(execution.positionId).catch(() => null);
      const selectedCandidateId = String(selected.context.metadata.opportunityCandidateId ?? "");
      const resolvedBuyPrice = Number(execution.details?.entryPrice ?? openedPosition?.entryPrice ?? 0);
      const resolvedBuyQty = Number(execution.details?.filledQuantity ?? openedPosition?.quantity ?? 0);
      await patchRoundRuntimeProgress({
        jobId,
        runId: run.id,
        roundNo,
        totalRounds: job.totalRounds,
        maxSelectionAttempts,
        patch: {
          step: "EXECUTING",
          message: `Tur ${roundNo}: ${symbol} icin alis emri acildi`,
          currentSymbol: symbol,
          currentPipeline: "execution",
          executionPhasePct: 60,
        },
      }).catch(() => null);

      const effectiveMaxWaitSec = Number(execution.details?.maxDurationSec ?? roundMaxWaitSec ?? job.maxWaitSec);

      await updateAutoRoundRun({
        runId: run.id,
        state: "alim_yapildi",
        executionId: execution.executionId,
        buyPrice: resolvedBuyPrice,
        buyQty: resolvedBuyQty,
        metadata: {
          targetProfitPct: perRoundTargetProfitPct,
          totalTargetProfitPct: job.targetProfitPct,
          stopLossPct: perRoundStopLossPct,
          totalStopLossPct: job.stopLossPct,
          maxWaitSec: effectiveMaxWaitSec,
          takeProfitPrice: Number(execution.details?.takeProfitPrice ?? 0),
          stopLossPrice: Number(execution.details?.stopLossPrice ?? 0),
          positionId: execution.positionId,
          expectedSellAt: new Date(
            Date.now() + Math.max(30, effectiveMaxWaitSec) * 1000,
          ).toISOString(),
          planReason: selected.ai?.explanation ?? "scanner + ai consensus",
        },
      });
      await setJobState(jobId, "alim_yapildi", `Tur ${roundNo}: alim tamamlandi`, {
        roundNo,
        runId: run.id,
        symbol,
        executionId: execution.executionId,
        buyPrice: resolvedBuyPrice,
        buyQty: resolvedBuyQty,
      });

      await updateAutoRoundRun({
        runId: run.id,
        state: "satis_bekleniyor",
      });
      await setJobState(jobId, "satis_bekleniyor", `Tur ${roundNo}: satis bekleniyor`, {
        roundNo,
        runId: run.id,
        symbol,
      });

      await patchRoundRuntimeProgress({
        jobId,
        runId: run.id,
        roundNo,
        totalRounds: job.totalRounds,
        maxSelectionAttempts,
        patch: {
          step: "POSITION_OPEN",
          message: `Tur ${roundNo}: pozisyon acik, satis bekleniyor`,
          currentSymbol: symbol,
          currentPipeline: "position-monitor",
          executionPhasePct: 100,
          positionHoldSec: 0,
          positionMaxWaitSec: effectiveMaxWaitSec,
        },
      }).catch(() => null);

      const closeResult = await waitPositionClosed({
        jobId,
        runId: run.id,
        positionId: execution.positionId,
        executionId: execution.executionId,
        maxWaitSec: effectiveMaxWaitSec,
        roundNo,
        totalRounds: job.totalRounds,
        positionOpenedAtMs: Date.now(),
      });
      if (!closeResult.ok) {
        const failState: AutoRoundState = closeResult.reason === "sure_doldu" ? "sure_doldu" : "tur_basarisiz";
        await failRound({
          jobId,
          runId: run.id,
          reason: closeResult.reason,
          symbol,
          activeState: failState,
          roundOwnerId,
        });
        continue;
      }
      if (selectedCandidateId) {
        getCanonicalCandidateStore().transitionCandidate(selectedCandidateId, "PAPER_CLOSED", [
          `CLOSE_REASON_${String(closeResult.closeReason ?? "UNKNOWN")}`,
        ]);
      }

      const nextUsed = job.allowRepeatCoin ? usedSymbols : [...usedSymbols, symbol];
      let releasedRecord =
        getRoundOwnershipRecord(jobId, roundNo) ??
        getRoundRegistrySnapshot().entries.find((row) => row.jobId === jobId && row.roundNo === roundNo) ??
        null;
      if (releasedRecord) {
        await releaseRoundOwnership({
          jobId,
          roundNo,
          runId: run.id,
          ownerId: roundOwnerId,
          finalStatus: "ROUND_COMPLETED",
        }).catch(() => null);
        releasedRecord = getRoundOwnershipRecord(jobId, roundNo) ?? releasedRecord;
      }

      await transactionallyCompleteRound({
        jobId,
        runId: run.id,
        runPatch: {
          state: closeResult.state,
          executionId: execution.executionId,
          sellPrice: closeResult.sellPrice,
          sellQty: closeResult.sellQty,
          netPnl: closeResult.netPnl,
          feeTotal: closeResult.feeTotal,
          result: isSuccessfulNetExit(closeResult.roePercent) ? "profit" : "loss",
          metadata: {
            closeReason: closeResult.closeReason,
            roePercent: closeResult.roePercent,
            minimumNetRoePercent: 0.5,
            successfulNetExit: isSuccessfulNetExit(closeResult.roePercent),
            targetProfitPct: perRoundTargetProfitPct,
            totalTargetProfitPct: job.targetProfitPct,
            stopLossPct: perRoundStopLossPct,
            totalStopLossPct: job.stopLossPct,
            maxWaitSec: Number(execution.details?.maxDurationSec ?? job.maxWaitSec),
            takeProfitPrice: Number(execution.details?.takeProfitPrice ?? 0),
            stopLossPrice: Number(execution.details?.stopLossPrice ?? 0),
            expectedSellAt: new Date(
              Date.now() + Math.max(30, Number(execution.details?.maxDurationSec ?? job.maxWaitSec)) * 1000,
            ).toISOString(),
            planReason: selected.ai?.explanation ?? "scanner + ai consensus",
            marketRegime: String(selected.context.metadata.marketRegime ?? "RANGE_SIDEWAYS"),
            mtfAlignment: Number(
              selected.ai?.decisionPayload?.timeframeAnalysis?.alignmentScore ??
                selected.context.metadata.mtfAlignmentScore ??
                0,
            ),
            shortMomentum: Number(selected.context.metadata.shortMomentumPercent ?? 0),
            shortFlow: Number(selected.context.metadata.shortFlowImbalance ?? 0),
            entryLane: resolveEntryLane(String(selected.ai?.explanation ?? "")),
            holdSec: Math.max(
              1,
              Math.floor((Date.now() - new Date(run.startedAt).getTime()) / 1000),
            ),
          },
        },
        ownership: releasedRecord,
        jobMetadataPatch: {
          usedSymbols: nextUsed,
        },
      });

      await setJobState(jobId, "tur_tamamlandi", `Tur ${roundNo} tamamlandi`, {
        roundNo,
        runId: run.id,
        symbol,
        netPnl: closeResult.netPnl,
        roePercent: closeResult.roePercent,
        closeReason: closeResult.closeReason,
      });

      const forensicSession =
        getForensicSession() ??
        getOrCreateForensicSession({ sessionId: jobId, jobId, campaignId });
      traceCandidateTraded({ symbol, reasonDetail: closeResult.closeReason });
      await runRoundForensicExport({
        session: forensicSession,
        campaignId,
        roundId: String(roundNo),
        runId: run.id,
        jobId,
        roundNo,
        startedAt: run.startedAt,
        endedAt: new Date(),
        symbol,
        netPnl: closeResult.netPnl,
        feeTotal: closeResult.feeTotal,
        result: isSuccessfulNetExit(closeResult.roePercent) ? "profit" : "loss",
        userId: job.userId,
        terminalState: closeResult.state,
        currentStage: "COMPLETED",
      });
    }
  } catch (error) {
    clearRoundCancellation(jobId);
    logger.error({ error: (error as Error).message, jobId }, "Auto round engine failed");
    const failedJob = await getAutoRoundJobById(jobId).catch(() => null);
    const activeRunId = failedJob?.activeRunId;
    if (activeRunId) {
      const failedRun = await getAutoRoundRunById(activeRunId).catch(() => null);
      await failRound({
        jobId,
        runId: activeRunId,
        reason: (error as Error).message,
        symbol: failedRun?.symbol ?? undefined,
      }).catch(() => null);
    }
    await updateAutoRoundJob({
      jobId,
      status: "FAILED",
      activeState: "tur_basarisiz",
      lastError: (error as Error).message,
      finishedAt: new Date(),
    }).catch(() => null);
    await setJobState(jobId, "tur_basarisiz", `Tur motoru hata: ${(error as Error).message}`);
    throw error;
  }
}

function buildSchedulerSpawnResponse(jobId: string, spawn: AtomicSpawnResult) {
  const lease = getSchedulerLeaseSnapshot(jobId);
  return {
    scheduler: {
      jobId,
      action: spawn.action,
      ownerId: spawn.ownerId,
      generation: spawn.generation,
      state: lease?.state ?? "NOT_RUNNING",
      attached: spawn.action === "attached",
      spawned: spawn.action === "spawned",
    },
  };
}

export async function startAutoRoundJob(input: StartRoundInput) {
  const { user } = await getRuntimeExecutionContext(input.userId);
  const paperMode = input.aiMode.toLowerCase() === "learning" || env.EXECUTION_MODE === "paper";
  if (paperMode) {
    const preflight = await runPaperSessionPreflight({ userId: user.id });
    if (!preflight.canStart) {
      return {
        started: false,
        reason: preflight.blockReason ?? "Paper pre-flight blocked startup",
        job: null,
        code: preflight.blockCode ?? "PAPER_PREFLIGHT_BLOCKED",
        preflightAttemptId: preflight.attemptId,
        preflightVerdict: preflight.overallVerdict,
      };
    }
  }
  const safeMode = await getSafeModeState(user.id);
  if (safeMode.enabled && !paperMode) {
    return {
      started: false,
      reason: safeMode.reason ?? "Safe mode active",
      job: null,
    };
  }
  const pause = await resolveTradingPauseState(user.id, paperMode);
  if (pause.paused) {
    return {
      started: false,
      reason: pause.reason ?? "Trading paused",
      job: null,
      pauseKind: pause.kind,
    };
  }
  await ensureOpenPositionMonitors(user.id).catch((error) => {
    logger.warn(
      {
        userId: user.id,
        error: (error as Error).message,
      },
      "Failed to restore open position monitors at job start",
    );
  });
  ensureMarketDataDaemonStarted();
  ensureScannerWorkerStarted();
  const running = await findRunningAutoRoundJob(user.id);
  if (running) {
    const spawn = await ensureSingleSchedulerLoop(running.id);
    await atomicStartSchedulerWatchdog(running.id).catch(() => null);
    return {
      started: false,
      reason: "Halihazirda aktif bir tur motoru var",
      job: running,
      ...buildSchedulerSpawnResponse(running.id, spawn),
    };
  }
  const job = await createAutoRoundJob({
    userId: user.id,
    totalRounds: input.totalRounds,
    budgetPerTrade: input.budgetPerTrade,
    targetProfitPct: input.targetProfitPct,
    stopLossPct: input.stopLossPct,
    maxWaitSec: input.maxWaitSec,
    coinSelectionMode: input.coinSelectionMode,
    aiMode: input.aiMode,
    allowRepeatCoin: input.allowRepeatCoin,
    mode: input.mode,
  });
  const campaignId = buildCampaignId({ jobId: job.id });
  await updateAutoRoundJob({
    jobId: job.id,
    metadata: {
      ...(((job.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>),
      campaignId,
    },
  }).catch(() => null);
  if (paperMode) {
    beginForensicPaperSession({ sessionId: job.id, jobId: job.id, campaignId });
  }
  await setJobState(job.id, "bekliyor", "Tur motoru baslatildi", {
    totalRounds: job.totalRounds,
    budgetPerTrade: job.budgetPerTrade,
    targetProfitPct: job.targetProfitPct,
    stopLossPct: job.stopLossPct,
    maxWaitSec: job.maxWaitSec,
  });
  const spawn = await ensureSingleSchedulerLoop(job.id);
  await atomicStartSchedulerWatchdog(job.id).catch(() => null);
  return {
    started: true,
    jobId: job.id,
    ...buildSchedulerSpawnResponse(job.id, spawn),
  };
}

async function finalizeStoppedAutoRoundJob(jobId: string) {
  const job = await getAutoRoundJobById(jobId);
  if (!job) return;
  terminalizeAiForRuns(
    (job.rounds ?? []).map((run) => ({ id: run.id, roundNo: Number(run.roundNo ?? 0) })).filter((run) => run.roundNo > 0),
    "JOB_FINALIZED_STOPPED",
    "Tur motoru durduruldu",
  );
  for (const run of job.rounds) {
    if (inProgressRoundStates.includes(run.state as AutoRoundState) && !run.endedAt) {
      await updateAutoRoundRun({
        runId: run.id,
        state: "tur_basarisiz",
        failReason: "Tur motoru durduruldu",
        result: "failed",
        endedAt: new Date(),
      }).catch(() => null);
    }
  }
  await updateAutoRoundJob({
    jobId,
    status: "STOPPED",
    stopRequested: true,
    activeState: "bekliyor",
    finishedAt: new Date(),
    lastError: null,
  });
  stopSchedulerWatchdog(jobId);
  await setJobState(jobId, "bekliyor", "Tur motoru kullanici tarafindan durduruldu");
}

export async function stopAutoRoundJob(userId?: string) {
  const { user } = await getRuntimeExecutionContext(userId);
  const job = await findStoppableAutoRoundJob(user.id);
  if (!job) {
    return { stopped: false, reason: "Aktif tur motoru yok" };
  }
  if (job.stopRequested) {
    await finalizeStoppedAutoRoundJob(job.id);
    return {
      stopped: true,
      jobId: job.id,
      reason: "Takili tur motoru DB uzerinden durduruldu",
    };
  }
  await updateAutoRoundJob({
    jobId: job.id,
    stopRequested: true,
    activeState: "bekliyor",
  });
  cancelRoundSelection(job.id, "Tur motoru durduruldu");
  const latestJob = await getAutoRoundJobById(job.id);
  if (latestJob) {
    terminalizeAiForRuns(
      (latestJob.rounds ?? [])
        .map((run) => ({ id: run.id, roundNo: Number(run.roundNo ?? 0) }))
        .filter((run) => run.roundNo > 0),
      "JOB_STOP_REQUESTED",
      "Tur motoru durduruldu",
    );
  }
  stopSchedulerWatchdog(job.id);
  await setJobState(job.id, "bekliyor", "Tur motoru durdurma istegi aldi");
  return {
    stopped: true,
    jobId: job.id,
  };
}

function buildAutoRoundSimulationSummary(
  jobs: Awaited<ReturnType<typeof listAutoRoundJobs>>,
  fullJobStats: Map<string, Awaited<ReturnType<typeof getAutoRoundJobStats>>>,
) {
  const classifyRun = (run: NonNullable<(typeof jobs)[number]["rounds"][number]>) => {
    const netPnl = Number(run.netPnl ?? 0);
    const result = String(run.result ?? "").toLowerCase();
    const opened = Number(run.buyPrice ?? 0) > 0 && Number(run.buyQty ?? 0) > 0;
    const rejected = !opened && (run.state === "tur_basarisiz" || Boolean(run.failReason) || Boolean(run.endedAt));
    const metadata = (run.metadata as Record<string, unknown> | null) ?? {};
    const roePercent = Number(
      metadata.roePercent ??
        calculateNetProfitPercent({
          side: "LONG",
          entryPrice: Number(run.buyPrice ?? 0),
          exitPrice: Number(run.sellPrice ?? 0),
        }),
    );
    const success = opened && (result === "profit" || isSuccessfulNetExit(roePercent));
    const failed = opened && (result === "loss" || netPnl < 0 || run.state === "zarar_durdur_calisti" || (!success && Boolean(run.endedAt)));
    const breakeven = opened && !success && !failed && netPnl === 0 && run.endedAt;
    const rejectBucket = rejected
      ? String(metadata.rejectBucket ?? normalizeRejectBucket(String(run.failReason ?? "")))
      : null;
    const entryNotional = opened ? Number(run.buyPrice ?? 0) * Number(run.buyQty ?? 0) : 0;
    const pnlPercent = entryNotional > 0 ? (netPnl / entryNotional) * 100 : 0;
    return { netPnl: opened ? netPnl : 0, pnlPercent, entryNotional, opened, rejected, success, failed, breakeven, rejectBucket };
  };

  const allRuns = jobs.flatMap((job) => job.rounds ?? []).filter(Boolean);
  const recentRuns = [...allRuns]
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 100);
  const timeoutTrades: Array<{
    symbol: string;
    openedAt: string;
    closedAt: string | null;
    netPnl: number;
    roePercent: number;
    marketRegime: string;
    entryLane: string;
    mtfAlignment: number;
    holdSec: number;
  }> = [];
  const timeoutByRegime: Record<string, number> = {};
  const exitReasonBuckets: Record<string, number> = {};
  const aggregate = recentRuns.reduce(
    (acc, run) => {
      const classified = classifyRun(run);
      const metadata = (run.metadata as Record<string, unknown> | null) ?? {};
      const closeReason = String(metadata.closeReason ?? "");
      if (classified.opened && closeReason) {
        exitReasonBuckets[closeReason] = (exitReasonBuckets[closeReason] ?? 0) + 1;
      }
      if (classified.opened && closeReason === "TIMEOUT") {
        const regime = String(metadata.marketRegime ?? "UNKNOWN");
        timeoutByRegime[regime] = (timeoutByRegime[regime] ?? 0) + 1;
        timeoutTrades.push({
          symbol: String(run.symbol ?? ""),
          openedAt: new Date(run.startedAt).toISOString(),
          closedAt: run.endedAt ? new Date(run.endedAt).toISOString() : null,
          netPnl: Number(run.netPnl ?? 0),
          roePercent: Number(metadata.roePercent ?? classified.pnlPercent),
          marketRegime: regime,
          entryLane: String(metadata.entryLane ?? "scanner"),
          mtfAlignment: Number(metadata.mtfAlignment ?? 0),
          holdSec: Number(metadata.holdSec ?? 0),
        });
      }
      acc.openedRounds += classified.opened ? 1 : 0;
      acc.successCount += classified.success ? 1 : 0;
      acc.failedCount += classified.failed ? 1 : 0;
      acc.rejectedCount += classified.rejected ? 1 : 0;
      acc.breakevenCount += classified.breakeven ? 1 : 0;
      acc.netPnl += classified.netPnl;
      acc.entryNotional += classified.entryNotional;
      acc.feeTotal += classified.opened ? Number(run.feeTotal ?? 0) : 0;
      if (classified.rejectBucket) {
        acc.rejectionBuckets[classified.rejectBucket] = (acc.rejectionBuckets[classified.rejectBucket] ?? 0) + 1;
        if (acc.lastRejectSamples.length < 8) {
          acc.lastRejectSamples.push({
            symbol: run.symbol ?? String((run.metadata as Record<string, unknown> | null)?.symbol ?? ""),
            reason: String(run.failReason ?? ""),
            bucket: classified.rejectBucket,
            at: run.endedAt?.toISOString() ?? new Date(run.startedAt).toISOString(),
          });
        }
      }
      return acc;
    },
    {
      openedRounds: 0,
      successCount: 0,
      failedCount: 0,
      rejectedCount: 0,
      breakevenCount: 0,
      netPnl: 0,
      entryNotional: 0,
      feeTotal: 0,
      rejectionBuckets: {} as Record<string, number>,
      lastRejectSamples: [] as Array<{ symbol: string; reason: string; bucket: string; at: string }>,
    },
  );
  const decidedCount = aggregate.successCount + aggregate.failedCount;

  return {
    windowSize: 100,
    totalRounds: recentRuns.length,
    openedRounds: aggregate.openedRounds,
    successCount: aggregate.successCount,
    failedCount: aggregate.failedCount,
    rejectedCount: aggregate.rejectedCount,
    breakevenCount: aggregate.breakevenCount,
    netPnl: Number(aggregate.netPnl.toFixed(8)),
    netPnlPercent: Number((aggregate.entryNotional > 0 ? (aggregate.netPnl / aggregate.entryNotional) * 100 : 0).toFixed(4)),
    feeTotal: Number(aggregate.feeTotal.toFixed(8)),
    winRate: Number((aggregate.successCount / Math.max(1, decidedCount) * 100).toFixed(2)),
    rejectionBuckets: aggregate.rejectionBuckets,
    lastRejectSamples: aggregate.lastRejectSamples,
    exitReasonBuckets,
    timeoutAnalysis: {
      count: timeoutTrades.length,
      byRegime: timeoutByRegime,
      trades: timeoutTrades.slice(0, 20),
    },
    lastUpdatedAt: new Date().toISOString(),
    recentJobs: jobs.map((job) => {
      const full = fullJobStats.get(job.id);
      const jobRounds = (job.rounds ?? []).filter(Boolean);
      const windowAgg = jobRounds.reduce(
        (acc, run) => {
          const classified = classifyRun(run);
          acc.openedRounds += classified.opened ? 1 : 0;
          acc.successCount += classified.success ? 1 : 0;
          acc.failedCount += classified.failed ? 1 : 0;
          acc.rejectedCount += classified.rejected ? 1 : 0;
          return acc;
        },
        { openedRounds: 0, successCount: 0, failedCount: 0, rejectedCount: 0 },
      );
      const stats = full ?? {
        openedRounds: windowAgg.openedRounds,
        successCount: windowAgg.successCount,
        failedCount: windowAgg.failedCount,
        rejectedCount: windowAgg.rejectedCount,
        netPnl: 0,
        feeTotal: 0,
        entryNotional: 0,
        netPnlPercent: 0,
        winRate: 0,
      };
      return {
        jobId: job.id,
        status: job.status,
        totalRounds: job.totalRounds,
        currentRound: job.currentRound,
        completedRounds: job.completedRounds,
        failedRounds: job.failedRounds,
        openedRounds: stats.openedRounds,
        successCount: stats.successCount,
        failedCount: stats.failedCount,
        rejectedCount: stats.rejectedCount,
        windowOpenedRounds: windowAgg.openedRounds,
        windowSuccessCount: windowAgg.successCount,
        windowFailedCount: windowAgg.failedCount,
        windowRejectedCount: windowAgg.rejectedCount,
        statsScope: full ? ("full" as const) : ("window" as const),
        netPnl: Number(stats.netPnl.toFixed(8)),
        netPnlPercent: Number(stats.netPnlPercent.toFixed(4)),
        feeTotal: Number(stats.feeTotal.toFixed(8)),
        winRate: Number(stats.winRate.toFixed(2)),
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
      };
    }),
  };
}

function enrichJobForStatus(job: NonNullable<Awaited<ReturnType<typeof findRunningAutoRoundJob>>>) {
  const metadata = (job.metadata as Record<string, unknown> | null) ?? null;
  return {
    ...job,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    runtime: readRuntimeFromMetadata(metadata),
    rounds: (job.rounds ?? []).map((run) => {
      const runMeta = (run.metadata as Record<string, unknown> | null) ?? null;
      return {
        ...run,
        startedAt: run.startedAt.toISOString(),
        endedAt: run.endedAt?.toISOString() ?? null,
        runtime: readRuntimeFromMetadata(runMeta),
      };
    }),
  };
}

let lastStatusPollRecoveryAt = 0;
const STATUS_POLL_RECOVERY_DEBOUNCE_MS = 30_000;

async function maybeRecoverOnStatusPoll(jobId: string) {
  const now = Date.now();
  if (now - lastStatusPollRecoveryAt < STATUS_POLL_RECOVERY_DEBOUNCE_MS) return;
  if (hasLocalSchedulerLoop(jobId)) return;
  const localLease = getSchedulerLeaseSnapshot(jobId);
  if (localLease && isSchedulerLeaseLive(localLease, getProcessOwnerId())) return;
  lastStatusPollRecoveryAt = now;
  await executeSchedulerRecovery({
    jobId,
    trigger: "status_poll",
    operator: "automatic",
  }).catch(() => null);
  await atomicStartSchedulerWatchdog(jobId).catch(() => null);
}

export async function getAutoRoundStatus(userId?: string) {
  const { user } = await getRuntimeExecutionContext(userId);
  const running = await findRunningAutoRoundJob(user.id);
  if (running) {
    await maybeRecoverOnStatusPoll(running.id);
  }
  const recentJobsRaw = await listAutoRoundJobs(user.id, 8);
  for (const job of recentJobsRaw) {
    await reconcileStaleWaitingRunsForJob(job.id);
  }
  const recentJobs = await listAutoRoundJobs(user.id, 8);
  const fullJobStats = new Map<string, Awaited<ReturnType<typeof getAutoRoundJobStats>>>();
  await Promise.all(
    recentJobs.map(async (job) => {
      fullJobStats.set(job.id, await getAutoRoundJobStats(job.id));
    }),
  );
  const schedulerRegistry = getSchedulerRegistrySnapshot();
  const activeLease = running ? getSchedulerLeaseSnapshot(running.id) ?? (await loadSchedulerLease(running.id)) : null;
  const health = await getProductionHealthSnapshot(user.id).catch(() => null);
  return {
    active: running ? enrichJobForStatus(running) : null,
    jobs: recentJobs.map((job) => enrichJobForStatus(job as NonNullable<typeof running>)),
    summary: buildAutoRoundSimulationSummary(recentJobs, fullJobStats),
    scheduler: {
      registry: schedulerRegistry,
      activeLease,
      roundRegistry: getRoundRegistrySnapshot(),
      readOnly: true,
    },
    health,
  };
}

export function getAutoRoundRoundRegistry() {
  return getRoundRegistrySnapshot();
}

function serializeAutoRoundRunItem(run: Awaited<ReturnType<typeof listAutoRoundRunsPaginated>>["runs"][number]) {
  return {
    id: run.id,
    jobId: run.jobId,
    jobStatus: run.job.status,
    jobTotalRounds: run.job.totalRounds,
    jobCurrentRound: run.job.currentRound,
    roundNo: run.roundNo,
    state: run.state,
    symbol: run.symbol,
    executionId: run.executionId,
    buyPrice: run.buyPrice,
    buyQty: run.buyQty,
    sellPrice: run.sellPrice,
    sellQty: run.sellQty,
    netPnl: run.netPnl,
    feeTotal: run.feeTotal,
    result: run.result,
    failReason: run.failReason,
    selectedReason: run.selectedReason,
    metadata: (run.metadata as Record<string, unknown> | null) ?? null,
    startedAt: run.startedAt.toISOString(),
    endedAt: run.endedAt?.toISOString() ?? null,
  };
}

export async function getAutoRoundRunsHistory(
  userId: string | undefined,
  input: {
    page?: number;
    pageSize?: number;
    filter?: AutoRoundHistoryFilter;
    jobId?: string;
  },
) {
  const { user } = await getRuntimeExecutionContext(userId);
  const filter = input.filter ?? "all";
  const pageSize = input.pageSize ?? 5;
  const page = input.page ?? 1;
  const jobId = input.jobId?.trim() || undefined;
  const [paginated, counts] = await Promise.all([
    listAutoRoundRunsPaginated({
      userId: user.id,
      page,
      pageSize,
      filter,
      jobId,
    }),
    getAutoRoundRunFilterCounts(user.id, jobId),
  ]);
  return {
    filter,
    page: paginated.page,
    pageSize: paginated.pageSize,
    total: paginated.total,
    totalPages: paginated.totalPages,
    counts,
    items: paginated.runs.map(serializeAutoRoundRunItem),
  };
}

export async function ensureAutoRoundRecovery() {
  const results = await executeSchedulerRecoveryForRunningJobs({ trigger: "startup" });
  const jobs = await listRunningAutoRoundJobs(20);
  const runningJobs = await Promise.all(
    jobs.map(async (job) => ({
      id: job.id,
      needsExplicitStart: !getSchedulerLeaseSnapshot(job.id) && !results.some((row) => row.jobId === job.id && row.result === "success"),
      schedulerLease: getSchedulerLeaseSnapshot(job.id) ?? (await loadSchedulerLease(job.id)),
      lastRecovery: results.find((row) => row.jobId === job.id) ?? null,
    })),
  );
  return {
    readOnly: false,
    recoveredLoops: results.filter((row) => row.result === "success" && row.action === "RESUME").length,
    recoveries: results,
    runningJobs,
    registry: getSchedulerRegistrySnapshot(),
    health: await getProductionHealthSnapshot().catch(() => null),
  };
}

export async function getSchedulerProductionHealth(userId?: string) {
  return getProductionHealthSnapshot(userId);
}

export async function triggerSchedulerRecovery(input?: {
  jobId?: string;
  userId?: string;
  force?: boolean;
}) {
  if (input?.jobId) {
    return executeSchedulerRecovery({
      jobId: input.jobId,
      trigger: "manual",
      operator: "manual",
      force: input.force,
    });
  }
  const { user } = await getRuntimeExecutionContext(input?.userId);
  const running = await findRunningAutoRoundJob(user.id);
  if (!running) {
    return { ok: false as const, reason: "No running auto-round job" };
  }
  const result = await executeSchedulerRecovery({
    jobId: running.id,
    trigger: "manual",
    operator: "manual",
    force: input?.force,
  });
  return { ok: true as const, result };
}

export async function getSchedulerRecoveryTimeline(jobId: string, limit = 50) {
  return getRecoveryTimeline(jobId, limit);
}

export function getAutoRoundSchedulerRegistry() {
  return getSchedulerRegistrySnapshot();
}

export async function removeAutoRoundRun(userId: string, runId: string) {
  const run = await getAutoRoundRunById(runId);
  if (!run) {
    return { deleted: false, reason: "Tur kaydi bulunamadi." };
  }
  if (run.job.userId !== userId) {
    return { deleted: false, reason: "Bu tur kaydini silme yetkin yok." };
  }
  const runningLikeStates: AutoRoundState[] = ["tariyor", "coin_secildi", "alim_yapildi", "satis_bekleniyor"];
  if (run.job.status === "RUNNING" && runningLikeStates.includes(run.state as AutoRoundState)) {
    return { deleted: false, reason: "Aktif/ilerleyen tur kaydi silinemez. Once turu durdur." };
  }
  await deleteAutoRoundRun(runId);
  return { deleted: true, runId };
}

configureSchedulerRecovery({
  spawnScheduler: ensureSingleSchedulerLoop,
  reconcileStaleWaitingRuns: reconcileStaleWaitingRunsForJob,
  reconcileRegistryIntegrity: reconcileRegistryIntegrityForJob,
  recoverRoundRegistry: (input) =>
    recoverRoundRegistryFromRuns({
      jobId: input.jobId,
      ownerId: input.ownerId,
      inProgressStates: inProgressRoundStates,
      runs: input.runs.map((run) => ({
        id: run.id,
        roundNo: run.roundNo,
        state: run.state,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
      })),
      onDuplicateRun: async (runId) => {
        await transactionallyFailRound({
          jobId: input.jobId,
          runId,
          reason: "Duplicate in-progress run consolidated by round registry recovery",
          rejectBucket: "registry",
        }).catch(() => null);
      },
    }),
  cancelRoundSelection: (jobId) => cancelRoundSelection(jobId, "Recovery restart current stage"),
  failActiveRound: async (jobId, reason) => {
    const activeJob = await getAutoRoundJobById(jobId);
    const runId = activeJob?.activeRunId;
    if (!runId) return;
    await failRound({
      jobId,
      runId,
      reason,
      symbol: activeJob?.rounds?.find((row) => row.id === runId)?.symbol ?? undefined,
    });
  },
  stopJob: async (jobId, reason) => {
    stopSchedulerWatchdog(jobId);
    await updateAutoRoundJob({
      jobId,
      stopRequested: true,
      activeState: "tur_basarisiz",
      lastError: reason,
    });
    cancelRoundSelection(jobId, reason);
  },
});
