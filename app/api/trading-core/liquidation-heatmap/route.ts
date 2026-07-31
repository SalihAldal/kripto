import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { liquidationHeatmapService } from "@/src/server/trading-core/liquidation-heatmap";

const schema = z.object({
  symbol: z.string().min(3),
  markPrice: z.number().positive(),
  liquidationLevels: z.array(
    z.object({
      price: z.number().positive(),
      notionalUsd: z.number().positive(),
      side: z.enum(["LONG", "SHORT"]),
      leverage: z.number().positive().optional(),
    }),
  ),
  openInterest: z.array(z.object({ timestamp: z.number(), openInterestUsd: z.number().nonnegative() })).optional(),
  fundingRates: z.array(z.object({ timestamp: z.number(), fundingRatePercent: z.number() })).optional(),
  volatilityPercent: z.number().nonnegative().optional(),
  receivedAt: z.string().optional(),
});

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    return apiOkFromRequest(request, liquidationHeatmapService.status());
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
    if (!parsed.success) return apiError(tr ? "Liquidation heatmap payload gecersiz." : "Invalid liquidation heatmap payload.", 400);
    return apiOkFromRequest(request, liquidationHeatmapService.analyze(parsed.data));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
