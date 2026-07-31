import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getCheckpointStatus } from "@/src/server/event-platform/checkpoint.service";
import { listRegisteredPlugins } from "@/src/server/event-platform/plugin-registry.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [checkpoints, plugins] = await Promise.all([getCheckpointStatus(), listRegisteredPlugins()]);
    return apiOkFromRequest(request, { checkpoints, plugins });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
