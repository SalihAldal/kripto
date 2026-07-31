import { tradingConfig } from "@/src/server/trading-core/config";
import { TradingCoreEventBus } from "@/src/server/trading-core/core/event-bus";
import type { MarketTick, ModuleHealth, TradingModule } from "@/src/server/trading-core/core/types";
import { BinanceMarketStream } from "@/src/server/trading-core/websocket/binance-market-stream";
import { LivePaperPositionManager } from "@/src/server/trading-core/paper/live-paper-position-manager";
import { PaperBalanceLedger } from "@/src/server/trading-core/paper/paper-balance-ledger";
import { PaperExecutionSimulator } from "@/src/server/trading-core/paper/paper-execution-simulator";
import type {
  LivePaperEngineOptions,
  PaperBalances,
  PaperClosedPosition,
  PaperFill,
  PaperMode,
  PaperOrderRequest,
  PaperPositionUpdate,
} from "@/src/server/trading-core/paper/live-paper-types";

export class LivePaperEngine implements TradingModule {
  readonly name = "live-paper-engine";
  readonly enabled = true;
  private readonly mode: PaperMode;
  private readonly initialBalances: PaperBalances;
  private readonly ledger: PaperBalanceLedger;
  private readonly simulator: PaperExecutionSimulator;
  private readonly positions: LivePaperPositionManager;
  private readonly fills = new Map<string, PaperFill>();
  private readonly closed: PaperClosedPosition[] = [];
  private readonly symbols: string[];
  private stream: BinanceMarketStream | null = null;
  private unsubscribe: (() => void) | null = null;
  private running = false;
  private lastTick: MarketTick | null = null;

  constructor(private readonly options: LivePaperEngineOptions = {}) {
    this.mode = options.mode ?? "test";
    this.initialBalances = options.initialBalances ?? { USDT: 2500, TRY: 100_000 };
    this.symbols = options.symbols ?? tradingConfig.getGlobal("coinWhitelist");
    this.ledger = new PaperBalanceLedger(this.initialBalances);
    this.simulator = new PaperExecutionSimulator(options.takerFeeRate ?? 0.001, options.slippageBps ?? 5);
    this.positions = new LivePaperPositionManager(
      this.simulator,
      options.defaultTakeProfitPercent ?? tradingConfig.getGlobal("takeProfitPercent"),
      options.defaultStopLossPercent ?? tradingConfig.getGlobal("stopLossPercent"),
    );
  }

  async start() {
    if (this.running) return;
    this.running = true;
    if (this.mode !== "live-market") return;
    const events = new TradingCoreEventBus();
    this.stream = new BinanceMarketStream(this.symbols, events, true);
    this.unsubscribe = this.stream.onTick((tick) => this.ingestTick(tick));
    await this.stream.start();
  }

  async stop() {
    this.running = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.stream?.stop();
    this.stream = null;
  }

  async openOrder(request: PaperOrderRequest) {
    const existing = this.fills.get(request.idempotencyKey);
    if (existing) return existing;
    const markPrice = request.markPrice ?? this.lastTick?.price;
    if (!markPrice || markPrice <= 0) throw new Error("Paper order icin mark price bulunamadi");
    const fill = this.simulator.simulateOpen(request, markPrice);
    this.ledger.reserveMargin(fill);
    this.positions.open(fill, request);
    this.fills.set(request.idempotencyKey, fill);
    return fill;
  }

  closePosition(positionId: string, markPrice?: number) {
    const position = this.positions.snapshot().find((row) => row.id === positionId || row.symbol === positionId.toUpperCase());
    if (!position) return null;
    const closed = this.positions.close(position.id, markPrice ?? position.markPrice, "MANUAL");
    if (closed) {
      this.ledger.settleClose(closed);
      this.closed.unshift(closed);
    }
    return closed;
  }

  ingestTick(tick: MarketTick): PaperPositionUpdate[] {
    const normalized = { ...tick, symbol: tick.symbol.toUpperCase() };
    this.lastTick = normalized;
    const updates = this.positions.updateTick(normalized);
    for (const update of updates) {
      if (update.closed) {
        this.ledger.settleClose(update.closed);
        this.closed.unshift(update.closed);
      }
    }
    return updates;
  }

  reset() {
    this.positions.reset();
    this.ledger.reset(this.initialBalances);
    this.fills.clear();
    this.closed.length = 0;
    this.lastTick = null;
  }

  status() {
    const openPositions = this.positions.snapshot();
    const unrealizedPnl = openPositions.reduce((sum, position) => sum + position.unrealizedPnl, 0);
    return {
      mode: this.mode,
      running: this.running,
      account: this.ledger.snapshot(unrealizedPnl),
      positions: openPositions,
      closed: this.closed.slice(0, 50),
      fills: Array.from(this.fills.values()).slice(-100),
      lastTick: this.lastTick,
      stream: {
        running: Boolean(this.stream),
        symbols: this.symbols,
      },
    };
  }

  async health(): Promise<ModuleHealth> {
    return {
      name: this.name,
      enabled: this.enabled,
      status: this.running ? "healthy" : "stopped",
      details: this.status(),
      checkedAt: new Date().toISOString(),
    };
  }
}
