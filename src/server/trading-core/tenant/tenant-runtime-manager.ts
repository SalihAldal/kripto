import { TradingCoreEventBus } from "@/src/server/trading-core/core/event-bus";
import { BotOrchestrator } from "@/src/server/trading-core/bots/bot-orchestrator";
import { PositionManager } from "@/src/server/trading-core/executors/position-manager";
import { BinanceMarketStream } from "@/src/server/trading-core/websocket/binance-market-stream";
import { tenantConfigEngine } from "@/src/server/trading-core/tenant/tenant-config-engine";
import { tenantPortfolios } from "@/src/server/trading-core/tenant/tenant-portfolio-store";
import { tenantSessions } from "@/src/server/trading-core/tenant/tenant-session-manager";
import type { TenantRuntimeSnapshot } from "@/src/server/trading-core/tenant/tenant-types";
import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";

type TenantRuntime = {
  userId: string;
  events: TradingCoreEventBus;
  stream: BinanceMarketStream;
  positions: PositionManager;
  bots: BotOrchestrator;
  unsubscribe: (() => void) | null;
};

export class TenantRuntimeManager {
  private readonly runtimes = new Map<string, TenantRuntime>();

  async start(userId: string) {
    const symbols = tenantConfigEngine.symbolsForUser(userId);
    const existing = this.runtimes.get(userId);
    if (existing) {
      tenantSessions.start({ userId, symbols });
      return this.snapshot(userId);
    }

    const events = new TradingCoreEventBus();
    const stream = new BinanceMarketStream(symbols, events, true);
    const positions = new PositionManager();
    const bots = new BotOrchestrator();
    const runtime: TenantRuntime = { userId, events, stream, positions, bots, unsubscribe: null };
    runtime.unsubscribe = stream.onTick((tick) => {
      positions.handleMarketTick(tick);
      tenantPortfolios.syncPositions(userId, positions.snapshot());
    });
    this.runtimes.set(userId, runtime);
    tenantSessions.start({ userId, symbols });
    tenantPortfolios.ensure(userId);
    await stream.start();
    tradingLogger.info({
      category: "SYSTEM",
      source: "trading-core.tenant-runtime",
      message: "Tenant runtime started",
      status: "SUCCESS",
      userId,
      context: { symbols },
    });
    return this.snapshot(userId);
  }

  async stop(userId: string) {
    const runtime = this.runtimes.get(userId);
    if (!runtime) {
      tenantSessions.stop(userId);
      return null;
    }
    runtime.unsubscribe?.();
    await runtime.stream.stop();
    this.runtimes.delete(userId);
    tenantSessions.stop(userId);
    tradingLogger.warn({
      category: "SYSTEM",
      source: "trading-core.tenant-runtime",
      message: "Tenant runtime stopped",
      status: "SUCCESS",
      userId,
    });
    return tenantSessions.get(userId);
  }

  getRuntime(userId: string) {
    return this.runtimes.get(userId) ?? null;
  }

  async snapshot(userId: string): Promise<TenantRuntimeSnapshot | null> {
    const session = tenantSessions.get(userId);
    if (!session) return null;
    const runtime = this.runtimes.get(userId);
    const streamHealth = runtime ? await runtime.stream.health() : null;
    const positions = runtime?.positions.snapshot() ?? tenantPortfolios.snapshot(userId).positions;
    const portfolio = tenantPortfolios.syncPositions(userId, positions);
    return {
      context: session,
      config: tenantConfigEngine.getEffectiveConfig(userId),
      portfolio,
      bots: runtime?.bots.snapshot() ?? [],
      stream: {
        enabled: Boolean(streamHealth?.enabled),
        status: streamHealth?.status ?? "stopped",
        symbols: session.symbols,
        lastError: (streamHealth?.details?.lastError as string | null | undefined) ?? null,
      },
    };
  }

  async allSnapshots() {
    return Promise.all(tenantSessions.all().map((session) => this.snapshot(session.userId)));
  }
}

const globalRuntime = globalThis as typeof globalThis & { __tenantRuntimeManager?: TenantRuntimeManager };
export const tenantRuntimeManager = globalRuntime.__tenantRuntimeManager ?? new TenantRuntimeManager();
globalRuntime.__tenantRuntimeManager = tenantRuntimeManager;
