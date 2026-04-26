import type { AIDecision } from "@/src/types/ai";
import { env } from "@/lib/config";
import { getRuntimeExecutionContext } from "@/src/server/repositories/execution.repository";
import { getAdaptiveExecutionPolicy } from "@/src/server/metrics/performance.service";
import { getScannerWorkerSnapshot } from "@/src/server/scanner/scanner-worker.service";
import { runScannerPipeline } from "@/src/server/scanner/scanner.service";
import { buildMarketContext } from "@/src/server/scanner/market-context-builder";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";
import { formatAIRequest } from "@/src/server/scanner/ai-request-formatter";
import { runAIConsensusFromInput } from "@/src/server/ai/analysis-orchestrator";
import { getRuntimeStrategyParams } from "@/src/server/config/strategy-runtime.service";
import type { ScannerCandidate } from "@/src/types/scanner";

export type FastEntryResult = {
  selected: ScannerCandidate | null;
  reason?: string;
  diagnostics?: {
    candidateCount: number;
    tradableCount: number;
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

function rankForFastEntry(candidate: ScannerCandidate) {
  const aiConfidence = candidate.ai?.finalConfidence ?? 0;
  const scannerScore = candidate.score.score;
  const shortMomentum = Number(candidate.context.metadata.shortMomentumPercent ?? 0);
  const flow = Math.abs(Number(candidate.context.metadata.shortFlowImbalance ?? 0));
  const velocity = Number(candidate.context.metadata.tradeVelocity ?? 0);
  const candleSignal = Math.abs(Number(candidate.context.shortCandleSignal ?? 0));
  const window = evaluateProfitWindow(candidate, false);
  const profitBoost = window.ok ? window.expectedProfitPercent * 5.5 : 0;
  const durationBonus = window.ok ? Math.max(-10, Math.min(10, (window.allowedDurationSec - window.suggestedDurationSec) / 45)) : -8;
  return aiConfidence * 0.42 + scannerScore * 0.32 + shortMomentum * 28 + flow * 18 + velocity * 6 + candleSignal * 2 + profitBoost + durationBonus;
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
  const minProfit = Math.max(relaxed ? 1.2 : 0.5, env.EXECUTION_TARGET_MIN_PROFIT_PERCENT - (relaxed ? 1.25 : 0));
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

function selectTradableCandidates(
  candidates: ScannerCandidate[],
  policy: { minConfidence: number; requireUnanimous: boolean },
  options?: { relaxed?: boolean },
) {
  const relaxed = options?.relaxed ?? false;
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
    .map((candidate) => {
      if (!candidate.ai) return null;
      if (env.EXECUTION_MODE === "live" && env.BINANCE_PLATFORM === "tr" && candidate.ai.finalDecision !== "BUY") {
        return null;
      }
      if (!candidate.ai.rejected && (candidate.ai.finalDecision === "BUY" || candidate.ai.finalDecision === "SELL")) {
        return candidate;
      }
      return null;
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
      return candidate.context.spreadPercent <= adaptiveSpreadLimit;
    })
    .filter(({ candidate }) => Number(candidate.context.metadata.tradeVelocity ?? 0) >= minVelocity)
    .filter(({ candidate }) => Math.abs(Number(candidate.context.metadata.shortFlowImbalance ?? 0)) >= minFlow)
    .filter(({ candidate }) => String(candidate.context.metadata.marketRegime ?? "RANGE_SIDEWAYS") !== "LOW_VOLUME_DEAD_MARKET")
    .filter(({ candidate }) => {
      const regime = String(candidate.context.metadata.marketRegime ?? "RANGE_SIDEWAYS");
      if (regime !== "HIGH_VOLATILITY_CHAOS" && regime !== "NEWS_DRIVEN_UNSTABLE") return true;
      return candidate.context.spreadPercent <= 0.12 && candidate.context.fakeSpikeScore <= 1.8;
    })
    .filter(({ window }) => window.ok)
    .filter(({ candidate }) =>
      policy.requireUnanimous ? isUnanimousDecision(candidate, candidate.ai?.finalDecision ?? "HOLD") : true,
    )
    .filter(({ candidate }) => passesUltraPrecisionSpotGate(candidate))
    .sort((a, b) => rankForFastEntry(b.candidate) - rankForFastEntry(a.candidate))
    .map((row) => row.candidate);
}

function buildNoTradeDiagnostics(
  candidates: ScannerCandidate[],
  minConfidence: number,
): NonNullable<FastEntryResult["diagnostics"]> {
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
      const aSent = aAi.roleScores.find((x) => x.role === "AI-2_SENTIMENT")?.score ?? 0;
      const bSent = bAi.roleScores.find((x) => x.role === "AI-2_SENTIMENT")?.score ?? 0;
      const aAlign = Number(aAi.decisionPayload?.timeframeAnalysis?.alignmentScore ?? 0);
      const bAlign = Number(bAi.decisionPayload?.timeframeAnalysis?.alignmentScore ?? 0);
      const aScore = aSent * 0.4 + aAlign * 0.3 + a.score.score * 0.3;
      const bScore = bSent * 0.4 + bAlign * 0.3 + b.score.score * 0.3;
      return bScore - aScore;
    });
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

async function buildEmergencyCandidates(): Promise<ScannerCandidate[]> {
  const runtimeStrategy = await getRuntimeStrategyParams();
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
          ...runtimeStrategy,
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

export async function getBestFastEntry(): Promise<FastEntryResult> {
  const snap = getScannerWorkerSnapshot().detailed;
  const originalCycleLimit = env.SCANNER_CYCLE_SYMBOL_LIMIT;
  const manualCycleLimit = Math.max(10, Math.min(env.EXECUTION_MANUAL_SCAN_SYMBOL_LIMIT, env.SCANNER_MAX_SYMBOLS));
  const shouldAdjustManualScan = originalCycleLimit !== manualCycleLimit;
  if (shouldAdjustManualScan) {
    (env as unknown as { SCANNER_CYCLE_SYMBOL_LIMIT: number }).SCANNER_CYCLE_SYMBOL_LIMIT = manualCycleLimit;
  }
  try {
  let scan = snap;
  if (!scan || scan.candidates.length === 0) {
    scan = await runScannerPipeline(undefined, {
      includeAi: true,
      persist: false,
      persistRejected: false,
    });
  }
  if (scan.totalSymbols === 0 || scan.candidates.length === 0) {
    scan = await runScannerPipeline(undefined, {
      includeAi: true,
      persist: false,
      persistRejected: false,
    });
  }
  const candidatePool = scan.candidates.length > 0 ? scan.candidates : await buildEmergencyCandidates();

  const runtime = await getRuntimeExecutionContext().catch(() => null);
  const runtimeStrategy = await getRuntimeStrategyParams();
  const policy = await getAdaptiveExecutionPolicy(runtime?.user.id);
  const effectivePolicy = {
    ...policy,
    minConfidence: Math.max(
      40,
      Math.min(99, Number(runtimeStrategy.aiScoreThreshold ?? policy.minConfidence ?? 60)),
    ),
  };

  const primary = selectTradableCandidates(candidatePool, effectivePolicy);
  let tradable = primary;
  let fallbackUsed = false;
  if (!env.AI_ULTRA_DISABLE_RELAXED_FALLBACK && tradable.length === 0 && candidatePool.length > 0) {
    const relaxed = selectTradableCandidates(
      candidatePool,
      {
          minConfidence: Math.max(46, effectivePolicy.minConfidence - 10),
        requireUnanimous: false,
      },
      { relaxed: true },
    );
    if (relaxed.length > 0) {
      tradable = relaxed;
    }
  }
  if (!env.AI_ULTRA_DISABLE_RELAXED_FALLBACK && tradable.length === 0) {
    const focusedPoolRaw = await buildEmergencyCandidates();
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
        { relaxed: true },
      );
      if (focusedTradable.length > 0) {
        tradable = focusedTradable;
        fallbackUsed = true;
      }
    }
  }
  if (!env.AI_ULTRA_DISABLE_RELAXED_FALLBACK && tradable.length === 0) {
    const recovery = selectRecoveryCandidatesFromRoleSignals(candidatePool, effectivePolicy.minConfidence);
    if (recovery.length > 0) {
      tradable = recovery;
      fallbackUsed = true;
    }
  }
  if (tradable.length === 0 && candidatePool.length <= 2) {
    if (env.AI_ULTRA_DISABLE_RELAXED_FALLBACK) {
      // ultra precision modda low-count fallback ile esik gevsetilmez
    } else {
    const lowCountRelaxed = selectTradableCandidates(
      candidatePool,
      { ...effectivePolicy, minConfidence: Math.max(50, effectivePolicy.minConfidence - 8) },
      { relaxed: true },
    );
    if (lowCountRelaxed.length > 0) {
      tradable = lowCountRelaxed;
    }
    }
  }

  if (tradable.length === 0 && candidatePool.length < 3) {
    const retryScan = await runScannerPipeline(undefined, {
      includeAi: true,
      persist: false,
      persistRejected: false,
    });
    const retryPool = retryScan.candidates.length > 0 ? retryScan.candidates : await buildEmergencyCandidates();
    const retryTradable = selectTradableCandidates(retryPool, effectivePolicy);
    if (retryTradable.length > 0) {
      const selected = retryTradable.find((row) => isTryQuotedSymbol(row.context.symbol)) ?? retryTradable[0];
      return {
        selected,
        diagnostics: {
          candidateCount: retryPool.length,
          tradableCount: retryTradable.length,
          minConfidence: effectivePolicy.minConfidence,
          requireUnanimous: effectivePolicy.requireUnanimous,
        },
        scannedAt: retryScan.scannedAt,
        evaluated: retryScan.aiEvaluatedSymbols,
      };
    }
    tradable = retryTradable;
  }

  const diagnostics = {
    candidateCount: candidatePool.length,
    tradableCount: tradable.length,
    minConfidence: effectivePolicy.minConfidence,
    requireUnanimous: effectivePolicy.requireUnanimous,
  };

  if (tradable.length === 0) {
    const noTradeDiagnostics = buildNoTradeDiagnostics(candidatePool, diagnostics.minConfidence);
    return {
      selected: null,
      reason:
        `No suitable short-horizon candidate (tradable=${diagnostics.tradableCount}/${diagnostics.candidateCount}, minConf=${diagnostics.minConfidence}, unanimous=${diagnostics.requireUnanimous ? "on" : "off"})` +
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
  }

  const selected = tradable.find((row) => isTryQuotedSymbol(row.context.symbol)) ?? tradable[0];
  return {
    selected,
    diagnostics,
    reason: fallbackUsed ? "Focused major-pair fallback selected candidate." : undefined,
    scannedAt: scan.scannedAt,
    evaluated: scan.aiEvaluatedSymbols,
  };
  } finally {
    if (shouldAdjustManualScan) {
      (env as unknown as { SCANNER_CYCLE_SYMBOL_LIMIT: number }).SCANNER_CYCLE_SYMBOL_LIMIT = originalCycleLimit;
    }
  }
}
