import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { checkApiToken } from "@/lib/auth";
import { getRequestLocale } from "@/lib/request-locale";
import {
  acknowledgeSafeModeThroughPolicy,
  assessSafeModeExecutionGate,
} from "@/src/server/recovery/paper-safe-mode-policy.service";
import { getSafeModeState, setSafeModeState } from "@/src/server/recovery/failsafe-recovery.service";
import { getRuntimeExecutionContext } from "@/src/server/repositories/execution.repository";
import { addAuditLog } from "@/src/server/repositories/audit.repository";

const schema = z.object({
  enabled: z.boolean(),
  reason: z.string().min(2).max(180).optional(),
  requireManualAck: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(request);
    if (limited) return limited;
    if (!checkApiToken(request)) return apiError("Unauthorized.", 401);
    const data = await getSafeModeState();
    return apiOkFromRequest(request, data);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const limited = enforceRateLimit(request);
    if (limited) return limited;
    if (!checkApiToken(request)) return apiError(tr ? "Yetkisiz." : "Unauthorized.", 401);
    const payload = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return apiError(tr ? "Gecersiz payload." : "Invalid payload.");
    const { user } = await getRuntimeExecutionContext();
    const before = await getSafeModeState(user.id);
    let saved: Awaited<ReturnType<typeof setSafeModeState>>;
    if (parsed.data.enabled) {
      saved = await setSafeModeState({
        userId: user.id,
        enabled: true,
        reason: parsed.data.reason,
        requireManualAck: parsed.data.requireManualAck,
      });
    } else {
      const ack = await acknowledgeSafeModeThroughPolicy({
        userId: user.id,
        reason: parsed.data.reason ?? "Manual safe mode acknowledgement",
        operator: "api",
      });
      if (!ack.acknowledged || !ack.saved) {
        const gate = await assessSafeModeExecutionGate(user.id);
        const detail =
          ack.message ??
          (gate.failureCode === "API_FAILURE_BREAKER_OPEN"
            ? tr
              ? "API failure breaker hala acik; safe mode kapatilamaz."
              : "API failure breaker still open; cannot clear safe mode."
            : tr
              ? "Safe mode kapatilamadi."
              : "Safe mode could not be cleared.");
        return apiError(detail, 409);
      }
      saved = ack.saved;
    }
    await addAuditLog({
      userId: user.id,
      action: "UPDATE",
      entityType: "FailsafeSafeMode",
      entityId: user.id,
      oldValues: before,
      newValues: saved,
    }).catch(() => null);
    return apiOkFromRequest(request, saved);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
