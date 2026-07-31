import { persistDeFiMetrics } from "@/src/server/onchain-intelligence/onchain-intelligence.repository";
import { emitOnChainEvent, ONCHAIN_EVENT } from "@/src/server/onchain-intelligence/onchain-intelligence.events";
import { DEFAULT_PROTOCOLS } from "@/src/server/onchain-intelligence/onchain-intelligence.types";
import type { OnChainNetwork } from "@prisma/client";

function randF(min: number, max: number) {
  return Number((min + Math.random() * (max - min)).toFixed(2));
}

export async function trackDeFiMetrics(network?: OnChainNetwork, limit = 10) {
  const protocols = network
    ? DEFAULT_PROTOCOLS.filter((p) => p.network === network)
    : DEFAULT_PROTOCOLS.slice(0, limit);
  const periodEnd = new Date();
  const periodStart = new Date(Date.now() - 24 * 60 * 60_000);
  let tracked = 0;

  for (const p of protocols) {
    const tvl = randF(10_000_000, 10_000_000_000);
    const row = await persistDeFiMetrics({
      network: p.network,
      protocol: p.protocol,
      tvlUsd: tvl,
      tvlGrowthPct: randF(-15, 40),
      dexVolumeUsd: randF(1_000_000, 2_000_000_000),
      borrowVolumeUsd: randF(500_000, 500_000_000),
      lendVolumeUsd: randF(500_000, 500_000_000),
      liquidationsUsd: randF(0, 50_000_000),
      stablecoinSupply: randF(100_000_000, 5_000_000_000),
      poolCount: Math.floor(Math.random() * 500) + 10,
      periodStart,
      periodEnd,
      quality: { confidence: 71, reliability: 69, freshness: 95 },
    });
    emitOnChainEvent(ONCHAIN_EVENT.DEFI_TRACKED, { protocol: p.protocol, defiId: row.id, tvlUsd: tvl });
    tracked += 1;
  }
  return { tracked };
}
