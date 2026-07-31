import { createHash } from "node:crypto";
import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type { DetectedWhaleEvent, WhaleScoreResult } from "@/src/server/whale-intelligence/whale-intelligence.types";

export function buildTxKey(input: DetectedWhaleEvent & { detectedAt?: Date }) {
  const raw = `${input.chain}|${input.txType}|${input.asset}|${input.amountUsd}|${input.fromAddress ?? ""}|${input.toAddress ?? ""}|${(input.detectedAt ?? new Date()).getTime()}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

export async function upsertWhaleWallet(input: {
  address: string;
  chain: Parameters<typeof prisma.whaleWallet.create>[0]["data"]["chain"];
  label?: string;
  tagType?: Parameters<typeof prisma.whaleWallet.create>[0]["data"]["tagType"];
  exchange?: string;
  entityName?: string;
  isVerified?: boolean;
}) {
  return prisma.whaleWallet.upsert({
    where: { address_chain: { address: input.address, chain: input.chain } },
    create: input,
    update: {
      label: input.label,
      tagType: input.tagType,
      exchange: input.exchange,
      entityName: input.entityName,
      lastActiveAt: new Date(),
    },
  });
}

export async function addWalletTag(input: {
  walletId: string;
  tagType: Parameters<typeof prisma.walletTag.create>[0]["data"]["tagType"];
  label: string;
  source?: string;
  confidence?: number;
}) {
  return prisma.walletTag.create({ data: input });
}

export async function persistWhaleTransaction(input: DetectedWhaleEvent & { walletId?: string }) {
  const txKey = buildTxKey(input);
  const existing = await prisma.whaleTransaction.findUnique({ where: { txKey } });
  if (existing) return { transaction: existing, duplicate: true };

  const row = await prisma.whaleTransaction.create({
    data: {
      txKey,
      walletId: input.walletId,
      chain: input.chain,
      txType: input.txType,
      direction: input.direction,
      asset: input.asset,
      amount: input.amount,
      amountUsd: input.amountUsd,
      exchange: input.exchange,
      fromAddress: input.fromAddress,
      toAddress: input.toAddress,
      confidence: input.confidence ?? 50,
      sourceReliability: input.sourceReliability ?? 50,
      estimatedImpact: Math.min(100, input.amountUsd / 1_000_000 * 10),
      falseSignalProb: input.confidence && input.confidence > 70 ? 10 : 25,
    },
  });
  return { transaction: row, duplicate: false };
}

export async function persistExchangeFlow(input: {
  exchange: string;
  chain?: Parameters<typeof prisma.exchangeFlow.create>[0]["data"]["chain"];
  asset: string;
  direction: Parameters<typeof prisma.exchangeFlow.create>[0]["data"]["direction"];
  inflowUsd: number;
  outflowUsd: number;
  txCount: number;
  whaleTxCount: number;
  periodStart: Date;
  periodEnd: Date;
}) {
  return prisma.exchangeFlow.create({
    data: {
      ...input,
      netFlowUsd: input.inflowUsd - input.outflowUsd,
    },
  });
}

export async function persistStablecoinFlow(input: {
  stablecoin: string;
  chain: Parameters<typeof prisma.stablecoinFlow.create>[0]["data"]["chain"];
  direction: Parameters<typeof prisma.stablecoinFlow.create>[0]["data"]["direction"];
  exchange?: string;
  amountUsd: number;
  txCount: number;
  netFlowUsd: number;
  periodStart: Date;
  periodEnd: Date;
}) {
  return prisma.stablecoinFlow.create({ data: input });
}

export async function persistWhaleScore(input: {
  walletId?: string;
  asset?: string;
  exchange?: string;
  score: WhaleScoreResult;
}) {
  return prisma.whaleScore.create({
    data: {
      walletId: input.walletId,
      asset: input.asset,
      exchange: input.exchange,
      ...input.score,
    },
  });
}

export async function persistWhaleReplay(input: {
  transactionId: string;
  symbol: string;
  priceAtEvent?: number;
  maxMovePct?: number;
  minMovePct?: number;
  reactionDelayMs?: number;
  similarTxIds?: string[];
  historicalAccuracy?: number;
}) {
  return prisma.whaleReplay.create({ data: input });
}

export async function persistWhaleAlert(input: {
  alertType: Parameters<typeof prisma.whaleAlert.create>[0]["data"]["alertType"];
  walletId?: string;
  transactionId?: string;
  asset: string;
  exchange?: string;
  chain?: Parameters<typeof prisma.whaleAlert.create>[0]["data"]["chain"];
  amountUsd: number;
  severity: number;
  confidence: number;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.whaleAlert.create({
    data: { ...input, metadata: input.metadata as Prisma.InputJsonValue },
  });
}

export async function persistInstitutionalFlow(input: {
  entityName: string;
  entityType: Parameters<typeof prisma.institutionalFlow.create>[0]["data"]["entityType"];
  asset: string;
  chain: Parameters<typeof prisma.institutionalFlow.create>[0]["data"]["chain"];
  direction: Parameters<typeof prisma.institutionalFlow.create>[0]["data"]["direction"];
  amountUsd: number;
  exchange?: string;
  confidence?: number;
}) {
  return prisma.institutionalFlow.create({ data: input });
}

export async function persistLiquidityRotation(input: {
  rotationType: Parameters<typeof prisma.liquidityRotation.create>[0]["data"]["rotationType"];
  fromAsset?: string;
  toAsset?: string;
  fromExchange?: string;
  toExchange?: string;
  fromSector?: string;
  toSector?: string;
  fromNarrative?: string;
  toNarrative?: string;
  amountUsd: number;
  confidence?: number;
}) {
  return prisma.liquidityRotation.create({ data: input });
}

export async function getWhaleDashboard() {
  const [wallets, transactions, exchangeFlows, stablecoinFlows, scores, alerts, institutional, rotations, replays] = await Promise.all([
    prisma.whaleWallet.findMany({ orderBy: { activityScore: "desc" }, take: 20, include: { tags: true, scores: { orderBy: { scoredAt: "desc" }, take: 1 } } }),
    prisma.whaleTransaction.findMany({ orderBy: { detectedAt: "desc" }, take: 30, include: { wallet: true } }),
    prisma.exchangeFlow.findMany({ orderBy: { periodEnd: "desc" }, take: 30 }),
    prisma.stablecoinFlow.findMany({ orderBy: { periodEnd: "desc" }, take: 20 }),
    prisma.whaleScore.findMany({ orderBy: { whaleActivityScore: "desc" }, take: 30, include: { wallet: true } }),
    prisma.whaleAlert.findMany({ where: { isActive: true }, orderBy: { triggeredAt: "desc" }, take: 20 }),
    prisma.institutionalFlow.findMany({ orderBy: { detectedAt: "desc" }, take: 20 }),
    prisma.liquidityRotation.findMany({ orderBy: { detectedAt: "desc" }, take: 20 }),
    prisma.whaleReplay.findMany({ orderBy: { replayedAt: "desc" }, take: 20, include: { transaction: true } }),
  ]);
  return { wallets, transactions, exchangeFlows, stablecoinFlows, scores, alerts, institutional, rotations, replays };
}

export async function getWalletDetails(address: string, chain?: string) {
  return prisma.whaleWallet.findFirst({
    where: { address, ...(chain ? { chain: chain as never } : {}) },
    include: {
      tags: { orderBy: { taggedAt: "desc" } },
      transactions: { orderBy: { detectedAt: "desc" }, take: 50 },
      scores: { orderBy: { scoredAt: "desc" }, take: 10 },
      alerts: { orderBy: { triggeredAt: "desc" }, take: 20 },
    },
  });
}

export async function listWhaleActivity(limit = 50, asset?: string) {
  return prisma.whaleTransaction.findMany({
    where: asset ? { asset: asset.toUpperCase() } : undefined,
    orderBy: { detectedAt: "desc" },
    take: limit,
    include: { wallet: true, replays: true },
  });
}

export async function listActiveAlerts(limit = 30) {
  return prisma.whaleAlert.findMany({
    where: { isActive: true },
    orderBy: { severity: "desc" },
    take: limit,
    include: { wallet: true, transaction: true },
  });
}

export async function listExchangeFlows(exchange?: string, limit = 30) {
  return prisma.exchangeFlow.findMany({
    where: exchange ? { exchange } : undefined,
    orderBy: { periodEnd: "desc" },
    take: limit,
  });
}

export async function listStablecoinFlows(limit = 30) {
  return prisma.stablecoinFlow.findMany({ orderBy: { periodEnd: "desc" }, take: limit });
}
