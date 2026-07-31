import { prisma } from "@/src/server/db/prisma";
import { persistWhaleAlert, persistInstitutionalFlow } from "@/src/server/whale-intelligence/whale-intelligence.repository";
import { emitWhaleEvent, WHALE_EVENT } from "@/src/server/whale-intelligence/whale-intelligence.events";
import type { WhaleAlertType } from "@prisma/client";

const ALERT_THRESHOLDS = {
  MASSIVE_BUY: 10_000_000,
  MASSIVE_SELL: 10_000_000,
  EXCHANGE_DRAIN: 50_000_000,
  EXCHANGE_DEPOSIT: 50_000_000,
  STABLECOIN_SURGE: 100_000_000,
  INSTITUTIONAL_ENTRY: 5_000_000,
  POTENTIAL_DISTRIBUTION: 20_000_000,
};

function resolveAlertType(tx: { direction: string; txType: string; amountUsd: number; asset: string; wallet?: { tagType: string } | null }): WhaleAlertType | null {
  if (tx.direction === "INFLOW" && tx.amountUsd >= ALERT_THRESHOLDS.MASSIVE_BUY) return "MASSIVE_BUY";
  if (tx.direction === "OUTFLOW" && tx.amountUsd >= ALERT_THRESHOLDS.MASSIVE_SELL) return "MASSIVE_SELL";
  if (tx.txType === "EXCHANGE_WITHDRAWAL" && tx.amountUsd >= ALERT_THRESHOLDS.EXCHANGE_DRAIN) return "EXCHANGE_DRAIN";
  if (tx.txType === "EXCHANGE_DEPOSIT" && tx.amountUsd >= ALERT_THRESHOLDS.EXCHANGE_DEPOSIT) return "EXCHANGE_DEPOSIT";
  if ((tx.asset === "USDT" || tx.asset === "USDC") && tx.amountUsd >= ALERT_THRESHOLDS.STABLECOIN_SURGE) return "STABLECOIN_SURGE";
  if (tx.txType === "INSTITUTIONAL" && tx.amountUsd >= ALERT_THRESHOLDS.INSTITUTIONAL_ENTRY) return "INSTITUTIONAL_ENTRY";
  if (tx.direction === "OUTFLOW" && tx.amountUsd >= ALERT_THRESHOLDS.POTENTIAL_DISTRIBUTION && tx.wallet?.tagType === "WHALE") return "POTENTIAL_DISTRIBUTION";
  if (tx.txType === "WALLET_TRANSFER" && tx.amountUsd >= 30_000_000) return "WHALE_ROTATION";
  return null;
}

export async function generateWhaleAlerts(limit = 50) {
  const since = new Date(Date.now() - 60 * 60_000);
  const transactions = await prisma.whaleTransaction.findMany({
    where: { detectedAt: { gte: since } },
    orderBy: { amountUsd: "desc" },
    take: limit,
    include: { wallet: true },
  });

  let generated = 0;
  for (const tx of transactions) {
    const alertType = resolveAlertType(tx);
    if (!alertType) continue;

    const existing = await prisma.whaleAlert.findFirst({
      where: { transactionId: tx.id, alertType },
    });
    if (existing) continue;

    const severity = Math.min(100, tx.amountUsd / 1_000_000 + tx.confidence * 0.3);
    const message = `${alertType.replace(/_/g, " ")}: ${tx.amountUsd.toLocaleString()} USD ${tx.asset} on ${tx.exchange ?? tx.chain}`;

    const alert = await persistWhaleAlert({
      alertType,
      walletId: tx.walletId ?? undefined,
      transactionId: tx.id,
      asset: tx.asset,
      exchange: tx.exchange ?? undefined,
      chain: tx.chain,
      amountUsd: tx.amountUsd,
      severity: Number(severity.toFixed(1)),
      confidence: tx.confidence,
      message,
    });
    emitWhaleEvent(WHALE_EVENT.ALERT_TRIGGERED, { alertId: alert.id, alertType, asset: tx.asset });
    generated += 1;

    if (tx.txType === "INSTITUTIONAL" || tx.wallet?.tagType === "FUND") {
      await persistInstitutionalFlow({
        entityName: tx.wallet?.entityName ?? tx.wallet?.label ?? "Unknown Institution",
        entityType: tx.wallet?.tagType ?? "FUND",
        asset: tx.asset,
        chain: tx.chain,
        direction: tx.direction,
        amountUsd: tx.amountUsd,
        exchange: tx.exchange ?? undefined,
        confidence: tx.confidence,
      });
    }
  }
  return { generated, scanned: transactions.length };
}

export async function deactivateStaleAlerts(hours = 24) {
  const cutoff = new Date(Date.now() - hours * 60 * 60_000);
  const result = await prisma.whaleAlert.updateMany({
    where: { isActive: true, triggeredAt: { lt: cutoff } },
    data: { isActive: false },
  });
  return { deactivated: result.count };
}
