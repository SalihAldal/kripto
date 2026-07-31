import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listTrainingDatasets } from "@/src/server/learning-platform/learning-platform.repository";
import { getLearningPlatformWorkerState } from "@/src/server/learning-platform/learning-platform.workers";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const datasetId = request.nextUrl.searchParams.get("datasetId");
    if (datasetId) {
      const dataset = await prisma.trainingDataset.findUnique({
        where: { datasetId },
        include: { rows: { take: 100, orderBy: { decisionTimestamp: "desc" } } },
      });
      return apiOkFromRequest(request, { dataset, worker: getLearningPlatformWorkerState() });
    }
    const datasets = await listTrainingDatasets(30);
    const models = await prisma.mLModel.findMany({ orderBy: { trainingDate: "desc" }, take: 20 });
    return apiOkFromRequest(request, { datasets, models, worker: getLearningPlatformWorkerState() });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
