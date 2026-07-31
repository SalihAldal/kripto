import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { buildSyntheticMarketData } from "@/src/server/trading-core/backtest/sample-data";
import { strategyOptimizer } from "@/src/server/trading-core/optimization";

const candleSchema = z.object({
  symbol: z.string(),
  openTime: z.number(),
  closeTime: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});

const schema = z.object({
  strategy: z.string().min(2).default("rsi-macd"),
  symbols: z.array(z.string().min(3)).default(["BTCUSDT", "ETHUSDT"]),
  marketData: z
    .array(
      z.object({
        symbol: z.string(),
        candles: z.array(candleSchema).min(30),
      }),
    )
    .optional(),
  initialBalance: z.number().positive().default(10_000),
  futures: z.boolean().default(true),
  allowShort: z.boolean().default(true),
  positionSizePercent: z.number().min(1).max(100).default(10),
  maxCandidates: z.number().int().min(1).max(30).default(12),
  apply: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"], requireConfirmation: true });
    if (!access.ok) return access.response;
    const parsed = schema.safeParse(sanitizePayload(await request.json().catch(() => ({}))));
    if (!parsed.success) return apiError(tr ? "Optimization payload gecersiz." : "Invalid optimization payload.", 400);
    const input = parsed.data;
    const result = await strategyOptimizer.optimize({
      strategy: input.strategy,
      marketData: input.marketData ?? buildSyntheticMarketData(input.symbols, 320),
      initialBalance: input.initialBalance,
      futures: input.futures,
      allowShort: input.allowShort,
      positionSizePercent: input.positionSizePercent,
      maxCandidates: input.maxCandidates,
      apply: input.apply,
    });

    await addAuditLog({
      userId: access.user.id,
      action: input.apply ? "UPDATE" : "EXECUTE",
      entityType: "StrategyOptimization",
      entityId: input.strategy,
      newValues: {
        apply: input.apply,
        recommendation: result.recommendation,
        best: result.best,
      },
    }).catch(() => null);

    return apiOkFromRequest(request, result);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
