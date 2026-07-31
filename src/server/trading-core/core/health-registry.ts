import type { ModuleHealth, TradingModule } from "@/src/server/trading-core/core/types";

export class HealthRegistry {
  private readonly modules = new Map<string, TradingModule>();

  register(module: TradingModule) {
    this.modules.set(module.name, module);
  }

  async snapshot(): Promise<ModuleHealth[]> {
    const checks = Array.from(this.modules.values()).map(async (module) => module.health());
    return Promise.all(checks);
  }
}
