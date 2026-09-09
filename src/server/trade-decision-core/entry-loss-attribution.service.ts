import type { TrySpotTradeRecord } from "./types";

export function attributeEntryLosses(trade: {
  entryPrice: number;
  signalTryPrice: number;
  costPct: number;
  mfePct: number;
  maePct: number;
  grossReturnPct: number;
  entryAtMs: number;
  signalAtMs: number;
  metadataRegimeNegative?: boolean;
}) {
  const slipPct = Math.max(0, ((trade.entryPrice - trade.signalTryPrice) / trade.signalTryPrice) * 100);
  const costDrag = trade.costPct;
  const giveback = Math.max(0, trade.mfePct - trade.grossReturnPct);
  const thesisBreak = trade.maePct < -0.5 ? Math.abs(trade.maePct) : 0;
  const adverseSelection = slipPct;
  const staleSignal = trade.entryAtMs - trade.signalAtMs > 15 * 60_000 ? 1 : 0;
  const regimeMismatch = trade.metadataRegimeNegative ? 1 : 0;
  return {
    adverseSelectionPct: Number(adverseSelection.toFixed(4)),
    costDragPct: Number(costDrag.toFixed(4)),
    givebackPct: Number(giveback.toFixed(4)),
    thesisBreakPct: Number(thesisBreak.toFixed(4)),
    staleSignalFlag: staleSignal,
    regimeMismatchFlag: regimeMismatch,
  };
}

export function aggregateLossAttribution(trades: TrySpotTradeRecord[]) {
  const keys = ["adverseSelectionPct", "costDragPct", "givebackPct", "thesisBreakPct", "staleSignalFlag", "regimeMismatchFlag"] as const;
  const out: Record<string, number> = {};
  for (const k of keys) {
    out[k] = trades.length ? trades.reduce((s, t) => s + Number(t.lossAttribution[k] ?? 0), 0) / trades.length : 0;
  }
  return out;
}
