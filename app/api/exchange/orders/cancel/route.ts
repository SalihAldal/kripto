import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOk, enforceRateLimit } from "@/lib/api";
import { checkApiToken } from "@/lib/auth";
import { cancelOrder } from "@/services/binance.service";

const payloadSchema = z.object({
  symbol: z.string().min(3),
  orderId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request);
  if (limited) return limited;
  if (!checkApiToken(request)) return apiError("Unauthorized.", 401);

  const json = await request.json();
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) return apiError("gecersiz payload");

  const data = await cancelOrder(parsed.data.symbol.toUpperCase(), parsed.data.orderId);
  return apiOk(data);
}
