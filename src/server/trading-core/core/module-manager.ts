import { logger } from "@/lib/logger";
import type { TradingModule } from "@/src/server/trading-core/core/types";
import { TradingCoreEventBus } from "@/src/server/trading-core/core/event-bus";

export class ModuleManager {
  private readonly modules: TradingModule[] = [];

  constructor(private readonly events: TradingCoreEventBus) {}

  register(tradingModule: TradingModule) {
    this.modules.push(tradingModule);
  }

  async startAll() {
    for (const tradingModule of this.modules) {
      if (!tradingModule.enabled || !tradingModule.start) continue;
      try {
        await tradingModule.start();
        this.events.emit("module.started", { module: tradingModule.name });
      } catch (error) {
        logger.warn({ module: tradingModule.name, error: (error as Error).message }, "Trading core module failed to start");
        this.events.emit("module.failed", { module: tradingModule.name, error: (error as Error).message });
      }
    }
  }

  async stopAll() {
    for (const tradingModule of [...this.modules].reverse()) {
      if (!tradingModule.stop) continue;
      try {
        await tradingModule.stop();
      } catch (error) {
        logger.warn({ module: tradingModule.name, error: (error as Error).message }, "Trading core module failed to stop");
      }
    }
  }
}
