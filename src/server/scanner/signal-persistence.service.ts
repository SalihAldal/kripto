import { logger } from "@/lib/logger";
import type { AIConsensusResult } from "@/src/types/ai";
import type { ScannerCandidate } from "@/src/types/scanner";
import {
  persistScannerResult,
  persistTradeSignalFromScanner,
} from "@/src/server/repositories/scanner.repository";
import { recordLegacyScannerPersistence } from "@/src/server/scanner/legacy-scanner-telemetry.service";

export async function persistCandidateSignal(
  candidate: ScannerCandidate,
  ai: AIConsensusResult | undefined,
  userId?: string,
  scope?: { runId?: string; roundId?: string },
) {
  try {
    const lane = String(candidate.context.metadata.primaryLane ?? "UNKNOWN");
    const opportunityScore = Number(candidate.context.metadata.opportunityScore ?? candidate.score.score ?? 0);
    const microScore =
      Number.isFinite(Number(candidate.context.metadata.microScore ?? Number.NaN))
        ? Number(candidate.context.metadata.microScore)
        : null;
    const finalScore =
      Number.isFinite(Number(candidate.context.metadata.finalScore ?? Number.NaN))
        ? Number(candidate.context.metadata.finalScore)
        : candidate.score.score;
    const executionReason = ai?.explanation ?? (candidate.score.reasons.join(" | ") || "NO_EXECUTION_DECISION");
    const source = String(candidate.context.metadata.discoverySource ?? "SCANNER");
    const legacySource = source !== "OPPORTUNITY" && source !== "MICROSTRUCTURE";
    if (legacySource) {
      recordLegacyScannerPersistence({
        runId: scope?.runId,
        roundId: scope?.roundId,
        source,
      });
      if (String(process.env.CANONICAL_RUNTIME_ENFORCE_NO_LEGACY_PERSIST ?? "").toLowerCase() === "true") {
        return;
      }
    }
    const scannerResult = await persistScannerResult({
      userId,
      symbol: candidate.context.symbol,
      scannerName: source === "OPPORTUNITY" || source === "MICROSTRUCTURE"
        ? "kinetic-opportunity-engine"
        : "kinetic-shortterm-scanner",
      score: candidate.score.score,
      confidence: candidate.score.confidence,
      rank: candidate.rank,
      reason: candidate.score.reasons.join(" | ") || "qualified",
      status: candidate.score.status,
      metadata: {
        candidateId: String(candidate.context.metadata.opportunityCandidateId ?? ""),
        symbol: candidate.context.symbol,
        lane,
        detectedAt: String(candidate.context.metadata.firstDetectedAt ?? new Date().toISOString()),
        detectedPrice: Number(candidate.context.metadata.firstDetectionPrice ?? candidate.context.lastPrice ?? 0),
        opportunityScore,
        microScore,
        finalScore,
        discoveryReasons: candidate.score.reasons,
        qualityReasons: candidate.context.rejectReasons,
        microReasons: Array.isArray(candidate.context.metadata.reasonCodes) ? candidate.context.metadata.reasonCodes : [],
        rankReasons: Array.isArray(candidate.context.metadata.reasonCodes) ? candidate.context.metadata.reasonCodes : [],
        riskReasons: [],
        executionReasons: ai ? [executionReason] : [],
        terminalReason: ai?.finalDecision ? `AI_${ai.finalDecision}` : candidate.score.status,
        sourceAuthority: source,
        runId: scope?.runId ?? null,
        roundId: scope?.roundId ?? null,
        context: candidate.context,
        scoreMetrics: candidate.score.metrics,
      },
    });

    if (ai) {
      await persistTradeSignalFromScanner({
        userId,
        symbol: candidate.context.symbol,
        scannerResultId: scannerResult.id,
        confidence: ai.finalConfidence,
        side: ai.finalDecision,
        reason: ai.explanation,
        metadata: {
          finalRiskScore: ai.finalRiskScore,
          score: ai.score,
        },
      });
    }
  } catch (error) {
    logger.warn(
      { symbol: candidate.context.symbol, error: (error as Error).message },
      "Scanner persistence skipped",
    );
  }
}
