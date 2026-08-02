import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOkFromRequest, logApiErrorFromUnknown } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { evaluatePreTradeRisk, RISK_GATE_POLICY } from "@/src/server/risk/risk-evaluation.service";
import { secureRoute } from "@/src/server/security/request-security";

const schema = z.object({
  symbol: z.string().min(3).max(32),
  confidencePercent: z.number().min(0).max(100),
  spreadPercent: z.number().min(0).max(100),
  liquidity24h: z.number().min(0),
  expectedProfitPercent: z.number().min(0).max(100),
  slippagePercent: z.number().min(0).max(100),
  volatilityPercent: z.number().min(0).max(100),
  riskPerTradePercent: z.number().min(0).max(100),
  stopLossConfigured: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";

  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "VIEWER"] });
    if (!access.ok) return access.response;

    const payload = await request.json();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return apiError(tr ? "Gecersiz payload." : "Invalid payload.");

    const result = await evaluatePreTradeRisk({
      userId: access.user.id,
      ...parsed.data,
    });

    return apiOkFromRequest(request, {
      ...result,
      gatePolicy: RISK_GATE_POLICY,
    });
  } catch (error) {
    return logApiErrorFromUnknown(request, error);
  }
}
