import type { IUniversalExchangeAdapter } from "@/src/server/exchange-abstraction/exchange-interface";
import type { ExchangePluginType } from "@prisma/client";
import { BinanceSpotAdapter } from "@/src/server/exchange-abstraction/adapters/binance-spot.adapter";
import {
  BinanceFuturesAdapter,
  BybitAdapter,
  CoinbaseAdapter,
  GateAdapter,
  KrakenAdapter,
  KucoinAdapter,
  MexcAdapter,
  OkxAdapter,
} from "@/src/server/exchange-abstraction/adapters/stub-exchange.adapter";

const adapterCache = new Map<ExchangePluginType, IUniversalExchangeAdapter>();

function createAdapter(pluginType: ExchangePluginType): IUniversalExchangeAdapter {
  switch (pluginType) {
    case "BINANCE_SPOT":
      return new BinanceSpotAdapter();
    case "BINANCE_FUTURES":
      return BinanceFuturesAdapter();
    case "BYBIT":
      return BybitAdapter();
    case "OKX":
      return OkxAdapter();
    case "GATE":
      return GateAdapter();
    case "MEXC":
      return MexcAdapter();
    case "KUCOIN":
      return KucoinAdapter();
    case "KRAKEN":
      return KrakenAdapter();
    case "COINBASE":
      return CoinbaseAdapter();
    default:
      return new BinanceSpotAdapter();
  }
}

export function getExchangePlugin(pluginType: ExchangePluginType = "BINANCE_SPOT"): IUniversalExchangeAdapter {
  if (!adapterCache.has(pluginType)) {
    adapterCache.set(pluginType, createAdapter(pluginType));
  }
  return adapterCache.get(pluginType)!;
}

export function getProductionAdapter(): IUniversalExchangeAdapter {
  return getExchangePlugin("BINANCE_SPOT");
}

export function listRegisteredPlugins(): ExchangePluginType[] {
  return [
    "BINANCE_SPOT", "BINANCE_FUTURES", "BYBIT", "OKX", "GATE", "MEXC", "KUCOIN", "KRAKEN", "COINBASE",
  ];
}

export function resetPluginCacheForTests() {
  adapterCache.clear();
}
