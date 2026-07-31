import type { PortfolioPositionInput } from "@/src/server/trading-core/portfolio";

export type CapitalRiskProfile = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
export type CapitalAllocationMode = "RISK_PARITY" | "PERFORMANCE_WEIGHTED" | "MANUAL_TARGET";

export type BotCapitalTarget = {
  botId: string;
  targetPercent: number;
};

export type CapitalAllocationConfig = {
  riskProfile: CapitalRiskProfile;
  mode: CapitalAllocationMode;
  maxBotAllocationPercent: number;
  maxRiskyBotAllocationPercent: number;
  maxTotalExposurePercent: number;
  hedgeAllocationPercent: number;
  minBotAllocationPercent: number;
  rebalanceThresholdPercent: number;
};

export type CapitalAllocationRequest = {
  userId?: string;
  totalCapitalUsd: number;
  riskProfile?: CapitalRiskProfile;
  mode?: CapitalAllocationMode;
  positions?: PortfolioPositionInput[];
  manualTargets?: BotCapitalTarget[];
  includeInactiveBots?: boolean;
};

export type BotCapitalAllocation = {
  botId: string;
  botName: string;
  strategyType: string;
  riskLevel: string;
  allocationPercent: number;
  allocationUsd: number;
  weight: number;
  maxExposureUsd: number;
  hedge: boolean;
  reasons: string[];
};

export type CapitalAllocationExposureCheck = {
  botId: string;
  currentExposureUsd: number;
  targetExposureUsd: number;
  exposurePercentOfCapital: number;
  status: "OK" | "REDUCE" | "BLOCK";
  reason: string;
};

export type CapitalAllocationPlan = {
  userId?: string;
  totalCapitalUsd: number;
  riskProfile: CapitalRiskProfile;
  mode: CapitalAllocationMode;
  allocations: BotCapitalAllocation[];
  hedgeAllocation: BotCapitalAllocation | null;
  exposureChecks: CapitalAllocationExposureCheck[];
  summary: {
    allocatedPercent: number;
    allocatedUsd: number;
    hedgePercent: number;
    botCount: number;
    maxExposurePercent: number;
  };
  warnings: string[];
  generatedAt: string;
};
