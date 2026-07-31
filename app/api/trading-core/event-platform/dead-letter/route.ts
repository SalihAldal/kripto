import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listDeadLetterEvents, resolveDeadLetter } from "@/src/server/event-platform/dead-letter.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const resolved = request.nextUrl.searchParams.get("resolved") === "true";
    return apiOkFromRequest(request, await listDeadLetterEvents(Number(request.nextUrl.searchParams.get("limit") ?? 50), resolved));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as { dlqKey: string };
    return apiOkFromRequest(request, await resolveDeadLetter(body.dlqKey));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
