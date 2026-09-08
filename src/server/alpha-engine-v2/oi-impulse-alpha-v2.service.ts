import {
  fundingPnlDuringHold,
  grossReturnPct,
  netAfterCost,
  resolveRoundTripCostPct,
} from "./cost-model-v2.service";
import { assertNoLookahead } from "./lookahead-guard";
import type { ExternalSymbolPanel } from "./external-market-data.types";
import { buildOiFeatures } from "./oi-features.service";
import type { AlphaTradeRecord } from "./types";

export const OI_IMPULSE_ALPHA_VERSION = "v2.0.0";

export type OiImpulseAlphaId =
  | "OI_IMPULSE_LONG"
  | "OI_IMPULSE_SHORT"
  | "OI_IMPULSE_LONG_V2"
  | "OI_IMPULSE_SHORT_V2"
  | "OI_IMPULSE_LONG_V2_FUNDING"
  | "OI_IMPULSE_LONG_V2_CVD";

export const OI_IMPULSE_V1_CONTRACT = {
  alphaId: "OI_IMPULSE_LONG",
  entry: {
    priceReturn4hPctMin: 0.3,
    oiDeltaPctMin: 1.5,
    fundingRateMax: 0.0003,
  },
  holdHours: 8,
  side: "LONG",
  note: "PRICE_UP_OI_UP",
  exit: "time-based hold",
  cost: "FUTURES realistic round-trip",
} as const;

export type OiImpulseVariant = "OI_ONLY" | "OI_FUNDING" | "OI_BASIS" | "OI_FUNDING_BASIS" | "OI_CVD";

function nearestFunding(panel: ExternalSymbolPanel, time: number) {
  let best = panel.funding[0];
  for (const row of panel.funding) {
    if (row.fundingTime <= time) best = row;
  }
  return best;
}

function nearestBasis(panel: ExternalSymbolPanel, time: number) {
  let best = panel.basis[0];
  for (const row of panel.basis) {
    if (row.closeTime <= time) best = row;
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

function buildTrade(input: {
  panel: ExternalSymbolPanel;
  idx: number;
  holdHours: number;
  side: "LONG" | "SHORT";
  split: AlphaTradeRecord["split"];
  alphaId: OiImpulseAlphaId;
  costPct: number;
  note?: string;
}): AlphaTradeRecord | null {
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

export function evaluateOiImpulseAtBar(input: {
  alphaId: OiImpulseAlphaId;
  panel: ExternalSymbolPanel;
  idx: number;
  split: AlphaTradeRecord["split"];
  costPct: number;
  variant?: OiImpulseVariant;
  holdHours?: number;
}): AlphaTradeRecord | null {
  const { alphaId, panel, idx, split, costPct } = input;
  const holdHours = input.holdHours ?? 8;
  const bar = panel.bars[idx];
  if (!bar || panel.availability.OPEN_INTEREST === "UNAVAILABLE") return null;

  const feat = buildOiFeatures(panel, idx);
  if (!feat) return null;

  const fund = nearestFunding(panel, bar.closeTime)?.fundingRate ?? 0;
  const basis = nearestBasis(panel, bar.closeTime)?.premium ?? 0;
  const cvd = nearestCvd(panel, bar.closeTime);
  const prevCvd = nearestCvd(panel, panel.bars[idx - 4]?.closeTime ?? bar.closeTime);
  const variant = input.variant ?? "OI_ONLY";

  if (alphaId === "OI_IMPULSE_LONG") {
    if (feat.priceReturn4h > 0.3 && feat.oiDeltaPct > 1.5 && fund <= 0.0003) {
      return buildTrade({ panel, idx, holdHours, side: "LONG", split, alphaId, costPct, note: "V1_PRICE_UP_OI_UP" });
    }
    return null;
  }
  if (alphaId === "OI_IMPULSE_SHORT") {
    if (feat.priceReturn4h < -0.3 && feat.oiDeltaPct > 1.5 && fund >= -0.0001) {
      return buildTrade({ panel, idx, holdHours, side: "SHORT", split, alphaId, costPct, note: "V1_PRICE_DOWN_OI_UP" });
    }
    return null;
  }

  const longCore =
    feat.priceReturn4h > 0.15 &&
    feat.oiDeltaPct > 0.8 &&
    feat.oiPercentile >= 0.75 &&
    feat.oiZScore > 0.5;
  const shortCore =
    feat.priceReturn4h < -0.15 &&
    feat.oiDeltaPct > 0.8 &&
    feat.oiPercentile >= 0.75 &&
    feat.oiZScore > 0.5;

  const fundingLongOk = fund <= 0.00025;
  const fundingShortOk = fund >= -0.00005;
  const basisLongOk = basis <= 0.001;
  const basisShortOk = basis >= -0.001;
  const cvdLongOk = cvd && prevCvd ? cvd.cvd > prevCvd.cvd : true;
  const cvdShortOk = cvd && prevCvd ? cvd.cvd < prevCvd.cvd : true;

  if (alphaId === "OI_IMPULSE_LONG_V2" || alphaId === "OI_IMPULSE_LONG_V2_FUNDING" || alphaId === "OI_IMPULSE_LONG_V2_CVD") {
    if (!longCore) return null;
    if (variant === "OI_FUNDING" || alphaId === "OI_IMPULSE_LONG_V2_FUNDING") {
      if (!fundingLongOk) return null;
    }
    if (variant === "OI_BASIS" && !basisLongOk) return null;
    if (variant === "OI_FUNDING_BASIS" && (!fundingLongOk || !basisLongOk)) return null;
    if (variant === "OI_CVD" || alphaId === "OI_IMPULSE_LONG_V2_CVD") {
      if (panel.availability.CVD === "UNAVAILABLE" || !cvdLongOk) return null;
    }
    return buildTrade({ panel, idx, holdHours, side: "LONG", split, alphaId, costPct, note: `V2_${variant}` });
  }

  if (alphaId === "OI_IMPULSE_SHORT_V2") {
    if (!shortCore) return null;
    if (variant === "OI_FUNDING" && !fundingShortOk) return null;
    if (variant === "OI_BASIS" && !basisShortOk) return null;
    if (variant === "OI_FUNDING_BASIS" && (!fundingShortOk || !basisShortOk)) return null;
    if (variant === "OI_CVD" && (panel.availability.CVD === "UNAVAILABLE" || !cvdShortOk)) return null;
    return buildTrade({ panel, idx, holdHours, side: "SHORT", split, alphaId, costPct, note: `V2_${variant}` });
  }

  return null;
}

export function runOiImpulseSimulation(input: {
  alphaId: OiImpulseAlphaId;
  panels: ExternalSymbolPanel[];
  startIdx: number;
  endIdx: number;
  stepHours: number;
  startTime: number;
  endTime: number;
  split: AlphaTradeRecord["split"];
  costScenario?: "REALISTIC" | "STRESS";
  variant?: OiImpulseVariant;
  holdHours?: number;
  slippageMultiplier?: number;
}) {
  const baseCost = resolveRoundTripCostPct("FUTURES", input.costScenario ?? "REALISTIC");
  const costPct = baseCost * (input.slippageMultiplier ?? 1);
  const trades: AlphaTradeRecord[] = [];
  for (let idx = input.startIdx; idx < input.endIdx; idx += input.stepHours) {
    const t = input.panels[0]?.bars[idx]?.closeTime ?? 0;
    if (t < input.startTime || t > input.endTime) continue;
    for (const panel of input.panels) {
      const trade = evaluateOiImpulseAtBar({
        alphaId: input.alphaId,
        panel,
        idx,
        split: input.split,
        costPct,
        variant: input.variant,
        holdHours: input.holdHours,
      });
      if (trade) trades.push(trade);
    }
  }
  return trades;
}

export function computeMfeMae(trades: AlphaTradeRecord[], panels: ExternalSymbolPanel[]) {
  return trades.map((t) => {
    const panel = panels.find((p) => p.symbol === t.symbol);
    if (!panel) return { ...t, mfe: 0, mae: 0 };
    const entryIdx = panel.bars.findIndex((b) => b.closeTime === t.entryTime);
    const exitIdx = panel.bars.findIndex((b) => b.closeTime === t.exitTime);
    if (entryIdx < 0 || exitIdx < 0) return { ...t, mfe: 0, mae: 0 };
    const entry = panel.bars[entryIdx].close;
    const slice = panel.bars.slice(entryIdx, exitIdx + 1);
    const high = slice.reduce((m, b) => Math.max(m, b.high), entry);
    const low = slice.reduce((m, b) => Math.min(m, b.low), entry);
    const mfe = t.side === "LONG" ? ((high - entry) / entry) * 100 : ((entry - low) / entry) * 100;
    const mae = t.side === "LONG" ? ((low - entry) / entry) * 100 : ((entry - high) / entry) * 100;
    return { symbol: t.symbol, entryTime: t.entryTime, mfe: Number(mfe.toFixed(4)), mae: Number(mae.toFixed(4)), netReturnPct: t.netReturnPct };
  });
}
