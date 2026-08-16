import { createHash } from "node:crypto";
import { env } from "@/lib/config";
import type {
  ForensicSessionContext,
  SlotCandidateSnapshot,
  SlotOpportunityReport,
  SlotOpportunityRow,
  TdiDecisionRecord,
} from "@/src/server/forensics/forensic.types";

function deterministicHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

function snapshotFromCandidate(input: {
  symbol: string;
  rank: number;
  score: number;
  strategy: string;
  regime: string;
  reason: string;
  tdi?: TdiDecisionRecord;
}): SlotCandidateSnapshot {
  return {
    symbol: input.symbol.toUpperCase(),
    rank: input.rank,
    score: input.score,
    strategy: input.strategy,
    regime: input.regime,
    reason: input.reason,
    tdiVerdict: input.tdi?.verdict,
    waitReasonCode: input.tdi?.waitReasonCode,
  };
}

export function buildSlotOpportunityReport(input: {
  session: ForensicSessionContext;
  maxPositions?: number;
}): SlotOpportunityReport {
  const maxPositions = input.maxPositions ?? env.EXECUTION_MAX_OPEN_POSITIONS ?? 3;
  const tdiBySymbol = new Map(
    (input.session.tdiDecisions ?? []).map((row) => [row.symbol.toUpperCase(), row]),
  );
  const ranked = [...input.session.candidates]
    .map((row, index) => {
      const meta = (row.marketContext ?? {}) as Record<string, unknown>;
      const score = Number(row.strategyScore ?? meta.scannerScore ?? 0);
      return snapshotFromCandidate({
        symbol: row.symbol,
        rank: row.ranking ?? index + 1,
        score,
        strategy: String(meta.marketRegimeStrategy ?? row.strategyId ?? "UNKNOWN"),
        regime: String(meta.marketRegime ?? "UNKNOWN"),
        reason: String(meta.selectionReason ?? row.source ?? "scanner"),
        tdi: tdiBySymbol.get(row.symbol.toUpperCase()),
      });
    })
    .sort((a, b) => a.rank - b.rank || b.score - a.score);

  const approved = ranked.filter((row) => row.tdiVerdict === "APPROVED");
  const selectedSymbols = new Set(
    input.session.orders.filter((row) => row.side === "BUY").map((row) => row.symbol.toUpperCase()),
  );
  const selected = ranked.filter((row) => selectedSymbols.has(row.symbol) || approved.includes(row));
  const topSelected = selected.slice(0, maxPositions);
  const waitRows = ranked.filter((row) => row.tdiVerdict === "WAIT");

  const rows: SlotOpportunityRow[] = topSelected.map((row, slotIndex) => {
    const nextBest = ranked.find(
      (candidate) =>
        candidate.rank > row.rank &&
        !topSelected.some((picked) => picked.symbol === candidate.symbol),
    );
    return {
      slotIndex: slotIndex + 1,
      selected: row,
      nextBest: nextBest
        ? {
            ...nextBest,
            scoreGap: Number((row.score - nextBest.score).toFixed(4)),
          }
        : undefined,
    };
  });

  for (let i = rows.length; i < Math.min(maxPositions, ranked.length); i += 1) {
    const candidate = ranked[i];
    if (!candidate || rows.some((row) => row.selected.symbol === candidate.symbol)) continue;
    const nextBest = ranked[i + 1];
    rows.push({
      slotIndex: i + 1,
      selected: candidate,
      nextBest: nextBest
        ? { ...nextBest, scoreGap: Number((candidate.score - nextBest.score).toFixed(4)) }
        : undefined,
    });
  }

  const report: SlotOpportunityReport = {
    generatedAt: new Date().toISOString(),
    maxPositions,
    selectedCount: topSelected.length,
    waitCount: waitRows.length,
    rows,
    deterministicHash: "",
  };
  report.deterministicHash = deterministicHash({
    maxPositions: report.maxPositions,
    rows: report.rows,
    waitCount: report.waitCount,
  });
  return report;
}
