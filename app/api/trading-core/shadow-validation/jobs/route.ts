import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { enqueueShadowValidationJob } from "@/src/server/shadow-validation/shadow-validation-queue";
import { prisma } from "@/src/server/db/prisma";
import type { ShadowValidationJobPayload } from "@/src/server/shadow-validation/shadow-validation.types";

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as ShadowValidationJobPayload;
    await enqueueShadowValidationJob(body);
    return apiOkFromRequest(request, { queued: true, job: body });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const rows = await prisma.shadowValidationJobState.findMany({ orderBy: { updatedAt: "desc" } });
    return apiOkFromRequest(request, { rows });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
