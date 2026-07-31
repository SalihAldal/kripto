import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { noTradeZoneEngine } from "@/src/server/trading-core/no-trade-zone";
import type { NoTradeZoneInput } from "@/src/server/trading-core/no-trade-zone";

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

const heatmapSchema = z.object({
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

const qualitySchema = z.object({
  symbol: z.string(),
  side: z.enum(["BUY", "SELL"]),
  action: z.enum(["ALLOW", "REDUCE_SIZE", "BLOCK"]),
  allowed: z.boolean(),
  qualityLevel: z.enum(["A", "B", "C", "D", "F"]),
  qualityScore: z.number(),
  probabilityScore: z.number(),
  riskRewardRatio: z.number(),
  filters: z.array(z.object({
    type: z.enum(["LOW_VOLUME", "WEAK_BREAKOUT", "BAD_RISK_REWARD", "FUNDING_EXTREME", "NEWS_SPIKE", "MANIPULATION_RISK", "WIDE_SPREAD", "LOW_LIQUIDITY"]),
    passed: z.boolean(),
    score: z.number(),
    severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
    reason: z.string(),
  })).default([]),
  blockedReasons: z.array(z.string()).default([]),
  sizeMultiplier: z.number(),
  generatedAt: z.string(),
});

const schema = z.object({
  symbol: z.string().min(3),
  marketRegime: marketRegimeSchema.nullable().optional(),
  liquidationHeatmap: heatmapSchema.nullable().optional(),
  tradeQuality: qualitySchema.nullable().optional(),
  spreadPercent: z.number().min(0).optional(),
  volumeRatio: z.number().min(0).optional(),
  liquidityUsd: z.number().min(0).optional(),
  volatilityPercent: z.number().min(0).optional(),
  newsRiskScore: z.number().min(0).max(100).optional(),
  fakeBreakoutScore: z.number().min(0).max(100).optional(),
  pauseBots: z.boolean().optional(),
  apply: z.boolean().optional(),
  blockTtlMs: z.number().positive().optional(),
  botPauseTtlMs: z.number().positive().optional(),
  targetBotIds: z.array(z.string().min(2)).optional(),
});

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    return apiOkFromRequest(request, noTradeZoneEngine.status());
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const parsed = schema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "No-trade zone payload gecersiz." : "Invalid no-trade zone payload.", 400);
    if (parsed.data.apply) {
      const confirmed = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"], requireConfirmation: true });
      if (!confirmed.ok) return confirmed.response;
    }
    return apiOkFromRequest(request, noTradeZoneEngine.detect(parsed.data as NoTradeZoneInput));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
