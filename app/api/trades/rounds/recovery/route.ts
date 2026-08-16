import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { checkApiToken } from "@/lib/auth";
import { getRequestLocale } from "@/lib/request-locale";
import {
  ensureTradeRoundRecovery,
  getTradeRoundProductionHealth,
  getTradeRoundRecoveryTimeline,
  triggerTradeRoundRecovery,
} from "@/services/trading-engine.service";

export async function GET(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const limited = enforceRateLimit(request);
    if (limited) return limited;
    if (!checkApiToken(request)) {
      return Response.json({ ok: false, error: tr ? "Yetkisiz." : "Unauthorized." }, { status: 401 });
    }

    const jobId = request.nextUrl.searchParams.get("jobId") ?? undefined;
    const timelineLimit = Number(request.nextUrl.searchParams.get("timelineLimit") ?? 25);

    const [health, recovery, timeline] = await Promise.all([
      getTradeRoundProductionHealth(),
      ensureTradeRoundRecovery(),
      jobId ? getTradeRoundRecoveryTimeline(jobId, timelineLimit) : Promise.resolve([]),
    ]);

    return apiOkFromRequest(request, {
      health,
      recovery,
      timeline,
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const limited = enforceRateLimit(request);
    if (limited) return limited;
    if (!checkApiToken(request)) {
      return Response.json({ ok: false, error: tr ? "Yetkisiz." : "Unauthorized." }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      jobId?: string;
      force?: boolean;
    };

    const result = await triggerTradeRoundRecovery({
      jobId: body.jobId,
      force: Boolean(body.force),
    });

    return apiOkFromRequest(request, result);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
