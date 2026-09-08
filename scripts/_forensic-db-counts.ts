import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const jobId = "cmtqhz77p000fun84lgcyuckv";
const userId = "cmtqhz23t0000un84a460hu19";
const start = new Date("2026-09-07T00:23:13.406Z");
const end = new Date("2026-09-07T08:23:30.000Z");

async function main() {
  const job = await p.autoRoundJob.findUnique({ where: { id: jobId } });
  const [positions, tradeOrders, paperTrades, paperPortfolio] = await Promise.all([
    p.position.count({ where: { userId, openedAt: { gte: start, lte: end } } }),
    p.tradeOrder.count({ where: { userId, createdAt: { gte: start, lte: end } } }),
    p.paperTrade.count({ where: { userId, createdAt: { gte: start, lte: end } } }),
    p.paperPortfolio.findFirst({ where: { userId } }),
  ]);
  console.log(
    JSON.stringify(
      {
        jobStatus: job?.status,
        stopRequested: job?.stopRequested,
        counts: { positions, tradeOrders, paperTrades },
        paperPortfolio: paperPortfolio
          ? {
              balance: paperPortfolio.balance,
              availableBalance: paperPortfolio.availableBalance,
              totalPnl: paperPortfolio.totalPnl,
              positionCount: paperPortfolio.positionCount,
              updatedAt: paperPortfolio.updatedAt,
            }
          : null,
      },
      null,
      2,
    ),
  );
  await p.$disconnect();
}

main();
