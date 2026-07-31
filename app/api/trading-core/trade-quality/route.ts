import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { tradeQualityEngine } from "@/src/server/trading-core/trade-quality";
import type { TradeQualityInput } from "@/src/server/trading-core/trade-quality";

const sideSchema = z.enum(["BUY", "SELL"]);

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

const liquidationHeatmapSchema = z.object({
  symbol: z.string(),
  markPrice: z.number(),
  clusters: z.array(z.unknown()).default([]),
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

const signalFusionSchema = z.object({
  symbol: z.string(),
  side: z.enum(["BUY", "SELL", "HOLD"]),
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(100),
  conflictScore: z.number(),
  noiseScore: z.number(),
  sourceScores: z.array(z.unknown()).default([]),
  filteredSources: z.array(z.unknown()).default([]),
  reasons: z.array(z.string()).default([]),
  generatedAt: z.string(),
  output: z.literal("json"),
});

const schema = z.object({
  symbol: z.string().min(3),
  side: sideSchema,
  entryPrice: z.number().positive().optional(),
  takeProfitPrice: z.number().positive().optional(),
  stopLossPrice: z.number().positive().optional(),
  volumeRatio: z.number().min(0).optional(),
  breakoutStrength: z.number().min(0).optional(),
  spreadPercent: z.number().min(0).optional(),
  liquidityUsd: z.number().min(0).optional(),
  fundingRatePercent: z.number().optional(),
  newsSpikeScore: z.number().min(0).max(100).optional(),
  orderbookDepthUsd: z.number().min(0).optional(),
  signalFusion: signalFusionSchema.nullable().optional(),
  marketRegime: marketRegimeSchema.nullable().optional(),
  liquidationHeatmap: liquidationHeatmapSchema.nullable().optional(),
  minQualityScore: z.number().min(0).max(100).optional(),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const parsed = schema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Trade quality payload gecersiz." : "Invalid trade quality payload.", 400);
    return apiOkFromRequest(request, tradeQualityEngine.evaluate(parsed.data as TradeQualityInput));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
