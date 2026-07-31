import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { prisma } from "@/src/server/db/prisma";
import { getAccountBalances } from "@/services/binance.service";
import { env } from "@/lib/config";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const userId = request.nextUrl.searchParams.get("userId") ?? access.user?.id;
    if (!userId) return apiErrorFromUnknown(new Error("userId required"));

    const [openTrades, closedToday, capital] = await Promise.all([
      prisma.liveTrade.findMany({ where: { userId, status: "OPEN" }, orderBy: { openedAt: "desc" } }),
      prisma.liveTrade.findMany({
        where: {
          userId,
          status: "CLOSED",
          closedAt: { gte: new Date(new Date().setUTCHours(0, 0, 0, 0)) },
        },
      }),
      prisma.capitalProtection.findUnique({ where: { userId } }),
    ]);

    let exchangeBalances: Array<{ asset: string; free: number; locked: number }> = [];
    try {
      const balances = await getAccountBalances();
      exchangeBalances = balances.map((b) => ({
        asset: b.asset,
        free: Number(b.free ?? 0),
        locked: Number(b.locked ?? 0),
      }));
    } catch {
      exchangeBalances = [];
    }

    const dailyPnl = closedToday.reduce((s, t) => s + t.realizedPnl, 0);
    const weeklyPnl = closedToday.reduce((s, t) => s + t.realizedPnl, 0);
    const equity = env.RISK_TOTAL_CAPITAL_TRY + (capital?.dailyPnl ?? dailyPnl);

    return apiOkFromRequest(request, {
      userId,
      balance: env.RISK_TOTAL_CAPITAL_TRY,
      equity,
      dailyPnl: capital?.dailyPnl ?? dailyPnl,
      weeklyPnl,
      monthlyPnl: capital?.dailyPnl ?? dailyPnl,
      openPositions: openTrades,
      exchangeBalances,
      capitalProtection: capital,
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
