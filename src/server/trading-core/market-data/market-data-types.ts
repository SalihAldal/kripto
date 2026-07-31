import type { MarketCandle, MarketTick } from "@/src/server/trading-core/core/types";

export type MarketDataSource = "BINANCE" | "BYBIT" | "OKX" | "TRADINGVIEW" | "COINGLASS" | "FUNDING_API" | "UNKNOWN";

export type NormalizedMarketTick = MarketTick & {
  source: MarketDataSource;
  receivedAt: number;
  latencyMs: number;
  normalizedAt: string;
};

export type NormalizedMarketCandle = MarketCandle & {
  source: MarketDataSource;
  repaired?: boolean;
  corrupted?: boolean;
  normalizedAt: string;
};

export type RawMarketTick = {
  source: MarketDataSource;
  symbol?: string;
  price?: unknown;
  volume?: unknown;
  eventTime?: unknown;
  receivedAt?: unknown;
};

export type RawMarketCandle = {
  source: MarketDataSource;
  symbol?: string;
  openTime?: unknown;
  closeTime?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  volume?: unknown;
};

export type MarketDataQualityIssue = {
  source: MarketDataSource;
  symbol?: string;
  type: "MISSING_FIELD" | "INVALID_PRICE" | "INVALID_VOLUME" | "INVALID_TIMESTAMP" | "CORRUPTED_OHLC" | "MISSING_CANDLE_REPAIRED" | "LATENCY_COMPENSATED";
  message: string;
  createdAt: string;
};

export type MarketDataNormalizationStats = {
  normalizedTicks: number;
  normalizedCandles: number;
  droppedTicks: number;
  droppedCandles: number;
  repairedCandles: number;
  latencyCompensations: number;
  issues: MarketDataQualityIssue[];
  updatedAt: string;
};
