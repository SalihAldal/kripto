import { clamp } from "@/src/server/trading-core/indicators/math";
import type { RiskEngineConfig } from "@/src/server/trading-core/risk-engine/risk-config";
import type { RiskLevel, RiskTradeInput } from "@/src/server/trading-core/risk-engine/risk-types";

export class PositionSizer {
  constructor(private readonly config: RiskEngineConfig) {}

  calculate(input: RiskTradeInput, level: RiskLevel) {
    if (level === "BLOCKED") return 0;
    const baseNotional = input.accountEquity * (this.config.baseRiskPerTradePercent / 100);
    const multiplier =
      level === "HIGH"
        ? this.config.highRiskSizeMultiplier
        : level === "MID"
          ? this.config.midRiskSizeMultiplier
          : this.config.lowRiskSizeMultiplier;
    const leverageAdjustedCap = baseNotional / Math.max(1, input.leverage * 0.35);
    const cap = Math.min(input.requestedNotional, leverageAdjustedCap * multiplier);
    return Number(clamp(cap, 0, input.requestedNotional).toFixed(8));
  }
}
