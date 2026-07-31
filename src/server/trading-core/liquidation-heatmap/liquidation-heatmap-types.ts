export type LiquidationSide = "LONG" | "SHORT";
export type HeatmapRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type SqueezeDirection = "UP" | "DOWN" | "BOTH" | "NONE";

export type LiquidationLevel = {
  price: number;
  notionalUsd: number;
  side: LiquidationSide;
  leverage?: number;
};

export type OpenInterestPoint = {
  timestamp: number;
  openInterestUsd: number;
};

export type FundingPoint = {
  timestamp: number;
  fundingRatePercent: number;
};

export type LiquidationHeatmapInput = {
  symbol: string;
  markPrice: number;
  liquidationLevels: LiquidationLevel[];
  openInterest?: OpenInterestPoint[];
  fundingRates?: FundingPoint[];
  volatilityPercent?: number;
  receivedAt?: string;
};

export type LiquidationCluster = {
  side: LiquidationSide;
  minPrice: number;
  maxPrice: number;
  centerPrice: number;
  distancePercent: number;
  totalNotionalUsd: number;
  levelCount: number;
  averageLeverage: number;
  intensityScore: number;
};

export type StopHuntZone = {
  side: LiquidationSide;
  price: number;
  distancePercent: number;
  notionalUsd: number;
  probabilityScore: number;
  reason: string;
};

export type LeverageZone = {
  leverage: number;
  side: LiquidationSide;
  notionalUsd: number;
  pressureScore: number;
};

export type LiquidationHeatmapAnalysis = {
  symbol: string;
  markPrice: number;
  clusters: LiquidationCluster[];
  stopHuntZones: StopHuntZone[];
  leverageZones: LeverageZone[];
  openInterestSpikeScore: number;
  fundingExtremeScore: number;
  squeezeDirection: SqueezeDirection;
  squeezeScore: number;
  manipulationRiskScore: number;
  riskLevel: HeatmapRiskLevel;
  highRiskAreas: string[];
  warnings: string[];
  analyzedAt: string;
};
