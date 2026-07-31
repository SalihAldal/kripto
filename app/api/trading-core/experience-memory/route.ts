import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { experienceMemoryEngine } from "@/src/server/trading-core/experience-memory";

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

const liquidationSchema = z.object({
  squeezeDirection: z.enum(["UP", "DOWN", "BOTH", "NONE"]),
  squeezeScore: z.number(),
  manipulationRiskScore: z.number(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
}).nullable().optional();

const entrySchema = z.object({
  strategy: z.string().min(1),
  botId: z.string().optional(),
  side: z.enum(["BUY", "SELL"]),
  confidenceScore: z.number().optional(),
  entryPrice: z.number().optional(),
  indicators: indicatorSchema.optional(),
});

const marketSchema = z.object({
  symbol: z.string().min(3),
  marketRegime: z.string().optional(),
  volumeRatio: z.number().optional(),
  fundingRatePercent: z.number().optional(),
  volatilityPercent: z.number().optional(),
  orderbookImbalancePercent: z.number().optional(),
  spreadPercent: z.number().optional(),
  liquidityUsd: z.number().optional(),
  liquidation: liquidationSchema,
});

const rememberSchema = z.object({
  action: z.literal("remember"),
  experience: z.object({
    tradeId: z.string().min(1),
    entry: entrySchema,
    market: marketSchema,
    pnlResult: z.number(),
    returnPercent: z.number(),
    tradeDurationMs: z.number().nonnegative().optional(),
    notes: z.array(z.string()).default([]),
  }),
});

const recallSchema = z.object({
  action: z.literal("recall"),
  query: z.object({
    entry: entrySchema,
    market: marketSchema,
    minSimilarityScore: z.number().min(0).max(100).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
});

const schema = z.discriminatedUnion("action", [rememberSchema, recallSchema]);

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    return apiOkFromRequest(request, experienceMemoryEngine.snapshot());
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
    if (!parsed.success) return apiError(tr ? "Experience memory payload gecersiz." : "Invalid experience memory payload.", 400);
    const result = parsed.data.action === "remember" ? experienceMemoryEngine.remember(parsed.data.experience) : experienceMemoryEngine.recall(parsed.data.query);
    return apiOkFromRequest(request, result);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
