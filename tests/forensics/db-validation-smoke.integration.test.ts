import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/src/server/db/prisma";

const createdTradeIds: string[] = [];
const createdExecutionIds: string[] = [];
const createdShadowIds: string[] = [];

describe("db validation smoke", () => {
  it("writes and reads shadow outcome and paper trade artifacts", async () => {
    const now = Date.now();
    const runA = `runA-${now}`;
    const runB = `runB-${now}`;
    const candidateA = `candA-${now}`;
    const candidateB = `candB-${now}`;

    const rowA = await prisma.shadowCandidateOutcome.upsert({
      where: { candidateId: candidateA },
      update: {},
      create: {
        candidateId: candidateA,
        symbol: "AAAUSDT",
        detectedAt: new Date(),
        firstDetectionPrice: 100,
        lane: "EARLY",
        finalScore: 88,
        moveKey: `AAAUSDT:${Math.floor(now / 1000)}`,
        latestStage: "EXECUTION_READY",
        latestScore: 88,
        latestRank: 1,
        snapshot: { runId: runA, candidateId: candidateA, symbol: "AAAUSDT" },
        journey: [{ stage: "DISCOVERED", at: now }],
        outcomes: [{ horizonMin: 60, mfePct: 3.2, maePct: -1.1, complete: true, quality: "OK" }],
        reachTimes: { timeTo2Percent: 120000 },
      },
    });
    const rowB = await prisma.shadowCandidateOutcome.upsert({
      where: { candidateId: candidateB },
      update: {},
      create: {
        candidateId: candidateB,
        symbol: "BBBUSDT",
        detectedAt: new Date(),
        firstDetectionPrice: 50,
        lane: "STEADY",
        finalScore: 76,
        moveKey: `BBBUSDT:${Math.floor(now / 1000)}`,
        latestStage: "MICRO_REJECTED",
        latestScore: 76,
        latestRank: 12,
        snapshot: { runId: runB, candidateId: candidateB, symbol: "BBBUSDT" },
        journey: [{ stage: "DISCOVERED", at: now }],
        outcomes: [{ horizonMin: 60, mfePct: 0.8, maePct: -3.2, complete: true, quality: "OK" }],
        reachTimes: { timeTo2Percent: null },
      },
    });
    createdShadowIds.push(rowA.id, rowB.id);

    const trade = await prisma.paperTrade.create({
      data: {
        tradeKey: `paper-${now}`,
        userId: "phase07-smoke",
        symbol: "AAAUSDT",
        side: "BUY",
        status: "OPEN",
        entryPrice: 100,
        quantity: 1,
        metadata: { runId: runA, candidateId: candidateA },
      },
    });
    createdTradeIds.push(trade.id);

    const execution = await prisma.paperExecution.create({
      data: {
        executionKey: `exec-${now}`,
        paperTradeId: trade.id,
        side: "BUY",
        executedQty: 1,
        avgFillPrice: 100.4,
        metadata: { runId: runA, candidateId: candidateA, moverId: `mover-${now}` },
      },
    });
    createdExecutionIds.push(execution.id);

    const readBack = await prisma.paperExecution.findUnique({
      where: { id: execution.id },
      include: { paperTrade: true },
    });
    expect(readBack?.paperTrade.symbol).toBe("AAAUSDT");

    const runAOutcomes = await prisma.shadowCandidateOutcome.findMany({
      where: { candidateId: { startsWith: "candA-" } },
    });
    const runBOutcomes = await prisma.shadowCandidateOutcome.findMany({
      where: { candidateId: { startsWith: "candB-" } },
    });
    expect(runAOutcomes.length).toBeGreaterThan(0);
    expect(runBOutcomes.length).toBeGreaterThan(0);
    expect(runAOutcomes[0]?.candidateId).not.toBe(runBOutcomes[0]?.candidateId);
  });
});

afterAll(async () => {
  if (createdExecutionIds.length > 0) {
    await prisma.paperExecution.deleteMany({ where: { id: { in: createdExecutionIds } } });
  }
  if (createdTradeIds.length > 0) {
    await prisma.paperTrade.deleteMany({ where: { id: { in: createdTradeIds } } });
  }
  if (createdShadowIds.length > 0) {
    await prisma.shadowCandidateOutcome.deleteMany({ where: { id: { in: createdShadowIds } } });
  }
});
