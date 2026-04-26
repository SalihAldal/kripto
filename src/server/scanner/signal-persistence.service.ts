import { logger } from "@/lib/logger";
import type { AIConsensusResult } from "@/src/types/ai";
import type { ScannerCandidate } from "@/src/types/scanner";
import {
  persistScannerResult,
  persistTradeSignalFromScanner,
} from "@/src/server/repositories/scanner.repository";

export async function persistCandidateSignal(
  candidate: ScannerCandidate,
  ai: AIConsensusResult | undefined,
  userId?: string,
) {
  try {
    const scannerResult = await persistScannerResult({
      userId,
      symbol: candidate.context.symbol,
      scannerName: "kinetic-shortterm-scanner",
      score: candidate.score.score,
      confidence: candidate.score.confidence,
      rank: candidate.rank,
      reason: candidate.score.reasons.join(" | ") || "qualified",
      status: candidate.score.status,
      metadata: {
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
