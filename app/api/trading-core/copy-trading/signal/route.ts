import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { copyTradingEngine } from "@/src/server/trading-core/copy-trading";

const schema = z.object({
  signalId: z.string().min(4),
  masterId: z.string().min(2),
  symbol: z.string().min(5),
  side: z.enum(["BUY", "SELL"]),
  type: z.enum(["MARKET", "LIMIT"]).default("MARKET"),
  quantity: z.number().positive(),
  price: z.number().positive().optional(),
  leverage: z.number().min(1).max(125).optional(),
  reduceOnly: z.boolean().optional(),
  filledQuantity: z.number().positive().optional(),
  sourceCreatedAt: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"], requireConfirmation: true });
    if (!access.ok) return access.response;
    const parsed = schema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Copy signal payload gecersiz." : "Invalid copy signal payload.", 400);
    const input = parsed.data;
    const results = await copyTradingEngine.copy({
      ...input,
      symbol: input.symbol.toUpperCase(),
      sourceCreatedAt: input.sourceCreatedAt ?? new Date().toISOString(),
      receivedAt: new Date().toISOString(),
    });
    await addAuditLog({
      userId: access.user.id,
      action: "EXECUTE",
      entityType: "CopyTradingSignal",
      entityId: input.signalId,
      newValues: { input, results },
    }).catch(() => null);
    return apiOkFromRequest(request, { results });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
