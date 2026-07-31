import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { dynamicPositionSizingEngine } from "@/src/server/trading-core/dynamic-position-sizing";
import type { DynamicPositionSizingInput } from "@/src/server/trading-core/dynamic-position-sizing";

const marketRegimeSchema = z.object({
  symbol: z.string().min(3),
  regime: z.enum(["TRENDING_BULLISH", "TRENDING_BEARISH", "SIDEWAYS", "HIGH_VOLATILITY", "LOW_VOLATILITY", "MANIPULATION_ZONE"]),
  trendDirection: z.enum(["BULLISH", "BEARISH", "SIDEWAYS"]),
  strategyMode: z.enum(["SCALPING", "TREND", "BREAKOUT", "DEFENSIVE", "DISABLED"]),
  tradeAllowed: z.boolean(),
  confidence: z.number().min(0).max(100),
  reasons: z.array(z.string()).default([]),
  metrics: z.object({
    volatilityPercent: z.number(),
    trendStrength: z.number(),
    rangePercent: z.number(),
    volumeRatio: z.number(),
    wickAnomalyScore: z.number(),
  }),
  detectedAt: z.string(),
});

const botMetricsSchema = z.object({
  botId: z.string(),
  tradeCount: z.number(),
  wins: z.number(),
  losses: z.number(),
  winrate: z.number(),
  averagePnl: z.number(),
  totalPnl: z.number(),
  maxDrawdown: z.number(),
  sharpeRatio: z.number(),
  expectancy: z.number(),
  profitFactor: z.number(),
  avgTradeDurationMs: z.number(),
  strategyConsistency: z.number(),
  botScore: z.number(),
  adaptiveWeight: z.number(),
  poorPerformance: z.boolean(),
  flags: z.array(z.string()).default([]),
  updatedAt: z.string(),
});

const heatmapSchema = z.object({
  symbol: z.string(),
  markPrice: z.number(),
  clusters: z.array(z.object({
    side: z.enum(["LONG", "SHORT"]),
    minPrice: z.number(),
    maxPrice: z.number(),
    centerPrice: z.number(),
    distancePercent: z.number(),
    totalNotionalUsd: z.number(),
    levelCount: z.number(),
    averageLeverage: z.number(),
    intensityScore: z.number(),
  })).default([]),
  stopHuntZones: z.array(z.unknown()).default([]),
  leverageZones: z.array(z.unknown()).default([]),
  openInterestSpikeScore: z.number(),
  fundingExtremeScore: z.number(),
  squeezeDirection: z.enum(["UP", "DOWN", "BOTH", "NONE"]),
  squeezeScore: z.number(),
  manipulationRiskScore: z.number(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  highRiskAreas: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  analyzedAt: z.string(),
});

const schema = z.object({
  symbol: z.string().min(3),
  side: z.enum(["BUY", "SELL"]),
  accountEquity: z.number().positive(),
  requestedNotional: z.number().positive().optional(),
  confidenceScore: z.number().min(0).max(100),
  volatilityPercent: z.number().min(0),
  drawdownPercent: z.number().min(0),
  liquidationDistancePercent: z.number().min(0).optional(),
  leverage: z.number().min(1).optional(),
  strategy: z.string().optional(),
  strategySuccessRate: z.number().min(0).max(100).optional(),
  botMetrics: botMetricsSchema.nullable().optional(),
  marketRegime: marketRegimeSchema.nullable().optional(),
  liquidationHeatmap: heatmapSchema.nullable().optional(),
  config: z.record(z.string(), z.number()).optional(),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const parsed = schema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Dynamic position sizing payload gecersiz." : "Invalid dynamic position sizing payload.", 400);
    return apiOkFromRequest(request, dynamicPositionSizingEngine.calculate(parsed.data as DynamicPositionSizingInput));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
