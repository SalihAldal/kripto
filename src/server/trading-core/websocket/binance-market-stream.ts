import { logger } from "@/lib/logger";
import type { MarketTick, ModuleHealth, TradingModule } from "@/src/server/trading-core/core/types";
import { TradingCoreEventBus } from "@/src/server/trading-core/core/event-bus";
import { tradingCoreFlags } from "@/src/server/trading-core/core/feature-flags";
import { tradingDomainLogger } from "@/src/server/trading-core/observability/domain-logger";
import { tradingFailsafeGuard } from "@/src/server/trading-core/protection/failsafe-guard";
import { marketDataNormalizer, marketDataSourceAdapters } from "@/src/server/trading-core/market-data";
import { retry } from "@/src/server/trading-core/utils/retry";

type TickHandler = (tick: MarketTick) => void;

export class BinanceMarketStream implements TradingModule {
  readonly name = "binance-market-stream";
  get enabled() {
    return tradingCoreFlags.enabled && tradingCoreFlags.websocketEnabled;
  }
  private socket: WebSocket | null = null;
  private stopped = true;
  private reconnectAttempt = 0;
  private readonly handlers = new Set<TickHandler>();
  private lastMessageAt = 0;
  private lastError: string | null = null;

  constructor(
    private readonly symbols: string[],
    private readonly events: TradingCoreEventBus,
    private readonly enabledOverride?: boolean,
  ) {}

  onTick(handler: TickHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async start() {
    if (!this.isEnabled()) return;
    this.stopped = false;
    await this.connect();
  }

  async stop() {
    this.stopped = true;
    this.socket?.close();
    this.socket = null;
    this.handlers.clear();
  }

  async health(): Promise<ModuleHealth> {
    return {
      name: this.name,
      enabled: this.isEnabled(),
      status: !this.isEnabled() ? "disabled" : this.socket ? "healthy" : this.lastError ? "degraded" : "starting",
      details: {
        symbols: this.symbols,
        lastMessageAt: this.lastMessageAt ? new Date(this.lastMessageAt).toISOString() : null,
        lastError: this.lastError,
      },
      checkedAt: new Date().toISOString(),
    };
  }

  private async connect() {
    if (typeof WebSocket === "undefined") {
      this.lastError = "Global WebSocket is not available in this Node runtime";
      logger.warn({ module: this.name }, this.lastError);
      return;
    }

    const streams = this.symbols.map((symbol) => `${symbol.toLowerCase()}@ticker`).join("/");
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    await retry(
      async () => {
        if (this.stopped) return;
        this.socket = new WebSocket(url);
        this.bindSocket(this.socket);
      },
      { retries: 2, minDelayMs: 250, maxDelayMs: 1000, jitter: true },
    );
  }

  private isEnabled() {
    return this.enabledOverride ?? (tradingCoreFlags.enabled && tradingCoreFlags.websocketEnabled);
  }

  private bindSocket(socket: WebSocket) {
    socket.onmessage = (event) => {
      if (!this.isEnabled()) {
        void this.stop();
        return;
      }
      const tick = this.parseTick(event.data);
      if (!tick) return;
      this.lastMessageAt = Date.now();
      this.lastError = null;
      for (const handler of this.handlers) handler(tick);
      this.events.emit("market.tick", tick);
    };

    socket.onerror = () => {
      this.lastError = "Binance WebSocket error";
    };

    socket.onclose = () => {
      this.socket = null;
      tradingDomainLogger.websocketDisconnect({
        source: this.name,
        symbols: this.symbols,
        reason: this.lastError ?? "socket closed",
      });
      tradingFailsafeGuard.recordWebSocketDisconnect(this.name, this.symbols);
      if (!this.stopped && this.isEnabled()) this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    this.reconnectAttempt += 1;
    const delay = Math.min(
      tradingCoreFlags.websocketReconnectMaxMs,
      tradingCoreFlags.websocketReconnectMinMs * 2 ** Math.min(this.reconnectAttempt, 8),
    );
    setTimeout(() => {
      if (!this.stopped && this.isEnabled()) void this.connect();
    }, delay);
  }

  private parseTick(data: unknown): MarketTick | null {
    try {
      const raw = JSON.parse(String(data)) as {
        data?: Record<string, unknown>;
      };
      const payload = raw.data;
      if (!payload) return null;
      const normalized = marketDataNormalizer.normalizeTick({
        ...marketDataSourceAdapters.binanceTicker(payload),
        receivedAt: Date.now(),
      });
      return normalized ? marketDataNormalizer.toMarketTick(normalized) : null;
    } catch {
      return null;
    }
  }
}
