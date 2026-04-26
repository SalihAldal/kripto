import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { checkApiToken } from "@/lib/auth";
import { getRequestLocale } from "@/lib/request-locale";
import { analyzeSymbol } from "@/services/ai/consensus.service";

const schema = z.object({
  symbol: z.string().min(5),
});

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";

  const limited = enforceRateLimit(request);
  if (limited) return limited;

  if (!checkApiToken(request)) {
    return apiError(tr ? "Yetkisiz." : "Unauthorized.", 401);
  }

  const payload = await request.json();
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return apiError(tr ? "Gecersiz payload." : "Invalid payload.");
  }

  const result = await analyzeSymbol(parsed.data.symbol.toUpperCase());
  return apiOkFromRequest(request, result);
}
