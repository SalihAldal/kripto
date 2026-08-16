import { createHash } from "node:crypto";
import { env } from "@/lib/config";
import type {
  ForensicSessionContext,
  NoSlotCandidateRecord,
  NoSlotClassification,
  SlotAllocationAnalysisReport,
} from "@/src/server/forensics/forensic.types";
import { buildSlotOpportunityReport } from "@/src/server/forensics/slot-opportunity-report.service";

function deterministicHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

function classifyNoSlot(input: {
  score: number;
  selectedMinScore: number;
  scoreGapToNextSelected?: number;
  postEntryMovePercent?: number;
}): { classification: NoSlotClassification; evidence: string[] } {
  const evidence: string[] = [];
  if (input.scoreGapToNextSelected !== undefined && input.scoreGapToNextSelected >= 5) {
    evidence.push(`scoreGapToSelected=${input.scoreGapToNextSelected}`);
    return { classification: "JUSTIFIED_NO_SLOT", evidence };
  }
  if (input.postEntryMovePercent !== undefined && input.postEntryMovePercent > 3) {
    evidence.push(`postEntryMovePercent=${input.postEntryMovePercent} (forensic only)`);
    return { classification: "POSSIBLE_MISSED_SLOT", evidence };
  }
  if (input.score >= input.selectedMinScore - 2) {
    evidence.push(`score=${input.score} near selectedMin=${input.selectedMinScore}`);
    return { classification: "POSSIBLE_MISSED_SLOT", evidence };
  }
  evidence.push("Insufficient evidence for missed-slot claim");
  return { classification: "UNKNOWN", evidence };
}

export function buildSlotAllocationAnalysis(input: {
  session: ForensicSessionContext;
  maxPositions?: number;
  postEntryMovesBySymbol?: Record<string, number>;
}): SlotAllocationAnalysisReport {
  const maxPositions = input.maxPositions ?? env.EXECUTION_MAX_OPEN_POSITIONS ?? 3;
  const slotReport = buildSlotOpportunityReport({ session: input.session, maxPositions });
  const evBySymbol = new Map(
    (input.session.evAudits ?? []).map((row) => [row.symbol.toUpperCase(), row.expectedValue ?? 0]),
  );
  const selectedScores = slotReport.rows.map((row) => row.selected.score);
  const selectedMinScore = selectedScores.length > 0 ? Math.min(...selectedScores) : 0;

  const noSlotCandidates: NoSlotCandidateRecord[] = (input.session.tdiDecisions ?? [])
    .filter((row) => row.verdict === "WAIT" && row.waitReasonCode === "NO_SLOT")
    .map((row) => {
      const nextSelectedGap = selectedMinScore > 0 ? Number((row.consensusScore ?? 0) - selectedMinScore) : undefined;
      const postEntryMovePercent = input.postEntryMovesBySymbol?.[row.symbol.toUpperCase()];
      const { classification, evidence } = classifyNoSlot({
        score: Number(row.consensusScore ?? 0),
        selectedMinScore,
        scoreGapToNextSelected: nextSelectedGap !== undefined ? Math.abs(nextSelectedGap) : undefined,
        postEntryMovePercent,
      });
      return {
        candidateId: row.candidateId,
        symbol: row.symbol,
        rank: Number(row.rank ?? 0),
        score: Number(row.consensusScore ?? 0),
        reasonCode: "NO_SLOT",
        strategy: row.strategy,
        regime: row.forensicRegime,
        ev: evBySymbol.get(row.symbol.toUpperCase()),
        classification,
        evidence,
        postEntryMovePercent,
      };
    });

  const approvedCount = (input.session.tdiDecisions ?? []).filter((row) => row.verdict === "APPROVED").length;
  const waitCount = (input.session.tdiDecisions ?? []).filter((row) => row.verdict === "WAIT").length;

  const report: SlotAllocationAnalysisReport = {
    generatedAt: new Date().toISOString(),
    maxPositions,
    approvedCount,
    waitCount,
    noSlotCandidates,
    roundRows: slotReport.rows,
    deterministicHash: "",
  };
  report.deterministicHash = deterministicHash({
    maxPositions,
    noSlotCandidates,
    approvedCount,
    waitCount,
  });
  return report;
}
