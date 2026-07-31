import { clamp } from "@/src/server/trading-core/indicators/math";
import type {
  ProviderPerformanceSample,
  SignalProviderConfig,
  SignalProviderPerformance,
  SignalProviderRiskRating,
} from "@/src/server/trading-core/signal-providers/signal-provider-types";

const MAX_SAMPLES = 500;

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export class ProviderPerformanceStore {
  private readonly samples = new Map<string, ProviderPerformanceSample[]>();
  private readonly verificationStats = new Map<string, { verified: number; suspicious: number; rejected: number }>();

  record(sample: ProviderPerformanceSample) {
    const rows = this.samples.get(sample.providerId) ?? [];
    rows.unshift({ ...sample, createdAt: sample.createdAt ?? new Date().toISOString() });
    if (rows.length > MAX_SAMPLES) rows.length = MAX_SAMPLES;
    this.samples.set(sample.providerId, rows);
    return rows;
  }

  recordVerification(providerId: string, status: "VERIFIED" | "SUSPICIOUS" | "REJECTED") {
    const current = this.verificationStats.get(providerId) ?? { verified: 0, suspicious: 0, rejected: 0 };
    if (status === "VERIFIED") current.verified += 1;
    if (status === "SUSPICIOUS") current.suspicious += 1;
    if (status === "REJECTED") current.rejected += 1;
    this.verificationStats.set(providerId, current);
  }

  metrics(provider: SignalProviderConfig): SignalProviderPerformance {
    const rows = this.samples.get(provider.providerId) ?? [];
    const stats = this.verificationStats.get(provider.providerId) ?? { verified: 0, suspicious: 0, rejected: 0 };
    const wins = rows.filter((row) => row.won ?? row.realizedPnl > 0).length;
    const totalPnl = rows.reduce((sum, row) => sum + row.realizedPnl, 0);
    const winrate = rows.length > 0 ? wins / rows.length * 100 : provider.baseScore;
    const reliabilityPenalty = stats.suspicious * 4 + stats.rejected * 10;
    const pnlScore = clamp(50 + average(rows.map((row) => row.realizedPnl)) * 4, 0, 100);
    const providerScore = clamp(provider.baseScore * 0.35 + winrate * 0.3 + pnlScore * 0.2 + provider.priority * 0.15 - reliabilityPenalty, 0, 100);
    return {
      providerId: provider.providerId,
      signalCount: stats.verified + stats.suspicious + stats.rejected,
      verifiedSignals: stats.verified,
      suspiciousSignals: stats.suspicious,
      rejectedSignals: stats.rejected,
      winrate: Number(winrate.toFixed(2)),
      totalPnl: Number(totalPnl.toFixed(6)),
      averagePnl: Number(average(rows.map((row) => row.realizedPnl)).toFixed(6)),
      providerScore: Number(providerScore.toFixed(2)),
      riskRating: this.riskRating(provider.riskRating, providerScore, stats.rejected),
      updatedAt: new Date().toISOString(),
    };
  }

  snapshot(providers: SignalProviderConfig[]) {
    return providers.map((provider) => this.metrics(provider));
  }

  private riskRating(base: SignalProviderRiskRating, score: number, rejectedSignals: number): SignalProviderRiskRating {
    if (base === "BLOCKED" || rejectedSignals >= 5 || score < 28) return "BLOCKED";
    if (score < 45 || base === "HIGH") return "HIGH";
    if (score < 68 || base === "MEDIUM") return "MEDIUM";
    return "LOW";
  }
}

const globalPerformance = globalThis as typeof globalThis & { __providerPerformanceStore?: ProviderPerformanceStore };
export const providerPerformanceStore = globalPerformance.__providerPerformanceStore ?? new ProviderPerformanceStore();
globalPerformance.__providerPerformanceStore = providerPerformanceStore;
