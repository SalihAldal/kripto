import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { signalFusionEngine } from "@/src/server/trading-core/signal-fusion";
import type { SignalFusionInput } from "@/src/server/trading-core/signal-fusion";

const sideSchema = z.enum(["BUY", "SELL", "HOLD"]);
const indicatorSchema = z.object({
  rsi: z.number().optional(),
  emaFast: z.number().optional(),
  emaSlow: z.number().optional(),
  macd: z.object({ macd: z.number(), signal: z.number(), histogram: z.number() }).optional(),
  volumeSpike: z.object({
    ratio: z.number(),
    isSpike: z.boolean(),
    currentVolume: z.number(),
    averageVolume: z.number(),
  }).optional(),
});

const technicalSchema = z.object({
  symbol: z.string().min(3),
  side: sideSchema,
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(100),
  strategySignals: z.array(z.object({
    strategy: z.string(),
    symbol: z.string(),
    side: sideSchema,
    score: z.number().min(0).max(100),
    confidence: z.number().min(0).max(100),
    reasons: z.array(z.string()),
    indicators: indicatorSchema,
    generatedAt: z.string(),
  })).default([]),
  reasons: z.array(z.string()).default([]),
  generatedAt: z.string().optional().default(() => new Date().toISOString()),
  output: z.literal("json").optional().default("json"),
});

const aiSchema = z.object({
  symbol: z.string(),
  trade_confidence_score: z.number().min(0).max(100),
  passed: z.boolean(),
  market_regime: z.string(),
  trend_direction: z.string(),
  risk_level: z.string(),
  model_name: z.string(),
  reasons: z.array(z.string()),
  engineered_features: z.record(z.string(), z.number()).default({}),
});

const schema = z.object({
  symbol: z.string().min(3),
  technical: technicalSchema.optional(),
  ai: aiSchema.nullable().optional(),
  volume: z.object({ side: sideSchema, volumeRatio: z.number().min(0), confidence: z.number().min(0).max(100) }).optional(),
  orderbook: z.object({
    side: sideSchema,
    imbalancePercent: z.number(),
    bidAskSpreadPercent: z.number().min(0),
    confidence: z.number().min(0).max(100),
  }).optional(),
  funding: z.object({ fundingRatePercent: z.number(), confidence: z.number().min(0).max(100).optional() }).optional(),
  liquidationHeatmap: z.object({
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
  }).nullable().optional(),
  marketRegime: z.object({
    regime: z.string(),
    trendDirection: z.string(),
    strategyMode: z.string(),
    tradeAllowed: z.boolean(),
    confidence: z.number().min(0).max(100),
    reasons: z.array(z.string()).default([]),
    metrics: z.record(z.string(), z.number()).default({}),
    detectedAt: z.string(),
  }).nullable().optional(),
  providerConsensus: z.object({
    symbol: z.string(),
    side: sideSchema,
    confidence: z.number().min(0).max(100),
    score: z.number().min(0).max(100),
    selectedProviderId: z.string().optional(),
    providerSignals: z.array(z.unknown()).default([]),
    reasons: z.array(z.string()).default([]),
    generatedAt: z.string(),
  }).nullable().optional(),
  weights: z.record(z.string(), z.number()).optional(),
  minConfidence: z.number().min(0).max(100).optional(),
  conflictThreshold: z.number().min(0).max(100).optional(),
  noiseThreshold: z.number().min(0).max(100).optional(),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const parsed = schema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Signal fusion payload gecersiz." : "Invalid signal fusion payload.", 400);
    return apiOkFromRequest(request, signalFusionEngine.fuse(parsed.data as SignalFusionInput));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
