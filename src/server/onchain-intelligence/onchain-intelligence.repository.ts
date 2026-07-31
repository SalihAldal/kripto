import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type { MetricQuality, OnChainScoreResult } from "@/src/server/onchain-intelligence/onchain-intelligence.types";

const DEFAULT_QUALITY: MetricQuality = {
  confidence: 55,
  source: "simulated",
  reliability: 60,
  historicalAccuracy: 50,
  freshness: 95,
};

export async function persistBlockchainSnapshot(input: {
  network: Parameters<typeof prisma.blockchainSnapshot.create>[0]["data"]["network"];
  blockHeight?: number;
  activeAddresses: number;
  txCount: number;
  gasUsed?: number;
  gasPrice?: number;
  tps?: number;
  quality?: Partial<MetricQuality>;
}) {
  const q = { ...DEFAULT_QUALITY, ...input.quality };
  return prisma.blockchainSnapshot.create({
    data: {
      network: input.network,
      blockHeight: input.blockHeight,
      activeAddresses: input.activeAddresses,
      txCount: input.txCount,
      gasUsed: input.gasUsed ?? 0,
      gasPrice: input.gasPrice ?? 0,
      tps: input.tps ?? 0,
      confidence: q.confidence,
      source: q.source,
      reliability: q.reliability,
      freshness: q.freshness,
    },
  });
}

export async function persistAddressActivity(input: {
  network: Parameters<typeof prisma.addressActivity.create>[0]["data"]["network"];
  address: string;
  activityType: Parameters<typeof prisma.addressActivity.create>[0]["data"]["activityType"];
  txCount?: number;
  volumeUsd?: number;
  lastActiveAt?: Date;
  quality?: Partial<MetricQuality>;
}) {
  const q = { ...DEFAULT_QUALITY, ...input.quality };
  return prisma.addressActivity.create({
    data: {
      network: input.network,
      address: input.address,
      activityType: input.activityType,
      txCount: input.txCount ?? 0,
      volumeUsd: input.volumeUsd ?? 0,
      lastActiveAt: input.lastActiveAt,
      confidence: q.confidence,
      source: q.source,
      reliability: q.reliability,
      historicalAccuracy: q.historicalAccuracy ?? 50,
      freshness: q.freshness,
    },
  });
}

export async function persistTransactionMetrics(input: {
  network: Parameters<typeof prisma.transactionMetrics.create>[0]["data"]["network"];
  asset?: string;
  txCount: number;
  largeTransfers: number;
  medianTransferUsd: number;
  averageTransferUsd: number;
  txGrowthPct: number;
  gasUsage: number;
  gasTrend: number;
  transferVelocity: number;
  periodStart: Date;
  periodEnd: Date;
  quality?: Partial<MetricQuality>;
}) {
  const q = { ...DEFAULT_QUALITY, ...input.quality };
  return prisma.transactionMetrics.create({
    data: {
      ...input,
      confidence: q.confidence,
      source: q.source,
      reliability: q.reliability,
      historicalAccuracy: q.historicalAccuracy ?? 50,
      freshness: q.freshness,
    },
  });
}

export async function persistExchangeReserve(input: {
  exchange: string;
  network: Parameters<typeof prisma.exchangeReserve.create>[0]["data"]["network"];
  asset: string;
  depositsUsd: number;
  withdrawalsUsd: number;
  hotWalletUsd?: number;
  coldWalletUsd?: number;
  reserveChangePct?: number;
  periodStart: Date;
  periodEnd: Date;
  quality?: Partial<MetricQuality>;
}) {
  const q = { ...DEFAULT_QUALITY, ...input.quality };
  return prisma.exchangeReserve.create({
    data: {
      ...input,
      netFlowUsd: input.depositsUsd - input.withdrawalsUsd,
      hotWalletUsd: input.hotWalletUsd ?? 0,
      coldWalletUsd: input.coldWalletUsd ?? 0,
      reserveChangePct: input.reserveChangePct ?? 0,
      confidence: q.confidence,
      source: q.source,
      reliability: q.reliability,
      freshness: q.freshness,
    },
  });
}

export async function persistSupplyMetrics(input: {
  network: Parameters<typeof prisma.supplyMetrics.create>[0]["data"]["network"];
  asset: string;
  circulatingSupply: number;
  totalSupply: number;
  maxSupply?: number;
  burnEvents?: number;
  mintEvents?: number;
  unlockEvents?: number;
  vestingLocked?: number;
  emissionRate?: number;
  inflationRate?: number;
  quality?: Partial<MetricQuality>;
}) {
  const q = { ...DEFAULT_QUALITY, ...input.quality };
  return prisma.supplyMetrics.create({ data: { ...input, confidence: q.confidence, source: q.source, reliability: q.reliability, freshness: q.freshness } });
}

export async function persistStakingMetrics(input: {
  network: Parameters<typeof prisma.stakingMetrics.create>[0]["data"]["network"];
  asset: string;
  totalStaked: number;
  newStakers?: number;
  unstakingEvents?: number;
  validatorCount?: number;
  stakingYield?: number;
  lockedSupplyPct?: number;
  quality?: Partial<MetricQuality>;
}) {
  const q = { ...DEFAULT_QUALITY, ...input.quality };
  return prisma.stakingMetrics.create({ data: { ...input, confidence: q.confidence, source: q.source, reliability: q.reliability, freshness: q.freshness } });
}

export async function persistDeFiMetrics(input: {
  network: Parameters<typeof prisma.deFiMetrics.create>[0]["data"]["network"];
  protocol?: string;
  tvlUsd: number;
  tvlGrowthPct?: number;
  dexVolumeUsd?: number;
  borrowVolumeUsd?: number;
  lendVolumeUsd?: number;
  liquidationsUsd?: number;
  stablecoinSupply?: number;
  poolCount?: number;
  periodStart: Date;
  periodEnd: Date;
  quality?: Partial<MetricQuality>;
}) {
  const q = { ...DEFAULT_QUALITY, ...input.quality };
  return prisma.deFiMetrics.create({ data: { ...input, confidence: q.confidence, source: q.source, reliability: q.reliability, freshness: q.freshness } });
}

export async function persistBridgeMetrics(input: {
  bridgeName: string;
  fromNetwork: Parameters<typeof prisma.bridgeMetrics.create>[0]["data"]["fromNetwork"];
  toNetwork: Parameters<typeof prisma.bridgeMetrics.create>[0]["data"]["toNetwork"];
  inflowUsd: number;
  outflowUsd: number;
  volumeUsd: number;
  txCount?: number;
  periodStart: Date;
  periodEnd: Date;
  quality?: Partial<MetricQuality>;
}) {
  const q = { ...DEFAULT_QUALITY, ...input.quality };
  return prisma.bridgeMetrics.create({
    data: {
      ...input,
      netMigrationUsd: input.inflowUsd - input.outflowUsd,
      txCount: input.txCount ?? 0,
      confidence: q.confidence,
      source: q.source,
      reliability: q.reliability,
      freshness: q.freshness,
    },
  });
}

export async function persistDeveloperMetrics(input: {
  protocol: string;
  repoUrl?: string;
  commits: number;
  contributors: number;
  releases?: number;
  openIssues?: number;
  pullRequests?: number;
  devVelocity: number;
  periodStart: Date;
  periodEnd: Date;
  quality?: Partial<MetricQuality>;
}) {
  const q = { ...DEFAULT_QUALITY, ...input.quality };
  return prisma.developerMetrics.create({ data: { ...input, confidence: q.confidence, source: q.source, reliability: q.reliability, freshness: q.freshness } });
}

export async function persistProtocolHealth(input: {
  protocol: string;
  network: Parameters<typeof prisma.protocolHealth.create>[0]["data"]["network"];
  networkActivity: number;
  security: number;
  adoption: number;
  growth: number;
  developerActivity: number;
  tvl: number;
  liquidity: number;
  decentralization: number;
  overallHealth: number;
  quality?: Partial<MetricQuality>;
}) {
  const q = { ...DEFAULT_QUALITY, ...input.quality };
  return prisma.protocolHealth.create({
    data: {
      ...input,
      confidence: q.confidence,
      source: q.source,
      reliability: q.reliability,
      historicalAccuracy: q.historicalAccuracy ?? 50,
      freshness: q.freshness,
    },
  });
}

export async function persistOnChainScore(input: {
  protocol?: string;
  network: Parameters<typeof prisma.onChainScore.create>[0]["data"]["network"];
  asset?: string;
  score: OnChainScoreResult;
  quality?: Partial<MetricQuality>;
}) {
  const q = { ...DEFAULT_QUALITY, ...input.quality };
  return prisma.onChainScore.create({
    data: {
      protocol: input.protocol,
      network: input.network,
      asset: input.asset,
      ...input.score,
      source: q.source,
      reliability: q.reliability,
      historicalAccuracy: q.historicalAccuracy ?? 50,
      freshness: q.freshness,
    },
  });
}

export async function upsertKnowledgeNode(input: {
  nodeKey: string;
  nodeType: Parameters<typeof prisma.knowledgeGraphNode.create>[0]["data"]["nodeType"];
  label: string;
  network?: Parameters<typeof prisma.knowledgeGraphNode.create>[0]["data"]["network"];
  weight?: number;
  metadata?: Record<string, unknown>;
}) {
  return prisma.knowledgeGraphNode.upsert({
    where: { nodeKey: input.nodeKey },
    create: { ...input, metadata: input.metadata as Prisma.InputJsonValue },
    update: { label: input.label, weight: input.weight, metadata: input.metadata as Prisma.InputJsonValue },
  });
}

export async function persistKnowledgeEdge(input: {
  fromNodeId: string;
  toNodeId: string;
  relation: string;
  weight?: number;
  confidence?: number;
}) {
  return prisma.knowledgeGraphEdge.create({ data: input });
}

export async function persistOnChainReplay(input: {
  network: Parameters<typeof prisma.onChainReplay.create>[0]["data"]["network"];
  eventType: string;
  protocol?: string;
  asset?: string;
  symbol?: string;
  priceAtEvent?: number;
  maxMovePct?: number;
  minMovePct?: number;
  reactionDelayMs?: number;
  similarEventIds?: string[];
  historicalAccuracy?: number;
  confidence?: number;
  eventAt: Date;
}) {
  return prisma.onChainReplay.create({ data: input });
}

export async function getOnChainDashboard() {
  const [snapshots, addressActivity, txMetrics, exchangeReserves, supply, staking, defi, bridges, developers, health, scores, graph, replays] = await Promise.all([
    prisma.blockchainSnapshot.findMany({ orderBy: { capturedAt: "desc" }, take: 12 }),
    prisma.addressActivity.findMany({ orderBy: { recordedAt: "desc" }, take: 30 }),
    prisma.transactionMetrics.findMany({ orderBy: { periodEnd: "desc" }, take: 20 }),
    prisma.exchangeReserve.findMany({ orderBy: { periodEnd: "desc" }, take: 20 }),
    prisma.supplyMetrics.findMany({ orderBy: { recordedAt: "desc" }, take: 20 }),
    prisma.stakingMetrics.findMany({ orderBy: { recordedAt: "desc" }, take: 15 }),
    prisma.deFiMetrics.findMany({ orderBy: { periodEnd: "desc" }, take: 20 }),
    prisma.bridgeMetrics.findMany({ orderBy: { periodEnd: "desc" }, take: 15 }),
    prisma.developerMetrics.findMany({ orderBy: { periodEnd: "desc" }, take: 15 }),
    prisma.protocolHealth.findMany({ orderBy: { overallHealth: "desc" }, take: 20 }),
    prisma.onChainScore.findMany({ orderBy: { protocolScore: "desc" }, take: 20 }),
    prisma.knowledgeGraphNode.findMany({ orderBy: { weight: "desc" }, take: 50, include: { outgoing: { take: 5 }, incoming: { take: 5 } } }),
    prisma.onChainReplay.findMany({ orderBy: { replayedAt: "desc" }, take: 20 }),
  ]);
  return { snapshots, addressActivity, txMetrics, exchangeReserves, supply, staking, defi, bridges, developers, health, scores, graph, replays };
}

export async function listAddressActivity(network?: string, limit = 50) {
  return prisma.addressActivity.findMany({
    where: network ? { network: network as never } : undefined,
    orderBy: { recordedAt: "desc" },
    take: limit,
  });
}

export async function listSupplyMetrics(asset?: string, limit = 30) {
  return prisma.supplyMetrics.findMany({
    where: asset ? { asset: asset.toUpperCase() } : undefined,
    orderBy: { recordedAt: "desc" },
    take: limit,
  });
}

export async function listDeFiMetrics(limit = 30) {
  return prisma.deFiMetrics.findMany({ orderBy: { tvlUsd: "desc" }, take: limit });
}

export async function listBridgeMetrics(limit = 20) {
  return prisma.bridgeMetrics.findMany({ orderBy: { volumeUsd: "desc" }, take: limit });
}

export async function listDeveloperMetrics(limit = 20) {
  return prisma.developerMetrics.findMany({ orderBy: { devVelocity: "desc" }, take: limit });
}

export async function getKnowledgeGraph(limit = 100) {
  const nodes = await prisma.knowledgeGraphNode.findMany({ orderBy: { weight: "desc" }, take: limit });
  const edges = await prisma.knowledgeGraphEdge.findMany({
    where: { fromNodeId: { in: nodes.map((n) => n.id) } },
    take: limit * 2,
    include: { fromNode: true, toNode: true },
  });
  return { nodes, edges };
}
