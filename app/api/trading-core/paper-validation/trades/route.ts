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
    const userId = request.nextUrl.searchParams.get("userId");
    const status = request.nextUrl.searchParams.get("status");
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    const trades = await prisma.paperTrade.findMany({
      where: {
        ...(userId ? { userId } : {}),
        ...(status ? { status: status as "OPEN" | "CLOSED" | "CANCELLED" } : {}),
      },
      orderBy: { openedAt: "desc" },
      take: limit,
      include: { executions: { orderBy: { executedAt: "desc" }, take: 3 } },
    });
    return apiOkFromRequest(request, trades);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
