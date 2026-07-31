import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { bumpVersion, promoteVersionStage } from "@/src/server/ai-governance/versioning.service";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const registryId = request.nextUrl.searchParams.get("registryId");
    const versions = await prisma.modelVersion.findMany({
      where: registryId ? { registryId } : undefined,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { registry: true },
    });
    return apiOkFromRequest(request, versions);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;
    const body = await request.json();
    if (body.promote) {
      return apiOkFromRequest(request, await promoteVersionStage(body.versionId, body.stage, body.actor));
    }
    return apiOkFromRequest(request, await bumpVersion(body));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
