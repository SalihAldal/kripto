import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOk } from "@/lib/api";
import {
  placeLimitBuy,
  placeLimitSell,
  placeMarketBuy,
  placeMarketSell,
} from "@/services/binance.service";
import { getRequestLocale } from "@/lib/request-locale";
import { sanitizePayload, secureRoute } from "@/src/server/security/request-security";

const payloadSchema = z.object({
  symbol: z.string().min(3),
  side: z.enum(["BUY", "SELL"]),
  type: z.enum(["MARKET", "LIMIT"]),
  quantity: z.number().positive(),
  price: z.number().positive().optional(),
  dryRun: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
  if (!access.ok) return access.response;

  const json = sanitizePayload(await request.json());
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) return apiError("gecersiz payload");

  const { symbol, side, type, quantity, price, dryRun } = parsed.data;
  const normalized = symbol.toUpperCase();

  if (type === "MARKET") {
    const data =
      side === "BUY"
        ? await placeMarketBuy(normalized, quantity, dryRun)
        : await placeMarketSell(normalized, quantity, dryRun);
    return apiOk(data);
  }

  if (!price) return apiError("limit order icin price gerekli");
  const data =
    side === "BUY"
      ? await placeLimitBuy(normalized, quantity, price, dryRun)
      : await placeLimitSell(normalized, quantity, price, dryRun);
  return apiOk(data);
}
