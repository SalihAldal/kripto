import { logger } from "@/lib/logger";
import type { ModuleHealth, SignalDecision } from "@/src/server/trading-core/core/types";
import { tradingCoreFlags } from "@/src/server/trading-core/core/feature-flags";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { toSignalJson, type SignalEngineJsonOutput } from "@/src/server/trading-core/signals/json-output";
import { TradingCoreService } from "@/src/server/trading-core/services/trading-core-service";
import { MarketDataBuffer } from "@/src/server/trading-core/websocket/market-data-buffer";
import { BinanceMarketStream } from "@/src/server/trading-core/websocket/binance-market-stream";
import { PositionManager } from "@/src/server/trading-core/executors/position-manager";
import { tradingFailsafeGuard } from "@/src/server/trading-core/protection/failsafe-guard";

type SignalOutputHandler = (output: SignalEngineJsonOutput) => void | Promise<void>;

export class SignalEngineRunner {
  readonly name = "signal-engine-runner";
  readonly enabled = tradingCoreFlags.enabled && tradingCoreFlags.signalEngineEnabled;
  private readonly outputHandlers = new Set<SignalOutputHandler>();
  private started = false;
  private lastSignal: SignalDecision | null = null;
  private lastError: string | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly stream: BinanceMarketStream,
    private readonly buffer: MarketDataBuffer,
    private readonly queue: TradingJobQueue,
    private readonly core: TradingCoreService,
    private readonly positions?: PositionManager,
  ) {
    this.queue.register<{ symbol: string }>("signal.analyze", async (job) => {
      if (!tradingCoreFlags.enabled || !tradingCoreFlags.signalEngineEnabled) return;
      const snapshot = this.buffer.getSnapshot(job.payload.symbol);
      if (!snapshot || snapshot.candles.length < 35) return;
      const result = await this.core.analyze(snapshot);
      this.lastSignal = result.signal;
      const output = toSignalJson(result.signal, result.execution);
      await Promise.all(Array.from(this.outputHandlers).map((handler) => handler(output)));
    });
  }

  onOutput(handler: SignalOutputHandler) {
    this.outputHandlers.add(handler);
    return () => this.outputHandlers.delete(handler);
  }

  async start() {
    if (this.started || !tradingCoreFlags.enabled || !tradingCoreFlags.signalEngineEnabled) return;
    this.started = true;
    await this.queue.start();
    this.unsubscribe = this.stream.onTick((tick) => {
      if (!tradingCoreFlags.enabled || !tradingCoreFlags.signalEngineEnabled) return;
      const protection = tradingFailsafeGuard.recordMarketTick(tick.symbol, tick.price);
      if (!protection.allowed) return;
      this.buffer.ingestTick(tick);
      this.positions?.handleMarketTick(tick);
      this.queue.push("signal.analyze", { symbol: tick.symbol }).catch((error) => {
        this.lastError = (error as Error).message;
        logger.warn({ error: this.lastError, symbol: tick.symbol }, "Signal queue push failed");
      });
    });
    await this.stream.start();
  }

  async stop() {
    this.started = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.queue.stop();
    await this.stream.stop();
    this.outputHandlers.clear();
  }

  async health(): Promise<ModuleHealth> {
    return {
      name: this.name,
      enabled: this.enabled,
      status: !tradingCoreFlags.enabled || !tradingCoreFlags.signalEngineEnabled ? "disabled" : this.started ? "healthy" : "stopped",
      details: {
        queue: this.queue.stats(),
        buffer: this.buffer.stats(),
        lastSignal: this.lastSignal
          ? {
              symbol: this.lastSignal.symbol,
              side: this.lastSignal.side,
              score: this.lastSignal.score,
              generatedAt: this.lastSignal.generatedAt,
            }
          : null,
        lastError: this.lastError,
      },
      checkedAt: new Date().toISOString(),
    };
  }
}
