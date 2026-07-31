import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listEmergencyControls, activateEmergencyControl, seedEmergencyControls } from "@/src/server/ai-governance/emergency-controls.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "VIEWER"] });
    if (!access.ok) return access.response;
    return apiOkFromRequest(request, await listEmergencyControls());
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
    if (body.seed) return apiOkFromRequest(request, await seedEmergencyControls());
    return apiOkFromRequest(request, await activateEmergencyControl(body));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
