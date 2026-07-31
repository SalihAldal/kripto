import { describe, expect, it, vi } from "vitest";
import { BinanceExchangeProvider } from "../src/server/exchange/providers/binance.provider";

describe("binance symbol filters", () => {
  it("step size ve tick size kurallarina gore yuvarlar", async () => {
    const provider = new BinanceExchangeProvider();
    vi.spyOn(provider, "getExchangeInfo").mockResolvedValue({
      timezone: "UTC",
      serverTime: Date.now(),
      symbols: [
        {
          symbol: "BTCTRY",
          status: "TRADING",
          baseAsset: "BTC",
          quoteAsset: "TRY",
          filters: {
            LOT_SIZE: { minQty: "0.001", maxQty: "100", stepSize: "0.001" },
            PRICE_FILTER: { minPrice: "1", maxPrice: "10000000", tickSize: "0.10" },
            MIN_NOTIONAL: { minNotional: "10" },
          },
        },
      ],
    });
    const result = await provider.validateSymbolFilters("BTCTRY", 0.12345, 110.567);
    expect(result.ok).toBe(true);
    expect(result.adjustedQuantity).toBe(0.123);
    expect(result.adjustedPrice).toBe(110.5);
  });

  it("min notional altinda kaldiginda reject eder", async () => {
    const provider = new BinanceExchangeProvider();
    vi.spyOn(provider, "getExchangeInfo").mockResolvedValue({
      timezone: "UTC",
      serverTime: Date.now(),
      symbols: [
        {
          symbol: "BTCTRY",
          status: "TRADING",
          baseAsset: "BTC",
          quoteAsset: "TRY",
          filters: {
            LOT_SIZE: { minQty: "0.001", maxQty: "100", stepSize: "0.001" },
            MIN_NOTIONAL: { minNotional: "1000" },
          },
        },
      ],
    });
    vi.spyOn(provider, "getTicker").mockResolvedValue({
      symbol: "BTCTRY",
      price: 90,
      change24h: 0,
      volume24h: 0,
    });
    const result = await provider.validateSymbolFilters("BTCTRY", 0.01, undefined);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("Notional below min");
  });

  it("calculateValidQuantity gecersiz durumda hata firlatir", async () => {
    const provider = new BinanceExchangeProvider();
    vi.spyOn(provider, "validateSymbolFilters").mockResolvedValue({
      ok: false,
      reasons: ["Notional below min: 1000"],
      adjustedQuantity: 0.01,
    });
    await expect(provider.calculateValidQuantity("BTCTRY", 0.01)).rejects.toThrow("calculateValidQuantity failed");
  });
});
