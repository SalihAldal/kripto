import type { CoinClassificationType, StrategySelectorType } from "@prisma/client";
import type { RegimeDetectionResult, StrategyScore } from "@/src/server/strategy-selector/strategy-selector.types";
import { getAllStrategyProfiles, isCoinCompatible, isRegimeCompatible } from "@/src/server/strategy-selector/strategy-library.service";
import { prisma } from "@/src/server/db/prisma";

function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

export async function scoreAllStrategies(
  symbol: string,
  regime: RegimeDetectionResult,
  coinClass: CoinClassificationType,
): Promise<StrategyScore[]> {
  const profiles = getAllStrategyProfiles();
  const perfRows = await prisma.adaptiveStrategyPerformance.findMany({
    where: { strategyType: { in: profiles.map((p) => p.strategyType) } },
    orderBy: { recordedAt: "desc" },
    take: 50,
  }).catch(() => []);

  const snapshot = await prisma.marketSnapshot.findFirst({
    where: { symbol: symbol.toUpperCase() },
    orderBy: { snapshotAt: "desc" },
    include: { momentum: true },
  }).catch(() => null);

  const momentum = Number(snapshot?.momentum?.momentumScore ?? 50);
  const volume = Number(snapshot?.relativeVolume ?? 1) * 50;
  const liquidity = Number(snapshot?.liquidityScore ?? 60);

  return profiles.map((profile) => {
    const perf = perfRows.find((p) => p.strategyType === profile.strategyType);
    const regimeMatch = isRegimeCompatible(profile.strategyType, regime) ? 85 : 30;
    const coinMatch = isCoinCompatible(profile.strategyType, coinClass) ? 80 : 35;
    const marketCompatibility = (regimeMatch + coinMatch) / 2;

    const momentumFit = momentum >= profile.momentumThreshold ? 80 : clamp(momentum / profile.momentumThreshold * 70);
    const volumeFit = volume >= profile.volumeThreshold ? 75 : clamp(volume / profile.volumeThreshold * 65);
    const liquidityFit = liquidity >= profile.liquidityThreshold ? 75 : clamp(liquidity / profile.liquidityThreshold * 65);
    const currentCompatibility = (momentumFit + volumeFit + liquidityFit) / 3;

    const historicalAccuracy = perf?.accuracy ?? profile.historicalAccuracy;
    const expectedWinRate = perf?.winRate ?? profile.expectedWinRate;
    const expectedProfitFactor = perf?.profitFactor ?? profile.expectedProfitFactor;

    const confidence = clamp(
      marketCompatibility * 0.35 + currentCompatibility * 0.35 + historicalAccuracy * 0.2 + regime.regimeConfidence * 0.1,
    );
    const totalScore = clamp(
      confidence * 0.4 + marketCompatibility * 0.25 + currentCompatibility * 0.2 + expectedWinRate * 0.15,
    );

    return {
      strategyType: profile.strategyType,
      expectedWinRate,
      expectedProfitFactor,
      historicalAccuracy,
      currentCompatibility: Number(currentCompatibility.toFixed(1)),
      marketCompatibility: Number(marketCompatibility.toFixed(1)),
      confidence: Number(confidence.toFixed(1)),
      totalScore: Number(totalScore.toFixed(1)),
    };
  }).sort((a, b) => b.totalScore - a.totalScore);
}

export function rankStrategies(scores: StrategyScore[]): StrategySelectorType[] {
  return scores.map((s) => s.strategyType);
}
