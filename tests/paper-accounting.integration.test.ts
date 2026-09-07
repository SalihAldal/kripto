import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFix02DisposablePostgres, type Fix02DisposablePostgres } from "./helpers/fix02-disposable-postgres";
import {
  ensurePaperAccountInitialized,
  executePaperCloseOrder,
  executePaperOpenOrder,
  getPaperAccount,
  readPaperCashBalances,
  resetPaperAccount,
} from "@/src/server/simulation/paper-trading.service";

let disposable: Fix02DisposablePostgres | null = null;
let prisma: typeof import("@/src/server/db/prisma").prisma;

async function seedUser() {
  const suffix = crypto.randomUUID().slice(0, 8);
  return prisma.user.create({
    data: { email: `acct-${suffix}@example.com`, username: `acct_${suffix}`, passwordHash: "hash", status: "ACTIVE" },
  });
}

describe.sequential("paper accounting (disposable PostgreSQL)", () => {
  beforeAll(async () => {
    disposable = await createFix02DisposablePostgres();
    prisma = (await import("@/src/server/db/prisma")).prisma;
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    if (disposable) await disposable.cleanup();
  }, 60_000);

  beforeEach(async () => {
    await prisma.appSetting.deleteMany({ where: { key: { startsWith: "paper.account." } } });
    await prisma.user.deleteMany();
  });

  it("initializes paper account deterministically from env defaults", async () => {
    process.env.PAPER_INITIAL_BALANCE_TRY = "100000";
    const user = await seedUser();
    const account = await ensurePaperAccountInitialized(user.id);
    expect(account.balances.TRY).toBe(100000);
    expect(account.balances.USDT).toBeGreaterThan(0);
    const row = await prisma.appSetting.findUnique({ where: { key: `paper.account.${user.id}` } });
    expect(row).not.toBeNull();
  });

  it("BUY then SELL reconciles cash with fees", async () => {
    const user = await seedUser();
    await resetPaperAccount(user.id);
    const before = await readPaperCashBalances(user.id);
    const buy = await executePaperOpenOrder({
      userId: user.id,
      symbol: "BTCTRY",
      side: "BUY",
      quantity: 0.01,
      price: 100,
      quoteAsset: "TRY",
      baseAsset: "BTC",
    });
    const afterBuy = await readPaperCashBalances(user.id);
    expect(afterBuy.TRY).toBeCloseTo(before.TRY - 0.01 * 100 - buy.fee, 4);
    expect(afterBuy.BTC).toBeCloseTo(0.01, 8);

    const sell = await executePaperCloseOrder({
      userId: user.id,
      symbol: "BTCTRY",
      side: "SELL",
      quantity: 0.01,
      price: 110,
      quoteAsset: "TRY",
      baseAsset: "BTC",
    });
    const afterSell = await readPaperCashBalances(user.id);
    expect(afterSell.BTC).toBeCloseTo(0, 8);
    const expectedTry = before.TRY - buy.fee - sell.fee + (0.01 * 110 - 0.01 * 100);
    expect(afterSell.TRY).toBeCloseTo(expectedTry, 4);
  });

  it("campaign A trades do not appear in campaign B scope", async () => {
    const user = await seedUser();
    const suffix = crypto.randomUUID().slice(0, 8);
    await prisma.paperTrade.create({
      data: {
        userId: user.id,
        tradeKey: `campaign-a-trade-${suffix}`,
        symbol: "BTCTRY",
        campaignId: "campaign-a",
        side: "BUY",
        status: "CLOSED",
        quantity: 1,
        entryPrice: 100,
        exitPrice: 105,
        realizedPnl: 5,
        fees: 0.2,
      },
    });
    await prisma.paperTrade.create({
      data: {
        userId: user.id,
        tradeKey: `campaign-b-trade-${suffix}`,
        symbol: "BTCTRY",
        campaignId: "campaign-b",
        side: "BUY",
        status: "CLOSED",
        quantity: 1,
        entryPrice: 100,
        exitPrice: 90,
        realizedPnl: -10,
        fees: 0.2,
      },
    });
    const a = await prisma.paperTrade.findMany({ where: { userId: user.id, campaignId: "campaign-a" } });
    const b = await prisma.paperTrade.findMany({ where: { userId: user.id, campaignId: "campaign-b" } });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].realizedPnl).toBe(5);
    expect(b[0].realizedPnl).toBe(-10);
  });

  it("restart preserves paper account state", async () => {
    const user = await seedUser();
    await resetPaperAccount(user.id);
    await executePaperOpenOrder({
      userId: user.id,
      symbol: "BTCTRY",
      side: "BUY",
      quantity: 0.02,
      price: 100,
      quoteAsset: "TRY",
      baseAsset: "BTC",
    });
    const before = await getPaperAccount(user.id);
    const after = await ensurePaperAccountInitialized(user.id);
    expect(after.balances.BTC).toBeCloseTo(before.balances.BTC, 8);
    expect(after.balances.TRY).toBeCloseTo(before.balances.TRY, 4);
  });
});
