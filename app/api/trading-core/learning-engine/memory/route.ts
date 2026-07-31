import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getMemoryStats, pruneShortTermMemory } from "@/src/server/learning-engine/learning-memory.service";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const memoryType = request.nextUrl.searchParams.get("memoryType");
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    const memories = memoryType
      ? await prisma.learningMemory.findMany({
          where: { memoryType: memoryType as never },
          orderBy: { createdAt: "desc" },
          take: Number.isFinite(limit) ? limit : 50,
        })
      : [];
    const decisionMemories = await prisma.decisionMemory.findMany({
      orderBy: { createdAt: "desc" },
      take: Number.isFinite(limit) ? limit : 50,
    });
    return apiOkFromRequest(request, {
      stats: await getMemoryStats(),
      memories,
      decisionMemories,
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function DELETE(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;
    const maxAgeHours = Number(request.nextUrl.searchParams.get("maxAgeHours") ?? 72);
    return apiOkFromRequest(request, await pruneShortTermMemory(Number.isFinite(maxAgeHours) ? maxAgeHours : 72));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
