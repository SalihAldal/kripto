import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOkFromRequest, logApiErrorFromUnknown } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { deleteTradeRoundRun } from "@/services/trading-engine.service";
import { secureRoute } from "@/src/server/security/request-security";

const schema = z.object({
  runId: z.string().min(6),
});

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;

    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return apiError(tr ? "Gecersiz tur silme payload." : "Invalid round delete payload.", 400);
    }

    const result = await deleteTradeRoundRun(parsed.data.runId, access.user.id);
    if (!result.deleted) {
      return apiError(result.reason ?? (tr ? "Tur silinemedi." : "Round could not be deleted."), 400);
    }
    return apiOkFromRequest(request, result);
  } catch (error) {
    return logApiErrorFromUnknown(request, error);
  }
}
