import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { smartPortfolioManager } from "@/src/server/trading-core/portfolio";

const positionSchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(3),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().positive(),
  entryPrice: z.number().positive(),
  currentPrice: z.number().positive(),
  strategy: z.string().optional(),
  botId: z.string().optional(),
  unrealizedPnl: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const schema = z.object({
  userId: z.string().optional(),
  accountEquity: z.number().positive(),
  positions: z.array(positionSchema),
  intent: z
    .object({
      symbol: z.string().min(3),
      side: z.enum(["BUY", "SELL"]),
      requestedNotional: z.number().positive(),
      strategy: z.string().optional(),
    })
    .optional(),
});

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    return apiOkFromRequest(request, smartPortfolioManager.status());
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const parsed = schema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Portfolio analiz payload gecersiz." : "Invalid portfolio analysis payload.", 400);
    return apiOkFromRequest(request, smartPortfolioManager.analyze(parsed.data));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
