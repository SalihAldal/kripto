import { createHmac } from "node:crypto";
import { env } from "@/lib/config";
import { protectedExchangeClient } from "@/src/server/trading-core/exchange-protection";
import type { SmartOrderSlice } from "@/src/server/trading-core/smart-execution/execution-types";

export class BinanceFuturesAdapter {
  private readonly baseUrl = process.env.BINANCE_FUTURES_HTTP_BASE ?? "https://fapi.binance.com";

  async submit(slice: SmartOrderSlice, clientOrderId: string) {
    if (!env.BINANCE_API_KEY || !env.BINANCE_API_SECRET || process.env.TRADING_CORE_LIVE_EXECUTION !== "true") {
      return {
        simulated: true,
        orderId: `sim-${slice.sliceId}`,
        clientOrderId,
        status: "FILLED",
      };
    }

    const body = new URLSearchParams({
      symbol: slice.symbol,
      side: slice.side,
      type: slice.type,
      quantity: String(slice.quantity),
      newClientOrderId: clientOrderId,
      timestamp: String(Date.now()),
    });
    if (slice.type === "LIMIT" && slice.limitPrice) {
      body.set("price", String(slice.limitPrice));
      body.set("timeInForce", "GTC");
    }
    const signature = createHmac("sha256", env.BINANCE_API_SECRET).update(body.toString()).digest("hex");
    body.set("signature", signature);
    return protectedExchangeClient.requestJson<Record<string, unknown>>({
      exchange: "binance-futures",
      method: "POST",
      url: `${this.baseUrl}/fapi/v1/order`,
      init: {
        method: "POST",
        headers: {
          "X-MBX-APIKEY": env.BINANCE_API_KEY,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
      weight: 1,
      priority: "CRITICAL",
      kind: "ORDER",
    });
  }

  async cancelAll(symbol: string) {
    if (!env.BINANCE_API_KEY || !env.BINANCE_API_SECRET || process.env.TRADING_CORE_LIVE_EXECUTION !== "true") {
      return { simulated: true, symbol, status: "CANCELED" };
    }
    const body = new URLSearchParams({ symbol, timestamp: String(Date.now()) });
    const signature = createHmac("sha256", env.BINANCE_API_SECRET).update(body.toString()).digest("hex");
    body.set("signature", signature);
    return protectedExchangeClient.requestJson<Record<string, unknown>>({
      exchange: "binance-futures",
      method: "DELETE",
      url: `${this.baseUrl}/fapi/v1/allOpenOrders`,
      init: {
        method: "DELETE",
        headers: { "X-MBX-APIKEY": env.BINANCE_API_KEY },
        body,
      },
      weight: 1,
      priority: "CRITICAL",
      kind: "CANCEL",
    });
  }
}
