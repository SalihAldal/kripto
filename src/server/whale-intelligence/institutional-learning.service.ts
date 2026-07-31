import { prisma } from "@/src/server/db/prisma";

export async function learnFromWhaleHistory(limit = 200) {
  const replays = await prisma.whaleReplay.findMany({
    orderBy: { replayedAt: "desc" },
    take: limit,
    include: { transaction: { include: { wallet: true } } },
  });

  const movedByType = new Map<string, { moves: number[]; count: number }>();
  const zeroImpactByType = new Map<string, number>();
  const exchangeLead = new Map<string, { moves: number[]; count: number }>();
  const walletPerf = new Map<string, { moves: number[]; count: number; label?: string }>();

  for (const replay of replays) {
    const txType = replay.transaction.txType;
    const move = Math.abs(replay.maxMovePct ?? 0);
    const bucket = movedByType.get(txType) ?? { moves: [], count: 0 };
    bucket.moves.push(move);
    bucket.count += 1;
    movedByType.set(txType, bucket);

    if (move < 0.5) zeroImpactByType.set(txType, (zeroImpactByType.get(txType) ?? 0) + 1);

    if (replay.transaction.exchange) {
      const exBucket = exchangeLead.get(replay.transaction.exchange) ?? { moves: [], count: 0 };
      exBucket.moves.push(move);
      exBucket.count += 1;
      exchangeLead.set(replay.transaction.exchange, exBucket);
    }

    if (replay.transaction.walletId) {
      const wBucket = walletPerf.get(replay.transaction.walletId) ?? { moves: [], count: 0, label: replay.transaction.wallet?.label ?? undefined };
      wBucket.moves.push(move);
      wBucket.count += 1;
      walletPerf.set(replay.transaction.walletId, wBucket);
    }
  }

  const impactfulTypes = [...movedByType.entries()]
    .map(([txType, b]) => ({ txType, avgMove: b.moves.reduce((s, m) => s + m, 0) / Math.max(1, b.moves.length), count: b.count }))
    .sort((a, b) => b.avgMove - a.avgMove);

  const leadingExchanges = [...exchangeLead.entries()]
    .map(([exchange, b]) => ({ exchange, avgMove: b.moves.reduce((s, m) => s + m, 0) / Math.max(1, b.moves.length), count: b.count }))
    .sort((a, b) => b.avgMove - a.avgMove)
    .slice(0, 10);

  const topWallets = [...walletPerf.entries()]
    .map(([walletId, b]) => ({ walletId, label: b.label, avgMove: b.moves.reduce((s, m) => s + m, 0) / Math.max(1, b.moves.length), count: b.count }))
    .sort((a, b) => b.avgMove - a.avgMove)
    .slice(0, 10);

  return {
    impactfulTypes,
    zeroImpactTypes: [...zeroImpactByType.entries()].map(([txType, count]) => ({ txType, count })),
    leadingExchanges,
    topWallets,
    sampleSize: replays.length,
  };
}
