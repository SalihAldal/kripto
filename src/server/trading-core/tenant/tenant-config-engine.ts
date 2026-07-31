import { tradingConfig } from "@/src/server/trading-core/config";
import type { TradingRuntimeConfig, UserTradingConfig } from "@/src/server/trading-core/config";

export class TenantConfigEngine {
  getEffectiveConfig(userId: string): TradingRuntimeConfig {
    return tradingConfig.effectiveForUser(userId);
  }

  updateUserConfig(userId: string, patch: UserTradingConfig) {
    return tradingConfig.updateUser(userId, patch);
  }

  symbolsForUser(userId: string) {
    return this.getEffectiveConfig(userId).coinWhitelist.map((symbol) => symbol.toUpperCase());
  }
}

export const tenantConfigEngine = new TenantConfigEngine();
