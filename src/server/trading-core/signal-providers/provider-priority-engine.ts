import { clamp } from "@/src/server/trading-core/indicators/math";
import type { ProviderConsensus, ProviderSignal } from "@/src/server/trading-core/signal-providers/signal-provider-types";
import type { TradeSide } from "@/src/server/trading-core/core/types";

export class ProviderPriorityEngine {
  priorityScore(signal: ProviderSignal) {
    const riskPenalty = signal.riskRating === "BLOCKED" ? 100 : signal.riskRating === "HIGH" ? 18 : signal.riskRating === "MEDIUM" ? 8 : 0;
    return Number(
      clamp(
        signal.providerScore * 0.34 +
          signal.confidence * 0.28 +
          signal.verification.confidenceScore * 0.24 +
          (signal.score ?? signal.confidence) * 0.14 -
          signal.verification.fakeSignalScore * 0.35 -
          riskPenalty,
        0,
        100,
      ).toFixed(2),
    );
  }

  consensus(symbol: string, signals: ProviderSignal[]): ProviderConsensus {
    const accepted = signals.filter((signal) => signal.symbol.toUpperCase() === symbol.toUpperCase() && signal.verification.status !== "REJECTED");
    if (accepted.length === 0) {
      return {
        symbol: symbol.toUpperCase(),
        side: "HOLD",
        confidence: 0,
        score: 0,
        providerSignals: [],
        reasons: ["No verified provider signal available"],
        generatedAt: new Date().toISOString(),
      };
    }
    const totals = accepted.reduce(
      (acc, signal) => {
        acc[signal.side] += signal.priorityScore;
        return acc;
      },
      { BUY: 0, SELL: 0, HOLD: 0 } satisfies Record<TradeSide, number>,
    );
    const side = (Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "HOLD") as TradeSide;
    const selected = accepted.filter((signal) => signal.side === side).sort((a, b) => b.priorityScore - a.priorityScore)[0];
    const sameSide = accepted.filter((signal) => signal.side === side);
    const score = sameSide.reduce((sum, signal) => sum + signal.priorityScore, 0) / Math.max(1, sameSide.length);
    const confidence = sameSide.reduce((sum, signal) => sum + signal.verification.confidenceScore, 0) / Math.max(1, sameSide.length);
    return {
      symbol: symbol.toUpperCase(),
      side,
      confidence: Number(clamp(confidence, 0, 100).toFixed(2)),
      score: Number(clamp(score, 0, 100).toFixed(2)),
      selectedProviderId: selected?.providerId,
      providerSignals: accepted.sort((a, b) => b.priorityScore - a.priorityScore),
      reasons: [
        `Consensus side=${side}`,
        `Providers=${accepted.length}`,
        selected ? `Top provider=${selected.providerName}` : "No top provider",
      ],
      generatedAt: new Date().toISOString(),
    };
  }
}
