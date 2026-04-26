import { NextRequest } from "next/server";
import { apiOk, enforceRateLimit } from "@/lib/api";
import { getExchangeInfo } from "@/services/binance.service";

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request);
  if (limited) return limited;
  const data = await getExchangeInfo();
  return apiOk(data);
}
