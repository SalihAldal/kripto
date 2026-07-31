import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { generateDailyPaperReport } from "@/src/server/paper-validation/daily-paper-report.service";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const userId = request.nextUrl.searchParams.get("userId") ?? undefined;
    const reports = await prisma.dailyPaperReport.findMany({
      where: userId ? { userId } : {},
      orderBy: { reportDate: "desc" },
      take: 30,
    });
    return apiOkFromRequest(request, reports);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as { userId?: string; date?: string };
    return apiOkFromRequest(
      request,
      await generateDailyPaperReport({ userId: body.userId, date: body.date ? new Date(body.date) : new Date() }),
    );
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
