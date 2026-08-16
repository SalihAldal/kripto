import type { EntryTimingClass, EntryTimingRecord } from "@/src/server/forensics/forensic.types";

function pctMove(from: number, to: number) {
  if (!Number.isFinite(from) || from <= 0 || !Number.isFinite(to)) return undefined;
  return Number((((to - from) / from) * 100).toFixed(4));
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
  if (adverse || input.entryDelayMs > maxNormalDelayMs) {
    return {
      classification: "POSSIBLY_LATE",
      reasonDetail: `Delay ${input.entryDelayMs}ms with ${move.toFixed(3)}% move to entry`,
    };
  }
  return {
    classification: "NORMAL",
    reasonDetail: `Delay ${input.entryDelayMs}ms with ${move.toFixed(3)}% move to entry`,
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
