import type { DataQaReport, ExternalDataKind, ExternalSymbolPanel } from "./external-market-data.types";

function qaSeries(
  symbol: string,
  kind: ExternalDataKind,
  timestamps: number[],
  expectedStart: number,
  expectedEnd: number,
  expectedGapMs: number,
): DataQaReport {
  if (!timestamps.length) {
    return {
      symbol,
      kind,
      coveragePct: 0,
      missingPct: 100,
      stalePct: 0,
      duplicatePct: 0,
      ordered: true,
      gapCount: 0,
      recordCount: 0,
      pass: false,
    };
  }
  const sorted = [...timestamps].sort((a, b) => a - b);
  const ordered = timestamps.every((t, i) => i === 0 || timestamps[i] >= timestamps[i - 1]);
  const dupes = timestamps.length - new Set(timestamps).size;
  let gaps = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] - sorted[i - 1] > expectedGapMs * 2) gaps += 1;
  }
  const span = expectedEnd - expectedStart;
  const coverage = span > 0 ? Math.min(100, ((sorted.at(-1)! - sorted[0]) / span) * 100) : 0;
  const expectedPoints = span / expectedGapMs;
  const missing = expectedPoints > 0 ? Math.max(0, 100 - (sorted.length / expectedPoints) * 100) : 0;
  return {
    symbol,
    kind,
    coveragePct: Number(coverage.toFixed(2)),
    missingPct: Number(missing.toFixed(2)),
    stalePct: 0,
    duplicatePct: timestamps.length ? Number(((dupes / timestamps.length) * 100).toFixed(2)) : 0,
    ordered,
    gapCount: gaps,
    recordCount: timestamps.length,
    pass: coverage >= 50 && ordered && dupes === 0,
  };
}

export function runExternalDataQa(panel: ExternalSymbolPanel, start: number, end: number): DataQaReport[] {
  return [
    qaSeries(panel.symbol, "OHLCV", panel.bars.map((b) => b.closeTime), start, end, 3_600_000),
    qaSeries(panel.symbol, "FUNDING", panel.funding.map((f) => f.fundingTime), start, end, 8 * 3_600_000),
    qaSeries(panel.symbol, "OPEN_INTEREST", panel.openInterest.map((o) => o.timestamp), start, end, 3_600_000),
    qaSeries(panel.symbol, "AGG_TRADES", panel.aggTrades.map((a) => a.timestamp), start, end, 3_600_000),
    qaSeries(panel.symbol, "LIQUIDATION", panel.liquidations.map((l) => l.timestamp), start, end, 3_600_000),
    qaSeries(panel.symbol, "LONG_SHORT_RATIO", panel.longShortRatio.map((l) => l.timestamp), start, end, 3_600_000),
  ];
}

export function aggregateQaSummary(reports: DataQaReport[]) {
  const byKind = new Map<ExternalDataKind, { pass: number; total: number; avgCoverage: number }>();
  for (const r of reports) {
    const cur = byKind.get(r.kind) ?? { pass: 0, total: 0, avgCoverage: 0 };
    cur.total += 1;
    if (r.pass) cur.pass += 1;
    cur.avgCoverage += r.coveragePct;
    byKind.set(r.kind, cur);
  }
  return [...byKind.entries()].map(([kind, v]) => ({
    kind,
    symbolsPassing: v.pass,
    symbolsTotal: v.total,
    avgCoveragePct: v.total ? Number((v.avgCoverage / v.total).toFixed(2)) : 0,
    available: v.pass > 0,
  }));
}

export function dataQaPass(reports: DataQaReport[], requiredKinds: ExternalDataKind[] = ["OHLCV", "FUNDING"]) {
  const summary = aggregateQaSummary(reports);
  return requiredKinds.every((kind) => {
    const row = summary.find((s) => s.kind === kind);
    return row && row.avgCoveragePct >= 40;
  });
}
