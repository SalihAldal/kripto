import { prisma } from "@/src/server/db/prisma";
import { emitWhaleEvent, WHALE_EVENT } from "@/src/server/whale-intelligence/whale-intelligence.events";
import type { SmartMoneyPatternType } from "@prisma/client";

type DetectedPattern = {
  patternType: SmartMoneyPatternType;
  asset: string;
  exchange?: string;
  confidence: number;
  walletId?: string;
  transactionIds: string[];
  description: string;
};

export async function detectSmartMoneyPatterns(limit = 30) {
  const since = new Date(Date.now() - 6 * 60 * 60_000);
  const transactions = await prisma.whaleTransaction.findMany({
    where: { detectedAt: { gte: since } },
    orderBy: { detectedAt: "desc" },
    take: limit * 3,
    include: { wallet: true },
  });

  const patterns: DetectedPattern[] = [];
  const byAsset = new Map<string, typeof transactions>();

  for (const tx of transactions) {
    const bucket = byAsset.get(tx.asset) ?? [];
    bucket.push(tx);
    byAsset.set(tx.asset, bucket);
  }

  for (const [asset, txs] of byAsset.entries()) {
    const inflows = txs.filter((t) => t.direction === "INFLOW");
    const outflows = txs.filter((t) => t.direction === "OUTFLOW");
    const inflowUsd = inflows.reduce((s, t) => s + t.amountUsd, 0);
    const outflowUsd = outflows.reduce((s, t) => s + t.amountUsd, 0);

    if (inflows.length >= 3 && inflowUsd > outflowUsd * 2) {
      patterns.push({
        patternType: "STEALTH_ACCUMULATION",
        asset,
        confidence: 70,
        transactionIds: inflows.slice(0, 5).map((t) => t.id),
        description: `Repeated inflows on ${asset} without price reaction`,
      });
    }
    if (outflows.length >= 3 && outflowUsd > inflowUsd * 2) {
      patterns.push({
        patternType: "DISTRIBUTION",
        asset,
        confidence: 75,
        transactionIds: outflows.slice(0, 5).map((t) => t.id),
        description: `Large distribution detected on ${asset}`,
      });
    }
    if (inflows.length >= 1 && outflows.length >= 1 && inflowUsd > 10_000_000 && outflowUsd > 10_000_000) {
      patterns.push({
        patternType: "LIQUIDITY_SWEEP",
        asset,
        confidence: 60,
        transactionIds: txs.slice(0, 3).map((t) => t.id),
        description: `Bidirectional large flow on ${asset}`,
      });
    }
    const institutional = txs.filter((t) => t.txType === "INSTITUTIONAL" || t.wallet?.tagType === "FUND");
    if (institutional.length >= 2) {
      patterns.push({
        patternType: "REPEATED_INSTITUTIONAL_ENTRY",
        asset,
        confidence: 80,
        walletId: institutional[0]?.walletId ?? undefined,
        transactionIds: institutional.map((t) => t.id),
        description: `Multiple institutional entries on ${asset}`,
      });
    }
    const largeOrders = txs.filter((t) => t.amountUsd > 20_000_000);
    if (largeOrders.length >= 2 && inflowUsd > outflowUsd) {
      patterns.push({
        patternType: "ICEBERG",
        asset,
        exchange: largeOrders[0]?.exchange ?? undefined,
        confidence: 65,
        transactionIds: largeOrders.map((t) => t.id),
        description: `Fragmented large orders on ${asset}`,
      });
    }
  }

  for (const pattern of patterns.slice(0, limit)) {
    emitWhaleEvent(WHALE_EVENT.PATTERN_DETECTED, pattern);
  }
  return { patterns: patterns.slice(0, limit), detected: patterns.length };
}
