import { persistBlockchainSnapshot } from "@/src/server/onchain-intelligence/onchain-intelligence.repository";
import { emitOnChainEvent, ONCHAIN_EVENT } from "@/src/server/onchain-intelligence/onchain-intelligence.events";
import { SUPPORTED_NETWORKS } from "@/src/server/onchain-intelligence/onchain-intelligence.types";
import type { OnChainNetwork } from "@prisma/client";

function rand(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min));
}

function randF(min: number, max: number) {
  return Number((min + Math.random() * (max - min)).toFixed(2));
}

export async function collectBlockchainData(network?: OnChainNetwork, limit = 12) {
  const networks = network ? [network] : SUPPORTED_NETWORKS.slice(0, limit);
  let collected = 0;
  for (const net of networks) {
    const row = await persistBlockchainSnapshot({
      network: net,
      blockHeight: rand(1_000_000, 20_000_000),
      activeAddresses: rand(10_000, 500_000),
      txCount: rand(50_000, 2_000_000),
      gasUsed: randF(1e9, 50e9),
      gasPrice: randF(10, 200),
      tps: randF(5, 3000),
      quality: { confidence: 65, source: "simulated", reliability: 70, freshness: 98 },
    });
    emitOnChainEvent(ONCHAIN_EVENT.SNAPSHOT_CAPTURED, { network: net, snapshotId: row.id });
    collected += 1;
  }
  return { collected, networks: networks.length };
}
