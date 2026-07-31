import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { feedbackLoopEngine } from "@/src/server/trading-core/feedback-loop";
import type { FeedbackCloseTradeInput, FeedbackOpenTradeInput, FeedbackRejectTradeInput } from "@/src/server/trading-core/feedback-loop";

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

const marketSchema = z.object({
  marketRegime: z.string().optional(),
  volatilityPercent: z.number().optional(),
  fundingRatePercent: z.number().optional(),
  orderbookImbalancePercent: z.number().optional(),
  spreadPercent: z.number().optional(),
  volumeRatio: z.number().optional(),
  liquidityUsd: z.number().optional(),
  newsSpikeScore: z.number().optional(),
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
  filters: z.array(z.unknown()).default([]),
  blockedReasons: z.array(z.string()).default([]),
  sizeMultiplier: z.number(),
  generatedAt: z.string(),
});

const sizingSchema = z.object({
  symbol: z.string(),
  side: z.enum(["BUY", "SELL"]),
  allowed: z.boolean(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "BLOCKED"]),
  baseNotional: z.number(),
  requestedNotional: z.number(),
  adjustedNotional: z.number(),
  positionSizePercent: z.number(),
  leverage: z.number(),
  factors: z.array(z.unknown()).default([]),
  reasons: z.array(z.string()).default([]),
  generatedAt: z.string(),
});

const openSchema = z.object({
  action: z.literal("open"),
  trade: z.object({
    tradeId: z.string().min(1),
    botId: z.string().min(1),
    strategy: z.string().min(1),
    symbol: z.string().min(3),
    side: z.enum(["BUY", "SELL"]),
    entryPrice: z.number().positive(),
    quantity: z.number().positive(),
    openedAt: z.string().optional(),
    market: marketSchema,
    strategySnapshot: z.object({
      strategy: z.string().min(1),
      params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
      minScore: z.number().optional(),
      confidenceScore: z.number().optional(),
      indicators: indicatorSchema.optional(),
      edgeConditions: z.array(edgeConditionSchema).optional(),
    }),
    tradeQuality: qualitySchema.optional(),
    sizing: sizingSchema.optional(),
  }),
});

const closeSchema = z.object({
  action: z.literal("close"),
  trade: z.object({
    tradeId: z.string().min(1),
    exitPrice: z.number().positive(),
    realizedPnl: z.number(),
    returnPercent: z.number(),
    closedAt: z.string().optional(),
    exitReason: z.string().optional(),
    applyLearning: z.boolean().optional(),
  }),
});

const rejectSchema = openSchema.extend({
  action: z.literal("reject"),
  trade: openSchema.shape.trade.extend({
    entryPrice: z.number().nonnegative(),
    quantity: z.number().nonnegative(),
    rejectReason: z.string().min(1),
    rejectedAt: z.string().optional(),
    confidenceScore: z.number().optional(),
  }),
});

const schema = z.discriminatedUnion("action", [openSchema, closeSchema, rejectSchema]);

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    return apiOkFromRequest(request, feedbackLoopEngine.snapshot());
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
    if (!parsed.success) return apiError(tr ? "Feedback loop payload gecersiz." : "Invalid feedback loop payload.", 400);
    if (parsed.data.action === "close" && parsed.data.trade.applyLearning) {
      const confirmed = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"], requireConfirmation: true });
      if (!confirmed.ok) return confirmed.response;
    }
    const result =
      parsed.data.action === "open"
        ? feedbackLoopEngine.openTrade(parsed.data.trade as FeedbackOpenTradeInput)
        : parsed.data.action === "reject"
          ? await feedbackLoopEngine.rejectTrade(parsed.data.trade as FeedbackRejectTradeInput)
          : await feedbackLoopEngine.closeTrade(parsed.data.trade as FeedbackCloseTradeInput);
    return apiOkFromRequest(request, result);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
