import { AppSettingScope, ConfigStatus, Prisma } from "@prisma/client";
import { env } from "@/lib/config";
import { prisma } from "@/src/server/db/prisma";

type PaperBalances = Record<string, number>;

export type PaperAccountSnapshot = {
  balances: PaperBalances;
  updatedAt: string;
};

type OpenOrderInput = {
  userId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  quoteAsset: string;
  baseAsset: string;
};

type CloseOrderInput = {
  userId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  quoteAsset: string;
  baseAsset: string;
};

const PAPER_SETTING_PREFIX = "paper.account.";

function safeNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return num;
}

function normalizeAsset(asset: string) {
  return asset.trim().toUpperCase();
}

function normalizeBalances(raw: unknown): PaperBalances {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const entries = Object.entries(obj).map(([key, value]) => [normalizeAsset(key), safeNumber(value)]);
  return Object.fromEntries(entries);
}

function ensureDefaultBalances(existing: PaperBalances): PaperBalances {
  const next = { ...existing };
  if (!Number.isFinite(next.TRY) || next.TRY <= 0) next.TRY = env.PAPER_INITIAL_BALANCE_TRY;
  if (!Number.isFinite(next.USDT)) next.USDT = env.PAPER_INITIAL_BALANCE_USDT;
  return next;
}

async function readPaperAccount(userId: string): Promise<PaperAccountSnapshot> {
  const key = `${PAPER_SETTING_PREFIX}${userId}`;
  const row = await prisma.appSetting.findUnique({ where: { key } });
  const now = new Date().toISOString();
  if (!row) {
    const defaults = ensureDefaultBalances({});
    const created = await prisma.appSetting.create({
      data: {
        key,
        scope: AppSettingScope.USER,
        userId,
        valueType: "json",
        status: ConfigStatus.ACTIVE,
        value: {
          balances: defaults,
          updatedAt: now,
        } as Prisma.InputJsonValue,
        description: "Paper trading virtual account",
      },
    });
    const value = created.value as Record<string, unknown>;
    return {
      balances: normalizeBalances(value.balances),
      updatedAt: String(value.updatedAt ?? now),
    };
  }
  const value = (row.value as Record<string, unknown> | null) ?? {};
  return {
    balances: ensureDefaultBalances(normalizeBalances(value.balances)),
    updatedAt: String(value.updatedAt ?? now),
  };
}

async function writePaperAccount(userId: string, balances: PaperBalances) {
  const key = `${PAPER_SETTING_PREFIX}${userId}`;
  const updatedAt = new Date().toISOString();
  await prisma.appSetting.upsert({
    where: { key },
    create: {
      key,
      scope: AppSettingScope.USER,
      userId,
      valueType: "json",
      status: ConfigStatus.ACTIVE,
      description: "Paper trading virtual account",
      value: {
        balances,
        updatedAt,
      } as Prisma.InputJsonValue,
    },
    update: {
      value: {
        balances,
        updatedAt,
      } as Prisma.InputJsonValue,
      status: ConfigStatus.ACTIVE,
    },
  });
  return updatedAt;
}

export async function getPaperAccount(userId: string) {
  const account = await readPaperAccount(userId);
  const orders = await prisma.tradeOrder.findMany({
    where: { userId },
    include: { tradingPair: true, executions: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const paperOrders = orders.filter((row) => {
    const mode = String((row.metadata as Record<string, unknown> | null)?.mode ?? "");
    return mode === "paper";
  });
  return {
    balances: account.balances,
    updatedAt: account.updatedAt,
    orderCount: paperOrders.length,
  };
}

export async function listPaperOrders(userId: string, limit = 100) {
  const rows = await prisma.tradeOrder.findMany({
    where: { userId },
    include: {
      tradingPair: true,
      executions: true,
    },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(300, limit)),
  });
  return rows
    .filter((row) => {
      const mode = String((row.metadata as Record<string, unknown> | null)?.mode ?? "");
      return mode === "paper";
    })
    .map((row) => ({
      id: row.id,
      symbol: row.tradingPair.symbol,
      side: row.side,
      type: row.type,
      status: row.status,
      quantity: row.quantity,
      price: row.avgExecutionPrice ?? row.price ?? 0,
      fee: row.fee,
      createdAt: row.createdAt.toISOString(),
      executedAt: row.executedAt?.toISOString() ?? null,
    }));
}

function requireBalance(balances: PaperBalances, asset: string, required: number) {
  const normalized = normalizeAsset(asset);
  const free = safeNumber(balances[normalized], 0);
  if (free + 1e-8 < required) {
    throw new Error(`Paper bakiye yetersiz: ${normalized} (gerekli=${required.toFixed(8)}, mevcut=${free.toFixed(8)})`);
  }
}

export async function executePaperOpenOrder(input: OpenOrderInput) {
  const quote = normalizeAsset(input.quoteAsset);
  const base = normalizeAsset(input.baseAsset);
  const quantity = Math.max(0, safeNumber(input.quantity));
  const price = Math.max(0, safeNumber(input.price));
  const notional = quantity * price;
  const fee = notional * env.BINANCE_TAKER_FEE_RATE;

  const account = await readPaperAccount(input.userId);
  const balances = { ...account.balances };

  if (input.side === "BUY") {
    const totalCost = notional + fee;
    requireBalance(balances, quote, totalCost);
    balances[quote] = Number((safeNumber(balances[quote]) - totalCost).toFixed(8));
    balances[base] = Number((safeNumber(balances[base]) + quantity).toFixed(8));
  } else {
    requireBalance(balances, base, quantity);
    balances[base] = Number((safeNumber(balances[base]) - quantity).toFixed(8));
    balances[quote] = Number((safeNumber(balances[quote]) + (notional - fee)).toFixed(8));
  }

  const updatedAt = await writePaperAccount(input.userId, balances);
  const ts = Date.now();
  return {
    orderId: `paper-open-${ts}`,
    clientOrderId: `paper-open-${ts}`,
    symbol: input.symbol,
    status: "FILLED",
    side: input.side,
    type: "MARKET",
    executedQty: quantity,
    price,
    dryRun: true,
    fee,
    accountUpdatedAt: updatedAt,
  };
}

export async function executePaperCloseOrder(input: CloseOrderInput) {
  const quote = normalizeAsset(input.quoteAsset);
  const base = normalizeAsset(input.baseAsset);
  const quantity = Math.max(0, safeNumber(input.quantity));
  const price = Math.max(0, safeNumber(input.price));
  const notional = quantity * price;
  const fee = notional * env.BINANCE_TAKER_FEE_RATE;

  const account = await readPaperAccount(input.userId);
  const balances = { ...account.balances };

  if (input.side === "SELL") {
    requireBalance(balances, base, quantity);
    balances[base] = Number((safeNumber(balances[base]) - quantity).toFixed(8));
    balances[quote] = Number((safeNumber(balances[quote]) + (notional - fee)).toFixed(8));
  } else {
    requireBalance(balances, quote, notional + fee);
    balances[quote] = Number((safeNumber(balances[quote]) - (notional + fee)).toFixed(8));
    balances[base] = Number((safeNumber(balances[base]) + quantity).toFixed(8));
  }

  const updatedAt = await writePaperAccount(input.userId, balances);
  const ts = Date.now();
  return {
    orderId: `paper-close-${ts}`,
    clientOrderId: `paper-close-${ts}`,
    symbol: input.symbol,
    status: "FILLED",
    side: input.side,
    type: "MARKET",
    executedQty: quantity,
    price,
    dryRun: true,
    fee,
    accountUpdatedAt: updatedAt,
  };
}

export async function resetPaperAccount(userId: string) {
  const balances = ensureDefaultBalances({});
  const updatedAt = await writePaperAccount(userId, balances);
  return { balances, updatedAt };
}
