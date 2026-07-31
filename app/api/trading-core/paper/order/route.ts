import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { getIdempotencyKey } from "@/src/server/security/idempotency";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { getLivePaperEngine } from "@/src/server/trading-core/paper/singleton";

const schema = z.object({
  symbol: z.string().min(5),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().positive(),
  markPrice: z.number().positive().optional(),
  leverage: z.number().min(1).max(125).default(1),
  takeProfitPercent: z.number().positive().max(100).optional(),
  stopLossPercent: z.number().positive().max(100).optional(),
  slippageBps: z.number().min(0).max(500).optional(),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const idempotencyKey = getIdempotencyKey(request.headers);
    if (!idempotencyKey) return apiError(tr ? "idempotency-key zorunludur." : "idempotency-key is required.", 428);
    const parsed = schema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Paper order payload gecersiz." : "Invalid paper order payload.", 400);
    const fill = await getLivePaperEngine().openOrder({ ...parsed.data, idempotencyKey });
    await addAuditLog({
      userId: access.user.id,
      action: "EXECUTE",
      entityType: "LivePaperOrder",
      entityId: fill.orderId,
      newValues: parsed.data,
      metadata: { positionId: fill.positionId },
    }).catch(() => null);
    return apiOkFromRequest(request, { fill, status: getLivePaperEngine().status() });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
