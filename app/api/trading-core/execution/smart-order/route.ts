import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { writeIdempotentResponse } from "@/src/server/security/idempotency";
import { sanitizePayload } from "@/src/server/security/request-security";
import {
  requireSmartExecutionIdempotency,
  secureSmartExecutionRoute,
  withSmartExecutionLock,
} from "@/src/server/trading-core/smart-execution/smart-execution-route-security";
import { getSmartExecutionService } from "@/src/server/trading-core/smart-execution/singleton";

const schema = z.object({
  symbol: z.string().min(5),
  side: z.enum(["BUY", "SELL"]),
  type: z.enum(["MARKET", "LIMIT"]).default("MARKET"),
  quantity: z.number().positive(),
  price: z.number().positive().optional(),
  maxSlippageBps: z.number().min(1).max(500).default(25),
  splitCount: z.number().int().min(1).max(20).optional(),
  leverage: z.number().min(1).max(125).optional(),
  reduceOnly: z.boolean().optional(),
  clientOrderId: z.string().min(6).optional(),
});

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const access = await secureSmartExecutionRoute(request, {
      tr,
      roles: ["ADMIN", "TRADER"],
      requireConfirmation: process.env.TRADING_CORE_LIVE_EXECUTION === "true",
    });
    if (!access.ok) return access.response;

    const payload = sanitizePayload(await request.json());
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return apiError(tr ? "Smart order payload gecersiz." : "Invalid smart order payload.", 400);

    const idempotency = await requireSmartExecutionIdempotency(request, access.user.id, "smart-order", tr);
    if (!idempotency.ok) return idempotency.response;
    if (idempotency.cached) return apiOkFromRequest(request, idempotency.cached);

    const locked = await withSmartExecutionLock(access.user.id, "smart-order", tr, async () => {
      const service = getSmartExecutionService();
      await service.start();
      const plan = await service.enqueue(parsed.data, parsed.data.price);
      return { plan };
    });
    if (!locked.ok) return locked.response;

    await addAuditLog({
      userId: access.user.id,
      action: "EXECUTE",
      entityType: "SmartExecutionOrder",
      entityId: String(locked.result.plan.planId),
      newValues: parsed.data,
      metadata: {
        symbol: parsed.data.symbol,
        side: parsed.data.side,
        type: parsed.data.type,
      },
    }).catch(() => null);
    await writeIdempotentResponse(access.user.id, "smart-order", idempotency.key, locked.result);
    return apiOkFromRequest(request, locked.result);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function GET(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const access = await secureSmartExecutionRoute(request, {
      tr,
      roles: ["ADMIN", "TRADER", "VIEWER"],
    });
    if (!access.ok) return access.response;
    const health = await getSmartExecutionService().health();
    return apiOkFromRequest(request, health);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
