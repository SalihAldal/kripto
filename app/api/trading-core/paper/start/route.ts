import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { getLivePaperEngine, resetLivePaperEngine } from "@/src/server/trading-core/paper/singleton";

const schema = z.object({
  mode: z.enum(["test", "live-market"]).default("test"),
  symbols: z.array(z.string().min(5)).min(1).max(20).default(["BTCUSDT", "ETHUSDT"]),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const parsed = schema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Paper start payload gecersiz." : "Invalid paper start payload.", 400);
    const engine = resetLivePaperEngine({ mode: parsed.data.mode, symbols: parsed.data.symbols });
    await engine.start();
    return apiOkFromRequest(request, getLivePaperEngine().status());
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
