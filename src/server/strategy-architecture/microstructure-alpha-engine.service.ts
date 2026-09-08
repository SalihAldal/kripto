export const FUTURES_UNIVERSE_DEFAULT = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "SUIUSDT",
] as const;

export const HYPOTHESIS_NAMES = [
  "FUNDING_EXTREME_NEGATIVE_LONG",
  "FUNDING_EXTREME_POSITIVE_SHORT",
  "FUNDING_MEAN_REVERSION",
  "FUNDING_ACCELERATION_FADE",
  "BASIS_EXTREME_DISCOUNT_LONG",
  "BASIS_EXTREME_PREMIUM_SHORT",
  "BASIS_NORMALIZATION_FADE",
  "TAKER_IMBALANCE_LONG",
  "TAKER_IMBALANCE_SHORT",
  "CVD_DIVERGENCE_SHORT",
  "CVD_DIVERGENCE_LONG",
  "FUNDING_BASIS_CONFLUENCE_LONG",
  "FUNDING_BASIS_CONFLUENCE_SHORT",
] as const;

export type HypothesisName = (typeof HYPOTHESIS_NAMES)[number];
export type TradeSide = "LONG" | "SHORT";
export type DataSplit = "TRAIN" | "VALIDATION" | "TEST";

export const FUTURES_COST = {
  takerFeePerSidePct: 0.04,
  makerFeePerSidePct: 0.02,
  assumedTakerRoundTripFeePct: 0.08,
  realisticSlippageRtPct: 0.14,
  realisticRoundTripPct: 0.22,
  stressSlippageRtPct: 0.7,
  stressRoundTripPct: 0.78,
  leverageBaseline: 1,
} as const;

export type FuturesBar = {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  takerBuyQuote: number;
};

export type FundingPoint = {
  fundingTime: number;
  fundingRate: number;
  markPrice: number;
};

export type BasisPoint = {
  openTime: number;
  closeTime: number;
  premium: number;
};

export type OpenInterestPoint = {
  timestamp: number;
  openInterest: number;
};

export type SymbolMicroPanel = {
  symbol: string;
  bars: FuturesBar[];
  funding: FundingPoint[];
  basis: BasisPoint[];
  openInterest: OpenInterestPoint[];
};

export type AlphaTrade = {
  entryTime: number;
  exitTime: number;
  symbol: string;
  side: TradeSide;
  grossReturnPct: number;
  fundingPnlPct: number;
  feeCostPct: number;
  netReturnPct: number;
  split: DataSplit;
  hypothesis: HypothesisName;
  holdHours: number;
  note?: string;
};

export type AlphaStats = {
  trades: number;
  wins: number;
  losses: number;
  grossPnl: number;
  netPnl: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdown: number;
  longTrades: number;
  shortTrades: number;
};

export function netAfterFuturesCost(grossPct: number, fundingPnlPct: number, roundTripCostPct: number) {
  return grossPct + fundingPnlPct - roundTripCostPct;
}

export function grossReturnPct(side: TradeSide, entry: number, exit: number) {
  if (entry <= 0 || exit <= 0) return 0;
  return side === "LONG" ? ((exit - entry) / entry) * 100 : ((entry - exit) / entry) * 100;
}

export function fundingPnlDuringHold(
  side: TradeSide,
  funding: FundingPoint[],
  entryTime: number,
  exitTime: number,
): number {
  let pnl = 0;
  for (const row of funding) {
    if (row.fundingTime <= entryTime || row.fundingTime > exitTime) continue;
    const ratePct = row.fundingRate * 100;
    pnl += side === "LONG" ? -ratePct : ratePct;
  }
  return pnl;
}

export function computeAlphaStats(trades: AlphaTrade[], notionalPerTrade = 1000): AlphaStats {
  const nets = trades.map((t) => (t.netReturnPct / 100) * notionalPerTrade);
  const wins = nets.filter((n) => n > 0).length;
  const grossPnl = trades.reduce((s, t) => s + (t.grossReturnPct / 100) * notionalPerTrade, 0);
  const netPnl = nets.reduce((s, n) => s + n, 0);
  const grossW = nets.filter((n) => n > 0).reduce((s, n) => s + n, 0);
  const grossL = Math.abs(nets.filter((n) => n <= 0).reduce((s, n) => s + n, 0));
  let peak = 10_000;
  let eq = 10_000;
  let maxDd = 0;
  for (const n of nets) {
    eq += n;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, ((peak - eq) / peak) * 100);
  }
  return {
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    grossPnl: Number(grossPnl.toFixed(2)),
    netPnl: Number(netPnl.toFixed(2)),
    expectancy: trades.length ? Number((netPnl / trades.length).toFixed(4)) : 0,
    profitFactor: grossL > 0 ? Number((grossW / grossL).toFixed(4)) : grossW > 0 ? 999 : 0,
    maxDrawdown: Number(maxDd.toFixed(4)),
    longTrades: trades.filter((t) => t.side === "LONG").length,
    shortTrades: trades.filter((t) => t.side === "SHORT").length,
  };
}

export function passesValidationGate(stats: AlphaStats, minTrades = 8): boolean {
  return stats.trades >= minTrades && stats.netPnl > 0 && stats.expectancy > 0 && stats.profitFactor > 1;
}

export function passesFinalGate(stats: AlphaStats, minTrades = 6): boolean {
  return stats.trades >= minTrades && stats.netPnl > 0 && stats.expectancy > 0 && stats.profitFactor > 1;
}

function nearestFunding(funding: FundingPoint[], time: number) {
  let best: FundingPoint | null = null;
  for (const row of funding) {
    if (row.fundingTime <= time) best = row;
  }
  return best;
}

function nearestBasis(basis: BasisPoint[], time: number) {
  let best: BasisPoint | null = null;
  for (const row of basis) {
    if (row.closeTime <= time) best = row;
  }
  return best;
}

function barReturnPct(bars: FuturesBar[], idx: number, lookback: number) {
  const entry = bars[idx]?.close ?? 0;
  const past = bars[Math.max(0, idx - lookback)]?.close ?? entry;
  if (entry <= 0 || past <= 0) return 0;
  return ((entry - past) / past) * 100;
}

function takerBuyRatio(bar: FuturesBar) {
  if (!bar.quoteVolume) return 0.5;
  return bar.takerBuyQuote / bar.quoteVolume;
}

function buildTrade(input: {
  panel: SymbolMicroPanel;
  idx: number;
  holdHours: number;
  side: TradeSide;
  split: DataSplit;
  hypothesis: HypothesisName;
  costPct: number;
  note?: string;
}): AlphaTrade | null {
  const bar = input.panel.bars[input.idx];
  const exitIdx = input.idx + input.holdHours;
  const exitBar = input.panel.bars[exitIdx];
  if (!bar || !exitBar) return null;
  const gross = grossReturnPct(input.side, bar.close, exitBar.close);
  const fundingPnl = fundingPnlDuringHold(
    input.side,
    input.panel.funding,
    bar.closeTime,
    exitBar.closeTime,
  );
  const net = netAfterFuturesCost(gross, fundingPnl, input.costPct);
  return {
    entryTime: bar.closeTime,
    exitTime: exitBar.closeTime,
    symbol: input.panel.symbol,
    side: input.side,
    grossReturnPct: gross,
    fundingPnlPct: fundingPnl,
    feeCostPct: input.costPct,
    netReturnPct: net,
    split: input.split,
    hypothesis: input.hypothesis,
    holdHours: input.holdHours,
    note: input.note,
  };
}

export function simulateHypothesis(
  name: HypothesisName,
  panel: SymbolMicroPanel,
  idx: number,
  split: DataSplit,
  costPct: number,
): AlphaTrade | null {
  const bar = panel.bars[idx];
  if (!bar) return null;
  const fund = nearestFunding(panel.funding, bar.closeTime);
  const basis = nearestBasis(panel.basis, bar.closeTime);
  const prevFund = nearestFunding(panel.funding, bar.closeTime - 8 * 3_600_000);
  const funding = fund?.fundingRate ?? 0;
  const prevFunding = prevFund?.fundingRate ?? funding;
  const fundingDelta = funding - prevFunding;
  const premium = basis?.premium ?? 0;
  const takerRatio = takerBuyRatio(bar);
  const priceRet1h = barReturnPct(panel.bars, idx, 1);
  const prevTaker = takerBuyRatio(panel.bars[Math.max(0, idx - 1)] ?? bar);

  switch (name) {
    case "FUNDING_EXTREME_NEGATIVE_LONG":
      if (funding > -0.0003) return null;
      return buildTrade({ panel, idx, holdHours: 8, side: "LONG", split, hypothesis: name, costPct });
    case "FUNDING_EXTREME_POSITIVE_SHORT":
      if (funding < 0.0003) return null;
      return buildTrade({ panel, idx, holdHours: 8, side: "SHORT", split, hypothesis: name, costPct });
    case "FUNDING_MEAN_REVERSION":
      if (funding > 0.0005) {
        return buildTrade({ panel, idx, holdHours: 8, side: "SHORT", split, hypothesis: name, costPct });
      }
      if (funding < -0.0005) {
        return buildTrade({ panel, idx, holdHours: 8, side: "LONG", split, hypothesis: name, costPct });
      }
      return null;
    case "FUNDING_ACCELERATION_FADE":
      if (fundingDelta > 0.00015) {
        return buildTrade({ panel, idx, holdHours: 8, side: "SHORT", split, hypothesis: name, costPct });
      }
      if (fundingDelta < -0.00015) {
        return buildTrade({ panel, idx, holdHours: 8, side: "LONG", split, hypothesis: name, costPct });
      }
      return null;
    case "BASIS_EXTREME_DISCOUNT_LONG":
      if (premium > -0.001) return null;
      return buildTrade({ panel, idx, holdHours: 8, side: "LONG", split, hypothesis: name, costPct });
    case "BASIS_EXTREME_PREMIUM_SHORT":
      if (premium < 0.001) return null;
      return buildTrade({ panel, idx, holdHours: 8, side: "SHORT", split, hypothesis: name, costPct });
    case "BASIS_NORMALIZATION_FADE":
      if (premium > 0.0015) {
        return buildTrade({ panel, idx, holdHours: 4, side: "SHORT", split, hypothesis: name, costPct });
      }
      if (premium < -0.0015) {
        return buildTrade({ panel, idx, holdHours: 4, side: "LONG", split, hypothesis: name, costPct });
      }
      return null;
    case "TAKER_IMBALANCE_LONG":
      if (takerRatio < 0.55) return null;
      return buildTrade({ panel, idx, holdHours: 4, side: "LONG", split, hypothesis: name, costPct });
    case "TAKER_IMBALANCE_SHORT":
      if (takerRatio > 0.45) return null;
      return buildTrade({ panel, idx, holdHours: 4, side: "SHORT", split, hypothesis: name, costPct });
    case "CVD_DIVERGENCE_SHORT":
      if (priceRet1h > 0.25 && takerRatio < prevTaker - 0.03) {
        return buildTrade({ panel, idx, holdHours: 4, side: "SHORT", split, hypothesis: name, costPct });
      }
      return null;
    case "CVD_DIVERGENCE_LONG":
      if (priceRet1h < -0.25 && takerRatio > prevTaker + 0.03) {
        return buildTrade({ panel, idx, holdHours: 4, side: "LONG", split, hypothesis: name, costPct });
      }
      return null;
    case "FUNDING_BASIS_CONFLUENCE_LONG":
      if (funding < -0.0002 && premium < -0.0005) {
        return buildTrade({ panel, idx, holdHours: 8, side: "LONG", split, hypothesis: name, costPct });
      }
      return null;
    case "FUNDING_BASIS_CONFLUENCE_SHORT":
      if (funding > 0.0002 && premium > 0.0005) {
        return buildTrade({ panel, idx, holdHours: 8, side: "SHORT", split, hypothesis: name, costPct });
      }
      return null;
    default:
      return null;
  }
}

export function runHypothesisAcrossUniverse(input: {
  panels: SymbolMicroPanel[];
  hypothesis: HypothesisName;
  startIdx: number;
  endIdx: number;
  stepHours: number;
  splitOf: (time: number) => DataSplit;
  costPct: number;
}): AlphaTrade[] {
  const trades: AlphaTrade[] = [];
  for (let idx = input.startIdx; idx < input.endIdx; idx += input.stepHours) {
    const t = input.panels[0]?.bars[idx]?.closeTime ?? 0;
    const split = input.splitOf(t);
    for (const panel of input.panels) {
      const trade = simulateHypothesis(input.hypothesis, panel, idx, split, input.costPct);
      if (trade) trades.push(trade);
    }
  }
  return trades;
}

export type OiQuadrant = "PRICE_UP_OI_UP" | "PRICE_UP_OI_DOWN" | "PRICE_DOWN_OI_UP" | "PRICE_DOWN_OI_DOWN";

export function classifyOiQuadrant(priceChangePct: number, oiChangePct: number): OiQuadrant | null {
  if (Math.abs(priceChangePct) < 0.05 || Math.abs(oiChangePct) < 0.05) return null;
  if (priceChangePct > 0 && oiChangePct > 0) return "PRICE_UP_OI_UP";
  if (priceChangePct > 0 && oiChangePct < 0) return "PRICE_UP_OI_DOWN";
  if (priceChangePct < 0 && oiChangePct > 0) return "PRICE_DOWN_OI_UP";
  return "PRICE_DOWN_OI_DOWN";
}

export function computeOiQuadrantOutcomes(
  panel: SymbolMicroPanel,
  holdHours: number,
): Array<{ quadrant: OiQuadrant; avgReturnPct: number; samples: number }> {
  const buckets = new Map<OiQuadrant, number[]>();
  if (panel.openInterest.length < 10) return [];
  for (let i = 12; i < panel.bars.length - holdHours; i += 1) {
    const bar = panel.bars[i];
    const prev = panel.bars[i - 12];
    const exit = panel.bars[i + holdHours];
    if (!bar || !prev || !exit) continue;
    const oiNow = panel.openInterest.find((r) => r.timestamp <= bar.closeTime);
    const oiPrev = panel.openInterest.find((r) => r.timestamp <= prev.closeTime);
    if (!oiNow || !oiPrev || oiPrev.openInterest <= 0) continue;
    const priceChange = ((bar.close - prev.close) / prev.close) * 100;
    const oiChange = ((oiNow.openInterest - oiPrev.openInterest) / oiPrev.openInterest) * 100;
    const quadrant = classifyOiQuadrant(priceChange, oiChange);
    if (!quadrant) continue;
    const ret = ((exit.close - bar.close) / bar.close) * 100;
    const arr = buckets.get(quadrant) ?? [];
    arr.push(ret);
    buckets.set(quadrant, arr);
  }
  return [...buckets.entries()].map(([quadrant, rets]) => ({
    quadrant,
    avgReturnPct: rets.reduce((s, r) => s + r, 0) / rets.length,
    samples: rets.length,
  }));
}

export function resolveBtcRegime(btcBars: FuturesBar[], idx: number): "UPTREND" | "DOWNTREND" | "SIDEWAYS" | "HIGH_VOL" {
  const r24 = barReturnPct(btcBars, idx, 24);
  const slice = btcBars.slice(Math.max(1, idx - 14), idx + 1);
  let atr = 0;
  for (let i = 1; i < slice.length; i += 1) {
    atr += Math.max(
      slice[i].high - slice[i].low,
      Math.abs(slice[i].high - slice[i - 1].close),
      Math.abs(slice[i].low - slice[i - 1].close),
    );
  }
  const price = slice.at(-1)?.close ?? 1;
  const atrPct = price > 0 ? (atr / Math.max(slice.length - 1, 1) / price) * 100 : 0;
  if (atrPct > 2.5) return "HIGH_VOL";
  if (r24 > 1.2) return "UPTREND";
  if (r24 < -1.2) return "DOWNTREND";
  return "SIDEWAYS";
}

export function signalDecayProfile(
  panel: SymbolMicroPanel,
  hypothesis: HypothesisName,
  idx: number,
  horizons: number[],
  costPct: number,
): Array<{ horizonHours: number; netReturnPct: number }> {
  const bar = panel.bars[idx];
  if (!bar) return [];
  return horizons.map((holdHours) => {
    const trade = buildTrade({
      panel,
      idx,
      holdHours,
      side: hypothesis.includes("SHORT") ? "SHORT" : "LONG",
      split: "TRAIN",
      hypothesis,
      costPct,
    });
    return { horizonHours: holdHours, netReturnPct: trade?.netReturnPct ?? 0 };
  });
}
