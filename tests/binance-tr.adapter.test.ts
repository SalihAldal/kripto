import { describe, expect, it } from "vitest";
import { BinanceTrExchangeAdapter } from "@/src/server/exchange/adapters/binance-tr.adapter";
import { mapBinanceAdapterError, normalizeOrderStatus } from "@/src/server/exchange/adapters/error-mapper";

describe("binance tr adapter", () => {
  it("symbol rules'u normalize eder", async () => {
    const adapter = new BinanceTrExchangeAdapter({
      getExchangeInfo: async () => ({
        timezone: "UTC",
        serverTime: Date.now(),
        symbols: [
          {
            symbol: "BTCTRY",
            status: "TRADING",
            baseAsset: "BTC",
            quoteAsset: "TRY",
            filters: {
              PRICE_FILTER: { tickSize: "0.01" },
              LOT_SIZE: { stepSize: "0.0001", minQty: "0.0002" },
              MIN_NOTIONAL: { minNotional: "100" },
            },
          },
        ],
      }),
      validateSymbolFilters: async () => ({ ok: true, reasons: [], adjustedQuantity: 0.1234, adjustedPrice: 100 }),
      estimateFees: async () => ({
        symbol: "BTCTRY",
        side: "BUY",
        quantity: 1,
        price: 100,
        takerFeeRate: 0.001,
        makerFeeRate: 0.0009,
        estimatedTakerFee: 0.1,
        estimatedMakerFee: 0.09,
      }),
    } as never);

    const rules = await adapter.getSymbolRules("BTCTRY");
    expect(rules.symbol).toBe("BTCTRY");
    expect(rules.tickSize).toBe(0.01);
    expect(rules.stepSize).toBe(0.0001);
    expect(rules.minNotional).toBe(100);
    expect(rules.minQty).toBe(0.0002);
    expect(rules.status).toBe("ACTIVE");
  });

  it("error mapper binance auth/rate limit kodlarini normalize eder", () => {
    const auth = mapBinanceAdapterError(new Error("code=-2015 Invalid API-key"));
    const rate = mapBinanceAdapterError(new Error("HTTP 429 too many requests"));
    expect(auth.code).toBe("AUTH_INVALID");
    expect(rate.code).toBe("RATE_LIMIT");
    expect(rate.retryable).toBe(true);
  });

  it("order status metinlerini normalize eder", () => {
    expect(normalizeOrderStatus("FILLED")).toBe("FILLED");
    expect(normalizeOrderStatus("partially_filled")).toBe("PARTIALLY_FILLED");
    expect(normalizeOrderStatus("cancelled")).toBe("CANCELED");
    expect(normalizeOrderStatus("random_state")).toBe("UNKNOWN");
  });
});
