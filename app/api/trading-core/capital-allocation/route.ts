import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { capitalAllocationEngine } from "@/src/server/trading-core/capital-allocation";

const positionSchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(3),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().positive(),
  entryPrice: z.number().positive(),
  currentPrice: z.number().positive(),
  strategy: z.string().optional(),
  botId: z.string().optional(),
  unrealizedPnl: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const schema = z.object({
  userId: z.string().optional(),
  totalCapitalUsd: z.number().positive(),
  riskProfile: z.enum(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"]).optional(),
  mode: z.enum(["RISK_PARITY", "PERFORMANCE_WEIGHTED", "MANUAL_TARGET"]).optional(),
  positions: z.array(positionSchema).optional(),
  manualTargets: z.array(z.object({
    botId: z.string().min(2),
    targetPercent: z.number().min(0).max(100),
  })).optional(),
  includeInactiveBots: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const parsed = schema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Capital allocation payload gecersiz." : "Invalid capital allocation payload.", 400);
    return apiOkFromRequest(request, capitalAllocationEngine.allocate({ ...parsed.data, userId: parsed.data.userId ?? access.user.id }));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
