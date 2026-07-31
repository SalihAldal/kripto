import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { botProfileStore } from "@/src/server/trading-core/bot-profiles";

const schema = z.object({
  stars: z.number().min(1).max(5),
  comment: z.string().max(500).optional(),
});

export async function POST(request: NextRequest, context: { params: Promise<{ botId: string }> }) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const parsed = schema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Rating payload gecersiz." : "Invalid rating payload.", 400);
    const { botId } = await context.params;
    return apiOkFromRequest(request, botProfileStore.rate({ ...parsed.data, botId, userId: access.user.id }));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
