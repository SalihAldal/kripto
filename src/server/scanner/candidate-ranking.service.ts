import type { MarketContext, ScannerCandidate, ScannerScore } from "@/src/types/scanner";

export function rankCandidates(
  rows: Array<{ context: MarketContext; score: ScannerScore }>,
  topN: number,
): ScannerCandidate[] {
  return rows
    .sort((a, b) => b.score.score - a.score.score)
    .slice(0, topN)
    .map((row, index) => ({
      rank: index + 1,
      context: row.context,
      score: row.score,
    }));
}
