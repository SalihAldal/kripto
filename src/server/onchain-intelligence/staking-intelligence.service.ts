import { persistStakingMetrics } from "@/src/server/onchain-intelligence/onchain-intelligence.repository";
import { emitOnChainEvent, ONCHAIN_EVENT } from "@/src/server/onchain-intelligence/onchain-intelligence.events";
import { SUPPORTED_NETWORKS } from "@/src/server/onchain-intelligence/onchain-intelligence.types";
import type { OnChainNetwork } from "@prisma/client";

const STAKING_ASSETS: Record<string, string> = {
  ETHEREUM: "ETH", SOLANA: "SOL", BNB: "BNB", AVALANCHE: "AVAX", POLYGON: "MATIC", SUI: "SUI", APTOS: "APT",
};

function randF(min: number, max: number) {
  return Number((min + Math.random() * (max - min)).toFixed(2));
}

export async function trackStakingMetrics(network?: OnChainNetwork, limit = 7) {
  const networks = network
    ? [network]
    : SUPPORTED_NETWORKS.filter((n) => STAKING_ASSETS[n]).slice(0, limit);
  let tracked = 0;

  for (const net of networks) {
    const asset = STAKING_ASSETS[net] ?? "ETH";
    const row = await persistStakingMetrics({
      network: net,
      asset,
      totalStaked: randF(1e6, 50e9),
      newStakers: Math.floor(Math.random() * 5000),
      unstakingEvents: Math.floor(Math.random() * 500),
      validatorCount: Math.floor(Math.random() * 10000) + 100,
      stakingYield: randF(2, 15),
      lockedSupplyPct: randF(20, 70),
      quality: { confidence: 67, reliability: 64, freshness: 93 },
    });
    emitOnChainEvent(ONCHAIN_EVENT.STAKING_TRACKED, { network: net, asset, stakingId: row.id });
    tracked += 1;
  }
  return { tracked };
}
