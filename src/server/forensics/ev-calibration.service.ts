import { createHash } from "node:crypto";
import type {
  EvAudit,
  EvCalibrationBucket,
  EvCalibrationReport,
  PnlLedgerEntry,
} from "@/src/server/forensics/forensic.types";

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

function bucketLabel(min: number, max: number) {
  return `${round(min, 1)}-${round(max, 1)}`;
}

function deterministicHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

export function buildEvCalibrationReport(input: {
  evAudits: EvAudit[];
  pnlEntries: PnlLedgerEntry[];
  bucketWidth?: number;
}): EvCalibrationReport {
  const bucketWidth = input.bucketWidth ?? 5;
  const executed = input.evAudits.filter((row) => row.verdict === "APPROVED" && Number.isFinite(row.expectedValue));
  const pnlBySymbol = new Map<string, PnlLedgerEntry[]>();
  for (const row of input.pnlEntries) {
    const key = row.symbol.toUpperCase();
    const list = pnlBySymbol.get(key) ?? [];
    list.push(row);
    pnlBySymbol.set(key, list);
  }

  const bucketMap = new Map<string, EvCalibrationBucket>();
  for (const audit of executed) {
    const ev = Number(audit.expectedValue ?? 0);
    const bucketMin = Math.floor(ev / bucketWidth) * bucketWidth;
    const bucketMax = bucketMin + bucketWidth;
    const label = bucketLabel(bucketMin, bucketMax);
    const pnlRows = pnlBySymbol.get(audit.symbol.toUpperCase()) ?? [];
    const pnl = pnlRows[0];
    const actual = pnl?.netPnL ?? 0;
    const predicted = ev;
    const win = actual > 0;

    const existing = bucketMap.get(label) ?? {
      bucketLabel: label,
      evMin: bucketMin,
      evMax: bucketMax,
      sampleSize: 0,
      winCount: 0,
      lossCount: 0,
      winRate: 0,
      predictedExpectancy: 0,
      actualExpectancy: 0,
      calibrationDelta: 0,
      grossPnL: 0,
      netPnL: 0,
    };
    existing.sampleSize += 1;
    if (win) existing.winCount += 1;
    else existing.lossCount += 1;
    existing.predictedExpectancy += predicted;
    existing.actualExpectancy += actual;
    existing.grossPnL += pnl?.grossPnL ?? 0;
    existing.netPnL += actual;
    bucketMap.set(label, existing);
  }

  const buckets = Array.from(bucketMap.values())
    .map((row) => {
      const sampleSize = Math.max(1, row.sampleSize);
      const predictedExpectancy = row.predictedExpectancy / sampleSize;
      const actualExpectancy = row.actualExpectancy / sampleSize;
      return {
        ...row,
        winRate: round(row.winCount / sampleSize, 4),
        predictedExpectancy: round(predictedExpectancy, 4),
        actualExpectancy: round(actualExpectancy, 4),
        calibrationDelta: round(actualExpectancy - predictedExpectancy, 4),
        grossPnL: round(row.grossPnL, 4),
        netPnL: round(row.netPnL, 4),
      };
    })
    .sort((a, b) => a.evMin - b.evMin);

  const totalSamples = buckets.reduce((acc, row) => acc + row.sampleSize, 0);
  const meanCalibrationDelta =
    totalSamples > 0
      ? round(
          buckets.reduce((acc, row) => acc + row.calibrationDelta * row.sampleSize, 0) / totalSamples,
          4,
        )
      : 0;

  const report: EvCalibrationReport = {
    generatedAt: new Date(0).toISOString(),
    formulaVersion: executed[0]?.formulaVersion ?? "hybrid-v1",
    totalSamples,
    buckets,
    meanCalibrationDelta,
    brierScore: totalSamples > 0 ? round(meanCalibrationDelta ** 2, 6) : null,
    deterministicHash: "",
  };
  report.generatedAt = new Date().toISOString();
  report.deterministicHash = deterministicHash({
    formulaVersion: report.formulaVersion,
    totalSamples: report.totalSamples,
    buckets: report.buckets,
    meanCalibrationDelta: report.meanCalibrationDelta,
  });
  return report;
}

export function buildEvCalibrationReportDeterministic(
  input: Parameters<typeof buildEvCalibrationReport>[0],
  generatedAt: string,
) {
  const report = buildEvCalibrationReport(input);
  return {
    ...report,
    generatedAt,
    deterministicHash: deterministicHash({
      formulaVersion: report.formulaVersion,
      totalSamples: report.totalSamples,
      buckets: report.buckets,
      meanCalibrationDelta: report.meanCalibrationDelta,
    }),
  };
}
