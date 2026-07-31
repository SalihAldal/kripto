import { prisma } from "@/src/server/db/prisma";
import { STRATEGY_PROFILES } from "@/src/server/strategy-selector/strategy-library.service";

let bootstrapped = false;

export async function ensureStrategyProfiles() {
  if (bootstrapped) return;
  for (const profile of STRATEGY_PROFILES) {
    await prisma.adaptiveStrategyProfile.upsert({
      where: { strategyType: profile.strategyType },
      create: {
        profileKey: `profile_${profile.strategyType.toLowerCase()}`,
        ...profile,
      },
      update: {
        displayName: profile.displayName,
        description: profile.description,
        confidenceThreshold: profile.confidenceThreshold,
        momentumThreshold: profile.momentumThreshold,
        volumeThreshold: profile.volumeThreshold,
        liquidityThreshold: profile.liquidityThreshold,
        riskThreshold: profile.riskThreshold,
        expectedWinRate: profile.expectedWinRate,
        expectedProfitFactor: profile.expectedProfitFactor,
        historicalAccuracy: profile.historicalAccuracy,
        compatibleRegimes: profile.compatibleRegimes,
        compatibleCoins: profile.compatibleCoins,
        active: true,
      },
    });
  }
  bootstrapped = true;
}
