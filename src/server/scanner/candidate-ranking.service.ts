import type { MarketContext, ScannerCandidate, ScannerScore } from "@/src/types/scanner";

export function rankCandidates(
  rows: Array<{ context: MarketContext; score: ScannerScore }>,
  topN: number,
): ScannerCandidate[] {
  return rows
    .sort((a, b) => {
      const aBoost = Number(a.context.metadata.topGainerPriorityScore ?? 0) * 0.18;
      const bBoost = Number(b.context.metadata.topGainerPriorityScore ?? 0) * 0.18;
      return (b.score.score + bBoost) - (a.score.score + aBoost);
    })
    .slice(0, topN)
    .map((row, index) => ({
      rank: index + 1,
      context: row.context,
      score: row.score,
    }));
}
