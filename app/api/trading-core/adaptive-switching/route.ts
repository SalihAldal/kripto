import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { adaptiveSwitchingEngine } from "@/src/server/trading-core/adaptive-switching";

const regimeSchema = z.object({
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

const schema = z.object({
  symbol: z.string().min(3),
  marketRegime: regimeSchema,
  apply: z.boolean().optional(),
  cooldownMs: z.number().positive().optional(),
  minRegimeConfidence: z.number().min(0).max(100).optional(),
  disablePoorStrategies: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    return apiOkFromRequest(request, adaptiveSwitchingEngine.status());
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
    if (!parsed.success) return apiError(tr ? "Adaptive switching payload gecersiz." : "Invalid adaptive switching payload.", 400);
    if (parsed.data.apply) {
      const confirmed = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"], requireConfirmation: true });
      if (!confirmed.ok) return confirmed.response;
    }
    return apiOkFromRequest(request, adaptiveSwitchingEngine.plan(parsed.data));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
