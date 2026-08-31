import { laneTable, summarizeTrades, type ClosedTrade } from "@/src/server/paper-runtime/performance";

export function costAttribution(input: {
  rawMovePct: number;
  spreadPct: number;
  entrySlippagePct: number;
  exitSlippagePct: number;
  feePct: number;
  capturedPct: number;
}) {
  return {
    rawMovePct: input.rawMovePct,
    spreadPct: input.spreadPct,
    entrySlippagePct: input.entrySlippagePct,
    exitSlippagePct: input.exitSlippagePct,
    feePct: input.feePct,
    capturedPct: input.capturedPct,
    residualPct: Number(
      (input.rawMovePct - input.spreadPct - input.entrySlippagePct - input.exitSlippagePct - input.feePct - input.capturedPct).toFixed(4),
    ),
  };
}

export function captureRatio(theoreticalMovePct: number, capturedPct: number) {
  if (theoreticalMovePct <= 0) return null;
  return capturedPct / theoreticalMovePct;
}

export function scoreBuckets(trades: ClosedTrade[]) {
  const cuts = [
    { id: "80-84", min: 80, max: 85 },
    { id: "85-89", min: 85, max: 90 },
    { id: "90-94", min: 90, max: 95 },
    { id: "95+", min: 95, max: 101 },
  ];
  return cuts.map((cut) => {
    const rows = trades.filter((row) => row.score >= cut.min && row.score < cut.max);
    return { bucket: cut.id, ...summarizeTrades({ startEquity: 0, equity: 0, peak: 0, maxDrawdown: 0, unrealized: 0, trades: rows }) };
  });
}

export { laneTable, summarizeTrades };
