import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { enqueueExchangeAbstractionJob } from "@/src/server/exchange-abstraction/exchange-abstraction-queue";
import type { ExchangeAbstractionJobPayload } from "@/src/server/exchange-abstraction/exchange-abstraction.types";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;
    const jobStates = await prisma.exchangeAbstractionJobState.findMany({ orderBy: { updatedAt: "desc" } });
    return apiOkFromRequest(request, jobStates);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as ExchangeAbstractionJobPayload;
    if (!body?.type) return apiErrorFromUnknown(new Error("Missing job type"));
    const job = await enqueueExchangeAbstractionJob(body);
    return apiOkFromRequest(request, job);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
