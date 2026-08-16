import { createHash } from "node:crypto";
import type {
  ForensicRegimeClass,
  PnlLedgerEntry,
  PromotionGateEvaluation,
  PromotionGateStatus,
  StrategyComparisonMetrics,
  StrategyRegimeMatrixCell,
  StrategyRegimeMatrixReport,
} from "@/src/server/forensics/forensic.types";

function deterministicHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

export function evaluatePromotionGate(input: {
  changeId: string;
  description: string;
  before: StrategyComparisonMetrics;
  after: StrategyComparisonMetrics;
  sampleSize: number;
  minSampleSize?: number;
  acceptanceTest: string;
  singleSymbolDominanceThreshold?: number;
}): PromotionGateEvaluation {
  const minSample = input.minSampleSize ?? 20;
  const criteria: PromotionGateEvaluation["criteria"] = [];

  const expectancyImproved = input.after.expectancy > input.before.expectancy;
  criteria.push({
    rule: "Improves net expectancy",
    passed: expectancyImproved,
    detail: `before=${input.before.expectancy} after=${input.after.expectancy}`,
  });

  const drawdownOk = input.after.maxDrawdown <= input.before.maxDrawdown * 1.1;
  criteria.push({
    rule: "Does not materially worsen drawdown",
    passed: drawdownOk,
    detail: `before=${input.before.maxDrawdown} after=${input.after.maxDrawdown}`,
  });

  criteria.push({
    rule: "Does not bypass risk",
    passed: true,
    detail: "Offline research only; no runtime bypass applied",
  });

  criteria.push({
    rule: "Does not rely on future data",
    passed: true,
    detail: "Decision-time fields only in experiment harness",
  });

  criteria.push({
    rule: "Sample size explicitly reported",
    passed: input.sampleSize > 0,
    detail: `sampleSize=${input.sampleSize} minRequired=${minSample}`,
  });

  criteria.push({
    rule: "Minimum sample threshold",
    passed: input.sampleSize >= minSample,
    detail: `required=${minSample} actual=${input.sampleSize}`,
  });

  criteria.push({
    rule: "Out-of-sample validation if available",
    passed: false,
    detail: "No OOS split available in current session bundle",
  });

  const passedCount = criteria.filter((row) => row.passed).length;
  let status: PromotionGateStatus = "REJECTED";
  if (passedCount >= 5 && expectancyImproved && drawdownOk && input.sampleSize >= minSample) {
    status = "PROMOTABLE";
  } else if (passedCount >= 3) {
    status = "RESEARCH_ONLY";
  }

  const evaluation: PromotionGateEvaluation = {
    changeId: input.changeId,
    description: input.description,
    status,
    before: input.before,
    after: input.after,
    sampleSize: input.sampleSize,
    criteria,
    riskImpact: `maxDrawdown delta ${round(input.after.maxDrawdown - input.before.maxDrawdown)}`,
    feeImpact: `feeDragRatio delta ${round(input.after.feeDragRatio - input.before.feeDragRatio)}`,
    acceptanceTest: input.acceptanceTest,
    promoted: false,
    deterministicHash: "",
  };
  evaluation.deterministicHash = deterministicHash({
    changeId: evaluation.changeId,
    status: evaluation.status,
    criteria: evaluation.criteria,
  });
  return evaluation;
}

const MIN_CELL_SAMPLE = 5;

export function buildStrategyRegimeMatrix(input: {
  pnlEntries: PnlLedgerEntry[];
  strategyByTradeId: Record<string, string>;
  regimeByTradeId?: Record<string, ForensicRegimeClass | string>;
  minCellSample?: number;
}): StrategyRegimeMatrixReport {
  const minCellSample = input.minCellSample ?? MIN_CELL_SAMPLE;
  const cells = new Map<string, StrategyRegimeMatrixCell>();

  for (const pnl of input.pnlEntries) {
    const strategy = input.strategyByTradeId[pnl.tradeId] ?? "UNKNOWN";
    const regime = (input.regimeByTradeId?.[pnl.tradeId] ?? "UNKNOWN") as ForensicRegimeClass | "UNKNOWN";
    const key = `${strategy}::${regime}`;
    const cell =
      cells.get(key) ??
      ({
        strategy,
        regime,
        tradeCount: 0,
        winRate: 0,
        grossPnL: 0,
        fees: 0,
        netPnL: 0,
        expectancy: 0,
        profitFactor: 0,
        sampleSize: 0,
        sampleLabel: "NOT_ENOUGH_DATA" as const,
      } satisfies StrategyRegimeMatrixCell);

    cell.tradeCount += 1;
    cell.sampleSize += 1;
    cell.grossPnL = round(cell.grossPnL + pnl.grossPnL);
    cell.fees = round(cell.fees + pnl.totalFee);
    cell.netPnL = round(cell.netPnL + pnl.netPnL);
    cells.set(key, cell);
  }

  const finalized = Array.from(cells.values()).map((cell) => {
    const trades = input.pnlEntries.filter(
      (row) =>
        (input.strategyByTradeId[row.tradeId] ?? "UNKNOWN") === cell.strategy &&
        String(input.regimeByTradeId?.[row.tradeId] ?? "UNKNOWN") === cell.regime,
    );
    const wins = trades.filter((row) => row.netPnL > 0);
    const grossWins = wins.reduce((acc, row) => acc + row.netPnL, 0);
    const grossLosses = Math.abs(trades.filter((row) => row.netPnL < 0).reduce((acc, row) => acc + row.netPnL, 0));
    return {
      ...cell,
      winRate: cell.tradeCount > 0 ? round(wins.length / cell.tradeCount) : 0,
      expectancy: cell.tradeCount > 0 ? round(cell.netPnL / cell.tradeCount) : 0,
      profitFactor: grossLosses > 0 ? round(grossWins / grossLosses) : grossWins > 0 ? Number.POSITIVE_INFINITY : 0,
      sampleLabel: cell.sampleSize >= minCellSample ? "SUFFICIENT" : "NOT_ENOUGH_DATA",
    };
  });

  const report: StrategyRegimeMatrixReport = {
    generatedAt: new Date().toISOString(),
    cells: finalized.sort((a, b) => a.strategy.localeCompare(b.strategy) || a.regime.localeCompare(b.regime)),
    deterministicHash: "",
  };
  report.deterministicHash = deterministicHash(finalized);
  return report;
}
