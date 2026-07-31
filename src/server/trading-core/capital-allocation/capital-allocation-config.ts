import type { CapitalAllocationConfig, CapitalRiskProfile } from "@/src/server/trading-core/capital-allocation/capital-allocation-types";

function readNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export function getCapitalAllocationConfig(riskProfile: CapitalRiskProfile = "BALANCED"): CapitalAllocationConfig {
  const profileDefaults = {
    CONSERVATIVE: { maxBot: 28, risky: 14, exposure: 80, hedge: 15, min: 5 },
    BALANCED: { maxBot: 40, risky: 22, exposure: 110, hedge: 10, min: 5 },
    AGGRESSIVE: { maxBot: 55, risky: 35, exposure: 140, hedge: 7, min: 3 },
  }[riskProfile];

  return {
    riskProfile,
    mode: "RISK_PARITY",
    maxBotAllocationPercent: readNumber("TRADING_CAPITAL_MAX_BOT_ALLOCATION_PERCENT", profileDefaults.maxBot),
    maxRiskyBotAllocationPercent: readNumber("TRADING_CAPITAL_MAX_RISKY_BOT_ALLOCATION_PERCENT", profileDefaults.risky),
    maxTotalExposurePercent: readNumber("TRADING_CAPITAL_MAX_TOTAL_EXPOSURE_PERCENT", profileDefaults.exposure),
    hedgeAllocationPercent: readNumber("TRADING_CAPITAL_HEDGE_ALLOCATION_PERCENT", profileDefaults.hedge),
    minBotAllocationPercent: readNumber("TRADING_CAPITAL_MIN_BOT_ALLOCATION_PERCENT", profileDefaults.min),
    rebalanceThresholdPercent: readNumber("TRADING_CAPITAL_REBALANCE_THRESHOLD_PERCENT", 5),
  };
}
