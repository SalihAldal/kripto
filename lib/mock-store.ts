import { randomUUID } from "node:crypto";
import type { AiConsensus, MarketTicker, SystemLog, TradeRecord } from "@/lib/types";

const nowIso = () => new Date().toISOString();

export const mockTickers: MarketTicker[] = [
  { symbol: "BTCUSDT", price: 64231.5, change24h: 2.45, volume24h: 1280000000, updatedAt: nowIso() },
  { symbol: "ETHUSDT", price: 3450.2, change24h: 1.21, volume24h: 680000000, updatedAt: nowIso() },
  { symbol: "SOLUSDT", price: 142.11, change24h: 3.94, volume24h: 220000000, updatedAt: nowIso() },
];

export const trades: TradeRecord[] = [];
export const logs: SystemLog[] = [
  { id: randomUUID(), level: "INFO", message: "Kinetic sistem baslatildi.", timestamp: nowIso() },
  { id: randomUUID(), level: "INFO", message: "Binance fallback mock modu aktif.", timestamp: nowIso() },
];
export const analyses: AiConsensus[] = [];

export const settings = {
  confidenceThreshold: 0.85,
  maxRiskPerTrade: 1.5,
  autoTradeEnabled: true,
  maxOpenTrades: 3,
  watchlist: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
};
