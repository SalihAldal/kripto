import type { Pr05TradeOutcome } from "@/src/server/profitability/pr05-types";

export function aggregateTradeOutcomes(input: {
  outcomes: Pr05TradeOutcome[];
  variantKey: string;
  strategyId: Pr05TradeOutcome["strategyId"] | "PORTFOLIO";
  exitPolicyId: Pr05TradeOutcome["exitPolicyId"] | null;
  comparisonType: "MATCHED_EXIT" | "PORTFOLIO_REPLAY";
  split?: Pr05TradeOutcome["split"] | "ALL";
}) {
  const scoped =
    input.split && input.split !== "ALL"
      ? input.outcomes.filter((o) => o.split === input.split)
      : input.outcomes.filter((o) => o.split !== "UNASSIGNED" || input.split === "ALL");
  const closed = scoped.filter((o) => o.closed && !o.censored && o.netPnl != null);
  const censoredCount = scoped.filter((o) => o.censored).length;
  const nets = closed.map((o) => o.netPnl!);
  const wins = closed.filter((o) => (o.netPnl ?? 0) > 0);
  const losses = closed.filter((o) => (o.netPnl ?? 0) < 0);
  const netExpectancy =
    closed.length > 0 ? Number((nets.reduce((a, b) => a + b, 0) / closed.length).toFixed(8)) : null;
  const winRate = closed.length > 0 ? Number((wins.length / closed.length).toFixed(6)) : null;
  const grossWins = wins.reduce((a, o) => a + (o.netPnl ?? 0), 0);
  const grossLosses = Math.abs(losses.reduce((a, o) => a + (o.netPnl ?? 0), 0));
  const profitFactor =
    grossLosses > 0 ? Number((grossWins / grossLosses).toFixed(6)) : grossWins > 0 ? null : null;
  const largestWinner = closed.length ? Math.max(...closed.map((o) => o.netPnl ?? 0)) : null;
  const totalNet = nets.reduce((a, b) => a + b, 0);
  const largestWinnerShare =
    largestWinner != null && totalNet > 0 ? Number((largestWinner / totalNet).toFixed(6)) : null;
  const bySymbol = new Map<string, number>();
  for (const row of closed) {
    const key = row.symbol ?? "UNKNOWN";
    bySymbol.set(key, (bySymbol.get(key) ?? 0) + (row.netPnl ?? 0));
  }
  let topSymbolShare: number | null = null;
  if (totalNet > 0 && bySymbol.size > 0) {
    const top = Math.max(...bySymbol.values());
    topSymbolShare = Number((top / totalNet).toFixed(6));
  }
  let maxDrawdown: number | null = null;
  if (closed.length > 0) {
    let peak = 0;
    let equity = 0;
    let maxDd = 0;
    for (const row of closed.sort((a, b) => a.entryAtMs - b.entryAtMs)) {
      equity += row.netPnl ?? 0;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDd) maxDd = dd;
    }
    maxDrawdown = Number(maxDd.toFixed(8));
  }
  return {
    variantKey: input.variantKey,
    strategyId: input.strategyId,
    exitPolicyId: input.exitPolicyId,
    comparisonType: input.comparisonType,
    observedCount: scoped.length,
    closedTradeCount: closed.length,
    censoredCount,
    netExpectancy,
    netExpectancyStatus:
      closed.length === 0 ? ("INSUFFICIENT_DATA" as const) : nets.some((n) => !Number.isFinite(n)) ? ("UNKNOWN" as const) : ("KNOWN" as const),
    winRate,
    profitFactor,
    maxDrawdown,
    largestWinnerShare,
    topSymbolShare,
    costStressSurvives: null,
  };
}

export function computeNetExpectancyFromPnls(pnls: number[]) {
  const valid = pnls.filter((n) => Number.isFinite(n));
  if (!valid.length) return null;
  return Number((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(8));
}
