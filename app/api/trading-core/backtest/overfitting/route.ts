import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { backtestOverfittingDetector } from "@/src/server/trading-core/backtest/overfitting";

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
  backtest: z.object({
    initialBalance: z.number().positive().default(10_000),
    leverage: z.number().min(1).max(125).default(1),
    futures: z.boolean().default(true),
    allowShort: z.boolean().default(true),
    positionSizePercent: z.number().min(1).max(100).default(10),
    takeProfitPercent: z.number().min(0.1).max(100).default(1.2),
    stopLossPercent: z.number().min(0.1).max(100).default(0.8),
    strategies: z.array(z.object({ name: z.string(), enabled: z.boolean() })).default([{ name: "rsi-macd", enabled: true }]),
    costModel: z
      .object({
        makerFeeRate: z.number().min(0).default(0.0002),
        takerFeeRate: z.number().min(0).default(0.0004),
        slippageBps: z.number().min(0).default(5),
        latencyMs: z.number().min(0).default(250),
      })
      .default({ makerFeeRate: 0.0002, takerFeeRate: 0.0004, slippageBps: 5, latencyMs: 250 }),
    marketData: z.array(z.object({ symbol: z.string(), candles: z.array(candleSchema).min(30) })).optional(),
    symbols: z.array(z.string().min(3)).default(["BTCUSDT", "ETHUSDT"]),
    candlesPerSymbol: z.number().int().min(120).max(2000).default(360),
  }),
  windows: z.number().int().min(2).max(8).default(4),
  monteCarloRuns: z.number().int().min(3).max(50).default(12),
  randomizationRuns: z.number().int().min(3).max(30).default(8),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"], requireConfirmation: true });
    if (!access.ok) return access.response;
    const parsed = schema.safeParse(sanitizePayload(await request.json().catch(() => ({}))));
    if (!parsed.success) return apiError(tr ? "Overfitting detection payload gecersiz." : "Invalid overfitting detection payload.", 400);
    const report = await backtestOverfittingDetector.detect(parsed.data);
    await addAuditLog({
      userId: access.user.id,
      action: "EXECUTE",
      entityType: "BacktestOverfittingDetection",
      entityId: report.riskLevel,
      newValues: {
        riskLevel: report.riskLevel,
        riskScore: report.riskScore,
        passed: report.passed,
      },
    }).catch(() => null);
    return apiOkFromRequest(request, report);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
