import {
  fundingPnlDuringHold,
  grossReturnPct,
  netAfterCost,
  resolveRoundTripCostPct,
} from "./cost-model-v2.service";
import {
  atrPct,
  estimateBeta,
  percentileRank,
  returnPct,
  takerBuyRatio,
  volumePersistenceRatio,
} from "./feature-registry.service";
import type { AlphaTradeRecord } from "./types";

export type HistoricalBar = {
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

export type SymbolHistoricalPanel = {
  symbol: string;
  bars: HistoricalBar[];
  funding: Array<{ fundingTime: number; fundingRate: number }>;
  basis: Array<{ closeTime: number; premium: number }>;
};

export type AlphaSimulatorId =
  | "RESIDUAL_MOMENTUM"
  | "CROSS_SECTIONAL_RESIDUAL_STRENGTH"
  | "VOLUME_PERSISTENCE_RESIDUAL"
  | "FUNDING_BASIS_DISLOCATION"
  | "CVD_REGIME_CONDITIONAL"
  | "LOW_TURNOVER_SWING"
  | "CASH_FILTER_REGIME"
  | "RESIDUAL_MOMENTUM_SHORT"
  | "BTC_REGIME_RESIDUAL_SHORT"
  | "RESIDUAL_MEAN_REVERSION"
  | "FUNDING_RESIDUAL_DIVERGENCE"
  | "LOW_TURNOVER_RESIDUAL_SWING"
  | "RESIDUAL_STRENGTH_LONG";

export const ALPHA_SIMULATOR_VERSION = "v2.1.0";

function nearestFunding(funding: SymbolHistoricalPanel["funding"], time: number) {
  let best: { fundingTime: number; fundingRate: number } | null = null;
  for (const row of funding) {
    if (row.fundingTime <= time) best = row;
  }
  return best;
}

function nearestBasis(basis: SymbolHistoricalPanel["basis"], time: number) {
  let best: { closeTime: number; premium: number } | null = null;
  for (const row of basis) {
    if (row.closeTime <= time) best = row;
  }
  return best;
}

function btcRegime(btc: HistoricalBar[], idx: number) {
  const closes = btc.map((b) => b.close);
  const r24 = returnPct(closes, idx, 24);
  const vol = atrPct(btc, idx, 60);
  if (vol > 2.5) return "HIGH_VOL";
  if (r24 > 1.2) return "UPTREND";
  if (r24 < -1.2) return "DOWNTREND";
  return "SIDEWAYS";
}

function buildTrade(input: {
  panel: SymbolHistoricalPanel;
  idx: number;
  holdHours: number;
  side: "LONG" | "SHORT" | "CASH";
  split: AlphaTradeRecord["split"];
  alphaId: AlphaSimulatorId;
  costPct: number;
  note?: string;
}): AlphaTradeRecord | null {
  if (input.side === "CASH") {
    const bar = input.panel.bars[input.idx];
    if (!bar) return null;
    return {
      entryTime: bar.closeTime,
      exitTime: bar.closeTime,
      symbol: input.panel.symbol,
      side: "CASH",
      grossReturnPct: 0,
      fundingPnlPct: 0,
      feeCostPct: 0,
      netReturnPct: 0,
      split: input.split,
      alphaId: input.alphaId,
      note: input.note ?? "CASH",
    };
  }
  const bar = input.panel.bars[input.idx];
  const exitBar = input.panel.bars[input.idx + input.holdHours];
  if (!bar || !exitBar) return null;
  const gross = grossReturnPct(input.side, bar.close, exitBar.close);
  const fundingPnl = fundingPnlDuringHold(input.side, input.panel.funding, bar.closeTime, exitBar.closeTime);
  return {
    entryTime: bar.closeTime,
    exitTime: exitBar.closeTime,
    symbol: input.panel.symbol,
    side: input.side,
    grossReturnPct: gross,
    fundingPnlPct: fundingPnl,
    feeCostPct: input.costPct,
    netReturnPct: netAfterCost(gross, fundingPnl, input.costPct),
    split: input.split,
    alphaId: input.alphaId,
    note: input.note,
  };
}

export function simulateAlphaAtBar(input: {
  alphaId: AlphaSimulatorId;
  panels: SymbolHistoricalPanel[];
  btc: HistoricalBar[];
  idx: number;
  split: AlphaTradeRecord["split"];
  costPct: number;
  allowedRegimes?: string[];
}): AlphaTradeRecord[] {
  const { alphaId, panels, btc, idx, split, costPct, allowedRegimes } = input;
  const regime = btcRegime(btc, Math.min(idx, btc.length - 1));
  if (allowedRegimes?.length && !allowedRegimes.includes(regime)) {
    return [];
  }
  const closesBySymbol = panels.map((p) => ({
    symbol: p.symbol,
    closes: p.bars.map((b) => b.close),
    panel: p,
  }));
  const btcCloses = btc.map((b) => b.close);

  switch (alphaId) {
    case "CASH_FILTER_REGIME":
      if (regime === "HIGH_VOL" || regime === "DOWNTREND") {
        return panels.map((p) => buildTrade({ panel: p, idx, holdHours: 0, side: "CASH", split, alphaId, costPct, note: regime })!);
      }
      break;
    case "RESIDUAL_MOMENTUM":
    case "RESIDUAL_MOMENTUM_SHORT":
    case "BTC_REGIME_RESIDUAL_SHORT": {
      const residuals = closesBySymbol.map((row) => {
        const beta = estimateBeta(row.closes, btcCloses, idx, 24);
        const symRet = returnPct(row.closes, idx, 24);
        const btcRet = returnPct(btcCloses, idx, 24);
        return { symbol: row.symbol, panel: row.panel, residual: symRet - beta * btcRet };
      });
      const values = residuals.map((r) => r.residual);
      const trades: AlphaTradeRecord[] = [];
      for (const row of residuals) {
        const pct = percentileRank(values, row.residual);
        if (alphaId === "RESIDUAL_MOMENTUM" && pct >= 0.8) {
          const t = buildTrade({ panel: row.panel, idx, holdHours: 8, side: "LONG", split, alphaId, costPct });
          if (t) trades.push(t);
        }
        if (
          (alphaId === "RESIDUAL_MOMENTUM_SHORT" || alphaId === "BTC_REGIME_RESIDUAL_SHORT") &&
          pct <= 0.2
        ) {
          const t = buildTrade({
            panel: row.panel,
            idx,
            holdHours: 8,
            side: "SHORT",
            split,
            alphaId: alphaId === "BTC_REGIME_RESIDUAL_SHORT" ? "BTC_REGIME_RESIDUAL_SHORT" : "RESIDUAL_MOMENTUM_SHORT",
            costPct,
          });
          if (t) trades.push(t);
        }
      }
      return trades;
    }
    case "RESIDUAL_STRENGTH_LONG": {
      const residuals = closesBySymbol.map((row) => {
        const beta = estimateBeta(row.closes, btcCloses, idx, 24);
        const symRet = returnPct(row.closes, idx, 24);
        const btcRet = returnPct(btcCloses, idx, 24);
        const vol = atrPct(row.panel.bars, idx, 14);
        return { panel: row.panel, score: (symRet - beta * btcRet) / Math.max(vol, 0.5) };
      });
      const values = residuals.map((r) => r.score);
      return residuals
        .filter((r) => percentileRank(values, r.score) >= 0.85 && r.score > 0.3)
        .map((r) => buildTrade({ panel: r.panel, idx, holdHours: 8, side: "LONG", split, alphaId, costPct }))
        .filter(Boolean) as AlphaTradeRecord[];
    }
    case "RESIDUAL_MEAN_REVERSION": {
      const trades: AlphaTradeRecord[] = [];
      for (const row of closesBySymbol) {
        const beta = estimateBeta(row.closes, btcCloses, idx, 24);
        const residual = returnPct(row.closes, idx, 12) - beta * returnPct(btcCloses, idx, 12);
        if (residual > 2.5) {
          const t = buildTrade({ panel: row.panel, idx, holdHours: 4, side: "SHORT", split, alphaId, costPct });
          if (t) trades.push(t);
        } else if (residual < -2.5) {
          const t = buildTrade({ panel: row.panel, idx, holdHours: 4, side: "LONG", split, alphaId, costPct });
          if (t) trades.push(t);
        }
      }
      return trades;
    }
    case "FUNDING_RESIDUAL_DIVERGENCE": {
      const trades: AlphaTradeRecord[] = [];
      for (const row of closesBySymbol) {
        const bar = row.panel.bars[idx];
        if (!bar) continue;
        const fund = nearestFunding(row.panel.funding, bar.closeTime)?.fundingRate ?? 0;
        const beta = estimateBeta(row.closes, btcCloses, idx, 24);
        const residual = returnPct(row.closes, idx, 12) - beta * returnPct(btcCloses, idx, 12);
        if (fund > 0.0003 && residual > 1.2) {
          const t = buildTrade({ panel: row.panel, idx, holdHours: 8, side: "SHORT", split, alphaId, costPct });
          if (t) trades.push(t);
        } else if (fund < -0.0003 && residual < -1.2) {
          const t = buildTrade({ panel: row.panel, idx, holdHours: 8, side: "LONG", split, alphaId, costPct });
          if (t) trades.push(t);
        }
      }
      return trades;
    }
    case "LOW_TURNOVER_RESIDUAL_SWING": {
      const ranked = closesBySymbol
        .map((row) => {
          const beta = estimateBeta(row.closes, btcCloses, idx, 24);
          const residual = returnPct(row.closes, idx, 48) - beta * returnPct(btcCloses, idx, 48);
          const vol = atrPct(row.panel.bars, idx, 24);
          return { panel: row.panel, residual, vol };
        })
        .filter((r) => Math.abs(r.residual) > 1.5 && r.vol < 3.5)
        .sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual))
        .slice(0, 2);
      return ranked
        .map((r) =>
          buildTrade({
            panel: r.panel,
            idx,
            holdHours: 12,
            side: r.residual > 0 ? "LONG" : "SHORT",
            split,
            alphaId,
            costPct,
          }),
        )
        .filter(Boolean) as AlphaTradeRecord[];
    }
    case "CROSS_SECTIONAL_RESIDUAL_STRENGTH": {
      const ranked = closesBySymbol
        .map((row) => {
          const beta = estimateBeta(row.closes, btcCloses, idx, 24);
          const symRet = returnPct(row.closes, idx, 12);
          const btcRet = returnPct(btcCloses, idx, 12);
          const volAdj = atrPct(row.panel.bars, idx, 14);
          const residual = (symRet - beta * btcRet) / Math.max(volAdj, 0.5);
          return { panel: row.panel, residual };
        })
        .sort((a, b) => b.residual - a.residual);
      const picks = ranked.slice(0, 3);
      return picks
        .filter((p) => p.residual > 0.5)
        .map((p) => buildTrade({ panel: p.panel, idx, holdHours: 8, side: "LONG", split, alphaId, costPct }))
        .filter(Boolean) as AlphaTradeRecord[];
    }
    case "VOLUME_PERSISTENCE_RESIDUAL": {
      const trades: AlphaTradeRecord[] = [];
      for (const row of closesBySymbol) {
        const beta = estimateBeta(row.closes, btcCloses, idx, 24);
        const symRet = returnPct(row.closes, idx, 12);
        const btcRet = returnPct(btcCloses, idx, 12);
        const residual = symRet - beta * btcRet;
        const volPersist = volumePersistenceRatio(row.panel.bars.map((b) => b.volume), idx, 12);
        if (residual > 0.8 && volPersist > 1.15) {
          const t = buildTrade({ panel: row.panel, idx, holdHours: 8, side: "LONG", split, alphaId, costPct });
          if (t) trades.push(t);
        }
      }
      return trades;
    }
    case "FUNDING_BASIS_DISLOCATION": {
      const trades: AlphaTradeRecord[] = [];
      for (const row of closesBySymbol) {
        const bar = row.panel.bars[idx];
        if (!bar) continue;
        const fund = nearestFunding(row.panel.funding, bar.closeTime)?.fundingRate ?? 0;
        const premium = nearestBasis(row.panel.basis, bar.closeTime)?.premium ?? 0;
        const beta = estimateBeta(row.closes, btcCloses, idx, 24);
        const residual = returnPct(row.closes, idx, 12) - beta * returnPct(btcCloses, idx, 12);
        if (fund < -0.0002 && premium < -0.0004 && residual > 0) {
          const t = buildTrade({ panel: row.panel, idx, holdHours: 8, side: "LONG", split, alphaId, costPct });
          if (t) trades.push(t);
        } else if (fund > 0.0002 && premium > 0.0004 && residual < 0) {
          const t = buildTrade({ panel: row.panel, idx, holdHours: 8, side: "SHORT", split, alphaId, costPct });
          if (t) trades.push(t);
        }
      }
      return trades;
    }
    case "CVD_REGIME_CONDITIONAL": {
      if (regime === "HIGH_VOL") return [];
      const trades: AlphaTradeRecord[] = [];
      for (const row of closesBySymbol) {
        const bar = row.panel.bars[idx];
        const prev = row.panel.bars[idx - 1];
        if (!bar || !prev) continue;
        const priceRet = returnPct(row.closes, idx, 1);
        const taker = takerBuyRatio(bar.quoteVolume, bar.takerBuyQuote);
        const prevTaker = takerBuyRatio(prev.quoteVolume, prev.takerBuyQuote);
        const beta = estimateBeta(row.closes, btcCloses, idx, 24);
        const residual = returnPct(row.closes, idx, 6) - beta * returnPct(btcCloses, idx, 6);
        if (regime === "UPTREND" && priceRet > 0.2 && taker < prevTaker - 0.03 && residual > 0) {
          const t = buildTrade({ panel: row.panel, idx, holdHours: 4, side: "SHORT", split, alphaId, costPct });
          if (t) trades.push(t);
        }
        if (regime === "DOWNTREND" && priceRet < -0.2 && taker > prevTaker + 0.03 && residual < 0) {
          const t = buildTrade({ panel: row.panel, idx, holdHours: 4, side: "LONG", split, alphaId, costPct });
          if (t) trades.push(t);
        }
      }
      return trades;
    }
    case "LOW_TURNOVER_SWING": {
      const ranked = closesBySymbol
        .map((row) => ({
          panel: row.panel,
          ret: returnPct(row.closes, idx, 48),
          vol: atrPct(row.panel.bars, idx, 24),
        }))
        .filter((r) => r.ret > 2 && r.vol < 3)
        .sort((a, b) => b.ret - a.ret)
        .slice(0, 2);
      return ranked
        .map((r) => buildTrade({ panel: r.panel, idx, holdHours: 24, side: "LONG", split, alphaId, costPct }))
        .filter(Boolean) as AlphaTradeRecord[];
    }
    default:
      return [];
  }
  return [];
}

export function runHistoricalAlphaSimulation(input: {
  alphaId: AlphaSimulatorId;
  panels: SymbolHistoricalPanel[];
  btc: HistoricalBar[];
  startIdx: number;
  endIdx: number;
  stepHours: number;
  splitOf: (time: number) => AlphaTradeRecord["split"];
  venue: "SPOT" | "FUTURES";
  costScenario?: "REALISTIC" | "STRESS";
  allowedRegimes?: string[];
}) {
  const costPct = resolveRoundTripCostPct(input.venue, input.costScenario ?? "REALISTIC");
  const trades: AlphaTradeRecord[] = [];
  for (let idx = input.startIdx; idx < input.endIdx; idx += input.stepHours) {
    const t = input.panels[0]?.bars[idx]?.closeTime ?? 0;
    const split = input.splitOf(t);
    trades.push(
      ...simulateAlphaAtBar({
        alphaId: input.alphaId,
        panels: input.panels,
        btc: input.btc,
        idx,
        split,
        costPct,
        allowedRegimes: input.allowedRegimes,
      }),
    );
  }
  return trades;
}

export const ALPHA_SIMULATOR_IDS: AlphaSimulatorId[] = [
  "RESIDUAL_MOMENTUM",
  "RESIDUAL_MOMENTUM_SHORT",
  "BTC_REGIME_RESIDUAL_SHORT",
  "RESIDUAL_STRENGTH_LONG",
  "CROSS_SECTIONAL_RESIDUAL_STRENGTH",
  "VOLUME_PERSISTENCE_RESIDUAL",
  "FUNDING_BASIS_DISLOCATION",
  "FUNDING_RESIDUAL_DIVERGENCE",
  "RESIDUAL_MEAN_REVERSION",
  "CVD_REGIME_CONDITIONAL",
  "LOW_TURNOVER_SWING",
  "LOW_TURNOVER_RESIDUAL_SWING",
  "CASH_FILTER_REGIME",
];
