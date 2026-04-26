import { NextRequest } from "next/server";
import { apiError, apiOk, enforceRateLimit } from "@/lib/api";
import { getRecentTrades } from "@/services/binance.service";

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  const symbol = request.nextUrl.searchParams.get("symbol")?.toUpperCase();
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
  if (!symbol) return apiError("symbol gerekli");

  const data = await getRecentTrades(symbol, Number.isNaN(limit) ? 50 : limit);
  return apiOk(data);
}
