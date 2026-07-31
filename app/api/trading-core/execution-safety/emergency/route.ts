import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getEmergencyState, listEmergencyActions, releaseEmergencyStop, triggerEmergencyStop } from "@/src/server/execution-safety/emergency-protection.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const symbol = request.nextUrl.searchParams.get("symbol") ?? undefined;
    const state = await getEmergencyState(access.user.id, symbol);
    const actions = await listEmergencyActions(30);
    return apiOkFromRequest(request, { state, actions });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as {
      action: "TRIGGER" | "RELEASE";
      scope: "GLOBAL" | "EXCHANGE" | "SYMBOL" | "USER";
      symbol?: string;
      reason?: string;
    };
    if (body.action === "RELEASE") {
      await releaseEmergencyStop({
        scope: body.scope,
        userId: access.user.id,
        symbol: body.symbol,
        reason: body.reason ?? "Manual release",
      });
    } else {
      await triggerEmergencyStop({
        scope: body.scope,
        userId: access.user.id,
        symbol: body.symbol,
        reason: body.reason ?? "Manual emergency stop",
      });
    }
    return apiOkFromRequest(request, { ok: true, action: body.action });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
