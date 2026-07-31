import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { marketEdgeDiscoveryEngine } from "@/src/server/trading-core/market-edge";
import type { MarketEdgeDiscoveryRequest } from "@/src/server/trading-core/market-edge";

const candleSchema = z.object({
  symbol: z.string().min(3),
  openTime: z.number(),
  closeTime: z.number(),
  open: z.number().positive(),
  high: z.number().positive(),
  low: z.number().positive(),
  close: z.number().positive(),
  volume: z.number().nonnegative(),
});

const tradeSchema = z.object({
  id: z.string().min(1),
  strategy: z.string().min(1),
  symbol: z.string().min(3),
  side: z.enum(["BUY", "SELL"]),
  entryTime: z.number(),
  exitTime: z.number(),
  entryPrice: z.number().positive(),
  exitPrice: z.number().positive(),
  quantity: z.number().positive(),
  notional: z.number().nonnegative(),
  fee: z.number().nonnegative(),
  slippage: z.number().nonnegative(),
  grossPnl: z.number(),
  netPnl: z.number(),
  returnPercent: z.number(),
  exitReason: z.enum(["TAKE_PROFIT", "STOP_LOSS", "REVERSE_SIGNAL", "END_OF_DATA"]),
});

const sampleSchema = z.object({
  symbol: z.string().min(3),
  timestamp: z.number(),
  volatilityPercent: z.number().optional(),
  fundingRatePercent: z.number().optional(),
  volumeRatio: z.number().optional(),
  orderbookImbalancePercent: z.number().optional(),
  whaleNotionalUsd: z.number().optional(),
  breakoutDirection: z.enum(["UP", "DOWN", "NONE"]).optional(),
  breakoutSucceeded: z.boolean().optional(),
  fakeBreakout: z.boolean().optional(),
  regime: z.enum(["TRENDING_BULLISH", "TRENDING_BEARISH", "SIDEWAYS", "HIGH_VOLATILITY", "LOW_VOLATILITY", "MANIPULATION_ZONE"]).optional(),
  strategy: z.string().optional(),
  returnPercent: z.number().optional(),
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
  symbols: z.array(z.string().min(3)).optional(),
  trades: z.array(tradeSchema).optional(),
  marketData: z.array(z.object({ symbol: z.string().min(3), candles: z.array(candleSchema) })).optional(),
  samples: z.array(sampleSchema).optional(),
  liquidationHeatmaps: z.array(heatmapSchema).optional(),
  minSamples: z.number().int().min(1).optional(),
  strategies: z.array(z.string().min(1)).optional(),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const parsed = schema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Market edge payload gecersiz." : "Invalid market edge payload.", 400);
    return apiOkFromRequest(request, marketEdgeDiscoveryEngine.discover(parsed.data as MarketEdgeDiscoveryRequest));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
