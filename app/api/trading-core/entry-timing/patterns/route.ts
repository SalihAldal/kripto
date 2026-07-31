import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getBestAndWorstPatterns } from "@/src/server/entry-timing/entry-learning.service";
import { generateEntryHeatmap } from "@/src/server/entry-timing/entry-heatmap.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [patterns, heatmap] = await Promise.all([
      getBestAndWorstPatterns(),
      generateEntryHeatmap(),
    ]);
    return apiOkFromRequest(request, { ...patterns, heatmap: heatmap.heatmap });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
