import type { ModuleHealth, TradingModule } from "@/src/server/trading-core/core/types";
import { HighFrequencyWriteBuffer } from "@/src/server/trading-core/database/architecture/write-buffer";
import { TradingCoreCache } from "@/src/server/trading-core/database/architecture/redis-cache";
import { TradingCorePubSub } from "@/src/server/trading-core/database/architecture/redis-pubsub";
import { TradingCoreRepository } from "@/src/server/trading-core/database/architecture/trading-core-repository";

export class TradingCoreDatabaseArchitecture implements TradingModule {
  readonly name = "trading-core-database-architecture";
  readonly enabled = true;
  readonly repository = new TradingCoreRepository();
  readonly cache = new TradingCoreCache();
  readonly pubsub = new TradingCorePubSub();
  readonly writeBuffer = new HighFrequencyWriteBuffer();

  async start() {
    this.writeBuffer.start();
  }

  async stop() {
    this.writeBuffer.stop();
    await this.writeBuffer.flush();
  }

  async health(): Promise<ModuleHealth> {
    return {
      name: this.name,
      enabled: this.enabled,
      status: "healthy",
      details: {
        writeBuffer: this.writeBuffer.stats(),
        cache: "redis-with-memory-fallback",
        websocketScaling: "redis-pubsub-channel-per-stream",
        eventSourcing: "trading_core.events",
      },
      checkedAt: new Date().toISOString(),
    };
  }
}
