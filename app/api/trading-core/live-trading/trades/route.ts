import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const userId = request.nextUrl.searchParams.get("userId") ?? access.user?.id;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    const status = request.nextUrl.searchParams.get("status") ?? undefined;

    const trades = await prisma.liveTrade.findMany({
      where: {
        ...(userId ? { userId } : {}),
        ...(status ? { status: status as "OPEN" | "CLOSED" | "CANCELLED" | "RECOVERED" } : {}),
      },
      orderBy: { openedAt: "desc" },
      take: Math.min(limit, 200),
    });

    return apiOkFromRequest(request, { trades, count: trades.length });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
