import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { executeRecovery, runSelfHealing } from "@/src/server/aoc/self-healing.service";
import { prisma } from "@/src/server/db/prisma";
import type { RecoveryPlan } from "@/src/server/aoc/aoc.types";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const recoveries = await prisma.recoveryHistory.findMany({ orderBy: { executedAt: "desc" }, take: 50 });
    return apiOkFromRequest(request, { recoveries });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;
    const body = await request.json() as { action?: "self_heal"; plan?: RecoveryPlan };
    if (body.action === "self_heal") {
      const result = await runSelfHealing();
      return apiOkFromRequest(request, result);
    }
    if (body.plan) {
      const recovery = await executeRecovery(body.plan);
      return apiOkFromRequest(request, { recovery });
    }
    return apiErrorFromUnknown(new Error("Invalid recovery request"));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
