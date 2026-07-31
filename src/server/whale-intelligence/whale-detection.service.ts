import { prisma } from "@/src/server/db/prisma";
import { persistWhaleTransaction, upsertWhaleWallet } from "@/src/server/whale-intelligence/whale-intelligence.repository";
import { emitWhaleEvent, WHALE_EVENT } from "@/src/server/whale-intelligence/whale-intelligence.events";
import { DEFAULT_EXCHANGES, SAMPLE_ASSETS, type DetectedWhaleEvent } from "@/src/server/whale-intelligence/whale-intelligence.types";
import type { FlowDirection, WhaleTransactionType } from "@prisma/client";

const TX_TYPES: WhaleTransactionType[] = [
  "SPOT_ORDER",
  "FUTURES_ORDER",
  "WALLET_TRANSFER",
  "EXCHANGE_DEPOSIT",
  "EXCHANGE_WITHDRAWAL",
  "STABLECOIN_MOVEMENT",
  "ETF_FLOW",
  "INSTITUTIONAL",
];

const CHAINS = ["ETHEREUM", "BNB", "SOLANA", "BITCOIN", "ARBITRUM"] as const;

function randomUsd(min: number, max: number) {
  return Number((min + Math.random() * (max - min)).toFixed(2));
}

function buildSimulatedEvent(i: number): DetectedWhaleEvent {
  const txType = TX_TYPES[i % TX_TYPES.length]!;
  const asset = SAMPLE_ASSETS[i % SAMPLE_ASSETS.length]!;
  const exchange = DEFAULT_EXCHANGES[i % DEFAULT_EXCHANGES.length];
  const direction: FlowDirection = i % 3 === 0 ? "OUTFLOW" : "INFLOW";
  const amountUsd = randomUsd(500_000, 50_000_000);
  const amount = asset.startsWith("USD") ? amountUsd : amountUsd / (asset === "BTC" ? 65000 : asset === "ETH" ? 3500 : 100);

  return {
    chain: CHAINS[i % CHAINS.length]!,
    txType,
    direction,
    asset,
    amount: Number(amount.toFixed(4)),
    amountUsd,
    exchange,
    fromAddress: `0xfrom_${i}`,
    toAddress: `0xto_${i}`,
    walletAddress: `0xwhale_${i % 10}`,
    confidence: 55 + (i % 40),
    sourceReliability: 60 + (i % 30),
  };
}

export async function detectWhaleActivity(limit = 20) {
  let detected = 0;
  for (let i = 0; i < limit; i++) {
    const event = buildSimulatedEvent(Date.now() + i);
    let walletId: string | undefined;
    if (event.walletAddress) {
      const wallet = await upsertWhaleWallet({
        address: event.walletAddress,
        chain: event.chain,
        label: `Whale ${i % 10}`,
        tagType: event.walletTag ?? "WHALE",
        exchange: event.exchange,
      });
      walletId = wallet.id;
    }
    const result = await persistWhaleTransaction({ ...event, walletId });
    if (!result.duplicate) {
      detected += 1;
      emitWhaleEvent(WHALE_EVENT.TRANSACTION_DETECTED, { transactionId: result.transaction.id, asset: event.asset, amountUsd: event.amountUsd });
    }
  }
  return { detected };
}

export async function detectLargeOrders(limit = 10) {
  return detectWhaleActivity(limit);
}

export async function getRecentWhaleTransactions(limit = 50) {
  return prisma.whaleTransaction.findMany({ orderBy: { detectedAt: "desc" }, take: limit, include: { wallet: true } });
}
