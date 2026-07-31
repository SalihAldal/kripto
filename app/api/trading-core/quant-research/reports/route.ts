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
    const cadence = request.nextUrl.searchParams.get("cadence");
    const reports = cadence
      ? await prisma.researchReport.findMany({
          where: { cadence: cadence as "DAILY" | "WEEKLY" | "MONTHLY" },
          orderBy: { reportDate: "desc" },
          take: 30,
        })
      : await prisma.researchReport.findMany({ orderBy: { reportDate: "desc" }, take: 30 });
    return apiOkFromRequest(request, reports);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
