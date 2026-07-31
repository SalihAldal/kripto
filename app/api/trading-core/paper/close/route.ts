import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { getLivePaperEngine } from "@/src/server/trading-core/paper/singleton";

const schema = z.object({
  positionId: z.string().min(3),
  markPrice: z.number().positive().optional(),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const parsed = schema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Paper close payload gecersiz." : "Invalid paper close payload.", 400);
    const closed = getLivePaperEngine().closePosition(parsed.data.positionId, parsed.data.markPrice);
    if (!closed) return apiError(tr ? "Paper pozisyon bulunamadi." : "Paper position not found.", 404);
    await addAuditLog({
      userId: access.user.id,
      action: "EXECUTE",
      entityType: "LivePaperClose",
      entityId: closed.id,
      newValues: parsed.data,
      metadata: { realizedPnl: closed.realizedPnl },
    }).catch(() => null);
    return apiOkFromRequest(request, { closed, status: getLivePaperEngine().status() });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
