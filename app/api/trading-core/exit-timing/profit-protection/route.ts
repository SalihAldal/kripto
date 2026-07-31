import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getProfitProtectionTimeline } from "@/src/server/exit-timing/exit-timing.repository";
import { discoverOpenPositions, collectExitContext } from "@/src/server/exit-timing/exit-context.service";
import { computeProfitProtection } from "@/src/server/exit-timing/profit-protection.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const positionId = request.nextUrl.searchParams.get("positionId") ?? undefined;
    const timeline = await getProfitProtectionTimeline(positionId);
    return apiOkFromRequest(request, { timeline });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = await request.json() as { positionId?: string };
    const positions = await discoverOpenPositions(10);
    const pos = body.positionId ? positions.find((p) => p.id === body.positionId) : positions[0];
    if (!pos) return apiErrorFromUnknown(new Error("No open position"));
    const ctx = await collectExitContext(pos);
    if (!ctx) return apiErrorFromUnknown(new Error("Context unavailable"));
    const protection = await computeProfitProtection(ctx);
    return apiOkFromRequest(request, { protection });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
