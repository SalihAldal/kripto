export type DataProvenance = {
  source: string;
  symbol: string;
  venue: string;
  timestamp: number;
  receivedAt: number;
  granularity: string;
  quality: "HIGH" | "MEDIUM" | "LOW" | "UNAVAILABLE";
};

export type ExternalDataKind =
  | "OHLCV"
  | "FUNDING"
  | "BASIS"
  | "OPEN_INTEREST"
  | "LIQUIDATION"
  | "AGG_TRADES"
  | "CVD"
  | "LONG_SHORT_RATIO"
  | "ORDER_BOOK";

export type OiPoint = { timestamp: number; openInterest: number; openInterestValue?: number };
export type LiquidationEvent = {
  timestamp: number;
  side: "BUY" | "SELL";
  price: number;
  qty: number;
  notional: number;
};
export type AggTradeBucket = {
  timestamp: number;
  aggressiveBuyVolume: number;
  aggressiveSellVolume: number;
  delta: number;
  tradeCount: number;
  avgTradeSize: number;
  largeBuyFlow: number;
  largeSellFlow: number;
};
export type CvdPoint = { timestamp: number; cvd: number; slope: number; acceleration: number };
export type LongShortRatioPoint = { timestamp: number; longShortRatio: number; longAccount: number; shortAccount: number };
export type OrderBookSnapshot = {
  timestamp: number;
  bidDepth: number;
  askDepth: number;
  imbalance: number;
  spreadBps: number;
  depth5: number;
  depth10: number;
  depth20: number;
};

export type ExternalSymbolPanel = {
  symbol: string;
  venue: string;
  bars: Array<{
    openTime: number;
    closeTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    quoteVolume: number;
    takerBuyQuote: number;
  }>;
  funding: Array<{ fundingTime: number; fundingRate: number; markPrice?: number }>;
  basis: Array<{ closeTime: number; premium: number }>;
  openInterest: OiPoint[];
  liquidations: LiquidationEvent[];
  aggTrades: AggTradeBucket[];
  cvd: CvdPoint[];
  longShortRatio: LongShortRatioPoint[];
  orderBook: OrderBookSnapshot[];
  availability: Record<ExternalDataKind, "AVAILABLE" | "UNAVAILABLE" | "DEGRADED">;
  provenance: DataProvenance[];
};

export type DataQaReport = {
  symbol: string;
  kind: ExternalDataKind;
  coveragePct: number;
  missingPct: number;
  stalePct: number;
  duplicatePct: number;
  ordered: boolean;
  gapCount: number;
  recordCount: number;
  pass: boolean;
};

export interface HistoricalMarketDataProvider {
  name: string;
  getOpenInterest(symbol: string, start: number, end: number): Promise<OiPoint[]>;
  getLiquidations(symbol: string, start: number, end: number): Promise<LiquidationEvent[]>;
  getAggTrades(symbol: string, start: number, end: number): Promise<AggTradeBucket[]>;
  getLongShortRatio(symbol: string, start: number, end: number): Promise<LongShortRatioPoint[]>;
  getOrderBookSnapshots(symbol: string, start: number, end: number): Promise<OrderBookSnapshot[]>;
  getFunding(symbol: string, start: number, end: number): Promise<Array<{ fundingTime: number; fundingRate: number }>>;
  getBasis(symbol: string, start: number, end: number): Promise<Array<{ closeTime: number; premium: number }>>;
  getKlines(symbol: string, start: number, end: number): Promise<ExternalSymbolPanel["bars"]>;
}
