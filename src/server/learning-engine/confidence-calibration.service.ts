import { prisma } from "@/src/server/db/prisma";
import { persistConfidenceCalibration } from "@/src/server/learning-engine/learning-engine.repository";
import type { ConfidenceCalibrationPoint } from "@/src/server/learning-engine/learning-engine.types";

export async function computeConfidenceCalibration(periodHours = 24 * 30) {
  const since = new Date(Date.now() - periodHours * 60 * 60_000);
  const rows = await prisma.decisionLog.findMany({
    where: { timestamp: { gte: since }, confidence: { not: null } },
    take: 2000,
    select: { decisionId: true, confidence: true, decision: true },
  });

  const evaluations = await prisma.decisionEvaluation.findMany({
    where: { decisionId: { in: rows.map((row) => row.decisionId) } },
    select: { decisionId: true, verdict: true },
  });
  const evalMap = new Map(evaluations.map((row) => [row.decisionId, row.verdict]));

  const bins = new Map<string, { predicted: number[]; success: number[] }>();
  for (const row of rows) {
    const conf = Number(row.confidence ?? 0);
    const bin = `${Math.floor(conf / 10) * 10}-${Math.floor(conf / 10) * 10 + 9}`;
    const bucket = bins.get(bin) ?? { predicted: [], success: [] };
    bucket.predicted.push(conf);
    const verdict = evalMap.get(row.decisionId) ?? "";
    const success = verdict.includes("CORRECT") || (row.decision === "BUY" && verdict.includes("WIN")) ? 1 : 0;
    bucket.success.push(success);
    bins.set(bin, bucket);
  }

  const points: ConfidenceCalibrationPoint[] = [];
  for (const [predictedBin, bucket] of bins.entries()) {
    if (bucket.predicted.length < 5) continue;
    const predictedAvg = bucket.predicted.reduce((a, b) => a + b, 0) / bucket.predicted.length;
    const actualSuccessRate = (bucket.success.reduce((a, b) => a + b, 0) / bucket.success.length) * 100;
    const calibrationError = Math.abs(predictedAvg - actualSuccessRate);
    points.push({
      predictedBin,
      predictedAvg: Number(predictedAvg.toFixed(2)),
      actualSuccessRate: Number(actualSuccessRate.toFixed(2)),
      count: bucket.predicted.length,
      calibrationError: Number(calibrationError.toFixed(2)),
    });
  }

  await persistConfidenceCalibration(points);
  const avgError = points.length > 0 ? points.reduce((sum, row) => sum + row.calibrationError, 0) / points.length : 0;
  return { points, avgCalibrationError: avgError, confidenceDrift: avgError };
}
