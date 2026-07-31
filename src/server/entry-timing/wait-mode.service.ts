import type { EntryVerdict, WaitDuration } from "@prisma/client";
import type { EntryConfirmation, EntryFilterResult } from "@/src/server/entry-timing/entry-timing.types";
import { WAIT_DURATION_MS as WAIT_MS } from "@/src/server/entry-timing/entry-timing.types";

export function resolveEntryVerdict(
  confirmation: EntryConfirmation,
  filters: EntryFilterResult,
): { verdict: EntryVerdict; waitDuration?: WaitDuration; reevaluateAt?: Date; reasons: string[] } {
  const reasons: string[] = [];

  if (!filters.passed) {
    return { verdict: "REJECT", reasons: filters.rejectMessages };
  }

  if (confirmation.entryConfidence >= 72 && confirmation.entryScore >= 70 && confirmation.entryRisk < 45) {
    reasons.push("High confidence entry window");
    return { verdict: "BUY", reasons };
  }

  if (confirmation.entryConfidence >= 55 && confirmation.entryScore >= 55) {
    let waitDuration: WaitDuration = "MINUTES_15";
    if (confirmation.pullbackProbability > 60) waitDuration = "MINUTES_5";
    else if (confirmation.fakeBreakoutProbability > 40) waitDuration = "MINUTES_30";
    else if (confirmation.entryRisk > 55) waitDuration = "HOUR_1";

    const reevaluateAt = new Date(Date.now() + WAIT_MS[waitDuration]);
    reasons.push(`Awaiting confirmation — re-evaluate in ${waitDuration.replace("_", " ").toLowerCase()}`);
    return { verdict: "WAIT", waitDuration, reevaluateAt, reasons };
  }

  reasons.push("Entry conditions not met");
  return { verdict: "REJECT", reasons };
}

export async function processWaitReevaluations() {
  const { getPendingReevaluations } = await import("@/src/server/entry-timing/entry-timing.repository");
  const { analyzeEntryTiming } = await import("@/src/server/entry-timing/entry-analysis.service");
  const pending = await getPendingReevaluations();
  const results = [];
  for (const analysis of pending) {
    const result = await analyzeEntryTiming(analysis.symbol, analysis.priceAtAnalysis);
    results.push(result);
  }
  return { reevaluated: results.length, results };
}
