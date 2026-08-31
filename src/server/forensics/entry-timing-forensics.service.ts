import type { EntryTimingAggregateReport, EntryTimingClass, EntryTimingRecord } from "@/src/server/forensics/forensic.types";

function pctMove(from: number, to: number) {
  if (!Number.isFinite(from) || from <= 0 || !Number.isFinite(to)) return undefined;
  return Number((((to - from) / from) * 100).toFixed(4));
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return Number(sorted[index]!.toFixed(2));
}

export function classifyEntryTiming(input: {
  side: "LONG" | "SHORT";
  entryDelayMs: number;
  movementToEntryPercent?: number;
  maxNormalDelayMs?: number;
  lateMoveThresholdPercent?: number;
}): { classification: EntryTimingClass; reasonDetail: string } {
  const maxNormalDelayMs = input.maxNormalDelayMs ?? 120_000;
  const lateMoveThresholdPercent = input.lateMoveThresholdPercent ?? 0.35;
  const move = Math.abs(Number(input.movementToEntryPercent ?? 0));
  const adverse =
    input.side === "LONG"
      ? Number(input.movementToEntryPercent ?? 0) > lateMoveThresholdPercent
      : Number(input.movementToEntryPercent ?? 0) < -lateMoveThresholdPercent;

  if (!Number.isFinite(input.entryDelayMs) || input.entryDelayMs < 0) {
    return { classification: "UNKNOWN", reasonDetail: "Missing or invalid entry delay" };
  }
  if (input.entryDelayMs <= maxNormalDelayMs * 0.5 && move <= lateMoveThresholdPercent * 0.5) {
    return {
      classification: "GOOD_ENTRY",
      reasonDetail: `Delay ${input.entryDelayMs}ms with ${move.toFixed(3)}% move to entry`,
    };
  }
  if (adverse && input.entryDelayMs > maxNormalDelayMs) {
    return {
      classification: "EDGE_DECAY",
      reasonDetail: `Edge decayed before entry: delay ${input.entryDelayMs}ms with ${move.toFixed(3)}% adverse move`,
    };
  }
  if (adverse || input.entryDelayMs > maxNormalDelayMs) {
    return {
      classification: "CHASING",
      reasonDetail: `Late/chasing entry: delay ${input.entryDelayMs}ms with ${move.toFixed(3)}% adverse pressure`,
    };
  }
  return {
    classification: "NORMAL",
    reasonDetail: `Delay ${input.entryDelayMs}ms with ${move.toFixed(3)}% move to entry`,
  };
}

export function buildEntryTimingAggregateReport(records: EntryTimingRecord[]): EntryTimingAggregateReport {
  const delays = records.map((row) => row.entryDelayMs).filter((value) => Number.isFinite(value) && value >= 0);
  const moves = records
    .map((row) => Math.abs(Number(row.movementToEntryPercent ?? Number.NaN)))
    .filter((value) => Number.isFinite(value));
  const candidateToDecision = records
    .map((row) => {
      if (!row.candidateTimestamp || !row.decisionTimestamp) return Number.NaN;
      return Math.max(0, new Date(row.decisionTimestamp).getTime() - new Date(row.candidateTimestamp).getTime());
    })
    .filter((value) => Number.isFinite(value));
  const decisionToEntry = records
    .map((row) => {
      if (!row.decisionTimestamp) return Number.NaN;
      return Math.max(0, new Date(row.entryTimestamp).getTime() - new Date(row.decisionTimestamp).getTime());
    })
    .filter((value) => Number.isFinite(value));
  const classificationCounts = records.reduce<Partial<Record<EntryTimingClass, number>>>((acc, row) => {
    acc[row.classification] = (acc[row.classification] ?? 0) + 1;
    return acc;
  }, {});
  return {
    generatedAt: new Date().toISOString(),
    sampleSize: records.length,
    classificationCounts,
    entryDelayMs: {
      p50: percentile(delays, 0.5),
      p90: percentile(delays, 0.9),
      p95: percentile(delays, 0.95),
    },
    movementToEntryPercent: {
      p50: percentile(moves, 0.5),
      p90: percentile(moves, 0.9),
      p95: percentile(moves, 0.95),
    },
    stageLatencyMs: {
      candidateToDecision:
        candidateToDecision.length > 0
          ? {
              p50: percentile(candidateToDecision, 0.5),
              p90: percentile(candidateToDecision, 0.9),
              p95: percentile(candidateToDecision, 0.95),
            }
          : undefined,
      decisionToEntry:
        decisionToEntry.length > 0
          ? {
              p50: percentile(decisionToEntry, 0.5),
              p90: percentile(decisionToEntry, 0.9),
              p95: percentile(decisionToEntry, 0.95),
            }
          : undefined,
    },
  };
}

export function buildEntryTimingRecord(input: {
  candidateId: string;
  symbol: string;
  side: "LONG" | "SHORT";
  candidateTimestamp?: string | Date;
  decisionTimestamp?: string | Date;
  entryTimestamp: string | Date;
  priceAtCandidate?: number;
  priceAtDecision?: number;
  priceAtEntry: number;
}): EntryTimingRecord {
  const candidateMs = input.candidateTimestamp ? new Date(input.candidateTimestamp).getTime() : undefined;
  const decisionMs = input.decisionTimestamp ? new Date(input.decisionTimestamp).getTime() : candidateMs;
  const entryMs = new Date(input.entryTimestamp).getTime();
  const anchorMs = decisionMs ?? candidateMs ?? entryMs;
  const entryDelayMs = Math.max(0, entryMs - anchorMs);
  const anchorPrice = input.priceAtDecision ?? input.priceAtCandidate ?? input.priceAtEntry;
  const movementToEntryPercent = pctMove(anchorPrice, input.priceAtEntry);
  const timing = classifyEntryTiming({
    side: input.side,
    entryDelayMs,
    movementToEntryPercent,
  });
  return {
    candidateId: input.candidateId,
    symbol: input.symbol.toUpperCase(),
    candidateTimestamp: candidateMs ? new Date(candidateMs).toISOString() : undefined,
    decisionTimestamp: decisionMs ? new Date(decisionMs).toISOString() : undefined,
    entryTimestamp: new Date(entryMs).toISOString(),
    entryDelayMs,
    priceAtCandidate: input.priceAtCandidate,
    priceAtDecision: input.priceAtDecision,
    priceAtEntry: input.priceAtEntry,
    movementToEntryPercent,
    classification: timing.classification,
    reasonDetail: timing.reasonDetail,
  };
}
