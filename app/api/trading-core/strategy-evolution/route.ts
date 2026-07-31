import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { strategyEvolutionEngine } from "@/src/server/trading-core/strategy-evolution";

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

const schema = z.object({
  strategy: z.string().min(1),
  marketData: z.array(z.object({ symbol: z.string().min(3), candles: z.array(candleSchema).min(40) })).min(1),
  initialBalance: z.number().positive(),
  futures: z.boolean(),
  allowShort: z.boolean(),
  positionSizePercent: z.number().positive(),
  maxCandidates: z.number().int().min(1).max(40).optional(),
  promote: z.boolean().optional(),
  requireOverfittingPass: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    return apiOkFromRequest(request, strategyEvolutionEngine.status());
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
    if (!parsed.success) return apiError(tr ? "Strategy evolution payload gecersiz." : "Invalid strategy evolution payload.", 400);
    if (parsed.data.promote) {
      const confirmed = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"], requireConfirmation: true });
      if (!confirmed.ok) return confirmed.response;
    }
    return apiOkFromRequest(request, await strategyEvolutionEngine.evolve(parsed.data));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
