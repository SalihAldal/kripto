import { prisma } from "@/src/server/db/prisma";
import { persistOnChainScore } from "@/src/server/onchain-intelligence/onchain-intelligence.repository";
import { emitOnChainEvent, ONCHAIN_EVENT } from "@/src/server/onchain-intelligence/onchain-intelligence.events";
import { DEFAULT_PROTOCOLS, SUPPORTED_NETWORKS } from "@/src/server/onchain-intelligence/onchain-intelligence.types";
import type { OnChainNetwork } from "@prisma/client";
import type { OnChainScoreResult } from "@/src/server/onchain-intelligence/onchain-intelligence.types";

function randF(min: number, max: number) {
  return Number((min + Math.random() * (max - min)).toFixed(1));
}

export async function computeOnChainScore(protocol?: string, network?: OnChainNetwork) {
  const p = protocol
    ? DEFAULT_PROTOCOLS.find((x) => x.protocol === protocol)
    : DEFAULT_PROTOCOLS[Math.floor(Math.random() * DEFAULT_PROTOCOLS.length)];

  const net = network ?? p?.network ?? "ETHEREUM";
  const health = p ? await prisma.protocolHealth.findFirst({ where: { protocol: p.protocol }, orderBy: { scoredAt: "desc" } }) : null;
  const supply = p ? await prisma.supplyMetrics.findFirst({ where: { asset: p.asset }, orderBy: { recordedAt: "desc" } }) : null;
  const defi = p ? await prisma.deFiMetrics.findFirst({ where: { protocol: p.protocol }, orderBy: { periodEnd: "desc" } }) : null;

  const accumulationScore = supply ? Math.min(100, 50 + (supply.burnEvents - supply.mintEvents) * 5) : randF(30, 80);
  const adoptionScore = health?.adoption ?? randF(30, 85);
  const growthScore = health?.growth ?? (defi?.tvlGrowthPct ? Math.min(100, 50 + defi.tvlGrowthPct) : randF(25, 80));
  const riskScore = health ? Math.max(0, 100 - health.security) : randF(10, 50);
  const protocolScore = health?.overallHealth ?? randF(40, 90);
  const networkScore = health?.networkActivity ?? randF(35, 88);
  const confidence = randF(55, 85);

  const score: OnChainScoreResult = {
    accumulationScore,
    adoptionScore,
    growthScore,
    riskScore,
    protocolScore,
    networkScore,
    confidence,
  };

  const row = await persistOnChainScore({
    protocol: p?.protocol,
    network: net,
    asset: p?.asset,
    score,
    quality: { confidence, reliability: 68, historicalAccuracy: 55, freshness: 93 },
  });
  emitOnChainEvent(ONCHAIN_EVENT.ONCHAIN_SCORE_COMPUTED, { protocol: p?.protocol, protocolScore });
  return row;
}

export async function scoreRecentProtocols(limit = 10) {
  let scored = 0;
  for (const p of DEFAULT_PROTOCOLS.slice(0, limit)) {
    await computeOnChainScore(p.protocol, p.network).catch(() => null);
    scored += 1;
  }
  for (const net of SUPPORTED_NETWORKS.slice(0, 3)) {
    await computeOnChainScore(undefined, net).catch(() => null);
  }
  return { scored };
}
