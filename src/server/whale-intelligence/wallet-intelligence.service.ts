import { prisma } from "@/src/server/db/prisma";
import { addWalletTag, upsertWhaleWallet } from "@/src/server/whale-intelligence/whale-intelligence.repository";
import { emitWhaleEvent, WHALE_EVENT } from "@/src/server/whale-intelligence/whale-intelligence.events";
import { DEFAULT_WALLETS } from "@/src/server/whale-intelligence/whale-intelligence.types";

export async function seedWhaleWallets() {
  let seeded = 0;
  for (const wallet of DEFAULT_WALLETS) {
    const row = await upsertWhaleWallet(wallet);
    const existingTags = await prisma.walletTag.count({ where: { walletId: row.id } });
    if (existingTags === 0) {
      await addWalletTag({ walletId: row.id, tagType: wallet.tagType, label: wallet.label, source: "seed", confidence: 90 });
      emitWhaleEvent(WHALE_EVENT.WALLET_TAGGED, { walletId: row.id, tagType: wallet.tagType });
    }
    seeded += 1;
  }
  return { seeded };
}

export async function monitorWallets(limit = 20) {
  await seedWhaleWallets();
  const wallets = await prisma.whaleWallet.findMany({ orderBy: { lastActiveAt: "asc" }, take: limit });
  let updated = 0;
  for (const wallet of wallets) {
    const recentTx = await prisma.whaleTransaction.count({
      where: { walletId: wallet.id, detectedAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) } },
    });
    const activityScore = Math.min(100, recentTx * 15 + wallet.totalVolumeUsd / 1_000_000);
    await prisma.whaleWallet.update({
      where: { id: wallet.id },
      data: { activityScore, lastActiveAt: new Date(), totalVolumeUsd: wallet.totalVolumeUsd + recentTx * 100_000 },
    });
    updated += 1;
  }
  return { updated, wallets: wallets.length };
}

export async function tagWallet(walletId: string, tagType: Parameters<typeof addWalletTag>[0]["tagType"], label: string) {
  const tag = await addWalletTag({ walletId, tagType, label, source: "manual", confidence: 80 });
  emitWhaleEvent(WHALE_EVENT.WALLET_TAGGED, { walletId, tagType });
  return tag;
}

export async function listWalletsByTag(tagType?: string, limit = 50) {
  return prisma.whaleWallet.findMany({
    where: tagType ? { tagType: tagType as never } : undefined,
    orderBy: { activityScore: "desc" },
    take: limit,
    include: { tags: true },
  });
}
