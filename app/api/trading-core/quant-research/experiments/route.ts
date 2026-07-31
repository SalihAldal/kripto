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
    const projectId = request.nextUrl.searchParams.get("projectId");
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    const experiments = await prisma.experiment.findMany({
      where: projectId ? { projectId } : undefined,
      orderBy: { createdAt: "desc" },
      take: Number.isFinite(limit) ? limit : 50,
      include: { results: { orderBy: { createdAt: "desc" }, take: 5 } },
    });
    return apiOkFromRequest(request, experiments);
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
    const { ensureDefaultResearchProject, createExperiment } = await import("@/src/server/quant-research/quant-research.repository");
    const project = body.projectId
      ? await prisma.researchProject.findUnique({ where: { id: body.projectId } })
      : await ensureDefaultResearchProject();
    if (!project) return apiErrorFromUnknown(new Error("Project not found"));
    const experiment = await createExperiment({
      projectId: project.id,
      name: body.name ?? "Manual Experiment",
      hypothesis: body.hypothesis,
      config: body.config,
    });
    return apiOkFromRequest(request, experiment);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
