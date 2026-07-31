import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { signalProviderManager } from "@/src/server/trading-core/signal-providers";

const signalSchema = z.object({
  providerId: z.string().min(2),
  symbol: z.string().min(3),
  side: z.enum(["BUY", "SELL", "HOLD"]),
  confidence: z.number().min(0).max(100),
  score: z.number().min(0).max(100).optional(),
  price: z.number().positive().optional(),
  timeframe: z.string().max(20).optional(),
  strategy: z.string().max(80).optional(),
  sourceTimestamp: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const parsed = signalSchema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Provider signal payload gecersiz." : "Invalid provider signal payload.", 400);
    const signal = signalProviderManager.submit(parsed.data);
    return apiOkFromRequest(request, {
      signal,
      consensus: signalProviderManager.consensus(signal.symbol),
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
