import { persistSupplyMetrics } from "@/src/server/onchain-intelligence/onchain-intelligence.repository";
import { emitOnChainEvent, ONCHAIN_EVENT } from "@/src/server/onchain-intelligence/onchain-intelligence.events";
import { DEFAULT_PROTOCOLS, SUPPORTED_NETWORKS } from "@/src/server/onchain-intelligence/onchain-intelligence.types";
import type { OnChainNetwork } from "@prisma/client";

function randF(min: number, max: number) {
  return Number((min + Math.random() * (max - min)).toFixed(2));
}

export async function trackSupplyMetrics(network?: OnChainNetwork, limit = 10) {
  const protocols = network
    ? DEFAULT_PROTOCOLS.filter((p) => p.network === network)
    : DEFAULT_PROTOCOLS.slice(0, limit);
  let tracked = 0;

  for (const p of protocols) {
    const circulating = randF(1e6, 1e9);
    const total = circulating * randF(1, 1.2);
    const row = await persistSupplyMetrics({
      network: p.network,
      asset: p.asset,
      circulatingSupply: circulating,
      totalSupply: total,
      maxSupply: total * 1.1,
      burnEvents: Math.floor(Math.random() * 10),
      mintEvents: Math.floor(Math.random() * 5),
      unlockEvents: Math.floor(Math.random() * 3),
      vestingLocked: total * randF(0.05, 0.3),
      emissionRate: randF(0.1, 5),
      inflationRate: randF(-2, 8),
      quality: { confidence: 68, reliability: 65, freshness: 94 },
    });
    emitOnChainEvent(ONCHAIN_EVENT.SUPPLY_TRACKED, { asset: p.asset, supplyId: row.id });
    tracked += 1;
  }
  return { tracked };
}

export async function getSupplySummary(asset?: string) {
  const { prisma } = await import("@/src/server/db/prisma");
  return prisma.supplyMetrics.findMany({
    where: asset ? { asset: asset.toUpperCase() } : undefined,
    orderBy: { recordedAt: "desc" },
    take: 20,
  });
}
