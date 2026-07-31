import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { secureRoute } from "@/src/server/security/request-security";
import { getLivePaperEngine } from "@/src/server/trading-core/paper/singleton";

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, {
      tr,
      roles: ["ADMIN", "TRADER"],
      requireConfirmation: true,
    });
    if (!access.ok) return access.response;
    const engine = getLivePaperEngine();
    engine.reset();
    await addAuditLog({
      userId: access.user.id,
      action: "UPDATE",
      entityType: "LivePaperAccount",
      entityId: access.user.id,
      newValues: engine.status().account,
    }).catch(() => null);
    return apiOkFromRequest(request, engine.status());
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
