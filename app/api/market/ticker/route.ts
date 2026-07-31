import { NextRequest } from "next/server";
import { apiError, apiOk, enforceRateLimit } from "@/lib/api";
import { env } from "@/lib/config";
import { getTicker } from "@/services/binance.service";

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  const symbol = request.nextUrl.searchParams.get("symbol") ?? (env.BINANCE_PLATFORM === "tr" ? "BTCTRY" : "BTCUSDT");
  if (!symbol) {
    return apiError("Symbol is required.");
  }

  const ticker = await getTicker(symbol.toUpperCase());
  return apiOk(ticker);
}
