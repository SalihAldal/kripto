import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { signalProviderManager } from "@/src/server/trading-core/signal-providers";

const performanceSchema = z.object({
  providerId: z.string().min(2),
  signalId: z.string().optional(),
  realizedPnl: z.number(),
  won: z.boolean().optional(),
  latencyMs: z.number().nonnegative().optional(),
  verified: z.boolean().optional(),
  createdAt: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"], requireConfirmation: true });
    if (!access.ok) return access.response;
    const parsed = performanceSchema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Provider performance payload gecersiz." : "Invalid provider performance payload.", 400);
    return apiOkFromRequest(request, signalProviderManager.recordPerformance(parsed.data));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
