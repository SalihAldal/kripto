import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { runLearningBackfill } from "@/src/server/trading-core/self-learning/learning-store";

const bodySchema = z.object({
  limit: z.number().int().min(1).max(50).default(10),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    return apiOkFromRequest(request, await runLearningBackfill(body.limit));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
