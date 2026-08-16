import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOkFromRequest, logApiErrorFromUnknown } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { buildMarketContext } from "@/src/server/scanner/market-context-builder";
import { SIGNAL_GENERATION_POLICY, scoreContext } from "@/src/server/scanner/signal-scoring.engine";
import { secureRoute } from "@/src/server/security/request-security";

const schema = z.object({
  symbol: z.string().min(3).max(32),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";

  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "VIEWER"] });
    if (!access.ok) return access.response;

    const payload = await request.json();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return apiError(tr ? "Gecersiz payload." : "Invalid payload.");

    const context = await buildMarketContext(parsed.data.symbol);
    const score = scoreContext(context);

    return apiOkFromRequest(request, {
      ok: score.status === "QUALIFIED",
      symbol: parsed.data.symbol,
      score,
      gatePolicy: SIGNAL_GENERATION_POLICY,
    });
  } catch (error) {
    return logApiErrorFromUnknown(request, error);
  }
}
