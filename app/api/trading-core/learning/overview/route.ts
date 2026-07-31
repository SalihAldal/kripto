import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getLearningOverview } from "@/src/server/trading-core/self-learning/learning-store";
import { getAIAnalysisMemoryReport } from "@/src/server/ai/ai-analysis-memory.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [overview, aiAnalysisMemory] = await Promise.all([
      getLearningOverview(),
      getAIAnalysisMemoryReport(),
    ]);
    return apiOkFromRequest(request, { ...overview, aiAnalysisMemory });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
