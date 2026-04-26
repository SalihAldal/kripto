import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { resetPaperAccount } from "@/src/server/simulation/paper-trading.service";
import { secureRoute } from "@/src/server/security/request-security";

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const access = await secureRoute(request, {
      tr,
      roles: ["ADMIN", "TRADER"],
      requireConfirmation: true,
    });
    if (!access.ok) return access.response;

    const result = await resetPaperAccount(access.user.id);
    await addAuditLog({
      userId: access.user.id,
      action: "UPDATE",
      entityType: "PaperAccount",
      entityId: access.user.id,
      newValues: result,
    }).catch(() => null);
    return apiOkFromRequest(request, result);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
