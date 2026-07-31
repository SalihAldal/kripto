import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { ProfessionalBacktestEngine } from "@/src/server/trading-core/backtest/backtest-engine";
import {
  fetchPaperRoundMarketData,
  PaperRoundBacktestEngine,
  summarizePaperRoundDiagnostics,
} from "@/src/server/trading-core/backtest/paper-round-backtest.engine";
import { buildSyntheticMarketData } from "@/src/server/trading-core/backtest/sample-data";

const schema = z.object({
  mode: z.enum(["paper-round", "strategy-lab"]).default("paper-round"),
  symbols: z.array(z.string().min(5)).min(1).max(20).default(["BTCUSDT", "ETHUSDT"]),
  initialBalance: z.number().positive().default(10_000),
  leverage: z.number().min(1).max(125).default(1),
  futures: z.boolean().default(true),
  allowShort: z.boolean().default(true),
  positionSizePercent: z.number().min(1).max(100).default(12),
  takeProfitPercent: z.number().min(0.1).max(50).default(0.88),
  stopLossPercent: z.number().min(0.1).max(50).default(0.55),
  maxWaitSec: z.number().int().min(300).max(86_400).default(3600),
  klineInterval: z.enum(["1m", "5m", "15m"]).default("1m"),
  klineLimit: z.number().int().min(120).max(1000).default(1000),
  strategies: z
    .array(z.enum(["rsi-macd", "volume-spike", "combined", "steady-gain", "pump-lane", "paper-round"]))
    .min(1)
    .default(["steady-gain", "pump-lane", "paper-round"]),
  makerFeeRate: z.number().min(0).max(0.1).default(0.0002),
  takerFeeRate: z.number().min(0).max(0.1).default(0.0015),
  slippageBps: z.number().min(0).max(200).default(8),
  latencyMs: z.number().min(0).max(10_000).default(250),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const parsed = schema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Professional backtest payload gecersiz." : "Invalid professional backtest payload.", 400);
    const data = parsed.data;

    if (data.mode === "paper-round") {
      const marketData = await fetchPaperRoundMarketData(data.symbols.slice(0, 8), data.klineInterval, data.klineLimit);
      if (marketData.length === 0) {
        return apiError(
          tr
            ? "Gercek kline verisi alinamadi. Coin listesini veya exchange baglantisini kontrol et."
            : "Could not fetch real kline data for backtest.",
          502,
        );
      }
      const lanes = data.strategies.filter((name): name is "steady-gain" | "pump-lane" | "paper-round" =>
        name === "steady-gain" || name === "pump-lane" || name === "paper-round",
      );
      const engine = new PaperRoundBacktestEngine();
      const result = engine.run({
        initialBalance: data.initialBalance,
        positionSizePercent: data.positionSizePercent,
        takeProfitPercent: data.takeProfitPercent,
        stopLossPercent: data.stopLossPercent,
        maxWaitSec: data.maxWaitSec,
        costModel: {
          takerFeeRate: data.takerFeeRate,
          slippageBps: data.slippageBps,
        },
        symbols: marketData.map((row) => row.symbol),
        marketData,
        lanes: lanes.length > 0 ? lanes : ["steady-gain", "pump-lane", "paper-round"],
      });
      return apiOkFromRequest(request, {
        ...result,
        diagnostics: summarizePaperRoundDiagnostics(result),
      });
    }

    const strategyNames = data.strategies.filter(
      (name): name is "rsi-macd" | "volume-spike" | "combined" =>
        name === "rsi-macd" || name === "volume-spike" || name === "combined",
    );
    const engine = new ProfessionalBacktestEngine();
    const result = await engine.run({
      initialBalance: data.initialBalance,
      leverage: data.leverage,
      futures: data.futures,
      allowShort: data.allowShort,
      positionSizePercent: data.positionSizePercent,
      takeProfitPercent: data.takeProfitPercent,
      stopLossPercent: data.stopLossPercent,
      strategies: (strategyNames.length > 0 ? strategyNames : ["rsi-macd", "volume-spike", "combined"]).map((name) => ({
        name,
        enabled: true,
      })),
      costModel: {
        makerFeeRate: data.makerFeeRate,
        takerFeeRate: data.takerFeeRate,
        slippageBps: data.slippageBps,
        latencyMs: data.latencyMs,
      },
      marketData: buildSyntheticMarketData(data.symbols),
    });
    return apiOkFromRequest(request, {
      ...result,
      config: {
        ...result.config,
        mode: "strategy-lab",
        dataSource: "synthetic",
      },
      diagnostics: {
        mode: "strategy-lab",
        dataSource: "synthetic",
        note: "RSI/MACD lab modu — sahte grafik verisi. Canli paper ile birebir ayni degil.",
      },
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
