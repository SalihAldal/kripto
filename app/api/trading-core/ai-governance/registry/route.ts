import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listRegistry, seedDefaultRegistry, getRegistryByKey } from "@/src/server/ai-governance/ai-registry.service";
import { registerModel } from "@/src/server/ai-governance/ai-governance.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const key = request.nextUrl.searchParams.get("key");
    if (key) return apiOkFromRequest(request, await getRegistryByKey(key));
    const type = request.nextUrl.searchParams.get("type") ?? undefined;
    return apiOkFromRequest(request, await listRegistry(type as never));
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
    if (body.seed) return apiOkFromRequest(request, await seedDefaultRegistry());
    return apiOkFromRequest(request, await registerModel(body));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
