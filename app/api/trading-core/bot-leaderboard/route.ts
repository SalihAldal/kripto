import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { botLeaderboardEngine, type BotLeaderboardPeriod } from "@/src/server/trading-core/bot-leaderboard";

function readPeriod(value: string | null): BotLeaderboardPeriod {
  const upper = value?.toUpperCase();
  if (upper === "WEEKLY" || upper === "MONTHLY" || upper === "DAILY") return upper;
  return "DAILY";
}

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const period = readPeriod(request.nextUrl.searchParams.get("period"));
    return apiOkFromRequest(request, botLeaderboardEngine.leaderboard(period));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
