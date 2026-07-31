import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listFeatureFlags, setFeatureFlag, isFeatureEnabled } from "@/src/server/ai-governance/feature-flags.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const flagKey = request.nextUrl.searchParams.get("flagKey");
    if (flagKey) {
      return apiOkFromRequest(request, { flagKey, enabled: await isFeatureEnabled(flagKey) });
    }
    return apiOkFromRequest(request, await listFeatureFlags(request.nextUrl.searchParams.get("environment") ?? "production"));
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
    return apiOkFromRequest(request, await setFeatureFlag(body));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
