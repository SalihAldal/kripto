import type { ProfitabilityExperimentRegistry, StrategyRegimeMatrixReport } from "@/src/server/forensics/forensic.types";

function esc(value: unknown) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(rows: Array<Record<string, unknown>>, columns: string[]) {
  const header = columns.join(",");
  const body = rows.map((row) => columns.map((col) => esc(row[col])).join(",")).join("\n");
  return `${header}\n${body}\n`;
}

export function buildStrategyRegimeMatrixCsv(report: StrategyRegimeMatrixReport) {
  const rows = report.cells.map((cell) => ({
    strategy: cell.strategy,
    regime: cell.regime,
    tradeCount: cell.tradeCount,
    winRate: cell.winRate,
    grossPnL: cell.grossPnL,
    fees: cell.fees,
    netPnL: cell.netPnL,
    expectancy: cell.expectancy,
    profitFactor: cell.profitFactor,
    maxDrawdown: cell.maxDrawdown ?? 0,
    sampleSize: cell.sampleSize,
    sampleLabel: cell.sampleLabel,
  }));
  return toCsv(rows, [
    "strategy",
    "regime",
    "tradeCount",
    "winRate",
    "grossPnL",
    "fees",
    "netPnL",
    "expectancy",
    "profitFactor",
    "maxDrawdown",
    "sampleSize",
    "sampleLabel",
  ]);
}

export function buildProfitabilityExperimentsCsv(registry: ProfitabilityExperimentRegistry) {
  const rows = registry.experiments.map((exp) => ({
    experimentId: exp.experimentId,
    baseline: exp.baseline,
    variant: exp.variant,
    hypothesis: exp.hypothesis,
    sample: exp.sample,
    tradeCount: exp.metrics.tradeCount,
    winRate: exp.metrics.winRate,
    grossPnL: exp.metrics.grossPnL,
    fees: exp.metrics.fees,
    netPnL: exp.metrics.netPnL,
    expectancy: exp.metrics.expectancy,
    profitFactor: exp.metrics.profitFactor,
    maxDrawdown: exp.metrics.maxDrawdown,
    feeDragRatio: exp.metrics.feeDragRatio,
    promotionStatus: exp.promotionStatus,
  }));
  return toCsv(rows, [
    "experimentId",
    "baseline",
    "variant",
    "hypothesis",
    "sample",
    "tradeCount",
    "winRate",
    "grossPnL",
    "fees",
    "netPnL",
    "expectancy",
    "profitFactor",
    "maxDrawdown",
    "feeDragRatio",
    "promotionStatus",
  ]);
}
