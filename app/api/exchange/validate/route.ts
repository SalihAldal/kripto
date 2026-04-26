import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOk, enforceRateLimit } from "@/lib/api";
import { validateSymbolFilters } from "@/services/binance.service";

const payloadSchema = z.object({
  symbol: z.string().min(3),
  quantity: z.number().positive(),
  price: z.number().positive().optional(),
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  const json = await request.json();
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) return apiError("gecersiz payload");

  const data = await validateSymbolFilters(
    parsed.data.symbol.toUpperCase(),
    parsed.data.quantity,
    parsed.data.price,
  );
  return apiOk(data);
}
