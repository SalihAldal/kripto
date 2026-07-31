import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { botProfileStore } from "@/src/server/trading-core/bot-profiles";

const upsertSchema = z.object({
  botId: z.string().min(2),
  name: z.string().min(2).max(120),
  description: z.string().min(10).max(1200),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
  supportedPairs: z.array(z.string().min(3)).min(1),
  strategyType: z.enum(["SCALPING", "TREND", "BREAKOUT", "MEAN_REVERSION", "GRID", "AI_ASSISTED"]),
  recommendedLeverage: z.number().min(1).max(125),
  tradeFrequency: z.enum(["LOW", "MEDIUM", "HIGH", "ULTRA"]),
  aiConfidence: z.number().min(0).max(100).optional(),
  tags: z.array(z.string().min(1).max(32)).optional(),
});

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    return apiOkFromRequest(request, botProfileStore.snapshot());
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"], requireConfirmation: true });
    if (!access.ok) return access.response;
    const parsed = upsertSchema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Bot profile payload gecersiz." : "Invalid bot profile payload.", 400);
    const profile = botProfileStore.upsert(parsed.data);
    await addAuditLog({
      userId: access.user.id,
      action: "UPDATE",
      entityType: "TradingBotProfile",
      entityId: profile.botId,
      newValues: profile,
    }).catch(() => null);
    return apiOkFromRequest(request, profile);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
