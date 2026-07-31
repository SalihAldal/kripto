import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { botBehaviorEngine, botBehaviorRegistry } from "@/src/server/trading-core/bot-behavior";
import type { SignalDecision } from "@/src/server/trading-core/core/types";

const behaviorProfileSchema = z.object({
  botId: z.string().min(2),
  name: z.string().min(2),
  behaviorType: z.enum(["SCALPER", "SWING", "DCA", "TREND", "BREAKOUT"]),
  riskAppetite: z.enum(["LOW", "MEDIUM", "HIGH"]),
  tradePace: z.enum(["FAST", "NORMAL", "SLOW"]),
  preferredRegimes: z.array(z.string()).min(1),
  preferredVolatilityPercent: z.object({ min: z.number().min(0), max: z.number().min(0) }),
  takeProfitPercent: z.number().min(0),
  stopLossPercent: z.number().min(0),
  trailingEnabled: z.boolean(),
  partialTakeProfitPercent: z.number().min(0),
  maxHoldMinutes: z.number().positive(),
  entryAggression: z.number().min(0).max(100),
  positionSizeMultiplier: z.number().positive(),
  minSignalScore: z.number().min(0).max(100),
  minConfidence: z.number().min(0).max(100),
  dca: z.object({
    enabled: z.boolean(),
    maxAdds: z.number().int().min(1).max(20),
    stepPercent: z.number().positive(),
    sizeMultiplier: z.number().positive(),
    volatilityMultiplier: z.number().min(0),
  }).optional(),
  notes: z.array(z.string()).default([]),
});

const decisionSchema = z.object({
  symbol: z.string().min(3),
  side: z.enum(["BUY", "SELL"]),
  botId: z.string().optional(),
  botName: z.string().optional(),
  strategy: z.string().optional(),
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(100),
  currentPrice: z.number().positive().optional(),
  volatilityPercent: z.number().min(0).optional(),
  marketRegime: z.string().optional(),
});

const requestSchema = z.union([
  z.object({ action: z.literal("upsertProfile"), profile: behaviorProfileSchema }),
  z.object({ action: z.literal("decide"), context: decisionSchema }),
]);

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    return apiOkFromRequest(request, {
      profiles: botBehaviorEngine.profiles(),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const parsed = requestSchema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Bot behavior payload gecersiz." : "Invalid bot behavior payload.", 400);

    if (parsed.data.action === "upsertProfile") {
      return apiOkFromRequest(request, botBehaviorRegistry.upsert(parsed.data.profile));
    }

    const context = parsed.data.context;
    const signal: SignalDecision = {
      symbol: context.symbol.toUpperCase(),
      side: context.side,
      score: context.score,
      confidence: context.confidence,
      strategySignals: [],
      botAllocation: context.botId
        ? {
            botId: context.botId,
            botName: context.botName ?? context.botId,
            strategy: context.strategy ?? "custom",
            priority: 50,
            weight: 1,
            score: context.score,
            reason: "Manual behavior decision context",
          }
        : null,
      marketRegime: context.marketRegime
        ? {
            regime: context.marketRegime,
            trendDirection: "SIDEWAYS",
            strategyMode: "CUSTOM",
            tradeAllowed: true,
            confidence: context.confidence,
            reasons: ["Manual behavior API context"],
            metrics: { volatilityPercent: context.volatilityPercent ?? 0 },
            detectedAt: new Date().toISOString(),
          }
        : undefined,
      reasons: ["Manual behavior decision request"],
      generatedAt: new Date().toISOString(),
      output: "json",
    };
    return apiOkFromRequest(request, botBehaviorEngine.decide({
      symbol: context.symbol,
      side: context.side,
      signal,
      botAllocation: signal.botAllocation,
      currentPrice: context.currentPrice,
      volatilityPercent: context.volatilityPercent,
    }));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
