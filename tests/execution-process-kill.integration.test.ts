import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFix02DisposablePostgres, type Fix02DisposablePostgres } from "./helpers/fix02-disposable-postgres";

let disposable: Fix02DisposablePostgres | null = null;
let prisma: typeof import("@/src/server/db/prisma").prisma;

const baseNow = Date.parse("2026-09-06T10:00:00.000Z");

async function seedPosition(quantity = 1) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: { email: `crash-${suffix}@example.com`, username: `crash_${suffix}`, passwordHash: "hash" },
  });
  const conn = await prisma.exchangeConnection.create({
    data: { userId: user.id, exchange: "BINANCE", name: "paper", apiKeyMasked: "x", apiSecretEncrypted: "y", isSandbox: true },
  });
  const pair = await prisma.tradingPair.upsert({
    where: { symbol: "BTCTRY" },
    update: {},
    create: { symbol: "BTCTRY", baseAsset: "BTC", quoteAsset: "TRY" },
  });
  const position = await prisma.position.create({
    data: {
      userId: user.id,
      exchangeConnectionId: conn.id,
      tradingPairId: pair.id,
      side: "LONG",
      status: "OPEN",
      entryPrice: 100,
      quantity,
      openedAt: new Date(baseNow),
      metadata: { mode: "paper", executionId: `exec-${suffix}` },
    },
  });
  return { user, conn, pair, position };
}

function runCrashChild(input: {
  mode: "PRE_COMMIT_KILL" | "POST_COMMIT_KILL";
  positionId: string;
  userId: string;
  exchangeConnectionId: string;
  tradingPairId: string;
  settlementFillId: string;
  exchangeOrderId: string;
  exchangeTradeId: string;
  barrierFile?: string;
}) {
  const env = {
    ...process.env,
    CRASH_MODE: input.mode,
    CRASH_POSITION_ID: input.positionId,
    CRASH_USER_ID: input.userId,
    CRASH_CONN_ID: input.exchangeConnectionId,
    CRASH_PAIR_ID: input.tradingPairId,
    CRASH_FILL_ID: input.settlementFillId,
    CRASH_ORDER_ID: input.exchangeOrderId,
    CRASH_TRADE_ID: input.exchangeTradeId,
    ...(input.barrierFile ? { CRASH_BARRIER_FILE: input.barrierFile } : {}),
  };
  return spawnSync("npx", ["tsx", "tests/helpers/process-kill-settlement-child.ts"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    shell: true,
  });
}

async function runPostCommitBarrierKill(input: {
  positionId: string;
  userId: string;
  exchangeConnectionId: string;
  tradingPairId: string;
  settlementFillId: string;
  exchangeOrderId: string;
  exchangeTradeId: string;
}) {
  const barrierFile = path.join(os.tmpdir(), `kripto-crash-barrier-${crypto.randomUUID()}.txt`);
  const env = {
    ...process.env,
    CRASH_MODE: "POST_COMMIT_KILL",
    CRASH_POSITION_ID: input.positionId,
    CRASH_USER_ID: input.userId,
    CRASH_CONN_ID: input.exchangeConnectionId,
    CRASH_PAIR_ID: input.tradingPairId,
    CRASH_FILL_ID: input.settlementFillId,
    CRASH_ORDER_ID: input.exchangeOrderId,
    CRASH_TRADE_ID: input.exchangeTradeId,
    CRASH_BARRIER_FILE: barrierFile,
  };
  const child = spawn("npx", ["tsx", "tests/helpers/process-kill-settlement-child.ts"], {
    cwd: process.cwd(),
    env,
    stdio: "ignore",
    shell: true,
  });
  const started = Date.now();
  while (!fs.existsSync(barrierFile) && Date.now() - started < 20_000) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(fs.existsSync(barrierFile)).toBe(true);
  child.kill("SIGKILL");
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(resolve, 2_000);
  });
  if (fs.existsSync(barrierFile)) fs.unlinkSync(barrierFile);
}

describe("EXEC crash proof — child process kill", () => {
  beforeAll(async () => {
    disposable = await createFix02DisposablePostgres();
    prisma = (await import("@/src/server/db/prisma")).prisma;
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    if (disposable) await disposable.cleanup();
  }, 60_000);

  beforeEach(async () => {
    await prisma.positionSettlementFill.deleteMany();
    await prisma.profitLossRecord.deleteMany();
    await prisma.tradeExecution.deleteMany();
    await prisma.tradeOrder.deleteMany();
    await prisma.position.deleteMany();
    await prisma.exchangeConnection.deleteMany();
    await prisma.user.deleteMany();
  });

  it("kill before commit leaves no partial writes", async () => {
    const seeded = await seedPosition(1);
    const res = runCrashChild({
      mode: "PRE_COMMIT_KILL",
      positionId: seeded.position.id,
      userId: seeded.user.id,
      exchangeConnectionId: seeded.conn.id,
      tradingPairId: seeded.pair.id,
      settlementFillId: "crash-pre-commit",
      exchangeOrderId: "order-pre-commit",
      exchangeTradeId: "trade-pre-commit",
    });
    expect(res.status).not.toBe(0);
    const position = await prisma.position.findUnique({ where: { id: seeded.position.id } });
    expect(position?.quantity).toBe(1);
    expect(await prisma.positionSettlementFill.count({ where: { positionId: seeded.position.id } })).toBe(0);
    expect(await prisma.tradeOrder.count({ where: { positionId: seeded.position.id } })).toBe(0);
    expect(await prisma.tradeExecution.count()).toBe(0);
    expect(await prisma.profitLossRecord.count({ where: { positionId: seeded.position.id } })).toBe(0);
  }, 60_000);

  it("kill after commit before response is idempotent on restart", async () => {
    const seeded = await seedPosition(1);
    const fillId = "crash-post-commit";
    const orderId = "order-post-commit";
    const tradeId = "trade-post-commit";
    await runPostCommitBarrierKill({
      positionId: seeded.position.id,
      userId: seeded.user.id,
      exchangeConnectionId: seeded.conn.id,
      tradingPairId: seeded.pair.id,
      settlementFillId: fillId,
      exchangeOrderId: orderId,
      exchangeTradeId: tradeId,
    });
    const { applyCanonicalPartialSettlementFill } = await import("@/src/server/execution/canonical-settlement-fill.service");
    const retry = await applyCanonicalPartialSettlementFill({
      positionId: seeded.position.id,
      settlementFillId: fillId,
      userId: seeded.user.id,
      exchangeConnectionId: seeded.conn.id,
      tradingPairId: seeded.pair.id,
      quoteAsset: "TRY",
      positionSide: "LONG",
      closeSide: "SELL",
      fillPrice: 110,
      filledQuantity: 0.4,
      closeFee: 0.1,
      feeAsset: "QUOTE",
      openFeePortion: 0.04,
      clientOrderId: `client-${tradeId}`,
      exchangeOrderId: orderId,
      closeReason: "TAKE_PROFIT",
      mode: "paper",
      orderTerminal: false,
      orderRemainingQuantity: 0.6,
      fillAtMs: Date.now(),
      metadata: { exchangeTradeId: tradeId },
    });
    expect(["APPLIED", "ALREADY_APPLIED"]).toContain(retry.status);
    const finalPosition = await prisma.position.findUnique({ where: { id: seeded.position.id } });
    expect(finalPosition?.quantity).toBeCloseTo(0.6, 8);
    expect(await prisma.positionSettlementFill.count({ where: { positionId: seeded.position.id } })).toBe(1);
  }, 60_000);
});

