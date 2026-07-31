import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { copyTradingEngine, copyTradingRegistry } from "@/src/server/trading-core/copy-trading";

const schema = z.object({
  kind: z.enum(["master", "follower"]),
  masterId: z.string().optional(),
  followerId: z.string().optional(),
  userId: z.string().optional(),
  displayName: z.string().optional(),
  status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]).optional(),
  defaultRiskMultiplier: z.number().min(0.1).max(5).optional(),
  accountId: z.string().optional(),
  allocationPercent: z.number().min(0.1).max(100).optional(),
  riskMultiplier: z.number().min(0.1).max(5).optional(),
  maxSlippageBps: z.number().min(1).max(500).optional(),
  maxDelayMs: z.number().min(100).max(60_000).optional(),
  maxLeverage: z.number().min(1).max(125).optional(),
  partialCopyMinPercent: z.number().min(1).max(100).optional(),
  copyReduceOnly: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    return apiOkFromRequest(request, copyTradingEngine.snapshot());
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"], requireConfirmation: true });
    if (!access.ok) return access.response;
    const parsed = schema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Copy trade payload gecersiz." : "Invalid copy trade payload.", 400);
    const input = parsed.data;
    const userId = access.user.role === "ADMIN" && input.userId ? input.userId : access.user.id;
    const row = input.kind === "master"
      ? copyTradingRegistry.upsertMaster({
          masterId: input.masterId,
          userId,
          displayName: input.displayName ?? access.user.fullName ?? access.user.email,
          defaultRiskMultiplier: input.defaultRiskMultiplier,
          status: input.status,
        })
      : copyTradingRegistry.upsertFollower({
          followerId: input.followerId,
          userId,
          masterId: input.masterId ?? "",
          accountId: input.accountId,
          allocationPercent: input.allocationPercent,
          riskMultiplier: input.riskMultiplier,
          maxSlippageBps: input.maxSlippageBps,
          maxDelayMs: input.maxDelayMs,
          maxLeverage: input.maxLeverage,
          partialCopyMinPercent: input.partialCopyMinPercent,
          copyReduceOnly: input.copyReduceOnly,
          status: input.status,
        });
    const entityId = "followerId" in row ? row.followerId : row.masterId;

    await addAuditLog({
      userId: access.user.id,
      action: "UPDATE",
      entityType: "CopyTrading",
      entityId,
      newValues: row,
    }).catch(() => null);
    return apiOkFromRequest(request, { row, snapshot: copyTradingEngine.snapshot() });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
