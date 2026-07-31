import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { selfLearningEngine } from "@/src/server/trading-core/self-learning";

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

const edgeConditionSchema = z.object({
  type: z.enum([
    "VOLATILITY_PATTERN",
    "LIQUIDATION_EVENT",
    "BREAKOUT_SUCCESS",
    "FAKE_BREAKOUT",
    "FUNDING_EXTREME",
    "VOLUME_ANOMALY",
    "WHALE_ACTIVITY",
    "ORDERBOOK_IMBALANCE",
    "MARKET_INEFFICIENCY",
  ]),
  label: z.string(),
  sampleSize: z.number(),
  winrate: z.number(),
  averageReturnPercent: z.number(),
  edgeScore: z.number(),
  confidence: z.number(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "EXTREME"]),
  reasons: z.array(z.string()).default([]),
});

const schema = z.object({
  apply: z.boolean().optional(),
  trade: z.object({
    tradeId: z.string().min(1),
    botId: z.string().min(1),
    strategy: z.string().min(1),
    symbol: z.string().min(3),
    side: z.enum(["BUY", "SELL"]),
    realizedPnl: z.number(),
    returnPercent: z.number(),
    entryPrice: z.number().positive().optional(),
    exitPrice: z.number().positive().optional(),
    maxDurationSec: z.number().positive().optional(),
    targetProfitPercent: z.number().positive().optional(),
    stopLossPercent: z.number().positive().optional(),
    qualityScore: z.number().optional(),
    marketRegime: z.string().optional(),
    indicators: indicatorSchema.optional(),
    reasons: z.array(z.string()).optional(),
    edgeConditions: z.array(edgeConditionSchema).optional(),
    openedAt: z.string().optional(),
    closedAt: z.string().optional(),
  }),
});

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    return apiOkFromRequest(request, await selfLearningEngine.snapshot());
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
    if (!parsed.success) return apiError(tr ? "Self-learning payload gecersiz." : "Invalid self-learning payload.", 400);
    if (parsed.data.apply) {
      const confirmed = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"], requireConfirmation: true });
      if (!confirmed.ok) return confirmed.response;
    }
    return apiOkFromRequest(request, await selfLearningEngine.learn(parsed.data.trade, Boolean(parsed.data.apply)));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
