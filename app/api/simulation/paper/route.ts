import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { listPaperOrders, getPaperAccount } from "@/src/server/simulation/paper-trading.service";
import { secureRoute } from "@/src/server/security/request-security";

export async function GET(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const access = await secureRoute(request, {
      tr,
      roles: ["ADMIN", "TRADER", "VIEWER"],
    });
    if (!access.ok) return access.response;

    const account = await getPaperAccount(access.user.id);
    const orders = await listPaperOrders(access.user.id, 120);
    return apiOkFromRequest(request, {
      ...account,
      orders,
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
