import { prisma } from "@/src/server/db/prisma";
import { persistLiquidityRotation } from "@/src/server/whale-intelligence/whale-intelligence.repository";
import { emitWhaleEvent, WHALE_EVENT } from "@/src/server/whale-intelligence/whale-intelligence.events";
import { DEFAULT_EXCHANGES, SAMPLE_ASSETS } from "@/src/server/whale-intelligence/whale-intelligence.types";
import type { RotationType } from "@prisma/client";

const ROTATIONS: Array<{ type: RotationType; fromKey: string; toKey: string }> = [
  { type: "CAPITAL", fromKey: "BTC", toKey: "ETH" },
  { type: "EXCHANGE", fromKey: "BINANCE", toKey: "COINBASE" },
  { type: "SECTOR", fromKey: "LAYER1", toKey: "AI" },
  { type: "NARRATIVE", fromKey: "MEME", toKey: "RWA" },
  { type: "LIQUIDITY", fromKey: "USDT", toKey: "USDC" },
];

function randomUsd(min: number, max: number) {
  return Number((min + Math.random() * (max - min)).toFixed(2));
}

export async function detectLiquidityRotations(limit = 5) {
  let detected = 0;
  for (let i = 0; i < limit; i++) {
    const rot = ROTATIONS[i % ROTATIONS.length]!;
    const amountUsd = randomUsd(1_000_000, 200_000_000);
    const input: Parameters<typeof persistLiquidityRotation>[0] = {
      rotationType: rot.type,
      amountUsd,
      confidence: 55 + (i % 35),
    };
    if (rot.type === "CAPITAL") {
      input.fromAsset = rot.fromKey;
      input.toAsset = rot.toKey;
    } else if (rot.type === "EXCHANGE") {
      input.fromExchange = rot.fromKey;
      input.toExchange = rot.toKey;
    } else if (rot.type === "SECTOR") {
      input.fromSector = rot.fromKey;
      input.toSector = rot.toKey;
    } else if (rot.type === "NARRATIVE") {
      input.fromNarrative = rot.fromKey;
      input.toNarrative = rot.toKey;
    } else {
      input.fromAsset = SAMPLE_ASSETS[i % SAMPLE_ASSETS.length];
      input.toAsset = SAMPLE_ASSETS[(i + 1) % SAMPLE_ASSETS.length];
    }
    const row = await persistLiquidityRotation(input);
    emitWhaleEvent(WHALE_EVENT.ROTATION_DETECTED, { rotationId: row.id, rotationType: rot.type, amountUsd });
    detected += 1;
  }
  return { detected };
}

export async function getRotationSummary() {
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const rotations = await prisma.liquidityRotation.findMany({ where: { detectedAt: { gte: since } }, orderBy: { amountUsd: "desc" } });
  const byType = new Map<string, { count: number; totalUsd: number }>();
  for (const rot of rotations) {
    const bucket = byType.get(rot.rotationType) ?? { count: 0, totalUsd: 0 };
    bucket.count += 1;
    bucket.totalUsd += rot.amountUsd;
    byType.set(rot.rotationType, bucket);
  }
  return { rotations, byType: [...byType.entries()].map(([type, data]) => ({ type, ...data })) };
}

export async function detectExchangeRotation() {
  const flows = await prisma.exchangeFlow.findMany({ orderBy: { periodEnd: "desc" }, take: 20 });
  const netByExchange = new Map<string, number>();
  for (const flow of flows) {
    netByExchange.set(flow.exchange, (netByExchange.get(flow.exchange) ?? 0) + flow.netFlowUsd);
  }
  const sorted = [...netByExchange.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length >= 2 && sorted[0]![1] - sorted[sorted.length - 1]![1] > 1_000_000) {
    await persistLiquidityRotation({
      rotationType: "EXCHANGE",
      fromExchange: sorted[sorted.length - 1]![0],
      toExchange: sorted[0]![0],
      amountUsd: sorted[0]![1] - sorted[sorted.length - 1]![1],
      confidence: 65,
    });
  }
  return { exchanges: DEFAULT_EXCHANGES.length, netByExchange: Object.fromEntries(netByExchange) };
}
