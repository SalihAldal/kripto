import { getMarketDataDaemon } from "@/src/server/market-data/spine/market-data-daemon";
import { countHotPathPublicMarketRestCalls } from "@/src/server/market-data/spine/rest-call-audit";
import type { BookTickerState, MarketTradeEvent } from "@/src/server/market-data/spine/events";
import type { OrderBookSnapshot } from "@/src/types/exchange";
import type { OpportunityCandidate } from "@/src/server/opportunity/types";
import { getOpportunityEngine } from "@/src/server/opportunity/opportunity-engine";
import { computeMicroFeatures } from "@/src/server/microstructure/features";
import {
  buildMicroBreakdown,
  executionQualityScore,
  liquidityQualityScore,
  scoreMicro,
} from "@/src/server/microstructure/score";
import { DEFAULT_MICRO_CONFIG, resolveMicroConfig, type MicrostructureConfig } from "@/src/server/microstructure/config";
import { compactAiContext, neutralAi, parseAiAdvisory } from "@/src/server/microstructure/ai-advisory";
import { buildFinalCandidate, rankWithHysteresis } from "@/src/server/microstructure/final-ranker";
import type {
  AiAdvisory,
  BookSample,
  FinalRankedCandidate,
  HardRejectCode,
  MicroFeatures,
  MicroEvaluateInput,
  MicroEvaluateResult,
} from "@/src/server/microstructure/types";
import type { MarketContext, ScannerCandidate, ScannerScore } from "@/src/types/scanner";
import { createRuntimeInstanceId } from "@/src/server/runtime/instance-id";
import { getCanonicalCandidateStore } from "@/src/server/candidate/candidate-store.service";
import { resolveCanonicalVenueConfig } from "@/src/server/exchange/venue-config.service";

const BOOK_HISTORY_LIMIT = 32;
const JOURNAL_LIMIT = 800;
const CANONICAL_VENUE = resolveCanonicalVenueConfig();

export class MicrostructureEngine {
  readonly config: MicrostructureConfig;
  readonly instanceId = createRuntimeInstanceId("microstructure-engine");
  readonly finalRankerInstanceId = createRuntimeInstanceId("final-ranker");
  private readonly sessions = new Map<string, FinalRankedCandidate>();
  private readonly bookHistory = new Map<string, BookSample[]>();
  private readonly journal: FinalRankedCandidate[] = [];
  private lastResult: MicroEvaluateResult | null = null;
  private readonly readyLatencies: number[] = [];
  private aiCalls = 0;

  constructor(config?: Partial<MicrostructureConfig>) {
    this.config = resolveMicroConfig(config);
  }

  evaluate(opportunity?: OpportunityCandidate[]): MicroEvaluateResult {
    const started = Date.now();
    const restBefore = countHotPathPublicMarketRestCalls();
    const hot = (opportunity ?? getOpportunityEngine().getRanked()).filter(
      (row) => row.state === "HOT" || row.state === "PROMOTED",
    );
    const scored: FinalRankedCandidate[] = [];
    const keep = new Set<string>();
    for (const row of hot.slice(0, this.config.deepLimit)) {
      keep.add(row.candidateId);
      const deep = getMarketDataDaemon().getDeepState(row.symbol);
      const book = deep?.bookTicker ?? null;
      this.rememberBook(row.symbol, book, started);
      const input: MicroEvaluateInput = {
        opportunity: row,
        trades: deep?.recentTrades ?? [],
        book,
        depth: getMarketDataDaemon().getOrderBook(row.symbol),
        bookHistory: this.bookHistory.get(row.symbol) ?? [],
        intendedNotional: this.config.intendedNotional,
        now: started,
        ai: this.sessions.get(row.candidateId)?.ai,
      };
      scored.push(this.scoreOne(input, this.sessions.get(row.candidateId)?.deepSubscribed ?? false));
    }
    for (const [id, session] of this.sessions) {
      if (!keep.has(id)) {
        this.expire(session, started);
      }
    }
    const ranked = rankWithHysteresis(scored.filter((row) => row.state !== "EXPIRED"), [...this.sessions.values()]);
    this.syncSubscriptions(ranked);
    this.lastResult = this.finish(started, restBefore, hot.length, ranked);
    getCanonicalCandidateStore().ingestMicroEvaluation({
      result: this.lastResult,
      microInstanceId: this.instanceId,
      ttlMs: this.config.ttlMs,
    });
    return this.lastResult;
  }

  evaluatePrepared(inputs: MicroEvaluateInput[]): MicroEvaluateResult {
    const started = Date.now();
    const restBefore = countHotPathPublicMarketRestCalls();
    const scored = inputs.map((input) => this.scoreOne({ ...input, now: input.now ?? started }, true));
    const ranked = rankWithHysteresis(scored, [...this.sessions.values()]);
    this.lastResult = this.finish(started, restBefore, inputs.length, ranked);
    getCanonicalCandidateStore().ingestMicroEvaluation({
      result: this.lastResult,
      microInstanceId: this.instanceId,
      ttlMs: this.config.ttlMs,
    });
    return this.lastResult;
  }

  applyAi(candidateId: string, raw: unknown) {
    const session = this.sessions.get(candidateId);
    if (!session) return null;
    this.aiCalls += 1;
    session.ai = parseAiAdvisory(raw, this.config.aiMaxModifier);
    return session.ai;
  }

  getRanked() {
    return this.lastResult?.ranked ?? [];
  }

  getExecutionReady() {
    return this.getRanked().filter((row) => row.state === "EXECUTION_READY" || row.state === "MICRO_CONFIRMED");
  }

  getSession(candidateId: string) {
    return this.sessions.get(candidateId) ?? null;
  }

  getJournal() {
    return this.journal.slice();
  }

  getTelemetry() {
    const sorted = [...this.readyLatencies].sort((a, b) => a - b);
    const p = (q: number) =>
      sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((q / 100) * sorted.length) - 1)] : 0;
    return {
      instanceId: this.instanceId,
      finalRankerInstanceId: this.finalRankerInstanceId,
      lastDurationMs: this.lastResult?.durationMs ?? 0,
      hot: this.lastResult?.hotCount ?? 0,
      warming: this.lastResult?.warmingCount ?? 0,
      microConfirmed: this.lastResult?.confirmedCount ?? 0,
      executionReady: this.lastResult?.executionReadyCount ?? 0,
      expired: this.lastResult?.expiredCount ?? 0,
      deepSubscriptions: this.lastResult?.deepSubscriptions ?? 0,
      readyP50Ms: p(50),
      readyP95Ms: p(95),
      aiCalls: this.aiCalls,
      journal: this.journal.length,
    };
  }

  toScannerCandidates(): ScannerCandidate[] {
    return this.getExecutionReady().map((row, index) => ({
      rank: index + 1,
      context: toMarketContext(row),
      score: toScannerScore(row),
    }));
  }

  compactContextForAi(row: FinalRankedCandidate) {
    return compactAiContext({
      symbol: row.symbol,
      lane: row.lane,
      opportunityScore: row.opportunityScore,
      microScore: row.microScore,
      return5m: 0,
      takerBuyRatio5s: row.features.takerBuyRatio5s,
      spreadBps: row.features.spreadBps,
      exhaustion: row.features.microExhaustion,
    });
  }

  resetForTests() {
    this.sessions.clear();
    this.bookHistory.clear();
    this.journal.length = 0;
    this.readyLatencies.length = 0;
    this.lastResult = null;
    this.aiCalls = 0;
  }

  private scoreOne(input: MicroEvaluateInput, deepSubscribed: boolean): FinalRankedCandidate {
    const now = input.now ?? Date.now();
    const features = computeMicroFeatures(input);
    const breakdown = buildMicroBreakdown(features);
    const microScore = scoreMicro(input.opportunity.primaryLane, breakdown, features);
    const liquidityScore = liquidityQualityScore(features);
    const executionQuality = executionQualityScore(features, liquidityScore);
    const hardReject = resolveHardReject(features, input.book, this.config, now);
    const previous = this.sessions.get(input.opportunity.candidateId);
    const ai = input.ai ?? previous?.ai ?? neutralAi("UNAVAILABLE");
    const built = buildFinalCandidate({
      opportunity: input.opportunity,
      features,
      microScore,
      breakdown,
      liquidityScore,
      executionQuality,
      ai,
      previous,
      hotAt: previous?.hotAt ?? now,
      now,
      config: this.config,
      hardReject,
      tdiDecision: input.tdiDecision,
      deepSubscribed,
    });
    if (built.microReadyAt && !previous?.microReadyAt) {
      this.readyLatencies.push(built.microReadyAt - built.hotAt);
      if (this.readyLatencies.length > 200) this.readyLatencies.splice(0, this.readyLatencies.length - 200);
    }
    this.sessions.set(built.candidateId, built);
    this.persist(built);
    return built;
  }

  private expire(session: FinalRankedCandidate, now: number) {
    session.state = "EXPIRED";
    this.persist(session);
    this.sessions.delete(session.candidateId);
    const daemon = getMarketDataDaemon();
    if (session.deepSubscribed) {
      daemon.unsubscribeDeep(session.symbol, "microstructure-engine", ["aggTrade", "bookTicker"]);
      daemon.unsubscribeDeep(session.symbol, "microstructure-engine", ["depth"]);
      session.deepSubscribed = false;
    }
    void now;
  }

  private syncSubscriptions(ranked: FinalRankedCandidate[]) {
    const daemon = getMarketDataDaemon();
    const now = Date.now();
    const keep = ranked
      .filter((row) => row.state !== "EXPIRED" && row.state !== "HARD_REJECT")
      .slice(0, this.config.deepLimit);
    const keepIds = new Set(keep.map((row) => row.symbol));
    for (const row of keep) {
      if (!row.deepSubscribed) {
        daemon.subscribeDeep(row.symbol, "microstructure-engine", ["aggTrade", "bookTicker"]);
        row.deepSubscribed = true;
        row.timing.deepSubscribeRequestedAt = row.timing.deepSubscribeRequestedAt ?? now;
        row.timing.subscribeActivationLatencyMs =
          row.timing.deepActiveAt && row.timing.deepSubscribeRequestedAt
            ? Math.max(0, row.timing.deepActiveAt - row.timing.deepSubscribeRequestedAt)
            : row.timing.subscribeActivationLatencyMs;
      }
    }
    for (const session of this.sessions.values()) {
      if (session.deepSubscribed && !keepIds.has(session.symbol)) {
        daemon.unsubscribeDeep(session.symbol, "microstructure-engine", ["aggTrade", "bookTicker"]);
        daemon.unsubscribeDeep(session.symbol, "microstructure-engine", ["depth"]);
        session.deepSubscribed = false;
      }
    }
  }

  private rememberBook(symbol: string, book: BookTickerState | null, now: number) {
    if (!book) return;
    const list = this.bookHistory.get(symbol) ?? [];
    list.push({
      t: now,
      bestBid: book.bestBid,
      bestAsk: book.bestAsk,
      bidQty: book.bestBidQty,
      askQty: book.bestAskQty,
      spreadBps: book.spreadBps,
    });
    if (list.length > BOOK_HISTORY_LIMIT) list.splice(0, list.length - BOOK_HISTORY_LIMIT);
    this.bookHistory.set(symbol, list);
  }

  private persist(row: FinalRankedCandidate) {
    this.journal.push({ ...row, features: row.features, microBreakdown: row.microBreakdown });
    if (this.journal.length > JOURNAL_LIMIT) this.journal.splice(0, this.journal.length - JOURNAL_LIMIT);
  }

  private finish(started: number, restBefore: number, hotCount: number, ranked: FinalRankedCandidate[]): MicroEvaluateResult {
    const durationMs = Date.now() - started;
    if (countHotPathPublicMarketRestCalls() !== restBefore) {
      throw new Error("MICROSTRUCTURE_HOT_PATH_NETWORK_FORBIDDEN");
    }
    return {
      evaluatedAt: started,
      durationMs,
      ranked,
      hotCount,
      warmingCount: ranked.filter((row) => row.state === "WARMING").length,
      confirmedCount: ranked.filter((row) => row.state === "MICRO_CONFIRMED").length,
      executionReadyCount: ranked.filter((row) => row.state === "EXECUTION_READY").length,
      expiredCount: [...this.journal].filter((row) => row.state === "EXPIRED").length,
      deepSubscriptions: ranked.filter((row) => row.deepSubscribed).length,
      restCalls: 0,
    };
  }
}

function resolveHardReject(
  features: MicroFeatures,
  book: BookTickerState | null,
  config: MicrostructureConfig,
  now: number,
): HardRejectCode | null {
  if (book && (book.bestAsk <= 0 || book.bestBid <= 0 || book.bestAsk < book.bestBid)) return "MICRO_INVALID_BOOK";
  if (features.spreadBps >= config.extremeSpreadBps) return "MICRO_EXTREME_SPREAD";
  if (features.bidLiquidity + features.askLiquidity <= 0 && features.tradeCount === 0) return "MICRO_ZERO_LIQUIDITY";
  if (features.lastAggTradeAt && now - features.lastAggTradeAt > config.staleMs && features.tradeCount > 0) {
    return "MICRO_DATA_STALE";
  }
  return null;
}

export function toMarketContext(row: FinalRankedCandidate): MarketContext {
  const opportunityFeatures = row.opportunityBreakdown;
  const spreadPercent = row.features.spreadBps / 100;
  const marketEventAt = row.features.lastAggTradeAt > 0 ? new Date(row.features.lastAggTradeAt).toISOString() : null;
  const observedAt = new Date(row.timing.microAnalyzedAt).toISOString();
  const volumeAccelerationRatio =
    row.features.takerBuyVolume15s + row.features.takerSellVolume15s > 0
      ? row.features.netFlowAcceleration / Math.max(1, row.features.takerBuyVolume15s + row.features.takerSellVolume15s)
      : null;
  const inferredSourceType =
    row.features.tradeCount > 0 || row.features.lastAggTradeAt > 0 || row.features.lastBookTickerAt > 0
      ? "LIVE_MARKET"
      : "UNKNOWN";
  return {
    symbol: row.symbol,
    lastPrice: row.currentPrice,
    change24h: Number.isFinite(row.change24h) ? row.change24h! : 0,
    volume24h: Number.isFinite(row.quoteVolume24h) ? Math.max(0, row.quoteVolume24h!) : 0,
    volumeSpikePercent: Math.max(0, row.features.tradeRateAcceleration * 10),
    spreadPercent,
    volatilityPercent: Math.max(0.1, row.features.microExhaustion * 4),
    momentumPercent: row.features.flowImbalance5s * 5,
    orderBookImbalance: row.features.depthImbalance10bps,
    buyPressure: row.features.takerBuyRatio5s,
    shortCandleSignal: row.features.flowImbalance5s >= 0 ? 2 : -2,
    fakeSpikeScore: row.features.microExhaustion * 4,
    pumpIntensity: Math.max(0, row.opportunityScore),
    pumpRisk: row.features.microExhaustion * 100,
    tradable: row.state === "EXECUTION_READY" || row.state === "MICRO_CONFIRMED",
    rejectReasons: row.hardReject ? [row.hardReject] : [],
    metadata: {
      quoteVolume60s: row.features.takerBuyVolume60s + row.features.takerSellVolume60s,
      volume24hAvailable: Number.isFinite(row.quoteVolume24h),
      opportunityCandidateId: row.candidateId,
      sourceType: inferredSourceType,
      marketDataTimestamp: marketEventAt,
      featureObservedAt: observedAt,
      featureSchemaVersion: "er02-feature-contract-v1",
      featureTransformVersion: "er02-v1",
      primaryLane: row.lane,
      opportunityScore: row.opportunityScore,
      opportunityBreakdown: row.opportunityBreakdown,
      microScore: row.microScore,
      microBreakdown: row.microBreakdown,
      liquidityScore: row.liquidityScore,
      exhaustion: Number(Math.max(0, Math.min(1, row.features.microExhaustion)).toFixed(6)),
      trendStrength: Number((opportunityFeatures.priceAcceleration * 0.02).toFixed(6)),
      priceAcceleration: Number((opportunityFeatures.priceAcceleration / 100).toFixed(6)),
      volumeAcceleration: volumeAccelerationRatio != null ? Number(volumeAccelerationRatio.toFixed(6)) : null,
      relativeStrength: Number((opportunityFeatures.relativeStrength / 100).toFixed(6)),
      breakoutHeld: row.features.breakoutHoldTime > 0,
      rangeScore: Number((opportunityFeatures.compressionExpansion / 100).toFixed(6)),
      flowRecovery: Number(Math.max(0, Math.min(1, row.features.buyAbsorption)).toFixed(6)),
      retracement: Number(Math.max(0, Math.min(1, row.features.breakoutRetestQuality < 0 ? 1 : 1 - row.features.breakoutRetestQuality)).toFixed(6)),
      distanceFromMean: Number(Math.max(0, Math.min(1, Math.abs(row.features.priceFlowDivergence))).toFixed(6)),
      shortMomentumPercent: Number((row.features.flowImbalance5s * 100).toFixed(4)),
      tradeVelocity: Number(row.features.tradeRate5s.toFixed(6)),
      expectedSlippageBps: Number(row.features.expectedSlippageBps.toFixed(6)),
      takerFeePercent: null,
      strategyProfitBuffer: null,
      expectedMovePercent: null,
      volatilityRatio: Number((Math.max(0, row.features.microExhaustion) / 4).toFixed(6)),
      regimeTransitionProbability: null,
      regimeChaosProbability: null,
      pumpScore: Number(Math.max(0, Math.min(1, row.opportunityScore / 100)).toFixed(6)),
      missingFeatures: ["expectedMovePercent", "entryFee", "exitFee", "strategyProfitBuffer", "regimeTransitionProbability", "regimeChaosProbability"],
      staleFeatures: marketEventAt ? [] : ["marketEventAt"],
      executionQuality: row.executionQuality,
      finalScore: row.smoothedScore,
      firstDetectedAt: new Date(row.firstDetectedAt).toISOString(),
      firstDetectionPrice: row.firstDetectionPrice,
      reasonCodes: row.reasonCodes,
      discoverySource: "MICROSTRUCTURE",
      discoveryVenue: CANONICAL_VENUE.discoveryVenue,
      marketDataVenue: CANONICAL_VENUE.marketDataVenue,
      microstructureVenue: CANONICAL_VENUE.microstructureVenue,
      paperExecutionVenue: CANONICAL_VENUE.paperExecutionVenue,
      metadataVenue: CANONICAL_VENUE.metadataVenue,
      executionVenueEligible: true,
      metadataFresh: true,
      dataQualityOk: !row.hardReject && row.state !== "WARMING",
      aiAdvisory: row.ai,
      tdiShadow: row.tdi,
    },
  };
}

function toScannerScore(row: FinalRankedCandidate): ScannerScore {
  return {
    symbol: row.symbol,
    score: row.smoothedScore,
    confidence: row.confidence,
    status: row.state === "EXECUTION_READY" || row.state === "MICRO_CONFIRMED" ? "QUALIFIED" : "REJECTED",
    reasons: row.reasonCodes,
    metrics: {
      momentum: row.microBreakdown.takerBuyRatio,
      microMomentum: row.microBreakdown.buyFlowAcceleration,
      volume: row.microBreakdown.tradeAcceleration,
      spread: row.microBreakdown.spreadQuality,
      volatility: row.liquidityScore,
      orderBook: row.microBreakdown.depthImbalance,
      pressure: row.microBreakdown.askDepletion,
      microFlow: row.microBreakdown.bidSupport,
      velocity: row.microBreakdown.tradeAcceleration,
      candle: row.microBreakdown.breakoutAcceptance,
      fakeSpikePenalty: Math.abs(row.microBreakdown.exhaustion),
      positiveEvidence: Math.max(0, row.microScore),
      negativeEvidence: Math.abs(row.microBreakdown.exhaustion) + Math.abs(row.microBreakdown.divergence),
      liquidityPenalty: row.liquidityScore < 40 ? 40 : 0,
      pumpBoost: 0,
      pumpRiskPenalty: Math.abs(row.microBreakdown.exhaustion),
    },
  };
}

const globalRef = globalThis as typeof globalThis & { __kineticMicrostructureEngine?: MicrostructureEngine };

export function getMicrostructureEngine() {
  if (!globalRef.__kineticMicrostructureEngine) {
    globalRef.__kineticMicrostructureEngine = new MicrostructureEngine();
  }
  return globalRef.__kineticMicrostructureEngine;
}

export function resetMicrostructureEngineForTests(instance?: MicrostructureEngine) {
  globalRef.__kineticMicrostructureEngine = instance ?? new MicrostructureEngine();
  globalRef.__kineticMicrostructureEngine.resetForTests();
  return globalRef.__kineticMicrostructureEngine;
}

export { DEFAULT_MICRO_CONFIG };
