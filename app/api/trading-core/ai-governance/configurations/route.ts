import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { versionConfiguration, getActiveConfiguration, listConfigurationVersions, validateConfiguration } from "@/src/server/ai-governance/configuration-management.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const configKey = request.nextUrl.searchParams.get("configKey");
    if (!configKey) return apiErrorFromUnknown(new Error("configKey required"));
    const active = request.nextUrl.searchParams.get("active") === "true";
    if (active) return apiOkFromRequest(request, await getActiveConfiguration(configKey));
    return apiOkFromRequest(request, await listConfigurationVersions(configKey));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;
    const body = await request.json();
    if (body.validate) return apiOkFromRequest(request, await validateConfiguration(body.config ?? {}));
    return apiOkFromRequest(request, await versionConfiguration(body));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
