import { resolveRegimePipelinePolicy } from "@/src/server/scanner/regime-intelligence.service";
import { PortfolioCorrelationAnalyzer } from "@/src/server/trading-core/portfolio/portfolio-correlation-analyzer";
import { smartPortfolioManager } from "@/src/server/trading-core/portfolio/portfolio-manager";
import type { PortfolioPositionInput } from "@/src/server/trading-core/portfolio/portfolio-types";

export type PortfolioAllocationTelemetry = {
  availableCapital: number;
  capitalUtilized: number;
  positionSize: number;
  portfolioExposure: number;
  assetCorrelationGroup: string;
  assetCorrelationScore: number;
  sectorExposure: number;
  riskBudget: number;
  expectedValue: number;
  aiConfidence: number;
  opportunityScore: number;
  portfolioConcentration: number;
  capitalEfficiency: number;
  allocationMultiplier: number;
  confidenceWeight: number;
  expectedValueWeight: number;
  opportunityWeight: number;
  correlationFactor: number;
  diversificationFactor: number;
  regimeAllocationFactor: number;
  portfolioAction: string;
  portfolioBlocked: boolean;
};

export type PortfolioAllocationPolicy = {
  allowed: boolean;
  allocationMultiplier: number;
  adjustedNotional: number;
  portfolioAction: string;
  portfolioBlocked: boolean;
  telemetry: PortfolioAllocationTelemetry;
};

export type PortfolioAllocationAggregateKpis = {
  tradeCount: number;
  averageCapitalUtilization: number;
  averagePortfolioExposure: number;
  averageConcentration: number;
  averageAllocationMultiplier: number;
  portfolioBlockedRate: number;
  capitalEfficiency: number;
  profitFactor?: number;
  sharpeRatio?: number;
  sortinoRatio?: number;
  maxDrawdown?: number;
  portfolioStability?: number;
};

const correlationAnalyzer = new PortfolioCorrelationAnalyzer();

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals = 4) {
  return Number(value.toFixed(decimals));
}

function baseAsset(symbol: string) {
  return symbol.toUpperCase().replace(/(USDT|USDC|FDUSD|TRY|BTC|ETH)$/u, "");
}

function correlationGroupForSymbol(symbol: string) {
  const base = baseAsset(symbol);
  const groups: Record<string, string[]> = {
    majors: ["BTC", "ETH", "BNB", "SOL", "AVAX", "MATIC", "ARB", "OP", "LINK"],
    memes: ["DOGE", "SHIB", "PEPE", "FLOKI"],
    layer1: ["XRP", "ADA", "DOT", "ATOM", "NEAR", "INJ"],
  };
  for (const [group, assets] of Object.entries(groups)) {
    if (assets.includes(base)) return group;
  }
  return `single:${base}`;
}

export function resolveOpportunityAllocationWeights(input: {
  confidencePercent: number;
  expectedProfitPercent: number;
  rankingScore: number;
  aiRiskScore: number;
}) {
  const elite = input.confidencePercent >= 82 && input.aiRiskScore <= 50;
  const confidenceWeight = elite ? 1.06 : clamp(input.confidencePercent / 72, 0.86, 1.05);
  const expectedValueWeight = clamp(0.92 + input.expectedProfitPercent / 2.5, 0.9, 1.08);
  const opportunityWeight = clamp(input.rankingScore / 62, 0.88, 1.06);
  const weight = round(confidenceWeight * expectedValueWeight * opportunityWeight, 4);
  return {
    weight: clamp(weight, 0.82, 1.12),
    confidenceWeight: round(confidenceWeight, 4),
    expectedValueWeight: round(expectedValueWeight, 4),
    opportunityWeight: round(opportunityWeight, 4),
  };
}

export function resolveCorrelationAllocationFactor(input: {
  symbol: string;
  openPositions: PortfolioPositionInput[];
  accountEquity: number;
  requestedNotional: number;
}) {
  if (input.accountEquity <= 0) {
    return { factor: 1, group: correlationGroupForSymbol(input.symbol), concentration: 0, sectorExposure: 0 };
  }
  const group = correlationGroupForSymbol(input.symbol);
  const correlationExposure = correlationAnalyzer.analyze(input.openPositions, input.accountEquity);
  const groupExposure =
    correlationExposure.find((row) => row.group === group)?.exposurePercent ??
    correlationExposure.find((row) => row.symbols.some((s) => s.startsWith(baseAsset(input.symbol))))?.exposurePercent ??
    0;
  const projected = groupExposure + (input.requestedNotional / input.accountEquity) * 100;
  const concentration = round(projected, 4);
  let factor = 1;
  if (projected >= 35) factor = 0.55;
  else if (projected >= 25) factor = 0.72;
  else if (projected >= 18) factor = 0.85;
  else if (projected <= 8 && input.openPositions.length >= 2) factor = 1.03;
  return {
    factor: round(factor, 4),
    group,
    concentration,
    sectorExposure: round(groupExposure, 4),
  };
}

export function computeCapitalUtilization(input: {
  accountEquity: number;
  openPositions: PortfolioPositionInput[];
  requestedNotional: number;
}) {
  if (input.accountEquity <= 0) return { utilized: 0, available: 0, utilizationPercent: 0 };
  const utilized = input.openPositions.reduce(
    (sum, p) => sum + Math.abs(p.quantity * p.currentPrice),
    0,
  );
  const projected = utilized + input.requestedNotional;
  return {
    utilized: round(utilized, 4),
    available: round(Math.max(0, input.accountEquity - utilized), 4),
    utilizationPercent: round((projected / input.accountEquity) * 100, 4),
  };
}

export function resolvePortfolioAllocationPolicy(input: {
  accountEquity: number;
  openPositions: PortfolioPositionInput[];
  symbol: string;
  strategy: string;
  requestedNotional: number;
  confidencePercent: number;
  expectedProfitPercent: number;
  rankingScore: number;
  aiRiskScore: number;
  marketRegime: string;
  volatilityPercent?: number;
  liquidity24h?: number;
}): PortfolioAllocationPolicy {
  const utilization = computeCapitalUtilization({
    accountEquity: input.accountEquity,
    openPositions: input.openPositions,
    requestedNotional: input.requestedNotional,
  });
  const portfolioAnalysis = smartPortfolioManager.analyze({
    accountEquity: input.accountEquity,
    positions: input.openPositions,
    intent: {
      symbol: input.symbol,
      side: "BUY",
      requestedNotional: input.requestedNotional,
      strategy: input.strategy,
    },
  });
  const portfolioAction = portfolioAnalysis.decision?.action ?? "ALLOW";
  const portfolioBlocked = portfolioAction === "BLOCK";
  const opportunity = resolveOpportunityAllocationWeights({
    confidencePercent: input.confidencePercent,
    expectedProfitPercent: input.expectedProfitPercent,
    rankingScore: input.rankingScore,
    aiRiskScore: input.aiRiskScore,
  });
  const correlation = resolveCorrelationAllocationFactor({
    symbol: input.symbol,
    openPositions: input.openPositions,
    accountEquity: input.accountEquity,
    requestedNotional: input.requestedNotional,
  });
  const regimePolicy = resolveRegimePipelinePolicy({
    marketRegime: input.marketRegime,
    volatilityPercent: input.volatilityPercent,
    liquidity24h: input.liquidity24h,
  });
  const diversificationFactor =
    input.openPositions.length >= 3 && correlation.concentration <= 12 ? 1.02 : 1;
  const portfolioReduceFactor = portfolioAction === "REDUCE_SIZE" ? 0.5 : 1;
  const blockFactor = portfolioBlocked ? 0 : 1;
  const allocationMultiplier = round(
    clamp(
      opportunity.weight *
        correlation.factor *
        regimePolicy.sizingRegimeFactor *
        diversificationFactor *
        portfolioReduceFactor *
        blockFactor,
      0,
      1.12,
    ),
    4,
  );
  const adjustedNotional = round(input.requestedNotional * allocationMultiplier, 8);
  const riskBudget = round(input.requestedNotional * 0.01, 4);
  const telemetry: PortfolioAllocationTelemetry = {
    availableCapital: utilization.available,
    capitalUtilized: utilization.utilized,
    positionSize: adjustedNotional,
    portfolioExposure: utilization.utilizationPercent,
    assetCorrelationGroup: correlation.group,
    assetCorrelationScore: correlation.concentration,
    sectorExposure: correlation.sectorExposure,
    riskBudget,
    expectedValue: round(input.expectedProfitPercent, 4),
    aiConfidence: round(input.confidencePercent, 4),
    opportunityScore: round(input.rankingScore, 4),
    portfolioConcentration: correlation.concentration,
    capitalEfficiency:
      input.accountEquity > 0 ? round(adjustedNotional / input.accountEquity, 4) : 0,
    allocationMultiplier,
    confidenceWeight: opportunity.confidenceWeight,
    expectedValueWeight: opportunity.expectedValueWeight,
    opportunityWeight: opportunity.opportunityWeight,
    correlationFactor: correlation.factor,
    diversificationFactor,
    regimeAllocationFactor: regimePolicy.sizingRegimeFactor,
    portfolioAction,
    portfolioBlocked,
  };
  return {
    allowed: !portfolioBlocked && adjustedNotional > 0,
    allocationMultiplier,
    adjustedNotional,
    portfolioAction,
    portfolioBlocked,
    telemetry,
  };
}

export function aggregatePortfolioAllocationKpis(
  rows: PortfolioAllocationTelemetry[],
  pnls: number[] = [],
  initialEquity = 10_000,
) {
  if (!rows.length) {
    return {
      tradeCount: 0,
      averageCapitalUtilization: 0,
      averagePortfolioExposure: 0,
      averageConcentration: 0,
      averageAllocationMultiplier: 0,
      portfolioBlockedRate: 0,
      capitalEfficiency: 0,
    } satisfies PortfolioAllocationAggregateKpis;
  }
  const avg = (values: number[]) =>
    values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
  const blocked = rows.filter((r) => r.portfolioBlocked).length;
  let peak = initialEquity;
  let equity = initialEquity;
  let maxDrawdown = 0;
  for (const pnl of pnls) {
    equity += pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  const mean = pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0;
  const variance = pnls.length ? pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / pnls.length : 0;
  const sharpeRatio = variance > 0 ? round(mean / Math.sqrt(variance), 4) : 0;
  const downside = pnls.filter((p) => p < 0);
  const downsideVar = downside.length ? downside.reduce((s, p) => s + p ** 2, 0) / downside.length : 0;
  const sortinoRatio = downsideVar > 0 ? round(mean / Math.sqrt(downsideVar), 4) : sharpeRatio;
  const grossProfit = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0));
  const totalPnl = pnls.reduce((a, b) => a + b, 0);
  return {
    tradeCount: rows.length,
    averageCapitalUtilization: avg(rows.map((r) => r.portfolioExposure)),
    averagePortfolioExposure: avg(rows.map((r) => r.portfolioExposure)),
    averageConcentration: avg(rows.map((r) => r.portfolioConcentration)),
    averageAllocationMultiplier: avg(rows.map((r) => r.allocationMultiplier)),
    portfolioBlockedRate: round((blocked / rows.length) * 100, 2),
    capitalEfficiency: initialEquity > 0 ? round(totalPnl / initialEquity, 4) : 0,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 4) : grossProfit > 0 ? 999 : 0,
    sharpeRatio,
    sortinoRatio,
    maxDrawdown: round(maxDrawdown, 4),
    portfolioStability: round(
      clamp(100 - avg(rows.map((r) => r.portfolioConcentration)) * 1.4 - blocked * 5, 0, 100),
      2,
    ),
  } satisfies PortfolioAllocationAggregateKpis;
}
