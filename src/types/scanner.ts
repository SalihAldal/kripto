import type { AIConsensusResult } from "@/src/types/ai";

export type MarketContext = {
  symbol: string;
  lastPrice: number;
  change24h: number;
  volume24h: number;
  spreadPercent: number;
  volatilityPercent: number;
  momentumPercent: number;
  orderBookImbalance: number;
  buyPressure: number;
  shortCandleSignal: number;
  fakeSpikeScore: number;
  tradable: boolean;
  rejectReasons: string[];
  metadata: Record<string, unknown>;
};

export type ScannerScore = {
  symbol: string;
  score: number;
  confidence: number;
  status: "QUALIFIED" | "REJECTED";
  reasons: string[];
  metrics: {
    momentum: number;
    microMomentum: number;
    volume: number;
    spread: number;
    volatility: number;
    orderBook: number;
    pressure: number;
    microFlow: number;
    velocity: number;
    candle: number;
    fakeSpikePenalty: number;
    liquidityPenalty: number;
  };
};

export type ScannerCandidate = {
  rank: number;
  context: MarketContext;
  score: ScannerScore;
  ai?: AIConsensusResult;
};

export type ScannerPipelineResult = {
  scannedAt: string;
  totalSymbols: number;
  qualifiedSymbols: number;
  aiEvaluatedSymbols: number;
  candidates: ScannerCandidate[];
};

export type ScannerApiRow = {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  aiScore: number;
  scannerScore: number;
  spreadPercent: number;
  volatilityPercent: number;
  decision: "BUY" | "SELL" | "HOLD" | "NO_TRADE";
  marketRegime?: string;
  marketRegimeStrategy?: string;
};
