import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/src/server/db/prisma";
import { analyzePendingShadowOutcomes, finalizeShadowOutcomes } from "@/src/server/shadow-outcome/finalizer.service";

type OutcomeState = "PENDING" | "COMPLETE" | "INVALID_DATA" | "HISTORY_UNAVAILABLE";

function status60(outcomes: unknown): OutcomeState {
  if (!Array.isArray(outcomes)) return "PENDING";
  const row = outcomes.find((item) => Number((item as Record<string, unknown>).horizonMin) === 60) as
    | Record<string, unknown>
    | undefined;
  if (!row) return "PENDING";
  const explicit = String(row.status ?? "").toUpperCase();
  if (explicit === "PENDING" || explicit === "COMPLETE" || explicit === "INVALID_DATA" || explicit === "HISTORY_UNAVAILABLE") {
    return explicit;
  }
  const complete = row.complete === true;
  const quality = String(row.quality ?? "");
  if (!complete) return "PENDING";
  if (quality === "OK") return "COMPLETE";
  if (quality === "HISTORY_UNAVAILABLE") return "HISTORY_UNAVAILABLE";
  return "INVALID_DATA";
}

async function summarizeStates() {
  const rows = await prisma.shadowCandidateOutcome.findMany({
    select: { candidateId: true, outcomes: true },
  });
  const summary = { total: rows.length, COMPLETE_60M_OK: 0, PENDING_VALID: 0, INVALID_DATA: 0, HISTORY_UNAVAILABLE: 0 };
  for (const row of rows) {
    const state = status60(row.outcomes);
    if (state === "COMPLETE") summary.COMPLETE_60M_OK += 1;
    else if (state === "INVALID_DATA") summary.INVALID_DATA += 1;
    else if (state === "HISTORY_UNAVAILABLE") summary.HISTORY_UNAVAILABLE += 1;
    else summary.PENDING_VALID += 1;
  }
  return summary;
}

async function main() {
  const before = await summarizeStates();
  const finalize = await finalizeShadowOutcomes({ limit: 5000 });
  const pending = await analyzePendingShadowOutcomes({ limit: 6000 });
  const after = await summarizeStates();
  const age60mPending = pending.filter((row) => row.required60mReached);
  const report = {
    generatedAt: new Date().toISOString(),
    before,
    finalize,
    after,
    pendingCount: pending.length,
    pendingReasonHistogram: pending.reduce<Record<string, number>>((acc, row) => {
      acc[row.pendingReason] = (acc[row.pendingReason] ?? 0) + 1;
      return acc;
    }, {}),
    expired60mPendingCount: age60mPending.length,
    expired60mPendingSample: age60mPending.slice(0, 200),
    pendingRows: pending.slice(0, 4000),
  };
  const outDir = path.join(process.cwd(), "artifacts", "forensics", "prevalidation");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "phase07-outcome-pending-forensic.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ outPath, before, after, finalize, pending: pending.length }, null, 2)}\n`);
  await prisma.$disconnect();
}

void main();
