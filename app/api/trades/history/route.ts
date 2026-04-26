import { NextRequest } from "next/server";
import { apiOk, enforceRateLimit } from "@/lib/api";
import { listTrades } from "@/services/trading-engine.service";

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  return apiOk(await listTrades());
}
