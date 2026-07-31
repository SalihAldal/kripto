import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getLivePaperEngine } from "@/src/server/trading-core/paper/singleton";

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const engine = getLivePaperEngine();
    await engine.stop();
    return apiOkFromRequest(request, engine.status());
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
