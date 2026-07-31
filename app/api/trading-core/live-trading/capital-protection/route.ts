import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { ensureCapitalProtection } from "@/src/server/live-trading/live-trading.repository";
import { evaluateCapitalProtection } from "@/src/server/live-trading/capital-protection.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const userId = request.nextUrl.searchParams.get("userId") ?? access.user?.id;
    if (!userId) return apiErrorFromUnknown(new Error("userId required"));

    const state = await ensureCapitalProtection(userId);
    const evaluation = await evaluateCapitalProtection({ userId, symbol: "BTCUSDT", side: "BUY" });

    return apiOkFromRequest(request, { state, evaluation });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as { userId?: string; symbol?: string; side?: string; notional?: number };
    const userId = body.userId ?? access.user?.id;
    if (!userId) return apiErrorFromUnknown(new Error("userId required"));

    const evaluation = await evaluateCapitalProtection({
      userId,
      symbol: body.symbol ?? "BTCUSDT",
      side: body.side ?? "BUY",
      notional: body.notional,
    });

    return apiOkFromRequest(request, evaluation);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
