import { persistBridgeMetrics } from "@/src/server/onchain-intelligence/onchain-intelligence.repository";
import { emitOnChainEvent, ONCHAIN_EVENT } from "@/src/server/onchain-intelligence/onchain-intelligence.events";
import { DEFAULT_BRIDGES } from "@/src/server/onchain-intelligence/onchain-intelligence.types";

function randF(min: number, max: number) {
  return Number((min + Math.random() * (max - min)).toFixed(2));
}

export async function trackBridgeMetrics(limit = 4) {
  const periodEnd = new Date();
  const periodStart = new Date(Date.now() - 60 * 60_000);
  let tracked = 0;

  for (const bridge of DEFAULT_BRIDGES.slice(0, limit)) {
    const inflow = randF(1_000_000, 200_000_000);
    const outflow = randF(1_000_000, 200_000_000);
    const row = await persistBridgeMetrics({
      bridgeName: bridge.name,
      fromNetwork: bridge.from,
      toNetwork: bridge.to,
      inflowUsd: inflow,
      outflowUsd: outflow,
      volumeUsd: inflow + outflow,
      txCount: Math.floor(Math.random() * 5000) + 100,
      periodStart,
      periodEnd,
      quality: { confidence: 66, reliability: 63, freshness: 92 },
    });
    emitOnChainEvent(ONCHAIN_EVENT.BRIDGE_TRACKED, { bridge: bridge.name, bridgeId: row.id });
    tracked += 1;
  }
  return { tracked };
}
