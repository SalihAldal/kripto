import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { checkApiToken } from "@/lib/auth";
import { getRequestLocale } from "@/lib/request-locale";
import { runAIConsensus } from "@/src/server/ai";

const schema = z.object({
  symbol: z.string().min(3),
  strategyParams: z.record(z.string(), z.unknown()).optional(),
  riskSettings: z
    .object({
      maxRiskPerTrade: z.number().positive().optional(),
      maxLeverage: z.number().positive().optional(),
      maxDailyLossPercent: z.number().positive().optional(),
    })
    .optional(),
});

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";

  try {
    const limited = enforceRateLimit(request);
    if (limited) return limited;

    if (!checkApiToken(request)) {
      return apiError(tr ? "Yetkisiz." : "Unauthorized.", 401);
    }

    const payload = await request.json();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return apiError(tr ? "Gecersiz payload." : "Invalid payload.");

    const data = await runAIConsensus(
      parsed.data.symbol.toUpperCase(),
      parsed.data.strategyParams,
      parsed.data.riskSettings,
    );
    return apiOkFromRequest(request, data);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
