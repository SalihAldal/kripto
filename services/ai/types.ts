import type { MarketTicker } from "@/lib/types";

export type AIModelSignal = {
  model: string;
  signal: "BUY" | "SELL" | "HOLD";
  confidence: number;
  reason: string;
};

export type AIProvider = {
  name: string;
  evaluate(input: { ticker: MarketTicker }): Promise<AIModelSignal>;
};
