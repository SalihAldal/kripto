import { clamp } from "@/src/server/trading-core/indicators/math";
import type {
  ProviderSignalInput,
  ProviderSignalVerification,
  SignalProviderConfig,
  SignalProviderPerformance,
} from "@/src/server/trading-core/signal-providers/signal-provider-types";

export class SignalVerifier {
  verify(input: ProviderSignalInput, provider: SignalProviderConfig, performance: SignalProviderPerformance, recentSignals: ProviderSignalInput[]): ProviderSignalVerification {
    const reasons: string[] = [];
    let fakeSignalScore = 0;

    if (provider.status !== "ACTIVE") {
      fakeSignalScore += 50;
      reasons.push(`Provider is ${provider.status}`);
    }
    if (!provider.supportedPairs.includes(input.symbol.toUpperCase())) {
      fakeSignalScore += 35;
      reasons.push("Symbol is not supported by provider");
    }
    if (input.confidence < provider.minConfidence) {
      fakeSignalScore += Math.min(35, provider.minConfidence - input.confidence);
      reasons.push(`Confidence below provider minimum: ${input.confidence}`);
    }
    if (input.sourceTimestamp) {
      const ageMs = Date.now() - Date.parse(input.sourceTimestamp);
      if (Number.isFinite(ageMs) && ageMs > 5 * 60_000) {
        fakeSignalScore += 25;
        reasons.push("Signal timestamp is stale");
      }
    }
    const duplicate = recentSignals.some(
      (signal) => signal.providerId === input.providerId && signal.symbol === input.symbol && signal.side === input.side && Date.now() - Date.parse(signal.sourceTimestamp ?? new Date().toISOString()) < 30_000,
    );
    if (duplicate) {
      fakeSignalScore += 28;
      reasons.push("Duplicate provider signal detected");
    }
    if (performance.riskRating === "BLOCKED") {
      fakeSignalScore += 60;
      reasons.push("Provider performance is blocked");
    }
    if (performance.rejectedSignals >= 3) {
      fakeSignalScore += 20;
      reasons.push("Provider has repeated rejected signals");
    }

    const confidenceScore = clamp(input.confidence * 0.55 + performance.providerScore * 0.35 + provider.priority * 0.1 - fakeSignalScore * 0.45, 0, 100);
    const status = fakeSignalScore >= 70 ? "REJECTED" : fakeSignalScore >= 35 ? "SUSPICIOUS" : "VERIFIED";
    return {
      status,
      verified: status === "VERIFIED",
      fakeSignalScore: Number(clamp(fakeSignalScore, 0, 100).toFixed(2)),
      confidenceScore: Number(confidenceScore.toFixed(2)),
      reasons: reasons.length > 0 ? reasons : ["Signal verified"],
    };
  }
}
