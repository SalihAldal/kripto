import { prisma } from "@/src/server/db/prisma";
import { emitOnChainEvent, ONCHAIN_EVENT } from "@/src/server/onchain-intelligence/onchain-intelligence.events";
import type { OnChainNetwork } from "@prisma/client";

export async function trackSmartContractActivity(network?: OnChainNetwork, limit = 10) {
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const contracts = await prisma.addressActivity.findMany({
    where: { activityType: "SMART_CONTRACT", ...(network ? { network } : {}) },
    orderBy: { recordedAt: "desc" },
    take: limit,
  });

  const events = [];
  for (let i = 0; i < Math.min(limit, 5); i++) {
    events.push({
      type: ["DEPLOYMENT", "UPGRADE", "INTERACTION", "FAILURE", "PROXY_CHANGE", "OWNERSHIP_CHANGE"][i % 6],
      network: network ?? "ETHEREUM",
      contractAddress: contracts[i]?.address ?? `0xcontract_${i}`,
      confidence: 60 + (i % 25),
      timestamp: new Date(),
    });
  }
  return { events, contractCount: contracts.length };
}
