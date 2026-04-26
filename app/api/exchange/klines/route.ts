import { NextRequest } from "next/server";
import { apiError, apiOk, enforceRateLimit } from "@/lib/api";
import { getKlines } from "@/services/binance.service";

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  const symbol = request.nextUrl.searchParams.get("symbol")?.toUpperCase();
  const interval = request.nextUrl.searchParams.get("interval") ?? "1m";
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 100);
  if (!symbol) return apiError("symbol gerekli");

  const data = await getKlines(symbol, interval, Number.isNaN(limit) ? 100 : limit);
  return apiOk(data);
}
