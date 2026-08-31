import type { SymbolMarketSnapshot } from "@/src/server/market-data/spine/events";
import type { OpportunityCandidate, MarketBreadth } from "@/src/server/opportunity/types";
import type { FinalRankedCandidate } from "@/src/server/microstructure/types";
import { computeBreadth } from "@/src/server/opportunity/features";
import { resolveShadowConfig, type ShadowOutcomeConfig } from "@/src/server/shadow-outcome/config";
import { computeHorizons, computeReachTimes, moveKey, type PricePoint } from "@/src/server/shadow-outcome/metrics";
import { detectMoverEvents } from "@/src/server/shadow-outcome/mover-truth";
import type { DetectionSnapshot, JourneyEvent, PriceSource, TrackedCandidate } from "@/src/server/shadow-outcome/types";
import { createRuntimeInstanceId } from "@/src/server/runtime/instance-id";

export const SHADOW_OUTCOME_ORDERS_DISABLED = true as const;

const TRACK_STATES = new Set(["DISCOVERED", "WATCHING", "HOT", "PROMOTED", "MICRO_CONFIRMED", "EXECUTION_READY", "WARMING"]);
const PRICE_RETENTION_MS = 150 * 60_000;
const PRICE_CAP = 9_000;

function freezeSnapshot(snapshot: DetectionSnapshot): Readonly<DetectionSnapshot> {
  return Object.freeze({ ...snapshot, opportunityBreakdown: { ...snapshot.opportunityBreakdown } });
}

export class ShadowOutcomeEngine {
  readonly config: ShadowOutcomeConfig;
  readonly instanceId = createRuntimeInstanceId("shadow-outcome-engine");
  readonly ordersDisabled = SHADOW_OUTCOME_ORDERS_DISABLED;
  private readonly tracked = new Map<string, TrackedCandidate>();
  private readonly prices = new Map<string, PricePoint[]>();
  private lastTickAt = 0;
  private lastPersistAt = 0;
  private persistWrites = 0;

  constructor(config?: Partial<ShadowOutcomeConfig>) {
    this.config = resolveShadowConfig(config);
  }

  observeOpportunity(
    candidates: OpportunityCandidate[],
    input: {
      now?: number;
      breadth?: MarketBreadth | null;
      source?: PriceSource;
    } = {},
  ) {
    const now = input.now ?? Date.now();
    for (const row of candidates) {
      if (!TRACK_STATES.has(row.state)) continue;
      if (!this.tracked.has(row.candidateId) && row.score < this.config.minTrackScore) continue;
      const existing = this.tracked.get(row.candidateId);
      if (!existing) {
        this.tracked.set(
          row.candidateId,
          this.createTracked(
            freezeSnapshot({
              candidateId: row.candidateId,
              symbol: row.symbol.toUpperCase(),
              firstDetectedAt: row.firstDetectedAt,
              firstDetectionPrice: row.firstDetectionPrice,
              primaryLane: row.primaryLane,
              secondaryEvidence: row.secondaryEvidence,
              opportunityScore: row.score,
              opportunityBreakdown: { ...row.breakdown },
              microScore: null,
              microBreakdown: null,
              liquidityScore: null,
              executionQuality: null,
              finalScore: row.score,
              initialRank: null,
              btcReturn1m: input.breadth?.btcReturn1m ?? null,
              btcReturn5m: input.breadth?.btcReturn5m ?? null,
              marketBreadthPctPositive1m: input.breadth?.pctPositive1m ?? null,
              aiStatus: null,
              aiModifier: 0,
              tdiDecision: null,
              reasonCodes: row.reasonCodes,
              warnings: [],
              rvol1m: row.features.rvol1m,
              priceAccelerationShort: row.features.priceAccelerationShort,
              takerBuyRatio5s: null,
              source: input.source ?? "live",
            }),
            row.state,
            row.primaryLane,
            row.score,
            now,
          ),
        );
        this.pushPrice(row.symbol, {
          t: row.firstDetectedAt,
          price: row.firstDetectionPrice,
          high: row.firstDetectionPrice,
          low: row.firstDetectionPrice,
        });
      } else {
        existing.snapshot = freezeSnapshot({
          ...existing.snapshot,
          opportunityScore: row.score,
          finalScore: row.score,
          reasonCodes: [...new Set(row.reasonCodes ?? existing.snapshot.reasonCodes)],
          rvol1m: row.features.rvol1m,
          priceAccelerationShort: row.features.priceAccelerationShort,
        });
        this.appendJourney(existing, {
          at: now,
          stage: row.state,
          lane: row.primaryLane,
          score: row.score,
          state: row.state,
        });
        existing.latestStage = row.state;
        existing.latestScore = row.score;
      }
      const session = this.tracked.get(row.candidateId);
      if (!session) continue;
      if ((row.state === "HOT" || row.state === "PROMOTED") && session.hotAt == null) session.hotAt = now;
      if (row.deepSubscribed && session.deepSubscriptionAt == null) session.deepSubscriptionAt = now;
      this.refreshOutcomes(session, now);
    }
    return this.tracked.size;
  }

  observeMicro(ranked: FinalRankedCandidate[], input: { now?: number; source?: PriceSource } = {}) {
    const now = input.now ?? Date.now();
    for (const row of ranked) {
      if (!TRACK_STATES.has(row.state) && row.state !== "WARMING") continue;
      if (!this.tracked.has(row.candidateId) && row.smoothedScore < this.config.minTrackScore) continue;
      const existing = this.tracked.get(row.candidateId);
      if (!existing) {
        this.tracked.set(
          row.candidateId,
          this.createTracked(
            freezeSnapshot({
              candidateId: row.candidateId,
              symbol: row.symbol.toUpperCase(),
              firstDetectedAt: row.firstDetectedAt,
              firstDetectionPrice: row.firstDetectionPrice,
              primaryLane: row.lane,
              secondaryEvidence: [],
              opportunityScore: row.opportunityScore,
              opportunityBreakdown: { ...row.opportunityBreakdown },
              microScore: row.microScore,
              microBreakdown: { ...row.microBreakdown },
              liquidityScore: row.liquidityScore,
              executionQuality: row.executionQuality,
              finalScore: row.smoothedScore,
              initialRank: row.rank,
              btcReturn1m: null,
              btcReturn5m: null,
              marketBreadthPctPositive1m: null,
              aiStatus: row.ai.decision,
              aiModifier: row.ai.modifier,
              tdiDecision: row.tdi.decision,
              reasonCodes: row.reasonCodes,
              warnings: row.warnings,
              rvol1m: null,
              priceAccelerationShort: null,
              takerBuyRatio5s: row.features.takerBuyRatio5s,
              microTiming: row.timing,
              source: input.source ?? "live",
            }),
            row.state,
            row.lane,
            row.smoothedScore,
            now,
          ),
        );
        this.pushPrice(row.symbol, {
          t: row.firstDetectedAt,
          price: row.firstDetectionPrice,
          high: row.firstDetectionPrice,
          low: row.firstDetectionPrice,
        });
      } else {
        existing.snapshot = freezeSnapshot({
          ...existing.snapshot,
          microScore: row.microScore,
          microBreakdown: { ...row.microBreakdown },
          liquidityScore: row.liquidityScore,
          executionQuality: row.executionQuality,
          finalScore: row.smoothedScore,
          aiStatus: row.ai.decision,
          aiModifier: row.ai.modifier,
          tdiDecision: row.tdi.decision,
          reasonCodes: [...new Set(row.reasonCodes ?? existing.snapshot.reasonCodes)],
          warnings: [...new Set(row.warnings ?? existing.snapshot.warnings)],
          takerBuyRatio5s: row.features.takerBuyRatio5s,
          microTiming: row.timing,
        });
        this.appendJourney(existing, {
          at: now,
          stage: row.state,
          lane: row.lane,
          score: row.smoothedScore,
          state: row.state,
        });
        existing.latestStage = row.state;
        existing.latestScore = row.smoothedScore;
        existing.latestRank = row.rank;
        existing.latestAiStatus = row.ai.decision;
        existing.latestTdiDecision = row.tdi.decision;
      }
      const session = this.tracked.get(row.candidateId);
      if (!session) continue;
      if (row.state === "MICRO_CONFIRMED" && session.microConfirmedAt == null) session.microConfirmedAt = now;
      if (row.state === "EXECUTION_READY" && session.executionReadyAt == null) session.executionReadyAt = now;
      if (row.deepSubscribed && session.deepSubscriptionAt == null) session.deepSubscriptionAt = now;
      this.refreshOutcomes(session, now);
    }
    return this.tracked.size;
  }

  tickPrices(snapshots: SymbolMarketSnapshot[], now = Date.now()) {
    this.lastTickAt = now;
    for (const row of snapshots) {
      if (row.lastUpdateAt > now || row.eventTime > now) continue;
      const t = Math.min(row.lastUpdateAt || row.eventTime, now);
      this.pushPrice(row.symbol, {
        t,
        price: row.lastPrice,
        high: row.lastPrice,
        low: row.lastPrice,
      });
      if (row.stale) this.markSymbolGap(row.symbol.toUpperCase(), "OUTCOME_DATA_INCOMPLETE");
    }
    for (const session of this.tracked.values()) {
      this.refreshOutcomes(session, now);
    }
    return this.tracked.size;
  }

  ingestPrice(symbol: string, point: PricePoint, now = point.t) {
    if (point.t <= now) this.pushPrice(symbol, point);
    for (const session of this.tracked.values()) {
      if (session.snapshot.symbol === symbol.toUpperCase()) this.refreshOutcomes(session, now);
    }
  }

  getTracked() {
    return [...this.tracked.values()];
  }

  getSnapshot(candidateId: string) {
    return this.tracked.get(candidateId)?.snapshot ?? null;
  }

  getJourney(candidateId: string) {
    return this.tracked.get(candidateId)?.journey.slice() ?? [];
  }

  getMoverEvents(now = this.lastTickAt || Date.now()) {
    const events = [];
    for (const [symbol, points] of this.prices) {
      events.push(...detectMoverEvents({ symbol, points, now }));
    }
    return events;
  }

  getPricePoints(symbol: string) {
    return this.prices.get(symbol.toUpperCase())?.slice() ?? [];
  }

  getTelemetry() {
    return {
      instanceId: this.instanceId,
      owner: "shadow-outcome-engine",
      ordersDisabled: this.ordersDisabled,
      tracked: this.tracked.size,
      symbols: this.prices.size,
      lastTickAt: this.lastTickAt,
      persistWrites: this.persistWrites,
      minTrackScore: this.config.minTrackScore,
    };
  }

  shouldPersist(now = Date.now()) {
    return now - this.lastPersistAt >= this.config.persistEveryMs;
  }

  markPersisted(now = Date.now()) {
    this.lastPersistAt = now;
    this.persistWrites += 1;
  }

  /** Hard guarantee: this engine never submits exchange orders. */
  submitLiveOrder(): never {
    throw new Error("SHADOW_OUTCOME_ENGINE_ORDERS_DISABLED");
  }

  resetForTests() {
    this.tracked.clear();
    this.prices.clear();
    this.lastTickAt = 0;
    this.lastPersistAt = 0;
    this.persistWrites = 0;
  }

  private createTracked(
    snapshot: Readonly<DetectionSnapshot>,
    stage: string,
    lane: string,
    score: number,
    now: number,
  ): TrackedCandidate {
    const event: JourneyEvent = { at: snapshot.firstDetectedAt || now, stage, lane, score, state: stage };
    return {
      snapshot,
      journey: [event],
      moveKey: moveKey(snapshot.symbol, snapshot.firstDetectedAt),
      latestStage: stage,
      latestScore: score,
      latestRank: snapshot.initialRank,
      latestAiStatus: snapshot.aiStatus,
      latestTdiDecision: snapshot.tdiDecision,
      hotAt: stage === "HOT" || stage === "PROMOTED" ? now : null,
      microConfirmedAt: stage === "MICRO_CONFIRMED" ? now : null,
      executionReadyAt: stage === "EXECUTION_READY" ? now : null,
      deepSubscriptionAt: null,
      lastPrice: snapshot.firstDetectionPrice,
      lastPriceAt: snapshot.firstDetectedAt,
      high: snapshot.firstDetectionPrice,
      low: snapshot.firstDetectionPrice,
      highAt: snapshot.firstDetectedAt,
      outcomes: [],
      reachTimes: {},
      pricePoints: [{ t: snapshot.firstDetectedAt, price: snapshot.firstDetectionPrice }],
      invalidReason: null,
    };
  }

  private appendJourney(session: TrackedCandidate, event: JourneyEvent) {
    const last = session.journey[session.journey.length - 1];
    if (last && last.stage === event.stage && last.score === event.score && last.state === event.state) return;
    session.journey.push(event);
  }

  private pushPrice(symbol: string, point: PricePoint) {
    const key = symbol.toUpperCase();
    const list = this.prices.get(key) ?? [];
    const last = list[list.length - 1];
    if (last && point.t >= last.t && point.t - last.t > this.config.gapMs) {
      this.markSymbolGap(key, "OUTCOME_DATA_INCOMPLETE");
    }
    if (last && point.t < last.t) {
      list.push(point);
      list.sort((a, b) => a.t - b.t);
    } else if (!last || last.t !== point.t) {
      list.push(point);
    }
    const cutoff = point.t - PRICE_RETENTION_MS;
    while (list.length > PRICE_CAP || (list[0] && list[0].t < cutoff)) list.shift();
    this.prices.set(key, list);
  }

  private markSymbolGap(symbol: string, reason: string) {
    for (const session of this.tracked.values()) {
      if (session.snapshot.symbol === symbol && !session.invalidReason) {
        session.invalidReason = reason;
      }
    }
  }

  private refreshOutcomes(session: TrackedCandidate, now: number) {
    const points = (this.prices.get(session.snapshot.symbol) ?? [])
      .filter((row) => row.t <= now)
      .sort((a, b) => a.t - b.t);
    session.pricePoints = points.filter((row) => row.t >= session.snapshot.firstDetectedAt);
    const last = session.pricePoints[session.pricePoints.length - 1];
    if (last) {
      session.lastPrice = last.price;
      session.lastPriceAt = last.t;
      if (last.price > session.high) {
        session.high = last.price;
        session.highAt = last.t;
      }
      if (last.price < session.low) session.low = last.price;
    }
    session.outcomes = computeHorizons({
      detectedAt: session.snapshot.firstDetectedAt,
      detectionPrice: session.snapshot.firstDetectionPrice,
      points,
      now,
      gapMs: this.config.gapMs,
      lookaheadSafe: true,
    });
    session.reachTimes = computeReachTimes({
      detectedAt: session.snapshot.firstDetectedAt,
      detectionPrice: session.snapshot.firstDetectionPrice,
      points,
      now,
      lookaheadSafe: true,
    });
  }
}

let singleton: ShadowOutcomeEngine | null = null;

export function getShadowOutcomeEngine() {
  if (!singleton) singleton = new ShadowOutcomeEngine();
  return singleton;
}

export function resetShadowOutcomeEngineForTests(instance?: ShadowOutcomeEngine) {
  singleton = instance ?? new ShadowOutcomeEngine();
  singleton.resetForTests();
  return singleton;
}

export function observeCanonicalShadowTick(input?: {
  opportunity?: OpportunityCandidate[];
  micro?: FinalRankedCandidate[];
  snapshots?: SymbolMarketSnapshot[];
  now?: number;
  source?: PriceSource;
}) {
  const engine = getShadowOutcomeEngine();
  const now = input?.now ?? Date.now();
  const snapshots = input?.snapshots ?? [];
  const breadth = snapshots.length ? computeBreadth(snapshots, snapshots.find((row) => row.symbol.includes("BTC")) ?? null) : null;
  if (input?.opportunity) engine.observeOpportunity(input.opportunity, { now, breadth, source: input.source });
  if (input?.micro) engine.observeMicro(input.micro, { now, source: input.source });
  if (snapshots.length) engine.tickPrices(snapshots, now);
  return engine;
}
