import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listAlerts } from "@/src/server/aoc/aoc.repository";
import { dispatchAlert } from "@/src/server/aoc/alert-engine.service";
import type { AlertPayload } from "@/src/server/aoc/aoc.types";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    const alerts = await listAlerts(limit);
    return apiOkFromRequest(request, { alerts });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;
    const body = await request.json() as AlertPayload;
    const alert = await dispatchAlert(body);
    return apiOkFromRequest(request, { alert });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
