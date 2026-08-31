import { randomUUID } from "node:crypto";
import { resolvePaperConfig, type PaperRuntimeConfig } from "@/src/server/paper-runtime/config";
import { simulateRealisticFill } from "@/src/server/paper-runtime/fill-model";
import { DEFAULT_USDT_FILTERS } from "@/src/server/paper-runtime/filters";
import { assertLiveOrderSubmissionAllowed } from "@/src/server/paper-runtime/live-lock";
import { evaluatePaperRisk, sizePosition } from "@/src/server/paper-runtime/risk-overlay";
import { claimExit, evaluateExits, pickExit } from "@/src/server/paper-runtime/exit";
import { summarizeTrades, laneTable, type ClosedTrade } from "@/src/server/paper-runtime/performance";
import type {
  BookLevel,
  FillResult,
  HealthSnapshot,
  PaperIntent,
  PaperPosition,
  SymbolFilters,
} from "@/src/server/paper-runtime/types";

export type MarketView = {
  symbol: string;
  last: number;
  bids: BookLevel[];
  asks: BookLevel[];
  eventTime: number;
};

export class PaperRuntimeEngine {
  readonly config: PaperRuntimeConfig;
  readonly ordersDisabledOnLive = true;
  private equity: number;
  private peak: number;
  private maxDrawdown = 0;
  private dailyPnl = 0;
  private consecutiveLosses = 0;
  private readonly open = new Map<string, PaperPosition>();
  private readonly closed: ClosedTrade[] = [];
  private readonly intents = new Map<string, string>();
  private readonly unknownOrders = new Set<string>();
  private readonly rejectionReasons: Record<string, number> = {};
  private health: HealthSnapshot = {
    wsStatus: "UP",
    redisOk: true,
    dbOk: true,
    dataAgeMs: 0,
    btcReturn1m: 0,
    rateLimit429: false,
    ipBan418: false,
  };
  private wsRecoveredAt: number | null = null;
  private filters: SymbolFilters = DEFAULT_USDT_FILTERS;

  constructor(config?: Partial<PaperRuntimeConfig>) {
    this.config = resolvePaperConfig(config);
    this.equity = this.config.startEquity;
    this.peak = this.config.startEquity;
  }

  setHealth(health: Partial<HealthSnapshot>, now = Date.now()) {
    const prev = this.health.wsStatus;
    this.health = { ...this.health, ...health };
    if (prev !== "UP" && this.health.wsStatus === "UP") this.wsRecoveredAt = now;
  }

  setFilters(filters: SymbolFilters) {
    this.filters = filters;
  }

  submit(intent: PaperIntent, market: MarketView, now = Date.now()) {
    const live = assertLiveOrderSubmissionAllowed();
    if (live.allowed) {
      return this.reject(intent, "LIVE_LOCKED_FOR_PHASE6");
    }
    if (this.intents.has(intent.candidateId) || this.intents.has(intent.intentId)) {
      return this.reject(intent, "REJECT_DUPLICATE_EXECUTION");
    }
    if (this.unknownOrders.has(intent.intentId)) {
      return this.reject(intent, "UNKNOWN_ORDER_STATE");
    }
    if (market.eventTime > now) {
      return this.reject(intent, "LOOKAHEAD_BLOCKED");
    }
    const last = market.asks[0]?.price ?? market.last;
    const sizedNotional = sizePosition(this.config, this.equity, intent.stopPct);
    const qty = intent.quantity > 0 ? intent.quantity : last > 0 ? sizedNotional / last : 0;
    const risk = evaluatePaperRisk(
      this.config,
      {
        symbol: intent.symbol,
        equity: this.equity,
        peakEquity: this.peak,
        dailyPnl: this.dailyPnl,
        openCount: this.open.size,
        openNotional: [...this.open.values()].reduce((sum, row) => sum + row.qty * row.avgEntry, 0) + qty * last,
        openSymbols: [...this.open.values()].map((row) => row.symbol),
        stopPct: intent.stopPct,
        consecutiveLosses: this.consecutiveLosses,
        health: this.health,
        now,
        wsRecoveredAt: this.wsRecoveredAt,
      },
      last,
    );
    if (risk.verdict === "REJECT") {
      return this.reject(intent, risk.reasonCodes[0] ?? "RISK_REJECT");
    }
    const fill = this.fill(intent.side, qty, intent.signalPrice, market, now - intent.signalAt);
    if (fill.filledQty <= 0) {
      if (fill.rejectReason === "UNKNOWN") this.unknownOrders.add(intent.intentId);
      return this.reject(intent, fill.rejectReason ?? "EXECUTION_REJECTED");
    }
    this.intents.set(intent.candidateId, intent.intentId);
    this.intents.set(intent.intentId, intent.intentId);
    const stopPct = Math.max(0.4, intent.stopPct);
    const tpPct = Math.max(stopPct, intent.takeProfitPct);
    const position: PaperPosition = {
      positionId: randomUUID(),
      candidateId: intent.candidateId,
      symbol: intent.symbol.toUpperCase(),
      lane: intent.lane,
      score: intent.score,
      state: "OPEN",
      qty: fill.filledQty,
      avgEntry: fill.avgPrice,
      entryFee: fill.fee,
      entrySpreadPct: fill.spreadCostPct,
      entrySlippagePct: fill.slippagePct,
      openedAt: now,
      stopPrice: fill.avgPrice * (1 - stopPct / 100),
      takeProfitPrice: fill.avgPrice * (1 + tpPct / 100),
      trailPct: this.config.trailPct,
      highSinceEntry: fill.avgPrice,
      remainingQty: fill.filledQty,
      realizedGross: 0,
      realizedFees: fill.fee,
      realizedNet: -fill.fee,
      exitReason: null,
      closedAt: null,
      exitLock: false,
    };
    this.equity -= fill.fee;
    this.open.set(position.positionId, position);
    this.touchEquity(now);
    return { ok: true as const, position, fill, risk };
  }

  tick(market: MarketView, now = Date.now(), extras?: { flowCollapsed?: boolean; emergency?: boolean }) {
    if (market.eventTime > now) return;
    for (const position of [...this.open.values()]) {
      if (position.symbol !== market.symbol.toUpperCase()) continue;
      const bid = market.bids[0]?.price ?? market.last;
      if (bid > position.highSinceEntry) position.highSinceEntry = bid;
      const reasons = evaluateExits({
        position,
        bid,
        now,
        timeExitMs: this.config.timeExitMs,
        minProgressPct: this.config.minProgressPct,
        trailPct: position.trailPct,
        partialTpPct: this.config.partialTpPct,
        flowCollapsed: extras?.flowCollapsed,
        emergency: extras?.emergency,
        riskHalt: this.health.wsStatus === "FAILED",
      });
      const chosen = pickExit(reasons);
      if (!chosen) continue;
      if (chosen === "PARTIAL_TP") {
        this.closeQty(position, market, now, "PARTIAL_TP", position.qty * this.config.partialTpFraction);
        continue;
      }
      this.closeQty(position, market, now, chosen, position.qty);
    }
  }

  markUnknown(intentId: string) {
    this.unknownOrders.add(intentId);
  }

  snapshot() {
    return {
      equity: this.equity,
      peak: this.peak,
      dailyPnl: this.dailyPnl,
      consecutiveLosses: this.consecutiveLosses,
      open: [...this.open.values()],
      closed: this.closed.slice(),
      intents: [...this.intents.keys()],
      health: this.health,
    };
  }

  restore(snapshot: ReturnType<PaperRuntimeEngine["snapshot"]>) {
    this.equity = snapshot.equity;
    this.peak = snapshot.peak;
    this.dailyPnl = snapshot.dailyPnl;
    this.consecutiveLosses = snapshot.consecutiveLosses;
    this.open.clear();
    for (const row of snapshot.open) this.open.set(row.positionId, { ...row, exitLock: false });
    this.closed.splice(0, this.closed.length, ...snapshot.closed);
    this.intents.clear();
    for (const key of snapshot.intents) this.intents.set(key, key);
    this.health = snapshot.health;
  }

  getOpen() {
    return [...this.open.values()];
  }

  getClosed() {
    return this.closed.slice();
  }

  getRejections() {
    return { ...this.rejectionReasons };
  }

  performance() {
    const unrealized = [...this.open.values()].reduce((sum, row) => sum + row.qty * 0, 0);
    return summarizeTrades({
      startEquity: this.config.startEquity,
      equity: this.equity,
      peak: this.peak,
      maxDrawdown: this.maxDrawdown,
      unrealized,
      trades: this.closed,
    });
  }

  lanes() {
    return laneTable(this.closed);
  }

  /** Paper adapter never reaches live order endpoints. */
  submitLiveOrder(): never {
    throw new Error("PAPER_RUNTIME_LIVE_ORDERS_DISABLED");
  }

  resetForTests() {
    this.open.clear();
    this.closed.length = 0;
    this.intents.clear();
    this.unknownOrders.clear();
    this.equity = this.config.startEquity;
    this.peak = this.config.startEquity;
    this.dailyPnl = 0;
    this.consecutiveLosses = 0;
    this.maxDrawdown = 0;
    Object.keys(this.rejectionReasons).forEach((key) => delete this.rejectionReasons[key]);
  }

  private fill(side: PaperIntent["side"], quantity: number, signalPrice: number, market: MarketView, latencyMs: number): FillResult {
    return simulateRealisticFill({
      side,
      quantity,
      signalPrice,
      bids: market.bids,
      asks: market.asks,
      latencyMs: Math.max(this.config.defaultLatencyMs, latencyMs),
      feeRate: this.config.takerFeeRate,
      filters: this.filters,
      allowPartial: true,
    });
  }

  private closeQty(position: PaperPosition, market: MarketView, now: number, reason: NonNullable<PaperPosition["exitReason"]>, qty: number) {
    if (!claimExit(position, reason === "PARTIAL_TP" ? "PARTIAL_TP" : reason) && reason !== "PARTIAL_TP") return;
    const fill = this.fill("SELL", Math.min(qty, position.qty), position.avgEntry, market, this.config.defaultLatencyMs);
    if (fill.filledQty <= 0) {
      position.exitLock = false;
      position.state = "ERROR";
      return;
    }
    const gross = (fill.avgPrice - position.avgEntry) * fill.filledQty;
    const fees = fill.fee;
    const net = gross - fees;
    position.qty = Number((position.qty - fill.filledQty).toFixed(8));
    position.remainingQty = position.qty;
    position.realizedGross += gross;
    position.realizedFees += fees;
    position.realizedNet += net;
    this.equity += gross - fees;
    this.dailyPnl += net;
    const originalQty = fill.filledQty + position.qty;
    const allocEntryFee = originalQty > 0 ? position.entryFee * (fill.filledQty / originalQty) : 0;
    this.closed.push({
      symbol: position.symbol,
      lane: position.lane,
      score: position.score,
      qty: fill.filledQty,
      entry: position.avgEntry,
      exit: fill.avgPrice,
      gross,
      fees: fees + allocEntryFee,
      spreadCost: (position.entrySpreadPct / 100) * position.avgEntry * fill.filledQty,
      slippageCost: (position.entrySlippagePct / 100) * position.avgEntry * fill.filledQty + (fill.slippagePct / 100) * fill.notional,
      net: net - allocEntryFee,
      holdMs: now - position.openedAt,
      reason,
    });
    if (this.closed.length > this.config.closedRetention) this.closed.shift();
    if (position.qty <= 1e-8 || reason !== "PARTIAL_TP") {
      this.open.delete(position.positionId);
      if (net - allocEntryFee <= 0) this.consecutiveLosses += 1;
      else this.consecutiveLosses = 0;
    } else {
      position.state = "OPEN";
      position.exitLock = false;
      position.exitReason = null;
    }
    this.touchEquity(now);
  }

  private reject(intent: PaperIntent, reason: string) {
    this.rejectionReasons[reason] = (this.rejectionReasons[reason] ?? 0) + 1;
    return { ok: false as const, reason, intent };
  }

  private touchEquity(_now: number) {
    if (this.equity > this.peak) this.peak = this.equity;
    const dd = this.peak > 0 ? ((this.peak - this.equity) / this.peak) * 100 : 0;
    if (dd > this.maxDrawdown) this.maxDrawdown = dd;
  }
}

let singleton: PaperRuntimeEngine | null = null;

export function getPaperRuntimeEngine() {
  if (!singleton) singleton = new PaperRuntimeEngine();
  return singleton;
}

export function resetPaperRuntimeForTests(instance?: PaperRuntimeEngine) {
  singleton = instance ?? new PaperRuntimeEngine();
  singleton.resetForTests();
  return singleton;
}
