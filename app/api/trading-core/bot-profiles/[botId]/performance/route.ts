import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { botProfileStore } from "@/src/server/trading-core/bot-profiles";

const schema = z.object({
  symbol: z.string().optional(),
  strategy: z.string().optional(),
  realizedPnl: z.number(),
  returnPercent: z.number().optional(),
  openedAt: z.string().optional(),
  closedAt: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  aiConfidence: z.number().min(0).max(100).optional(),
});

export async function POST(request: NextRequest, context: { params: Promise<{ botId: string }> }) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"], requireConfirmation: true });
    if (!access.ok) return access.response;
    const parsed = schema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Performance payload gecersiz." : "Invalid performance payload.", 400);
    const { botId } = await context.params;
    return apiOkFromRequest(request, botProfileStore.recordPerformance({ ...parsed.data, botId }));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
