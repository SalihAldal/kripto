import type { KlineItem } from "@/src/types/exchange";

export const PARADIGM_NAMES = [
  "CROSS_SECTIONAL_RELATIVE_STRENGTH",
  "BTC_REGIME_CONDITIONED_ROTATION",
  "MULTI_DAY_SWING_MOMENTUM",
  "CROSS_SECTIONAL_MEAN_REVERSION",
  "VOLATILITY_BREAKOUT_SWING",
  "RELATIVE_STRENGTH_ROTATION_BASKET",
  "PAIR_RELATIVE_VALUE",
] as const;

export type ParadigmName = (typeof PARADIGM_NAMES)[number];

export const PARADIGM_COST = {
  roundTripFeePct: 0.3,
  realisticSlippageRtPct: 0.14,
  realisticRoundTripPct: 0.44,
  stressSlippageRtPct: 0.7,
  stressRoundTripPct: 1.0,
  slippageBpsPerSide: 7,
} as const;

export type ParadigmTrade = {
  entryTime: number;
  exitTime: number;
  symbols: string[];
  grossReturnPct: number;
  netReturnPct: number;
  split: "TRAIN" | "VALIDATION" | "TEST";
  paradigm: ParadigmName;
  note?: string;
};

export type ParadigmStats = {
  trades: number;
  wins: number;
  losses: number;
  grossPnl: number;
  netPnl: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdown: number;
  turnover: number;
};

export type SymbolPanel = {
  symbol: string;
  klines: KlineItem[];
  quoteAsset: string;
};

function returnPct(klines: KlineItem[], idx: number, lookbackMin: number) {
  const entry = klines[idx]?.close ?? 0;
  const pastIdx = Math.max(0, idx - lookbackMin);
  const past = klines[pastIdx]?.close ?? entry;
  if (past <= 0 || entry <= 0) return 0;
  return ((entry - past) / past) * 100;
}

function atrPct(klines: KlineItem[], idx: number, period = 14) {
  const slice = klines.slice(Math.max(1, idx - period), idx + 1);
  if (slice.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < slice.length; i += 1) {
    const tr = Math.max(
      slice[i].high - slice[i].low,
      Math.abs(slice[i].high - slice[i - 1].close),
      Math.abs(slice[i].low - slice[i - 1].close),
    );
    sum += tr;
  }
  const price = slice.at(-1)?.close ?? 1;
  return price > 0 ? (sum / (slice.length - 1) / price) * 100 : 0;
}

function holdReturn(klines: KlineItem[], idx: number, holdMin: number) {
  const entry = klines[idx]?.close ?? 0;
  const exitIdx = Math.min(klines.length - 1, idx + holdMin);
  const exit = klines[exitIdx]?.close ?? entry;
  if (entry <= 0) return 0;
  return ((exit - entry) / entry) * 100;
}

function netAfterCost(grossPct: number, roundTripCost: number) {
  return grossPct - roundTripCost;
}

export { netAfterCost };

export function computeParadigmStats(trades: ParadigmTrade[], notionalPerTrade = 1000): ParadigmStats {
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
    turnover: trades.length,
  };
}

export function resolveBtcRegime(btc: KlineItem[], idx: number): "UPTREND" | "DOWNTREND" | "SIDEWAYS" | "HIGH_VOL" {
  const r24 = returnPct(btc, idx, 24 * 60);
  const vol = atrPct(btc, idx, 60);
  if (vol > 2.5) return "HIGH_VOL";
  if (r24 > 1.2) return "UPTREND";
  if (r24 < -1.2) return "DOWNTREND";
  return "SIDEWAYS";
}

export function rankUniverseAt(panel: SymbolPanel[], idx: number, lookbackMin: number) {
  return panel
    .map((p) => ({
      symbol: p.symbol,
      ret: returnPct(p.klines, idx, lookbackMin),
      vol: atrPct(p.klines, idx),
      quote: p.quoteAsset,
    }))
    .filter((r) => Number.isFinite(r.ret))
    .sort((a, b) => b.ret - a.ret);
}

function basketGross(panel: SymbolPanel[], idx: number, symbols: string[], holdMin: number) {
  const rets = symbols.map((sym) => {
    const item = panel.find((p) => p.symbol === sym);
    if (!item) return 0;
    return holdReturn(item.klines, idx, holdMin);
  });
  return rets.length ? rets.reduce((s, r) => s + r, 0) / rets.length : 0;
}

export function simulateCrossSectionalRS(input: {
  panel: SymbolPanel[];
  idx: number;
  split: ParadigmTrade["split"];
  holdMin: number;
  topN: number;
  lookbackMin: number;
  costPct: number;
}): ParadigmTrade | null {
  const ranked = rankUniverseAt(input.panel, input.idx, input.lookbackMin);
  if (ranked.length < 4) return null;
  const picks = ranked.slice(0, input.topN).map((r) => r.symbol);
  const gross = basketGross(input.panel, input.idx, picks, input.holdMin);
  const entry = input.panel[0]?.klines[input.idx]?.closeTime ?? 0;
  const exitIdx = Math.min((input.panel[0]?.klines.length ?? 1) - 1, input.idx + input.holdMin);
  return {
    entryTime: entry,
    exitTime: input.panel[0]?.klines[exitIdx]?.closeTime ?? entry,
    symbols: picks,
    grossReturnPct: gross,
    netReturnPct: netAfterCost(gross, input.costPct),
    split: input.split,
    paradigm: "CROSS_SECTIONAL_RELATIVE_STRENGTH",
  };
}

export function simulateBtcRegimeRotation(input: {
  panel: SymbolPanel[];
  btc: KlineItem[];
  idx: number;
  split: ParadigmTrade["split"];
  holdMin: number;
  costPct: number;
}): ParadigmTrade | null {
  const regime = resolveBtcRegime(input.btc, input.idx);
  if (regime === "DOWNTREND" || regime === "HIGH_VOL") {
    return {
      entryTime: input.btc[input.idx]?.closeTime ?? 0,
      exitTime: input.btc[Math.min(input.btc.length - 1, input.idx + input.holdMin)]?.closeTime ?? 0,
      symbols: [],
      grossReturnPct: 0,
      netReturnPct: 0,
      split: input.split,
      paradigm: "BTC_REGIME_CONDITIONED_ROTATION",
      note: "CASH",
    };
  }
  const ranked = rankUniverseAt(input.panel, input.idx, 24 * 60);
  const picks = ranked.slice(0, 3).map((r) => r.symbol);
  const gross = basketGross(input.panel, input.idx, picks, input.holdMin);
  const exitIdx = Math.min((input.panel[0]?.klines.length ?? 1) - 1, input.idx + input.holdMin);
  return {
    entryTime: input.panel[0]?.klines[input.idx]?.closeTime ?? 0,
    exitTime: input.panel[0]?.klines[exitIdx]?.closeTime ?? 0,
    symbols: picks,
    grossReturnPct: gross,
    netReturnPct: netAfterCost(gross, input.costPct),
    split: input.split,
    paradigm: "BTC_REGIME_CONDITIONED_ROTATION",
    note: regime,
  };
}

export function simulateMultiDaySwing(input: {
  panel: SymbolPanel[];
  idx: number;
  split: ParadigmTrade["split"];
  holdMin: number;
  costPct: number;
}): ParadigmTrade | null {
  const ranked = rankUniverseAt(input.panel, input.idx, 24 * 60);
  if (ranked.length < 8) return null;
  const q = Math.floor(ranked.length * 0.25);
  const top = ranked.slice(0, q);
  const pick = top.find((r) => returnPct(input.panel.find((p) => p.symbol === r.symbol)!.klines, input.idx, 12 * 60) > 0);
  if (!pick) return null;
  const gross = holdReturn(input.panel.find((p) => p.symbol === pick.symbol)!.klines, input.idx, input.holdMin);
  const exitIdx = Math.min((input.panel[0]?.klines.length ?? 1) - 1, input.idx + input.holdMin);
  return {
    entryTime: input.panel[0]?.klines[input.idx]?.closeTime ?? 0,
    exitTime: input.panel[0]?.klines[exitIdx]?.closeTime ?? 0,
    symbols: [pick.symbol],
    grossReturnPct: gross,
    netReturnPct: netAfterCost(gross, input.costPct),
    split: input.split,
    paradigm: "MULTI_DAY_SWING_MOMENTUM",
  };
}

export function simulateCrossSectionalMeanReversion(input: {
  panel: SymbolPanel[];
  idx: number;
  split: ParadigmTrade["split"];
  holdMin: number;
  costPct: number;
}): ParadigmTrade | null {
  const ranked = rankUniverseAt(input.panel, input.idx, 12 * 60);
  if (ranked.length < 8) return null;
  const median = ranked[Math.floor(ranked.length / 2)]?.ret ?? 0;
  const under = ranked.filter((r) => r.ret < median - 0.4).slice(-3);
  if (!under.length) return null;
  const picks = under.map((r) => r.symbol);
  const gross = basketGross(input.panel, input.idx, picks, input.holdMin);
  const exitIdx = Math.min((input.panel[0]?.klines.length ?? 1) - 1, input.idx + input.holdMin);
  return {
    entryTime: input.panel[0]?.klines[input.idx]?.closeTime ?? 0,
    exitTime: input.panel[0]?.klines[exitIdx]?.closeTime ?? 0,
    symbols: picks,
    grossReturnPct: gross,
    netReturnPct: netAfterCost(gross, input.costPct),
    split: input.split,
    paradigm: "CROSS_SECTIONAL_MEAN_REVERSION",
  };
}

export function simulateVolatilityBreakoutSwing(input: {
  panel: SymbolPanel[];
  idx: number;
  split: ParadigmTrade["split"];
  holdMin: number;
  costPct: number;
}): ParadigmTrade | null {
  const candidates = input.panel
    .map((p) => ({
      symbol: p.symbol,
      atr: atrPct(p.klines, input.idx, 14),
      atrPast: atrPct(p.klines, Math.max(0, input.idx - 12 * 60), 14),
      ret4h: returnPct(p.klines, input.idx, 4 * 60),
      volRatio: (() => {
        const v = p.klines.slice(Math.max(0, input.idx - 20), input.idx + 1).map((k) => k.volume);
        const recent = v.slice(-5).reduce((s, x) => s + x, 0) / 5;
        const base = v.reduce((s, x) => s + x, 0) / Math.max(1, v.length);
        return base > 0 ? recent / base : 1;
      })(),
    }))
    .filter((c) => c.atrPast > 0 && c.atr / c.atrPast < 0.85 && c.volRatio > 1.15 && c.ret4h > 0.35);
  if (!candidates.length) return null;
  const pick = candidates.sort((a, b) => b.ret4h - a.ret4h)[0];
  const gross = holdReturn(input.panel.find((p) => p.symbol === pick.symbol)!.klines, input.idx, input.holdMin);
  const exitIdx = Math.min((input.panel[0]?.klines.length ?? 1) - 1, input.idx + input.holdMin);
  return {
    entryTime: input.panel[0]?.klines[input.idx]?.closeTime ?? 0,
    exitTime: input.panel[0]?.klines[exitIdx]?.closeTime ?? 0,
    symbols: [pick.symbol],
    grossReturnPct: gross,
    netReturnPct: netAfterCost(gross, input.costPct),
    split: input.split,
    paradigm: "VOLATILITY_BREAKOUT_SWING",
  };
}

export function simulateBasketRotation(input: {
  panel: SymbolPanel[];
  idx: number;
  split: ParadigmTrade["split"];
  holdMin: number;
  topN: number;
  costPct: number;
}): ParadigmTrade | null {
  const ranked = rankUniverseAt(input.panel, input.idx, 24 * 60);
  const picks = ranked.slice(0, input.topN).map((r) => r.symbol);
  const gross = basketGross(input.panel, input.idx, picks, input.holdMin);
  const exitIdx = Math.min((input.panel[0]?.klines.length ?? 1) - 1, input.idx + input.holdMin);
  return {
    entryTime: input.panel[0]?.klines[input.idx]?.closeTime ?? 0,
    exitTime: input.panel[0]?.klines[exitIdx]?.closeTime ?? 0,
    symbols: picks,
    grossReturnPct: gross,
    netReturnPct: netAfterCost(gross, input.costPct),
    split: input.split,
    paradigm: "RELATIVE_STRENGTH_ROTATION_BASKET",
  };
}

export function simulatePairRelativeValue(input: {
  panel: SymbolPanel[];
  idx: number;
  split: ParadigmTrade["split"];
  holdMin: number;
  costPct: number;
}): ParadigmTrade | null {
  if (input.panel.length < 2) return null;
  let bestPair: { a: string; b: string; z: number } | null = null;
  for (let i = 0; i < input.panel.length; i += 1) {
    for (let j = i + 1; j < input.panel.length; j += 1) {
      const a = input.panel[i];
      const b = input.panel[j];
      const ra = returnPct(a.klines, input.idx, 24 * 60);
      const rb = returnPct(b.klines, input.idx, 24 * 60);
      const z = ra - rb;
      if (!bestPair || Math.abs(z) > Math.abs(bestPair.z)) bestPair = { a: a.symbol, b: b.symbol, z };
    }
  }
  if (!bestPair || Math.abs(bestPair.z) < 1.5) return null;
  const longSym = bestPair.z > 0 ? bestPair.a : bestPair.b;
  const gross = holdReturn(input.panel.find((p) => p.symbol === longSym)!.klines, input.idx, input.holdMin);
  const exitIdx = Math.min((input.panel[0]?.klines.length ?? 1) - 1, input.idx + input.holdMin);
  return {
    entryTime: input.panel[0]?.klines[input.idx]?.closeTime ?? 0,
    exitTime: input.panel[0]?.klines[exitIdx]?.closeTime ?? 0,
    symbols: [longSym],
    grossReturnPct: gross,
    netReturnPct: netAfterCost(gross, input.costPct),
    split: input.split,
    paradigm: "PAIR_RELATIVE_VALUE",
    note: "NOT_DIRECTLY_DEPLOYABLE_SPOT_LONG_ONLY_PROXY",
  };
}

export function passesValidationGate(stats: ParadigmStats, minTrades = 8): boolean {
  return stats.trades >= minTrades && stats.netPnl > 0 && stats.expectancy > 0 && stats.profitFactor > 1;
}

export function passesFinalGate(stats: ParadigmStats, minTrades = 6): boolean {
  return stats.trades >= minTrades && stats.netPnl > 0 && stats.expectancy > 0 && stats.profitFactor > 1;
}
