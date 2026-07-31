import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listCapitalAllocations } from "@/src/server/execution-management/execution-management.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const allocations = await listCapitalAllocations(access.user.id);
    return apiOkFromRequest(request, { allocations });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
