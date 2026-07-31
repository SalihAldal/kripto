import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getPaperPortfolio } from "@/src/server/paper-validation/paper-portfolio.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const userId = request.nextUrl.searchParams.get("userId");
    if (!userId) return apiErrorFromUnknown(new Error("userId required"));
    return apiOkFromRequest(request, await getPaperPortfolio(userId));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
