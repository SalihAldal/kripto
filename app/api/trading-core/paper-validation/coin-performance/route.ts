import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getCoinLeaderboard, updateCoinScoreboard } from "@/src/server/paper-validation/coin-scoreboard.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const userId = request.nextUrl.searchParams.get("userId") ?? undefined;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 25);
    return apiOkFromRequest(request, await getCoinLeaderboard(userId, limit));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as { userId?: string };
    return apiOkFromRequest(request, await updateCoinScoreboard(body.userId));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
