import type { ExchangeProvider } from "@/src/server/exchange/providers/base-provider";
import { BinanceExchangeProvider } from "@/src/server/exchange/providers/binance.provider";
import { OkxExchangeProvider } from "@/src/server/exchange/providers/okx.provider";
import { env } from "@/lib/config";

let cachedProvider: ExchangeProvider | null = null;

export function getExchangeProvider(): ExchangeProvider {
  if (!cachedProvider) {
    cachedProvider = env.EXCHANGE_PROVIDER === "okx" ? new OkxExchangeProvider() : new BinanceExchangeProvider();
    void cachedProvider.getExchangeInfo().catch(() => null);
  }
  return cachedProvider;
}
