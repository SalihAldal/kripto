import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { advanceDeploymentPipeline, getDeploymentTimeline, rollbackDeployment } from "@/src/server/ai-governance/deployment-pipeline.service";
import { runCanaryDeployment } from "@/src/server/ai-governance/canary-deployment.service";
import { runShadowDeployment } from "@/src/server/ai-governance/shadow-deployment.service";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const deploymentId = request.nextUrl.searchParams.get("deploymentId");
    if (deploymentId) return apiOkFromRequest(request, await getDeploymentTimeline(deploymentId));
    const deployments = await prisma.deployment.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { version: true } });
    return apiOkFromRequest(request, deployments);
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
    if (body.rollback) return apiOkFromRequest(request, await rollbackDeployment(body.deploymentId, body.actor, body.reason));
    if (body.canary) return apiOkFromRequest(request, await runCanaryDeployment(body));
    if (body.shadow) return apiOkFromRequest(request, await runShadowDeployment(body));
    return apiOkFromRequest(request, await advanceDeploymentPipeline(body));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
