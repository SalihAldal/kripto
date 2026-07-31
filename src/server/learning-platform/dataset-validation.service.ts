const MIN_HORIZON_MS = 60 * 60 * 1000;

export function validateLabeledRow(input: {
  decisionId: string;
  featureSnapshot: Record<string, unknown>;
  labels: Record<string, unknown>;
  decisionTimestamp: Date;
  replayCompletedAt?: Date | null;
}) {
  if (!input.decisionId?.trim()) {
    return { valid: false, reason: "missing_decision_id" };
  }
  if (!input.featureSnapshot || Object.keys(input.featureSnapshot).length === 0) {
    return { valid: false, reason: "incomplete_feature_snapshot" };
  }
  const labels = input.labels;
  if (labels.mfe == null && labels.return4h == null && labels.peakProfitPct == null) {
    return { valid: false, reason: "incomplete_labels" };
  }
  if (input.replayCompletedAt) {
    const decisionMs = input.decisionTimestamp.getTime();
    const replayMs = input.replayCompletedAt.getTime();
    if (replayMs < decisionMs + MIN_HORIZON_MS) {
      return { valid: false, reason: "future_leakage_replay_incomplete" };
    }
  }
  const snapshotJson = JSON.stringify(input.featureSnapshot);
  if (snapshotJson.includes("NaN") || snapshotJson.includes("Infinity")) {
    return { valid: false, reason: "corrupted_feature_values" };
  }
  return { valid: true as const };
}

export async function validateDataset(trainingDatasetId: string) {
  const { prisma } = await import("@/src/server/db/prisma");
  const rows = await prisma.labeledDatasetRow.findMany({ where: { trainingDatasetId } });
  let valid = 0;
  let rejected = 0;
  const seen = new Set<string>();

  for (const row of rows) {
    let status = row.validationStatus;
    let reason = row.rejectionReason;

    if (seen.has(row.decisionId)) {
      status = "REJECTED";
      reason = "duplicate_decision_id";
    } else {
      seen.add(row.decisionId);
      const check = validateLabeledRow({
        decisionId: row.decisionId,
        featureSnapshot: row.featureSnapshot as Record<string, unknown>,
        labels: row.labels as Record<string, unknown>,
        decisionTimestamp: row.decisionTimestamp,
      });
      if (!check.valid) {
        status = "REJECTED";
        reason = check.reason;
      }
    }

    if (status !== row.validationStatus || reason !== row.rejectionReason) {
      await prisma.labeledDatasetRow.update({
        where: { id: row.id },
        data: { validationStatus: status, rejectionReason: reason ?? undefined },
      });
    }

    if (status === "VALID") valid += 1;
    else rejected += 1;
  }

  const status = valid >= 30 ? "READY" : valid > 0 ? "VALIDATED" : "REJECTED";
  await prisma.trainingDataset.update({
    where: { id: trainingDatasetId },
    data: { validRowCount: valid, rejectedRowCount: rejected, rowCount: valid + rejected, status },
  });

  return { valid, rejected, status };
}
