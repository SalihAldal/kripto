import { prisma } from "@/src/server/db/prisma";
import { emitWhaleEvent, WHALE_EVENT } from "@/src/server/whale-intelligence/whale-intelligence.events";
import type { FlowSummary } from "@/src/server/whale-intelligence/whale-intelligence.types";

export async function calculateFlowIntelligence(limit = 100) {
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const transactions = await prisma.whaleTransaction.findMany({
    where: { detectedAt: { gte: since } },
    orderBy: { detectedAt: "desc" },
    take: limit,
  });

  const summary: FlowSummary = {
    netBuyFlowUsd: 0,
    netSellFlowUsd: 0,
    exchangeInflowUsd: 0,
    exchangeOutflowUsd: 0,
    stablecoinInflowUsd: 0,
    stablecoinOutflowUsd: 0,
    accumulationUsd: 0,
    distributionUsd: 0,
  };

  for (const tx of transactions) {
    if (tx.direction === "INFLOW") {
      summary.netBuyFlowUsd += tx.amountUsd;
      summary.exchangeInflowUsd += tx.txType === "EXCHANGE_DEPOSIT" ? tx.amountUsd : 0;
      summary.stablecoinInflowUsd += tx.asset === "USDT" || tx.asset === "USDC" ? tx.amountUsd : 0;
      summary.accumulationUsd += tx.txType === "WALLET_TRANSFER" || tx.txType === "INSTITUTIONAL" ? tx.amountUsd : 0;
    } else {
      summary.netSellFlowUsd += tx.amountUsd;
      summary.exchangeOutflowUsd += tx.txType === "EXCHANGE_WITHDRAWAL" ? tx.amountUsd : 0;
      summary.stablecoinOutflowUsd += tx.asset === "USDT" || tx.asset === "USDC" ? tx.amountUsd : 0;
      summary.distributionUsd += tx.txType === "WALLET_TRANSFER" || tx.txType === "INSTITUTIONAL" ? tx.amountUsd : 0;
    }
  }

  emitWhaleEvent(WHALE_EVENT.FLOW_CALCULATED, { ...summary, txCount: transactions.length });
  return { summary, txCount: transactions.length };
}

export async function getNetFlowByAsset(asset: string) {
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const txs = await prisma.whaleTransaction.findMany({
    where: { asset: asset.toUpperCase(), detectedAt: { gte: since } },
  });
  const inflow = txs.filter((t) => t.direction === "INFLOW").reduce((s, t) => s + t.amountUsd, 0);
  const outflow = txs.filter((t) => t.direction === "OUTFLOW").reduce((s, t) => s + t.amountUsd, 0);
  return { asset, inflow, outflow, netFlow: inflow - outflow, txCount: txs.length };
}
