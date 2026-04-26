import { NextRequest } from "next/server";
import { apiError, apiOk, enforceRateLimit } from "@/lib/api";
import { checkApiToken } from "@/lib/auth";
import { getOrderStatus } from "@/services/binance.service";

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request);
  if (limited) return limited;
  if (!checkApiToken(request)) return apiError("Unauthorized.", 401);

  const symbol = request.nextUrl.searchParams.get("symbol")?.toUpperCase();
  const orderId = request.nextUrl.searchParams.get("orderId");
  if (!symbol || !orderId) return apiError("symbol ve orderId gerekli");

  const data = await getOrderStatus(symbol, orderId);
  return apiOk(data);
}
