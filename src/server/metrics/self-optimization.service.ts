import { env } from "@/lib/config";
import { listTradeHistory } from "@/src/server/repositories/trade.repository";
import type { AIConsensusResult } from "@/src/types/ai";
import type { ScannerCandidate } from "@/src/types/scanner";

type ConfidenceStat = {
  key: string;
  samples: number;
  wins: number;
  losses: number;
  netPnl: number;
  confidence: number;
};

type OptimizationProfile = {
  generatedAt: string;
  closedTrades: number;
  coins: ConfidenceStat[];
  hours: ConfidenceStat[];
  strategies: ConfidenceStat[];
  setups: ConfidenceStat[];
  regimeStrategies: ConfidenceStat[];
  entryTypes: ConfidenceStat[];
  exitTypes: ConfidenceStat[];
};

type CandidateOptimizationScore = {
  score: number;
  ok: boolean;
  reason: string;
  coinConfidence: number;
  timeConfidence: number;
  strategyConfidence: number;
  setupConfidence: number;
  regimeStrategyConfidence: number;
  entryTypeConfidence: number;
  exitTypeConfidence: number;
  confidenceAdjustments: {
    aiConfidenceDelta: number;
    qualityThresholdDelta: number;
    adaptiveWeight: number;
  };
  learnedPreferences: string[];
  highPerformingConditions: string[];
  lowPerformingConditions: string[];
  components: {
    coin: { key: string; confidence: number; samples: number };
    hour: { key: string; confidence: number; samples: number };
    strategy: { key: string; confidence: number; samples: number };
    setup: { key: string; confidence: number; samples: number };
    regimeStrategy: { key: string; confidence: number; samples: number };
    entryType: { key: string; confidence: number; samples: number };
    exitType: { key: string; confidence: number; samples: number };
  };
};

const PROFILE_TTL_MS = 40_000;
const profileCache = new Map<string, { at: number; profile: OptimizationProfile }>();

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function keyForUser(userId?: string) {
  return userId ?? "global";
}

function confidenceFromStat(input: { wins: number; samples: number; netPnl: number }) {
  if (input.samples <= 0) return 50;
  // Small sample'ta agresif ogrenmeyi engellemek icin bayesian shrinkage.
  const priorSamples = 7;
  const blendedWinRate = ((input.wins + priorSamples * 0.5) / (input.samples + priorSamples)) * 100;
  const sampleWeight = clamp(input.samples / 16, 0.2, 1);
  const pnlPerTrade = input.netPnl / Math.max(input.samples, 1);
  const pnlBias = clamp(pnlPerTrade, -3, 3) * 3.2;
  return Number(clamp(50 + (blendedWinRate - 50) * 0.72 * sampleWeight + pnlBias, 20, 84).toFixed(2));
}

function toStatArray(map: Map<string, { wins: number; losses: number; samples: number; netPnl: number }>) {
  return Array.from(map.entries())
    .map(([key, row]) => ({
      key,
      samples: row.samples,
      wins: row.wins,
      losses: row.losses,
      netPnl: Number(row.netPnl.toFixed(4)),
      confidence: confidenceFromStat({
        wins: row.wins,
        samples: row.samples,
        netPnl: row.netPnl,
      }),
    }))
    .sort((a, b) => b.confidence - a.confidence);
}

function getHourKey(date: Date) {
  return String(date.getHours()).padStart(2, "0");
}

function resolveSetupKey(candidate: ScannerCandidate, ai: AIConsensusResult) {
  const mode = String(candidate.context.metadata.marketRegime ?? "RANGE_SIDEWAYS");
  const tf = ai.decisionPayload?.timeframeAnalysis;
  const mtf = tf && tf.trendAligned && tf.entrySuitable && !tf.conflict ? "MTF_OK" : "MTF_MISS";
  const liquidity = ai.decisionPayload?.entryRejectReason ? "LQ_RISK" : "LQ_OK";
  const side = ai.finalDecision;
  return `${mode}:${side}:${mtf}:${liquidity}`;
}

function buildProfileStats(rows: Awaited<ReturnType<typeof listTradeHistory>>) {
  const perCoin = new Map<string, { wins: number; losses: number; samples: number; netPnl: number }>();
  const perHour = new Map<string, { wins: number; losses: number; samples: number; netPnl: number }>();
  const perStrategy = new Map<string, { wins: number; losses: number; samples: number; netPnl: number }>();
  const perSetup = new Map<string, { wins: number; losses: number; samples: number; netPnl: number }>();
  const perRegimeStrategy = new Map<string, { wins: number; losses: number; samples: number; netPnl: number }>();
  const perEntryType = new Map<string, { wins: number; losses: number; samples: number; netPnl: number }>();
  const perExitType = new Map<string, { wins: number; losses: number; samples: number; netPnl: number }>();
  let closedTrades = 0;

  for (const row of rows) {
    if (!row.position || row.position.status !== "CLOSED") continue;
    const pnl = Number(row.position.realizedPnl ?? 0);
    if (!Number.isFinite(pnl)) continue;
    closedTrades += 1;
    const win = pnl > 0;
    const metadata = (row.position.metadata as Record<string, unknown> | null) ?? {};
    const strategyKey = String(metadata.marketRegimeStrategy ?? "UNKNOWN_STRATEGY");
    const regimeKey = String(metadata.marketRegime ?? "RANGE_SIDEWAYS");
    const regimeStrategyKey = `${regimeKey}:${strategyKey}`;
    const ruleTags = Array.isArray(metadata.ruleTags)
      ? metadata.ruleTags.map((x) => String(x)).filter(Boolean)
      : [];
    const setupKey = ruleTags.length > 0 ? ruleTags.sort().join("+") : "NO_RULE_TAG";
    const smartEntry = (metadata.smartEntry as Record<string, unknown> | undefined) ?? {};
    const entryTypeKey = String(smartEntry.recommendedEntryType ?? "UNKNOWN_ENTRY");
    const exitTypeKey = String(metadata.closeReason ?? "UNKNOWN_EXIT");
    const closeAt = row.position.closedAt ?? row.position.openedAt;
    const hourKey = getHourKey(closeAt);

    const apply = (map: Map<string, { wins: number; losses: number; samples: number; netPnl: number }>, key: string) => {
      const curr = map.get(key) ?? { wins: 0, losses: 0, samples: 0, netPnl: 0 };
      curr.samples += 1;
      if (win) curr.wins += 1;
      else curr.losses += 1;
      curr.netPnl += pnl;
      map.set(key, curr);
    };

    apply(perCoin, row.tradingPair.symbol);
    apply(perHour, hourKey);
    apply(perStrategy, strategyKey);
    apply(perSetup, setupKey);
    apply(perRegimeStrategy, regimeStrategyKey);
    apply(perEntryType, entryTypeKey);
    apply(perExitType, exitTypeKey);
  }

  return {
    closedTrades,
    coins: toStatArray(perCoin),
    hours: toStatArray(perHour),
    strategies: toStatArray(perStrategy),
    setups: toStatArray(perSetup),
    regimeStrategies: toStatArray(perRegimeStrategy),
    entryTypes: toStatArray(perEntryType),
    exitTypes: toStatArray(perExitType),
  };
}

function topConditionSummaries(rows: ConfidenceStat[], prefix: string, minSamples: number, top: number, asc = false) {
  const filtered = rows.filter((x) => x.samples >= minSamples);
  const sorted = [...filtered].sort((a, b) => (asc ? a.confidence - b.confidence : b.confidence - a.confidence)).slice(0, top);
  return sorted.map((x) => `${prefix}:${x.key} (conf=${x.confidence}, n=${x.samples})`);
}

export async function getSelfOptimizationProfile(userId?: string): Promise<OptimizationProfile> {
  const key = keyForUser(userId);
  const cached = profileCache.get(key);
  if (cached && Date.now() - cached.at < PROFILE_TTL_MS) return cached.profile;

  const rows = await listTradeHistory({ userId, limit: 700 });
  const stats = buildProfileStats(rows);
  const profile: OptimizationProfile = {
    generatedAt: new Date().toISOString(),
    closedTrades: stats.closedTrades,
    coins: stats.coins,
    hours: stats.hours,
    strategies: stats.strategies,
    setups: stats.setups,
    regimeStrategies: stats.regimeStrategies,
    entryTypes: stats.entryTypes,
    exitTypes: stats.exitTypes,
  };
  profileCache.set(key, { at: Date.now(), profile });
  return profile;
}

function resolveConfidence(
  rows: ConfidenceStat[],
  key: string,
  fallback: number,
) {
  const found = rows.find((x) => x.key === key);
  if (!found) return { confidence: fallback, samples: 0 };
  return { confidence: found.confidence, samples: found.samples };
}

export async function evaluateAdaptiveCandidate(input: {
  userId?: string;
  candidate: ScannerCandidate;
  ai: AIConsensusResult;
}): Promise<CandidateOptimizationScore> {
  const profile = await getSelfOptimizationProfile(input.userId);
  if (profile.closedTrades < env.EXECUTION_ADAPTIVE_MIN_TRADES) {
    return {
      score: 60,
      ok: true,
      reason: "Adaptive sample yetersiz, default policy uygulandi",
      coinConfidence: 60,
      timeConfidence: 60,
      strategyConfidence: 60,
      setupConfidence: 60,
      regimeStrategyConfidence: 60,
      entryTypeConfidence: 60,
      exitTypeConfidence: 60,
      confidenceAdjustments: {
        aiConfidenceDelta: 0,
        qualityThresholdDelta: 0,
        adaptiveWeight: 0,
      },
      learnedPreferences: [],
      highPerformingConditions: [],
      lowPerformingConditions: [],
      components: {
        coin: { key: input.candidate.context.symbol, confidence: 60, samples: 0 },
        hour: { key: getHourKey(new Date()), confidence: 60, samples: 0 },
        strategy: { key: String(input.ai.decisionPayload?.selectedStrategy ?? "UNKNOWN_STRATEGY"), confidence: 60, samples: 0 },
        setup: { key: resolveSetupKey(input.candidate, input.ai), confidence: 60, samples: 0 },
        regimeStrategy: {
          key: `${String(input.candidate.context.metadata.marketRegime ?? "RANGE_SIDEWAYS")}:${String(input.ai.decisionPayload?.selectedStrategy ?? "UNKNOWN_STRATEGY")}`,
          confidence: 60,
          samples: 0,
        },
        entryType: {
          key: String((input.ai.decisionPayload as Record<string, unknown> | undefined)?.["consensusEngine"] ? "CONSENSUS_ENTRY" : "UNKNOWN_ENTRY"),
          confidence: 60,
          samples: 0,
        },
        exitType: { key: "UNKNOWN_EXIT", confidence: 60, samples: 0 },
      },
    };
  }

  const symbolKey = input.candidate.context.symbol;
  const hourKey = getHourKey(new Date());
  const strategyKey = String(input.ai.decisionPayload?.selectedStrategy ?? "UNKNOWN_STRATEGY");
  const setupKey = resolveSetupKey(input.candidate, input.ai);
  const regimeKey = String(input.candidate.context.metadata.marketRegime ?? "RANGE_SIDEWAYS");
  const regimeStrategyKey = `${regimeKey}:${strategyKey}`;
  const entryTypeKey = String(
    ((input.ai.decisionPayload as Record<string, unknown> | undefined)?.selfCriticReview as Record<string, unknown> | undefined)
      ?.finalApprovalOrDowngrade ?? "UNKNOWN_ENTRY",
  );
  const exitTypeKey = "UNKNOWN_EXIT";

  const coin = resolveConfidence(profile.coins, symbolKey, 55);
  const hour = resolveConfidence(profile.hours, hourKey, 55);
  const strategy = resolveConfidence(profile.strategies, strategyKey, 55);
  const setup = resolveConfidence(profile.setups, setupKey, 55);
  const regimeStrategy = resolveConfidence(profile.regimeStrategies, regimeStrategyKey, 55);
  const entryType = resolveConfidence(profile.entryTypes, entryTypeKey, 55);
  const exitType = resolveConfidence(profile.exitTypes, exitTypeKey, 55);

  const rawScore = Number(
    clamp(
      coin.confidence * 0.24 +
      hour.confidence * 0.14 +
      strategy.confidence * 0.2 +
      setup.confidence * 0.12 +
      regimeStrategy.confidence * 0.14 +
      entryType.confidence * 0.1 +
      exitType.confidence * 0.06,
      0,
      100,
    ).toFixed(2),
  );
  // Kaotik davranisi onlemek icin hafiza etkisini kisitla.
  const adaptiveWeight = clamp((profile.closedTrades - env.EXECUTION_ADAPTIVE_MIN_TRADES) / 220, 0.15, 0.75);
  const score = Number((55 + (rawScore - 55) * adaptiveWeight).toFixed(2));
  const aiConfidenceDelta = Number(clamp((score - 55) * 0.18, -4.5, 4.5).toFixed(2));
  const qualityThresholdDelta = Number(clamp((55 - score) * 0.1, -3, 3).toFixed(2));

  const badSignals: string[] = [];
  if (coin.samples >= 6 && coin.confidence < 35) badSignals.push(`coin=${symbolKey}`);
  if (strategy.samples >= 6 && strategy.confidence < 35) badSignals.push(`strategy=${strategyKey}`);
  if (setup.samples >= 6 && setup.confidence < 33) badSignals.push(`setup=${setupKey}`);
  if (regimeStrategy.samples >= 8 && regimeStrategy.confidence < 34) badSignals.push(`regimeStrategy=${regimeStrategyKey}`);
  if (entryType.samples >= 8 && entryType.confidence < 34) badSignals.push(`entryType=${entryTypeKey}`);
  const ok = badSignals.length === 0 && score >= env.EXECUTION_MIN_ADAPTIVE_SCORE;
  const reason = ok
    ? `Kontrollu hafiza skoru uygun (${score})`
    : badSignals.length > 0
      ? `Dusuk performansli pattern azaltildi: ${badSignals.join(", ")}`
      : `Adaptive score esik alti (${score} < ${env.EXECUTION_MIN_ADAPTIVE_SCORE})`;
  const learnedPreferences = unique([
    ...topConditionSummaries(profile.coins, "coin", 8, 3),
    ...topConditionSummaries(profile.strategies, "strategy", 8, 3),
    ...topConditionSummaries(profile.regimeStrategies, "regime_strategy", 8, 3),
    ...topConditionSummaries(profile.entryTypes, "entry", 8, 2),
    ...topConditionSummaries(profile.exitTypes, "exit", 8, 2),
  ]).slice(0, 10);
  const highPerformingConditions = unique([
    ...topConditionSummaries(profile.setups, "setup", 8, 4),
    ...topConditionSummaries(profile.hours, "hour", 8, 3),
  ]).slice(0, 8);
  const lowPerformingConditions = unique([
    ...topConditionSummaries(profile.setups, "setup", 8, 4, true),
    ...topConditionSummaries(profile.regimeStrategies, "regime_strategy", 8, 3, true),
  ]).slice(0, 8);

  return {
    score,
    ok,
    reason,
    coinConfidence: coin.confidence,
    timeConfidence: hour.confidence,
    strategyConfidence: strategy.confidence,
    setupConfidence: setup.confidence,
    regimeStrategyConfidence: regimeStrategy.confidence,
    entryTypeConfidence: entryType.confidence,
    exitTypeConfidence: exitType.confidence,
    confidenceAdjustments: {
      aiConfidenceDelta,
      qualityThresholdDelta,
      adaptiveWeight: Number(adaptiveWeight.toFixed(2)),
    },
    learnedPreferences,
    highPerformingConditions,
    lowPerformingConditions,
    components: {
      coin: { key: symbolKey, confidence: coin.confidence, samples: coin.samples },
      hour: { key: hourKey, confidence: hour.confidence, samples: hour.samples },
      strategy: { key: strategyKey, confidence: strategy.confidence, samples: strategy.samples },
      setup: { key: setupKey, confidence: setup.confidence, samples: setup.samples },
      regimeStrategy: { key: regimeStrategyKey, confidence: regimeStrategy.confidence, samples: regimeStrategy.samples },
      entryType: { key: entryTypeKey, confidence: entryType.confidence, samples: entryType.samples },
      exitType: { key: exitTypeKey, confidence: exitType.confidence, samples: exitType.samples },
    },
  };
}

