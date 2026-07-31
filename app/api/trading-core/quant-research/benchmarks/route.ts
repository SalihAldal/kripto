import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { prisma } from "@/src/server/db/prisma";
import { runInstitutionalBenchmark } from "@/src/server/quant-research/institutional-benchmark.service";
import { runRegimeBenchmark } from "@/src/server/quant-research/regime-benchmark.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const type = request.nextUrl.searchParams.get("type");
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    const benchmarks = await prisma.benchmark.findMany({
      where: type ? { benchmarkType: type as never } : undefined,
      orderBy: { recordedAt: "desc" },
      take: Number.isFinite(limit) ? limit : 50,
    });
    return apiOkFromRequest(request, benchmarks);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = await request.json();
    const windowDays = body.windowDays ?? 90;
    if (body.mode === "regime") {
      return apiOkFromRequest(request, await runRegimeBenchmark({ genomeId: body.genomeId, windowDays }));
    }
    return apiOkFromRequest(request, await runInstitutionalBenchmark({ genomeId: body.genomeId, windowDays }));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
