import { getMarketDataDaemon } from "@/src/server/market-data/spine/market-data-daemon";
import { countHotPathPublicMarketRestCalls } from "@/src/server/market-data/spine/rest-call-audit";
import type { SymbolMarketSnapshot } from "@/src/server/market-data/spine/events";
import { computeBreadth, computeOpportunityFeatures } from "@/src/server/opportunity/features";
import {
  buildScoreBreakdown,
  eligibleLanes,
  pickPrimaryLane,
  reasonCodesFor,
  scoreLane,
} from "@/src/server/opportunity/score";
import {
  DEFAULT_OPPORTUNITY_CONFIG,
  resolveOpportunityConfig,
  type OpportunityEngineConfig,
} from "@/src/server/opportunity/config";
import { isExcludedOpportunitySymbol, resolveBenchmarkSymbol } from "@/src/server/opportunity/universe-policy";
import type {
  FilterReasonCode,
  OpportunityCandidate,
  OpportunityLane,
  OpportunityMilestone,
  OpportunityScanResult,
  OpportunityState,
} from "@/src/server/opportunity/types";
import type { MarketContext, ScannerCandidate, ScannerScore } from "@/src/types/scanner";
import { createRuntimeInstanceId } from "@/src/server/runtime/instance-id";
import { getCanonicalCandidateStore } from "@/src/server/candidate/candidate-store.service";

const VOLUME_HISTORY_LIMIT = 24;
const FILTER_SAMPLE_LIMIT = 24;
const HOT_PROMOTION_SCORE_BUFFER: Record<OpportunityLane, number> = {
  EARLY: 4,
  STEADY: 8,
  MOMENTUM: 3,
  CONTINUATION: 5,
};
const HOT_PROMOTION_MIN_AGE_MS = 15_000;
const HOT_PROMOTION_MIN_EVIDENCE_STREAK = 3;

export class OpportunityEngine {
  readonly config: OpportunityEngineConfig;
  readonly instanceId = createRuntimeInstanceId("opportunity-engine");
  private readonly sessions = new Map<string, OpportunityCandidate>();
  private readonly volumeHistory = new Map<string, number[]>();
  private readonly evalDurations: number[] = [];
  private readonly milestones: OpportunityMilestone[] = [];
  private readonly evidenceStreak = new Map<string, number>();
  private lastResult: OpportunityScanResult | null = null;
  private aiCalls = 0;
  private persistWrites = 0;

  constructor(config?: Partial<OpportunityEngineConfig>) {
    this.config = resolveOpportunityConfig(config);
  }

  scan(snapshots?: SymbolMarketSnapshot[]): OpportunityScanResult {
    const started = Date.now();
    const restBefore = countHotPathPublicMarketRestCalls();
    const rows = snapshots ?? getMarketDataDaemon().getMarketSnapshot();
    const btcSymbol = resolveBenchmarkSymbol(rows.map((row) => row.symbol));
    const btc = rows.find((row) => row.symbol === btcSymbol) ?? null;
    const breadth = computeBreadth(rows, btc);
    const filterSamples: OpportunityScanResult["filterSamples"] = [];
    let staleRejects = 0;
    let liquidityRejects = 0;
    let excludedRejects = 0;
    const scored: OpportunityCandidate[] = [];

    for (const row of rows) {
      if (row.stale || !row.lastPrice) {
        staleRejects += 1;
        pushSample(filterSamples, row.symbol, "STALE_DATA", row.rolling.return5m ?? 0);
        continue;
      }
      if (isExcludedOpportunitySymbol(row.symbol, { extraExcludedQuotes: this.config.excludedQuotes })) {
        excludedRejects += 1;
        pushSample(filterSamples, row.symbol, "EXCLUDED_SYMBOL", row.rolling.return5m ?? 0);
        continue;
      }
      if (row.quoteVolume24h < this.config.minQuoteVolume24h) {
        liquidityRejects += 1;
        pushSample(filterSamples, row.symbol, "LOW_LIQUIDITY", row.rolling.return5m ?? 0);
        continue;
      }

      const history = this.volumeHistory.get(row.symbol) ?? [];
      const window = snapshots ? [] : getMarketDataDaemon().getWindow(row.symbol, 900_000);
      const features = computeOpportunityFeatures({ row, window, breadth, volumeHistory: history });
      rememberVolume(this.volumeHistory, row.symbol, features.volume1m);

      if (features.return1m < 0 && features.return5m < 0) {
        pushSample(filterSamples, row.symbol, "NEGATIVE_DIRECTION", features.return5m);
        this.decayOrExpire(row.symbol, row.lastPrice, started);
        continue;
      }
      if (features.exhaustionScore >= 80 && features.return5m > 8) {
        pushSample(filterSamples, row.symbol, "EXHAUSTED", features.return5m);
      }
      if (
        rows.length >= 20 &&
        breadth.pctPositive1m > 72 &&
        Math.abs(features.relativeStrengthMarket) < 0.12 &&
        Math.abs(features.relativeStrengthBTC1m) < 0.12 &&
        features.priceAccelerationShort < 0.05
      ) {
        pushSample(filterSamples, row.symbol, "MARKET_WIDE_MOVE_ONLY", features.return5m);
        continue;
      }

      const breakdown = buildScoreBreakdown(features);
      const lanes = eligibleLanes(features);
      const laneScores = {
        EARLY: scoreLane("EARLY", breakdown, features),
        STEADY: scoreLane("STEADY", breakdown, features),
        MOMENTUM: scoreLane("MOMENTUM", breakdown, features),
        CONTINUATION: scoreLane("CONTINUATION", breakdown, features),
      };
      const primaryLane = pickPrimaryLane(lanes, laneScores, features);
      const rawScore = Math.max(0, laneScores[primaryLane]);
      if (rawScore < this.config.dropThreshold && !this.sessions.has(row.symbol)) continue;
      const candidate = this.upsertSession({
        row,
        features,
        breakdown,
        lanes,
        laneScores,
        primaryLane,
        rawScore,
        now: started,
      });
      if (candidate.state !== "EXPIRED") scored.push(candidate);
    }

    const ranked = this.rankAndTrim(scored);
    this.syncDeepSubscriptions(ranked);
    const durationMs = Date.now() - started;
    this.evalDurations.push(durationMs);
    if (this.evalDurations.length > 200) this.evalDurations.splice(0, this.evalDurations.length - 200);
    if (countHotPathPublicMarketRestCalls() !== restBefore) {
      throw new Error("OPPORTUNITY_SCAN_NETWORK_FORBIDDEN");
    }
    this.lastResult = {
      scannedAt: started,
      universeSize: rows.length,
      evaluated: rows.length - staleRejects - excludedRejects - liquidityRejects,
      staleRejects,
      liquidityRejects,
      excludedRejects,
      ranked,
      laneLeaders: {
        EARLY: ranked.filter((row) => row.primaryLane === "EARLY"),
        STEADY: ranked.filter((row) => row.primaryLane === "STEADY"),
        MOMENTUM: ranked.filter((row) => row.primaryLane === "MOMENTUM"),
        CONTINUATION: ranked.filter((row) => row.primaryLane === "CONTINUATION"),
      },
      durationMs,
      deepSubscriptions: ranked.filter((row) => row.deepSubscribed).length,
      filterSamples,
    };
    getCanonicalCandidateStore().ingestOpportunityScan({
      result: this.lastResult,
      opportunityInstanceId: this.instanceId,
      ttlMs: this.config.candidateTtlMs,
    });
    return this.lastResult;
  }

  getLastResult() {
    return this.lastResult;
  }

  getRanked() {
    return this.lastResult?.ranked ?? [];
  }

  getSession(symbol: string) {
    return this.sessions.get(symbol.toUpperCase()) ?? null;
  }

  getTelemetry() {
    const sorted = [...this.evalDurations].sort((a, b) => a - b);
    const p = (q: number) =>
      sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((q / 100) * sorted.length) - 1)] : 0;
    return {
      instanceId: this.instanceId,
      scanP50Ms: p(50),
      scanP95Ms: p(95),
      lastDurationMs: this.lastResult?.durationMs ?? 0,
      universeSize: this.lastResult?.universeSize ?? 0,
      ranked: this.lastResult?.ranked.length ?? 0,
      deepSubscriptions: this.lastResult?.deepSubscriptions ?? 0,
      staleRejects: this.lastResult?.staleRejects ?? 0,
      sessions: this.sessions.size,
      milestones: this.milestones.length,
      aiCalls: this.aiCalls,
      persistWrites: this.persistWrites,
      laneCounts: {
        EARLY: this.lastResult?.laneLeaders.EARLY.length ?? 0,
        STEADY: this.lastResult?.laneLeaders.STEADY.length ?? 0,
        MOMENTUM: this.lastResult?.laneLeaders.MOMENTUM.length ?? 0,
        CONTINUATION: this.lastResult?.laneLeaders.CONTINUATION.length ?? 0,
      },
    };
  }

  toScannerCandidates(): ScannerCandidate[] {
    return this.getRanked().map((row, index) => ({
      rank: index + 1,
      context: toMarketContext(row),
      score: toScannerScore(row),
    }));
  }

  resetForTests() {
    this.sessions.clear();
    this.volumeHistory.clear();
    this.evalDurations.length = 0;
    this.milestones.length = 0;
    this.evidenceStreak.clear();
    this.lastResult = null;
    this.aiCalls = 0;
    this.persistWrites = 0;
  }

  private upsertSession(input: {
    row: SymbolMarketSnapshot;
    features: ReturnType<typeof computeOpportunityFeatures>;
    breakdown: ReturnType<typeof buildScoreBreakdown>;
    lanes: OpportunityLane[];
    laneScores: Record<OpportunityLane, number>;
    primaryLane: OpportunityLane;
    rawScore: number;
    now: number;
  }): OpportunityCandidate {
    const symbol = input.row.symbol.toUpperCase();
    const existing = this.sessions.get(symbol);
    const evidence =
      Math.abs(input.features.priceAccelerationShort) > 0.04 ||
      input.features.volumeAcceleration > 0 ||
      input.features.rvol1m > 1.6;
    let score = input.rawScore;
    let scansWithoutEvidence = existing?.scansWithoutEvidence ?? 0;
    let evidenceStreak = this.evidenceStreak.get(symbol) ?? 0;
    if (!evidence) {
      scansWithoutEvidence += 1;
      evidenceStreak = 0;
      if (scansWithoutEvidence >= 2) score = Number((score * this.config.decayPerIdleScan).toFixed(2));
    } else {
      scansWithoutEvidence = 0;
      evidenceStreak += 1;
    }
    this.evidenceStreak.set(symbol, evidenceStreak);

    if (!existing) {
      const created: OpportunityCandidate = {
        candidateId: `${symbol}:${input.now}`,
        symbol,
        primaryLane: input.primaryLane,
        secondaryEvidence: input.lanes.filter((lane) => lane !== input.primaryLane),
        score,
        laneScores: input.laneScores,
        breakdown: input.breakdown,
        features: input.features,
        reasonCodes: reasonCodesFor(input.features, input.breakdown),
        state: score >= this.config.hotThreshold ? "HOT" : score >= this.config.watchThreshold ? "WATCHING" : "DISCOVERED",
        firstDetectedAt: input.now,
        firstDetectionPrice: input.row.lastPrice,
        lastScoreAt: input.now,
        lastEvidenceAt: evidence ? input.now : 0,
        currentPrice: input.row.lastPrice,
        scansWithoutEvidence,
        deepSubscribed: false,
      };
      this.sessions.set(symbol, created);
      this.recordMilestone(created, "CREATED");
      return created;
    }

    const previousLane = existing.primaryLane;
    const previousState = existing.state;
    existing.primaryLane = input.primaryLane;
    existing.secondaryEvidence = input.lanes.filter((lane) => lane !== input.primaryLane);
    existing.score = score;
    existing.laneScores = input.laneScores;
    existing.breakdown = input.breakdown;
    existing.features = input.features;
    existing.reasonCodes = reasonCodesFor(input.features, input.breakdown);
    existing.lastScoreAt = input.now;
    existing.currentPrice = input.row.lastPrice;
    existing.scansWithoutEvidence = scansWithoutEvidence;
    if (evidence) existing.lastEvidenceAt = input.now;
    existing.state = nextState(existing.state, score, this.config, input.now - existing.firstDetectedAt, {
      lane: input.primaryLane,
      features: input.features,
      evidenceStreak,
    });
    this.sessions.set(symbol, existing);
    if (previousLane !== existing.primaryLane) this.recordMilestone(existing, "LANE_CHANGE");
    if (previousState !== existing.state) {
      this.recordMilestone(existing, existing.state === "PROMOTED" ? "PROMOTED" : "STATE_CHANGE");
    }
    return existing;
  }

  private decayOrExpire(symbol: string, price: number, now: number) {
    const existing = this.sessions.get(symbol);
    if (!existing) return;
    existing.score = Number((existing.score * this.config.decayPerIdleScan).toFixed(2));
    existing.currentPrice = price;
    existing.scansWithoutEvidence += 1;
    existing.state = nextState(existing.state, existing.score, this.config, now - existing.firstDetectedAt, null);
    if (existing.state === "EXPIRED") {
      this.recordMilestone(existing, "EXPIRED");
      this.sessions.delete(symbol);
      this.evidenceStreak.delete(symbol);
    }
  }

  getMilestones() {
    return this.milestones.slice();
  }

  private recordMilestone(row: OpportunityCandidate, event: OpportunityMilestone["event"]) {
    this.milestones.push({
      at: row.lastScoreAt,
      candidateId: row.candidateId,
      symbol: row.symbol,
      event,
      state: row.state,
      primaryLane: row.primaryLane,
      score: row.score,
      firstDetectionPrice: row.firstDetectionPrice,
      currentPrice: row.currentPrice,
    });
    this.persistWrites += 1;
    if (this.milestones.length > 800) this.milestones.splice(0, this.milestones.length - 800);
  }

  private rankAndTrim(rows: OpportunityCandidate[]) {
    const live = rows
      .filter((row) => row.state !== "EXPIRED" && row.score >= this.config.dropThreshold)
      .sort((a, b) => b.score - a.score);
    const selected: OpportunityCandidate[] = [];
    const used = new Set<string>();
    const take = (lane: OpportunityLane, quota: number) => {
      for (const row of live) {
        if (selected.length >= this.config.topK) break;
        if (used.has(row.symbol)) continue;
        if (row.primaryLane !== lane && row.score < 90) continue;
        if (row.primaryLane === lane || row.score >= 90) {
          if (row.primaryLane === lane) {
            const already = selected.filter((item) => item.primaryLane === lane).length;
            if (already >= quota && row.score < 90) continue;
          }
          selected.push(row);
          used.add(row.symbol);
        }
      }
    };
    take("EARLY", this.config.laneQuotas.EARLY);
    take("STEADY", this.config.laneQuotas.STEADY);
    take("MOMENTUM", this.config.laneQuotas.MOMENTUM);
    take("CONTINUATION", this.config.laneQuotas.CONTINUATION);
    for (const row of live) {
      if (selected.length >= this.config.topK) break;
      if (used.has(row.symbol)) continue;
      selected.push(row);
      used.add(row.symbol);
    }
    return selected;
  }

  private syncDeepSubscriptions(ranked: OpportunityCandidate[]) {
    const daemon = getMarketDataDaemon();
    const hot = ranked.filter((row) => row.state === "HOT" || row.state === "PROMOTED");
    const limited = hot.slice(0, this.config.deepSubscriptionLimit);
    const keep = new Set(limited.map((row) => row.symbol));
    for (const row of limited) {
      if (!row.deepSubscribed) {
        daemon.subscribeDeep(row.symbol, "opportunity-engine", ["aggTrade", "bookTicker"]);
        row.deepSubscribed = true;
      }
    }
    for (const session of this.sessions.values()) {
      if (session.deepSubscribed && !keep.has(session.symbol)) {
        daemon.unsubscribeDeep(session.symbol, "opportunity-engine", ["aggTrade", "bookTicker"]);
        session.deepSubscribed = false;
      }
    }
  }
}

function nextState(
  current: OpportunityState,
  score: number,
  config: OpportunityEngineConfig,
  ageMs: number,
  context: {
    lane: OpportunityLane;
    features: ReturnType<typeof computeOpportunityFeatures>;
    evidenceStreak: number;
  } | null,
): OpportunityState {
  if (ageMs > config.candidateTtlMs && score < config.watchThreshold) return "EXPIRED";
  const promotionEligible =
    Boolean(context) &&
    ageMs >= HOT_PROMOTION_MIN_AGE_MS &&
    (context?.evidenceStreak ?? 0) >= HOT_PROMOTION_MIN_EVIDENCE_STREAK &&
    context!.features.momentumConsistency >= 0.35 &&
    context!.features.relativeStrengthMarket > -0.08 &&
    context!.features.maxRetracement <= 1.4 &&
    score >= config.hotThreshold - HOT_PROMOTION_SCORE_BUFFER[context!.lane];
  if (score >= config.hotThreshold) {
    if (current === "HOT" || current === "PROMOTED") return "PROMOTED";
    return "HOT";
  }
  if (promotionEligible && score >= config.watchThreshold) {
    return current === "HOT" || current === "PROMOTED" ? "PROMOTED" : "HOT";
  }
  if (score >= config.watchThreshold) {
    if (current === "HOT" || current === "PROMOTED") {
      return score < config.dropThreshold ? "COOLING" : current;
    }
    return "WATCHING";
  }
  if (current === "HOT" || current === "PROMOTED" || current === "WATCHING") {
    return score < config.dropThreshold ? "COOLING" : current;
  }
  if (current === "COOLING" && score < config.dropThreshold) return "EXPIRED";
  return current === "DISCOVERED" ? "DISCOVERED" : "COOLING";
}

function rememberVolume(map: Map<string, number[]>, symbol: string, value: number) {
  const list = map.get(symbol) ?? [];
  list.push(Math.max(0, value));
  if (list.length > VOLUME_HISTORY_LIMIT) list.splice(0, list.length - VOLUME_HISTORY_LIMIT);
  map.set(symbol, list);
}

function pushSample(
  samples: OpportunityScanResult["filterSamples"],
  symbol: string,
  reason: FilterReasonCode,
  move5m: number,
) {
  if (samples.length >= FILTER_SAMPLE_LIMIT) return;
  samples.push({ symbol, reason, move5m });
}

function toMarketContext(row: OpportunityCandidate): MarketContext {
  return {
    symbol: row.symbol,
    lastPrice: row.currentPrice,
    change24h: row.features.change24h,
    volume24h: row.features.quoteVolume24h,
    volumeSpikePercent: Math.max(0, (row.features.rvol1m - 1) * 100),
    spreadPercent: 0.05,
    volatilityPercent: Math.max(0.1, Math.abs(row.features.return5m)),
    momentumPercent: row.features.return5m,
    orderBookImbalance: Math.max(-0.4, Math.min(0.4, row.features.relativeStrengthMarket / 5)),
    buyPressure: row.features.return1m >= 0 ? 0.62 : 0.38,
    shortCandleSignal: row.features.return15s >= 0 ? 2 : -2,
    fakeSpikeScore: row.features.exhaustionScore / 25,
    pumpIntensity: Math.max(0, row.features.return15m * 6),
    pumpRisk: row.features.exhaustionScore,
    tradable: row.state === "HOT" || row.state === "PROMOTED" || row.state === "WATCHING",
    rejectReasons: [],
    metadata: {
      opportunityCandidateId: row.candidateId,
      primaryLane: row.primaryLane,
      opportunityScore: row.score,
      opportunityBreakdown: row.breakdown,
      firstDetectedAt: new Date(row.firstDetectedAt).toISOString(),
      firstDetectionPrice: row.firstDetectionPrice,
      reasonCodes: row.reasonCodes,
      shortMomentumPercent: row.features.return30s,
      tradeVelocity: Math.max(0.05, Math.abs(row.features.velocity15s) + 0.1),
      shortFlowImbalance: Math.max(0.05, row.features.relativeStrengthMarket / 4 + 0.08),
      discoverySource: "OPPORTUNITY",
      dataQualityOk: true,
      marketRegime: row.features.return5m >= 0.4 ? "MOMENTUM_EXPANSION" : "TRENDING_UP",
    },
  };
}

function toScannerScore(row: OpportunityCandidate): ScannerScore {
  return {
    symbol: row.symbol,
    score: row.score,
    confidence: Math.min(96, 48 + row.score * 0.45),
    status: row.score >= 58 ? "QUALIFIED" : "REJECTED",
    reasons: row.reasonCodes,
    metrics: {
      momentum: row.breakdown.priceVelocity,
      microMomentum: row.breakdown.priceAcceleration,
      volume: row.breakdown.relativeVolume,
      spread: 80,
      volatility: row.breakdown.compressionExpansion,
      orderBook: row.breakdown.relativeStrength,
      pressure: row.breakdown.volumeAcceleration,
      microFlow: row.breakdown.consistency,
      velocity: row.breakdown.priceVelocity,
      candle: row.breakdown.breakout,
      fakeSpikePenalty: Math.abs(row.breakdown.exhaustion),
      positiveEvidence: Math.max(0, row.score),
      negativeEvidence: Math.abs(row.breakdown.exhaustion) + Math.abs(row.breakdown.chaseControl),
      liquidityPenalty: row.features.quoteVolume24h < DEFAULT_OPPORTUNITY_CONFIG.minQuoteVolume24h ? 40 : 0,
      pumpBoost: 0,
      pumpRiskPenalty: Math.abs(row.breakdown.exhaustion),
    },
  };
}

const globalRef = globalThis as typeof globalThis & { __kineticOpportunityEngine?: OpportunityEngine };

export function getOpportunityEngine() {
  if (!globalRef.__kineticOpportunityEngine) {
    globalRef.__kineticOpportunityEngine = new OpportunityEngine();
  }
  return globalRef.__kineticOpportunityEngine;
}

export function resetOpportunityEngineForTests(instance?: OpportunityEngine) {
  globalRef.__kineticOpportunityEngine = instance ?? new OpportunityEngine();
  globalRef.__kineticOpportunityEngine.resetForTests();
  return globalRef.__kineticOpportunityEngine;
}
