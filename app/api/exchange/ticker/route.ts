import { NextRequest } from "next/server";
import { apiError, apiOk, enforceRateLimit } from "@/lib/api";
import { env } from "@/lib/config";
import { getTicker } from "@/services/binance.service";

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  const defaultSymbol = env.BINANCE_PLATFORM === "tr" ? "BTCTRY" : "BTCUSDT";
  const symbol = request.nextUrl.searchParams.get("symbol")?.toUpperCase() ?? defaultSymbol;
  if (!symbol) return apiError("symbol gerekli");

  const data = await getTicker(symbol);
  return apiOk(data);
}
