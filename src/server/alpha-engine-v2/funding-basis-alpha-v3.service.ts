import {
  fundingPnlDuringHold,
  grossReturnPct,
  netAfterCost,
  resolveRoundTripCostPct,
  FUTURES_COST_REALISTIC,
} from "./cost-model-v2.service";
import { assertNoLookahead } from "./lookahead-guard";
import type { FundingBasisPanel } from "./funding-basis-data.service";
import type { HistoricalBar } from "./historical-alpha-simulator.service";
import type { AlphaSide, AlphaTradeRecord } from "./types";

export const FUNDING_BASIS_ALPHA_V3_ID = "FUNDING_BASIS_ALPHA_V3";
export const FUNDING_BASIS_ALPHA_V3_VERSION = "v3.0.0";

export type FundingBasisVariant = "FUNDING_ONLY" | "BASIS_ONLY" | "FUNDING_BASIS" | "FUNDING_BASIS_CONTEXT";

export type FundingBasisThresholds = {
  shortFundingPctileMin: number;
  longFundingPctileMax: number;
  shortBasisPctileMin: number;
  longBasisPctileMax: number;
  accelPctileExtreme: number;
  holdHours: number;
  variant: FundingBasisVariant;
};

export const DEFAULT_FUNDING_BASIS_THRESHOLDS: FundingBasisThresholds = {
  shortFundingPctileMin: 90,
  longFundingPctileMax: 10,
  shortBasisPctileMin: 75,
  longBasisPctileMax: 25,
  accelPctileExtreme: 90,
  holdHours: 8,
  variant: "FUNDING_BASIS",
};

export type FundingEventFeatures = {
  fundingTime: number;
  fundingRate: number;
  fundingRateBps: number;
  fundingPercentile: number;
  fundingZScore: number;
  fundingAccel: number;
  fundingAccelPercentile: number;
  basisPremium: number;
  basisPercentile: number;
  basisZScore: number;
  priceReturn4h: number;
  priceReturn12h: number;
  btcReturn4h: number;
  volumeRatio: number;
};

export type FundingBasisSignal = {
  alphaId: string;
  version: string;
  symbol: string;
  side: AlphaSide;
  eventTimestamp: number;
  fundingRateBps: number;
  basisPremiumBps: number;
  confidence: number;
  expectedGrossEdgeBps: number;
  expectedCostBps: number;
  expectedFundingImpactBps: number;
  expectedNetEdgeBps: number;
  holdingHorizonHours: number;
  reasonCodes: string[];
  features: FundingEventFeatures;
};

function percentileRank(values: number[], value: number) {
  if (!values.length) return 0.5;
  const below = values.filter((v) => v < value).length;
  return below / values.length;
}

function zScore(values: number[], value: number) {
  if (values.length < 3) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  const std = Math.sqrt(variance);
  return std > 0 ? (value - mean) / std : 0;
}

function barIndexAtOrBefore(bars: HistoricalBar[], time: number) {
  let idx = -1;
  for (let i = 0; i < bars.length; i += 1) {
    if (bars[i].closeTime <= time) idx = i;
    else break;
  }
  return idx;
}

function nearestBasis(basis: FundingBasisPanel["basis"], time: number) {
  let best: { closeTime: number; premium: number } | null = null;
  for (const row of basis) {
    if (row.closeTime <= time) best = row;
  }
  return best;
}

function returnPct(closes: number[], idx: number, lookback: number) {
  const prev = closes[idx - lookback];
  const cur = closes[idx];
  if (!prev || !cur || prev <= 0) return 0;
  return ((cur - prev) / prev) * 100;
}

export function buildFundingEventFeatures(input: {
  panel: FundingBasisPanel;
  btc: HistoricalBar[];
  eventIdx: number;
  historyFunding: number[];
  historyBasis: number[];
  historyAccel: number[];
}): FundingEventFeatures | null {
  const event = input.panel.funding[input.eventIdx];
  if (!event) return null;

  const barIdx = barIndexAtOrBefore(input.panel.bars, event.fundingTime);
  if (barIdx < 12) return null;

  assertNoLookahead(event.fundingTime, event.fundingTime, "funding_event");

  const closes = input.panel.bars.map((b) => b.close);
  const btcIdx = barIndexAtOrBefore(input.btc, event.fundingTime);
  const btcCloses = input.btc.map((b) => b.close);

  const basisRow = nearestBasis(input.panel.basis, event.fundingTime);
  const basisPremium = basisRow?.premium ?? NaN;

  const prevFunding = input.panel.funding[input.eventIdx - 1]?.fundingRate ?? event.fundingRate;
  const fundingAccel = event.fundingRate - prevFunding;

  const recentVol = input.panel.bars.slice(Math.max(0, barIdx - 24), barIdx).reduce((s, b) => s + b.volume, 0) / 24;
  const baseVol =
    input.panel.bars.slice(Math.max(0, barIdx - 72), Math.max(0, barIdx - 24)).reduce((s, b) => s + b.volume, 0) /
    Math.max(48, 1);

  return {
    fundingTime: event.fundingTime,
    fundingRate: event.fundingRate,
    fundingRateBps: event.fundingRate * 10_000,
    fundingPercentile: percentileRank(input.historyFunding, event.fundingRate) * 100,
    fundingZScore: zScore(input.historyFunding, event.fundingRate),
    fundingAccel,
    fundingAccelPercentile: percentileRank(input.historyAccel, fundingAccel) * 100,
    basisPremium,
    basisPercentile: Number.isFinite(basisPremium)
      ? percentileRank(input.historyBasis, basisPremium) * 100
      : 50,
    basisZScore: Number.isFinite(basisPremium) ? zScore(input.historyBasis, basisPremium) : 0,
    priceReturn4h: returnPct(closes, barIdx, 4),
    priceReturn12h: returnPct(closes, barIdx, 12),
    btcReturn4h: btcIdx >= 4 ? returnPct(btcCloses, btcIdx, 4) : 0,
    volumeRatio: baseVol > 0 ? recentVol / baseVol : 1,
  };
}

export function evaluateFundingEventSignal(
  features: FundingEventFeatures,
  thresholds: FundingBasisThresholds,
  hasBasis: boolean,
): FundingBasisSignal | null {
  const costBps = FUTURES_COST_REALISTIC.realisticRoundTripPct * 100;
  const expectedFundingImpactBps = features.fundingRateBps * (thresholds.holdHours / 8);

  const weakeningMomentum = features.priceReturn4h < features.priceReturn12h || features.priceReturn4h < 0;
  const exhaustion = features.priceReturn4h > 0 || features.priceReturn4h > features.priceReturn12h;

  const fundingShortOk =
    features.fundingPercentile >= thresholds.shortFundingPctileMin &&
    (thresholds.variant === "FUNDING_ONLY" ||
      !hasBasis ||
      thresholds.variant === "FUNDING_BASIS_CONTEXT" ||
      features.basisPercentile >= thresholds.shortBasisPctileMin);
  const fundingLongOk =
    features.fundingPercentile <= thresholds.longFundingPctileMax &&
    (thresholds.variant === "FUNDING_ONLY" ||
      !hasBasis ||
      thresholds.variant === "FUNDING_BASIS_CONTEXT" ||
      features.basisPercentile <= thresholds.longBasisPctileMax);

  const basisShortOk = hasBasis && features.basisPercentile >= thresholds.shortBasisPctileMin;
  const basisLongOk = hasBasis && features.basisPercentile <= thresholds.longBasisPctileMax;

  const accelShort =
    features.fundingAccelPercentile >= thresholds.accelPctileExtreme && features.fundingAccel > 0;
  const accelLong =
    features.fundingAccelPercentile <= 100 - thresholds.accelPctileExtreme && features.fundingAccel < 0;

  let side: AlphaSide = "CASH";
  const reasonCodes: string[] = [];

  if (thresholds.variant === "BASIS_ONLY") {
    if (basisShortOk && weakeningMomentum) {
      side = "SHORT";
      reasonCodes.push("H1_BASIS_EXTREME_PREMIUM", "MOMENTUM_WEAK");
    } else if (basisLongOk && exhaustion) {
      side = "LONG";
      reasonCodes.push("H2_BASIS_EXTREME_DISCOUNT", "EXHAUSTION");
    }
  } else if (thresholds.variant === "FUNDING_ONLY") {
    if (fundingShortOk && weakeningMomentum) {
      side = "SHORT";
      reasonCodes.push("H1_EXTREME_POSITIVE_FUNDING", "MOMENTUM_WEAK");
    } else if (fundingLongOk && exhaustion) {
      side = "LONG";
      reasonCodes.push("H2_EXTREME_NEGATIVE_FUNDING", "EXHAUSTION");
    } else if (accelShort && weakeningMomentum) {
      side = "SHORT";
      reasonCodes.push("H3_FUNDING_ACCEL_UP");
    } else if (accelLong && exhaustion) {
      side = "LONG";
      reasonCodes.push("H3_FUNDING_ACCEL_DOWN");
    }
  } else {
    if (fundingShortOk && (!hasBasis || basisShortOk) && weakeningMomentum) {
      side = "SHORT";
      reasonCodes.push("H1_FUNDING_BASIS_DISLOCATION_SHORT");
      if (features.fundingPercentile >= 95) reasonCodes.push("FUNDING_EXTREME");
    } else if (fundingLongOk && (!hasBasis || basisLongOk) && exhaustion) {
      side = "LONG";
      reasonCodes.push("H2_FUNDING_BASIS_DISLOCATION_LONG");
      if (features.fundingPercentile <= 5) reasonCodes.push("FUNDING_EXTREME");
    } else if (
      thresholds.variant === "FUNDING_BASIS_CONTEXT" &&
      fundingShortOk &&
      features.basisPercentile < thresholds.shortBasisPctileMin &&
      weakeningMomentum
    ) {
      side = "SHORT";
      reasonCodes.push("H4_FUNDING_BASIS_DIVERGENCE_SHORT");
    } else if (
      thresholds.variant === "FUNDING_BASIS_CONTEXT" &&
      fundingLongOk &&
      features.basisPercentile > thresholds.longBasisPctileMax &&
      exhaustion
    ) {
      side = "LONG";
      reasonCodes.push("H4_FUNDING_BASIS_DIVERGENCE_LONG");
    }
  }

  if (side === "CASH") return null;

  const grossEdgeBps = side === "SHORT" ? features.fundingRateBps * 2 : Math.abs(features.fundingRateBps) * 2;
  const netEdgeBps =
    grossEdgeBps - costBps + (side === "SHORT" ? expectedFundingImpactBps : -Math.abs(expectedFundingImpactBps));

  return {
    alphaId: side === "LONG" ? "FUNDING_DISLOCATION_LONG" : "FUNDING_DISLOCATION_SHORT",
    version: FUNDING_BASIS_ALPHA_V3_VERSION,
    symbol: "",
    side,
    eventTimestamp: features.fundingTime,
    fundingRateBps: features.fundingRateBps,
    basisPremiumBps: features.basisPremium * 10_000,
    confidence: Math.min(95, 50 + Math.abs(features.fundingPercentile - 50)),
    expectedGrossEdgeBps: grossEdgeBps,
    expectedCostBps: costBps,
    expectedFundingImpactBps,
    expectedNetEdgeBps: netEdgeBps,
    holdingHorizonHours: thresholds.holdHours,
    reasonCodes,
    features,
  };
}

export function simulateFundingBasisTrade(input: {
  panel: FundingBasisPanel;
  signal: FundingBasisSignal;
  split: AlphaTradeRecord["split"];
  costPct: number;
}): AlphaTradeRecord | null {
  const { panel, signal, split, costPct } = input;
  if (signal.side === "CASH") return null;
  if (!panelDataOk(panel)) return null;

  const entryIdx = barIndexAtOrBefore(panel.bars, signal.eventTimestamp);
  if (entryIdx < 0) return null;
  const entryBar = panel.bars[entryIdx];
  const exitBar = panel.bars[entryIdx + signal.holdingHorizonHours];
  if (!entryBar || !exitBar) return null;

  assertNoLookahead(signal.eventTimestamp, entryBar.closeTime, "entry_bar");

  const gross = grossReturnPct(signal.side, entryBar.close, exitBar.close);
  const fundingPnl = fundingPnlDuringHold(signal.side, panel.funding, entryBar.closeTime, exitBar.closeTime);

  return {
    entryTime: entryBar.closeTime,
    exitTime: exitBar.closeTime,
    symbol: panel.symbol,
    side: signal.side,
    grossReturnPct: gross,
    fundingPnlPct: fundingPnl,
    feeCostPct: costPct,
    netReturnPct: netAfterCost(gross, fundingPnl, costPct),
    split,
    alphaId: FUNDING_BASIS_ALPHA_V3_ID,
    note: signal.reasonCodes.join("|"),
  };
}

function panelDataOk(panel: FundingBasisPanel) {
  return panel.dataStates.funding === "AVAILABLE" && panel.dataStates.ohlcv === "AVAILABLE";
}

export function runFundingBasisEventSimulation(input: {
  panels: FundingBasisPanel[];
  btc: HistoricalBar[];
  startTime: number;
  endTime: number;
  thresholds: FundingBasisThresholds;
  split: AlphaTradeRecord["split"];
  costScenario?: "REALISTIC" | "STRESS";
}): { trades: AlphaTradeRecord[]; events: number; signals: number; cash: number } {
  const costPct = resolveRoundTripCostPct("FUTURES", input.costScenario ?? "REALISTIC");
  const trades: AlphaTradeRecord[] = [];
  let events = 0;
  let signals = 0;
  let cash = 0;

  for (const panel of input.panels) {
    if (!panelDataOk(panel)) continue;
    const hasBasis = panel.dataStates.basis === "AVAILABLE";

    for (let i = 1; i < panel.funding.length; i += 1) {
      const event = panel.funding[i];
      if (event.fundingTime < input.startTime || event.fundingTime > input.endTime) continue;
      events += 1;

      const historyFunding = panel.funding
        .slice(0, i)
        .map((f) => f.fundingRate)
        .filter((_, idx) => panel.funding[idx].fundingTime < event.fundingTime);
      const historyAccel = panel.funding
        .slice(1, i)
        .map((f, idx) => f.fundingRate - panel.funding[idx].fundingRate);
      const historyBasis = panel.basis
        .filter((b) => b.closeTime < event.fundingTime)
        .map((b) => b.premium)
        .filter((v) => Number.isFinite(v));

      if (historyFunding.length < 10) {
        cash += 1;
        continue;
      }
      if (
        (input.thresholds.variant === "BASIS_ONLY" || input.thresholds.variant === "FUNDING_BASIS") &&
        !hasBasis
      ) {
        cash += 1;
        continue;
      }

      const features = buildFundingEventFeatures({
        panel,
        btc: input.btc,
        eventIdx: i,
        historyFunding,
        historyBasis,
        historyAccel,
      });
      if (!features) {
        cash += 1;
        continue;
      }

      const signal = evaluateFundingEventSignal(features, input.thresholds, hasBasis);
      if (!signal) {
        cash += 1;
        continue;
      }
      signal.symbol = panel.symbol;
      signals += 1;

      const trade = simulateFundingBasisTrade({ panel, signal, split: input.split, costPct });
      if (trade) trades.push(trade);
    }
  }

  return { trades, events, signals, cash };
}

export function pnlConcentrationFunding(trades: AlphaTradeRecord[]) {
  const bySymbol = new Map<string, number>();
  const byDay = new Map<string, number>();
  let total = 0;
  for (const t of trades) {
    if (t.side === "CASH") continue;
    const pnl = (t.netReturnPct / 100) * 1000;
    total += pnl;
    bySymbol.set(t.symbol, (bySymbol.get(t.symbol) ?? 0) + pnl);
    byDay.set(new Date(t.entryTime).toISOString().slice(0, 10), (byDay.get(new Date(t.entryTime).toISOString().slice(0, 10)) ?? 0) + pnl);
  }
  const topSymbol = [...bySymbol.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  const topDay = [...byDay.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  return {
    topSymbolContributionPct: total !== 0 ? Number(((topSymbol?.[1] ?? 0) / total * 100).toFixed(2)) : 0,
    topDayContributionPct: total !== 0 ? Number(((topDay?.[1] ?? 0) / total * 100).toFixed(2)) : 0,
    topSymbol: topSymbol?.[0] ?? "",
    topDay: topDay?.[0] ?? "",
  };
}

export function splitLongShortStats(trades: AlphaTradeRecord[]) {
  const longs = trades.filter((t) => t.side === "LONG");
  const shorts = trades.filter((t) => t.side === "SHORT");
  const sum = (arr: AlphaTradeRecord[]) => arr.reduce((s, t) => s + (t.netReturnPct / 100) * 1000, 0);
  return {
    longTrades: longs.length,
    shortTrades: shorts.length,
    longNetPnl: Number(sum(longs).toFixed(2)),
    shortNetPnl: Number(sum(shorts).toFixed(2)),
  };
}
