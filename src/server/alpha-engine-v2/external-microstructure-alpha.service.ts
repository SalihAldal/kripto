import {
  fundingPnlDuringHold,
  grossReturnPct,
  netAfterCost,
  resolveRoundTripCostPct,
} from "./cost-model-v2.service";
import { assertNoLookahead } from "./lookahead-guard";
import type { ExternalSymbolPanel } from "./external-market-data.types";
import type { AlphaTradeRecord } from "./types";

export const EXTERNAL_MICROSTRUCTURE_ALPHA_VERSION = "v1.0.0";

export const EXTERNAL_ALPHA_IDS = [
  "OI_IMPULSE_LONG",
  "OI_IMPULSE_SHORT",
  "LONG_LIQUIDATION_REVERSAL",
  "SHORT_LIQUIDATION_REVERSAL",
  "CVD_PRICE_DIVERGENCE_LONG",
  "CVD_PRICE_DIVERGENCE_SHORT",
  "OI_FUNDING_DISLOCATION_LONG",
  "OI_FUNDING_DISLOCATION_SHORT",
  "LIQUIDATION_OI_EXHAUSTION_LONG",
  "LIQUIDATION_OI_EXHAUSTION_SHORT",
  "ORDER_BOOK_IMBALANCE_LONG",
  "ORDER_BOOK_IMBALANCE_SHORT",
] as const;

export type ExternalAlphaId = (typeof EXTERNAL_ALPHA_IDS)[number];

function barIdxAt(panel: ExternalSymbolPanel, time: number) {
  let idx = -1;
  for (let i = 0; i < panel.bars.length; i += 1) {
    if (panel.bars[i].closeTime <= time) idx = i;
    else break;
  }
  return idx;
}

function nearestOi(panel: ExternalSymbolPanel, time: number) {
  let best = panel.openInterest[0];
  for (const row of panel.openInterest) {
    if (row.timestamp <= time) best = row;
  }
  return best;
}

function nearestFunding(panel: ExternalSymbolPanel, time: number) {
  let best = panel.funding[0];
  for (const row of panel.funding) {
    if (row.fundingTime <= time) best = row;
  }
  return best;
}

function nearestCvd(panel: ExternalSymbolPanel, time: number) {
  let best = panel.cvd[0];
  for (const row of panel.cvd) {
    if (row.timestamp <= time) best = row;
  }
  return best;
}

function returnPct(panel: ExternalSymbolPanel, idx: number, lookback: number) {
  const cur = panel.bars[idx]?.close ?? 0;
  const prev = panel.bars[idx - lookback]?.close ?? cur;
  if (!cur || !prev) return 0;
  return ((cur - prev) / prev) * 100;
}

function oiDeltaPct(panel: ExternalSymbolPanel, idx: number, lookback = 4) {
  const bar = panel.bars[idx];
  if (!bar) return 0;
  const now = nearestOi(panel, bar.closeTime);
  const prevBar = panel.bars[idx - lookback];
  const prev = prevBar ? nearestOi(panel, prevBar.closeTime) : now;
  if (!now || !prev || prev.openInterest <= 0) return 0;
  return ((now.openInterest - prev.openInterest) / prev.openInterest) * 100;
}

function liquidationStats(panel: ExternalSymbolPanel, idx: number, lookbackHours = 4) {
  const bar = panel.bars[idx];
  if (!bar) return { longLiq: 0, shortLiq: 0, total: 0, imbalance: 0 };
  const start = bar.closeTime - lookbackHours * 3_600_000;
  let longLiq = 0;
  let shortLiq = 0;
  for (const ev of panel.liquidations) {
    if (ev.timestamp < start || ev.timestamp > bar.closeTime) continue;
    if (ev.side === "SELL") longLiq += ev.notional;
    else shortLiq += ev.notional;
  }
  const total = longLiq + shortLiq;
  return { longLiq, shortLiq, total, imbalance: total > 0 ? (shortLiq - longLiq) / total : 0 };
}

function buildTrade(input: {
  panel: ExternalSymbolPanel;
  idx: number;
  holdHours: number;
  side: "LONG" | "SHORT" | "CASH";
  split: AlphaTradeRecord["split"];
  alphaId: ExternalAlphaId;
  costPct: number;
  note?: string;
}): AlphaTradeRecord | null {
  if (input.side === "CASH") return null;
  const bar = input.panel.bars[input.idx];
  const exit = input.panel.bars[input.idx + input.holdHours];
  if (!bar || !exit) return null;
  assertNoLookahead(bar.closeTime, bar.closeTime, "entry");
  const gross = grossReturnPct(input.side, bar.close, exit.close);
  const funding = fundingPnlDuringHold(
    input.side,
    input.panel.funding.map((f) => ({ fundingTime: f.fundingTime, fundingRate: f.fundingRate })),
    bar.closeTime,
    exit.closeTime,
  );
  return {
    entryTime: bar.closeTime,
    exitTime: exit.closeTime,
    symbol: input.panel.symbol,
    side: input.side,
    grossReturnPct: gross,
    fundingPnlPct: funding,
    feeCostPct: input.costPct,
    netReturnPct: netAfterCost(gross, funding, input.costPct),
    split: input.split,
    alphaId: input.alphaId,
    note: input.note,
  };
}

export function evaluateExternalAlphaAtBar(input: {
  alphaId: ExternalAlphaId;
  panel: ExternalSymbolPanel;
  idx: number;
  split: AlphaTradeRecord["split"];
  costPct: number;
}): AlphaTradeRecord | null {
  const { alphaId, panel, idx, split, costPct } = input;
  const bar = panel.bars[idx];
  if (!bar || idx < 24) return null;

  const priceRet4 = returnPct(panel, idx, 4);
  const priceRet12 = returnPct(panel, idx, 12);
  const oiDelta = oiDeltaPct(panel, idx, 4);
  const fund = nearestFunding(panel, bar.closeTime)?.fundingRate ?? 0;
  const cvd = nearestCvd(panel, bar.closeTime);
  const prevCvd = nearestCvd(panel, panel.bars[idx - 4]?.closeTime ?? bar.closeTime);
  const liq = liquidationStats(panel, idx, 4);

  switch (alphaId) {
    case "OI_IMPULSE_LONG":
      if (panel.availability.OPEN_INTEREST === "UNAVAILABLE") return null;
      if (priceRet4 > 0.3 && oiDelta > 1.5 && fund <= 0.0003) {
        return buildTrade({ panel, idx, holdHours: 8, side: "LONG", split, alphaId, costPct, note: "PRICE_UP_OI_UP" });
      }
      return null;
    case "OI_IMPULSE_SHORT":
      if (panel.availability.OPEN_INTEREST === "UNAVAILABLE") return null;
      if (priceRet4 < -0.3 && oiDelta > 1.5 && fund >= -0.0001) {
        return buildTrade({ panel, idx, holdHours: 8, side: "SHORT", split, alphaId, costPct, note: "PRICE_DOWN_OI_UP" });
      }
      return null;
    case "LONG_LIQUIDATION_REVERSAL":
      if (panel.availability.LIQUIDATION === "UNAVAILABLE") return null;
      if (liq.longLiq > liq.shortLiq * 2 && liq.total > 0 && priceRet4 < -0.5) {
        return buildTrade({ panel, idx, holdHours: 4, side: "LONG", split, alphaId, costPct, note: "LONG_LIQ_EXHAUSTION" });
      }
      return null;
    case "SHORT_LIQUIDATION_REVERSAL":
      if (panel.availability.LIQUIDATION === "UNAVAILABLE") return null;
      if (liq.shortLiq > liq.longLiq * 2 && liq.total > 0 && priceRet4 > 0.5) {
        return buildTrade({ panel, idx, holdHours: 4, side: "SHORT", split, alphaId, costPct, note: "SHORT_LIQ_EXHAUSTION" });
      }
      return null;
    case "CVD_PRICE_DIVERGENCE_LONG":
      if (panel.availability.CVD === "UNAVAILABLE") return null;
      if (priceRet4 < -0.4 && cvd && prevCvd && cvd.cvd > prevCvd.cvd) {
        return buildTrade({ panel, idx, holdHours: 4, side: "LONG", split, alphaId, costPct, note: "PRICE_DOWN_CVD_UP" });
      }
      return null;
    case "CVD_PRICE_DIVERGENCE_SHORT":
      if (panel.availability.CVD === "UNAVAILABLE") return null;
      if (priceRet4 > 0.4 && cvd && prevCvd && cvd.cvd < prevCvd.cvd) {
        return buildTrade({ panel, idx, holdHours: 4, side: "SHORT", split, alphaId, costPct, note: "PRICE_UP_CVD_DOWN" });
      }
      return null;
    case "OI_FUNDING_DISLOCATION_LONG":
      if (panel.availability.OPEN_INTEREST === "UNAVAILABLE") return null;
      if (fund < -0.0002 && oiDelta > 0.8 && priceRet12 < 0) {
        return buildTrade({ panel, idx, holdHours: 8, side: "LONG", split, alphaId, costPct });
      }
      return null;
    case "OI_FUNDING_DISLOCATION_SHORT":
      if (panel.availability.OPEN_INTEREST === "UNAVAILABLE") return null;
      if (fund > 0.0002 && oiDelta > 0.8 && priceRet12 > 0) {
        return buildTrade({ panel, idx, holdHours: 8, side: "SHORT", split, alphaId, costPct });
      }
      return null;
    case "LIQUIDATION_OI_EXHAUSTION_LONG":
      if (panel.availability.LIQUIDATION === "UNAVAILABLE" || panel.availability.OPEN_INTEREST === "UNAVAILABLE") return null;
      if (liq.longLiq > 0 && oiDelta < -1 && priceRet4 < -0.3) {
        return buildTrade({ panel, idx, holdHours: 8, side: "LONG", split, alphaId, costPct });
      }
      return null;
    case "LIQUIDATION_OI_EXHAUSTION_SHORT":
      if (panel.availability.LIQUIDATION === "UNAVAILABLE" || panel.availability.OPEN_INTEREST === "UNAVAILABLE") return null;
      if (liq.shortLiq > 0 && oiDelta < -1 && priceRet4 > 0.3) {
        return buildTrade({ panel, idx, holdHours: 8, side: "SHORT", split, alphaId, costPct });
      }
      return null;
    case "ORDER_BOOK_IMBALANCE_LONG":
    case "ORDER_BOOK_IMBALANCE_SHORT":
      if (panel.availability.ORDER_BOOK === "UNAVAILABLE") return null;
      return null;
    default:
      return null;
  }
}

export function runExternalAlphaSimulation(input: {
  alphaId: ExternalAlphaId;
  panels: ExternalSymbolPanel[];
  startIdx: number;
  endIdx: number;
  stepHours: number;
  startTime: number;
  endTime: number;
  split: AlphaTradeRecord["split"];
  costScenario?: "REALISTIC" | "STRESS";
}) {
  const costPct = resolveRoundTripCostPct("FUTURES", input.costScenario ?? "REALISTIC");
  const trades: AlphaTradeRecord[] = [];
  for (let idx = input.startIdx; idx < input.endIdx; idx += input.stepHours) {
    const t = input.panels[0]?.bars[idx]?.closeTime ?? 0;
    if (t < input.startTime || t > input.endTime) continue;
    for (const panel of input.panels) {
      const trade = evaluateExternalAlphaAtBar({ alphaId: input.alphaId, panel, idx, split: input.split, costPct });
      if (trade) trades.push(trade);
    }
  }
  return trades;
}

export function pnlConcentrationExternal(trades: AlphaTradeRecord[]) {
  const bySymbol = new Map<string, number>();
  const byDay = new Map<string, number>();
  let total = 0;
  for (const t of trades) {
    const pnl = (t.netReturnPct / 100) * 1000;
    total += pnl;
    bySymbol.set(t.symbol, (bySymbol.get(t.symbol) ?? 0) + pnl);
    const day = new Date(t.entryTime).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + pnl);
  }
  const topSymbol = [...bySymbol.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  const topDay = [...byDay.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  return {
    topSymbolContributionPct: total !== 0 ? Number(((topSymbol?.[1] ?? 0) / total * 100).toFixed(2)) : 0,
    topDayContributionPct: total !== 0 ? Number(((topDay?.[1] ?? 0) / total * 100).toFixed(2)) : 0,
    topFoldContributionPct: 0,
    topSymbol: topSymbol?.[0] ?? "",
    topDay: topDay?.[0] ?? "",
  };
}

export function computePriceOiQuadrantForensic(panel: ExternalSymbolPanel, holdHours = 8) {
  const buckets = new Map<string, { long: number; short: number; cash: number; net: number }>();
  for (let idx = 24; idx < panel.bars.length - holdHours; idx += 4) {
    const priceRet = returnPct(panel, idx, 4);
    const oiDelta = oiDeltaPct(panel, idx, 4);
    if (Math.abs(priceRet) < 0.05 || Math.abs(oiDelta) < 0.05) continue;
    const key =
      priceRet > 0
        ? oiDelta > 0
          ? "PRICE_UP_OI_UP"
          : "PRICE_UP_OI_DOWN"
        : oiDelta > 0
          ? "PRICE_DOWN_OI_UP"
          : "PRICE_DOWN_OI_DOWN";
    const bar = panel.bars[idx];
    const exit = panel.bars[idx + holdHours];
    if (!bar || !exit) continue;
    const ret = ((exit.close - bar.close) / bar.close) * 100;
    const row = buckets.get(key) ?? { long: 0, short: 0, cash: 0, net: 0 };
    row.net += ret;
    if (ret > 0.1) row.long += 1;
    else if (ret < -0.1) row.short += 1;
    else row.cash += 1;
    buckets.set(key, row);
  }
  return [...buckets.entries()].map(([quadrant, v]) => ({ quadrant, ...v }));
}
