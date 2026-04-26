import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { checkApiToken } from "@/lib/auth";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { getRuntimeExecutionContext } from "@/src/server/repositories/execution.repository";
import { setPausedState } from "@/src/server/repositories/risk.repository";

const schema = z.object({
  paused: z.boolean(),
  reason: z.string().min(2).max(180).optional(),
  minutes: z.number().int().min(1).max(24 * 60).optional(),
});

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";

  const limited = enforceRateLimit(request);
  if (limited) return limited;
  if (!checkApiToken(request)) return apiError(tr ? "Yetkisiz." : "Unauthorized.", 401);

  const payload = await request.json();
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return apiError(tr ? "Gecersiz payload." : "Invalid payload.");

  const { user } = await getRuntimeExecutionContext();
  const until =
    parsed.data.paused && parsed.data.minutes
      ? new Date(Date.now() + parsed.data.minutes * 60 * 1000).toISOString()
      : undefined;
  const result = await setPausedState({
    userId: user.id,
    paused: parsed.data.paused,
    reason: parsed.data.reason,
    until,
  });

  await addAuditLog({
    userId: user.id,
    action: "UPDATE",
    entityType: "SystemPausedState",
    entityId: result.id,
    newValues: parsed.data,
  }).catch(() => null);

  return apiOkFromRequest(request, {
    paused: parsed.data.paused,
    reason: parsed.data.reason ?? null,
    until: until ?? null,
    message: parsed.data.paused
      ? tr
        ? "Sistem manuel olarak duraklatildi"
        : "System paused manually"
      : tr
        ? "Sistem tekrar aktif edildi"
        : "System resumed",
  });
}
