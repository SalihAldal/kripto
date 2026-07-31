import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { prisma } from "@/src/server/db/prisma";
import {
  activateKillSwitchFromApi,
  activateKillSwitchFromDashboard,
  isKillSwitchActive,
  monitorKillSwitchState,
  releaseKillSwitch,
} from "@/src/server/live-trading/kill-switch.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const userId = request.nextUrl.searchParams.get("userId") ?? access.user?.id ?? undefined;

    const [active, state] = await Promise.all([
      isKillSwitchActive(userId),
      monitorKillSwitchState(),
    ]);

    return apiOkFromRequest(request, { active, ...state });
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
      action: "activate" | "release";
      userId?: string;
      reason?: string;
      eventId?: string;
      source?: "API" | "DASHBOARD";
    };

    const userId = body.userId ?? access.user?.id;
    const reason = body.reason ?? "Manual kill switch";

    if (body.action === "activate") {
      const event =
        body.source === "DASHBOARD"
          ? await activateKillSwitchFromDashboard(userId, reason, access.user?.id)
          : await activateKillSwitchFromApi(userId!, reason);
      return apiOkFromRequest(request, event);
    }

    if (body.action === "release" && body.eventId) {
      return apiOkFromRequest(request, await releaseKillSwitch(body.eventId, userId));
    }

    return apiErrorFromUnknown(new Error("Invalid action"));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
