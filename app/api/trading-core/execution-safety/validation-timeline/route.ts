import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getValidationTimeline } from "@/src/server/execution-safety/execution-safety.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 100);
    return apiOkFromRequest(request, { timeline: await getValidationTimeline(Number.isFinite(limit) ? limit : 100) });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
