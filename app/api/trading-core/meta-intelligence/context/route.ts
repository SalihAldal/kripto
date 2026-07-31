import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getLatestContext } from "@/src/server/meta-intelligence/meta-intelligence.repository";
import { calibrateConfidence } from "@/src/server/meta-intelligence/confidence-calibration.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [context, confidence] = await Promise.all([
      getLatestContext(),
      calibrateConfidence(),
    ]);
    return apiOkFromRequest(request, { context, confidence });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
