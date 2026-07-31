import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import {
  calculateShadowPerformanceReport,
  compareRuleVsMlShadow,
  getMlShadowTradeCount,
} from "@/src/server/decision-engine-v2/shadow-integration.service";
import { getLatestShadowPerformance } from "@/src/server/decision-engine-v2/decision-engine-v2.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [mlPerf, rulePerf, comparison, tradeCount] = await Promise.all([
      getLatestShadowPerformance("decision-engine-v2"),
      getLatestShadowPerformance("decision-engine-v1"),
      compareRuleVsMlShadow(30),
      getMlShadowTradeCount(),
    ]);
    return apiOkFromRequest(request, { mlPerf, rulePerf, comparison, tradeCount });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = (await request.json().catch(() => ({}))) as { days?: number; engineId?: string };
    const report = await calculateShadowPerformanceReport({
      engineId: body.engineId ?? "decision-engine-v2",
      days: body.days ?? 30,
    });
    return apiOkFromRequest(request, report);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
