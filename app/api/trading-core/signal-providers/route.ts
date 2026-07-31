import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { signalProviderManager } from "@/src/server/trading-core/signal-providers";

const providerSchema = z.object({
  providerId: z.string().min(2).max(80),
  name: z.string().min(2).max(120),
  type: z.enum(["INTERNAL_AI", "TRADINGVIEW_WEBHOOK", "MANUAL_TRADER", "EXTERNAL_API", "ML_PREDICTION_ENGINE"]),
  status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]),
  priority: z.number().min(0).max(100),
  baseScore: z.number().min(0).max(100),
  riskRating: z.enum(["LOW", "MEDIUM", "HIGH", "BLOCKED"]),
  minConfidence: z.number().min(0).max(100),
  supportedPairs: z.array(z.string().min(3)).min(1),
  tags: z.array(z.string().min(1).max(32)).optional().default([]),
});

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const symbol = request.nextUrl.searchParams.get("symbol");
    return apiOkFromRequest(request, {
      ...signalProviderManager.snapshot(),
      consensus: symbol ? signalProviderManager.consensus(symbol) : null,
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"], requireConfirmation: true });
    if (!access.ok) return access.response;
    const parsed = providerSchema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Provider payload gecersiz." : "Invalid provider payload.", 400);
    const provider = signalProviderManager.upsertProvider(parsed.data);
    await addAuditLog({
      userId: access.user.id,
      action: "UPDATE",
      entityType: "SignalProvider",
      entityId: provider.providerId,
      newValues: provider,
    }).catch(() => null);
    return apiOkFromRequest(request, provider);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
