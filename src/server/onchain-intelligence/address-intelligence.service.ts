import { persistAddressActivity } from "@/src/server/onchain-intelligence/onchain-intelligence.repository";
import { emitOnChainEvent, ONCHAIN_EVENT } from "@/src/server/onchain-intelligence/onchain-intelligence.events";
import { SUPPORTED_NETWORKS } from "@/src/server/onchain-intelligence/onchain-intelligence.types";
import type { AddressActivityType, OnChainNetwork } from "@prisma/client";

const ACTIVITY_TYPES: AddressActivityType[] = [
  "ACTIVE", "NEW", "RETURNING", "DORMANT", "WHALE", "EXCHANGE", "TREASURY", "FOUNDATION", "VC", "SMART_CONTRACT",
];

function randF(min: number, max: number) {
  return Number((min + Math.random() * (max - min)).toFixed(2));
}

export async function analyzeAddressActivity(network?: OnChainNetwork, limit = 30) {
  const networks = network ? [network] : SUPPORTED_NETWORKS.slice(0, 6);
  let analyzed = 0;
  for (let i = 0; i < limit; i++) {
    const net = networks[i % networks.length]!;
    const activityType = ACTIVITY_TYPES[i % ACTIVITY_TYPES.length]!;
    const row = await persistAddressActivity({
      network: net,
      address: `0x${activityType.toLowerCase()}_${net.toLowerCase()}_${i}`,
      activityType,
      txCount: Math.floor(Math.random() * 500) + 1,
      volumeUsd: randF(10_000, 50_000_000),
      lastActiveAt: new Date(),
      quality: { confidence: 60 + (i % 30), reliability: 65, historicalAccuracy: 55, freshness: 95 },
    });
    emitOnChainEvent(ONCHAIN_EVENT.ADDRESS_ANALYZED, { addressId: row.id, activityType });
    analyzed += 1;
  }
  return { analyzed };
}
