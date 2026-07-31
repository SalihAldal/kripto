import { createHash } from "node:crypto";
import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type {
  CanonicalPortfolioBalance,
  ExchangeCapabilityMatrix,
  ExchangeHealthSnapshot,
  PrecisionRules,
} from "@/src/server/exchange-abstraction/exchange-abstraction.types";
import type {
  CanonicalOrderSide,
  CanonicalOrderStatusEnum,
  CanonicalOrderType,
  ExchangePluginType,
} from "@prisma/client";

function key(prefix: string) {
  return `${prefix}_${createHash("sha256").update(`${prefix}_${Date.now()}_${Math.random()}`).digest("hex").slice(0, 16)}`;
}

export async function upsertExchangeRegistry(input: {
  pluginType: ExchangePluginType;
  displayName: string;
  enabled?: boolean;
  isProduction?: boolean;
  connectionMode?: "REST" | "WEBSOCKET" | "BOTH";
  region?: string;
  accountLabel?: string;
}) {
  return prisma.exchangeRegistry.upsert({
    where: { pluginType: input.pluginType },
    create: {
      registryKey: key("reg"),
      pluginType: input.pluginType,
      displayName: input.displayName,
      enabled: input.enabled ?? true,
      isProduction: input.isProduction ?? false,
      connectionMode: input.connectionMode ?? "BOTH",
      region: input.region,
      accountLabel: input.accountLabel,
    },
    update: {
      displayName: input.displayName,
      enabled: input.enabled,
      isProduction: input.isProduction,
    },
  });
}

export async function upsertExchangeCapability(registryId: string, caps: ExchangeCapabilityMatrix) {
  return prisma.exchangeAbstractionCapability.upsert({
    where: { registryId },
    create: { registryId, ...caps },
    update: { ...caps },
  });
}

export async function persistExchangeHealth(registryId: string, health: ExchangeHealthSnapshot) {
  return prisma.exchangeAbstractionHealth.create({
    data: { registryId, ...health },
  });
}

export async function persistExchangeLatency(registryId: string, endpoint: string, latencyMs: number, success: boolean) {
  return prisma.exchangeAbstractionLatency.create({
    data: { registryId, endpoint, latencyMs, success },
  });
}

export async function upsertCanonicalSymbol(input: {
  baseAsset: string;
  quoteAsset: string;
  canonicalSymbol: string;
  pluginType: ExchangePluginType;
  exchangeSymbol: string;
  precision?: Partial<PrecisionRules>;
  status?: string;
}) {
  const canonicalKey = `${input.pluginType}:${input.canonicalSymbol}`;
  return prisma.canonicalSymbol.upsert({
    where: { canonicalKey },
    create: {
      canonicalKey,
      baseAsset: input.baseAsset,
      quoteAsset: input.quoteAsset,
      canonicalSymbol: input.canonicalSymbol,
      pluginType: input.pluginType,
      exchangeSymbol: input.exchangeSymbol,
      tickSize: input.precision?.tickSize,
      stepSize: input.precision?.stepSize,
      minNotional: input.precision?.minNotional,
      minQty: input.precision?.minQty,
      maxQty: input.precision?.maxQty,
      pricePrecision: input.precision?.pricePrecision ?? 8,
      qtyPrecision: input.precision?.quantityPrecision ?? 8,
      status: input.status ?? "ACTIVE",
    },
    update: {
      exchangeSymbol: input.exchangeSymbol,
      tickSize: input.precision?.tickSize,
      stepSize: input.precision?.stepSize,
      minNotional: input.precision?.minNotional,
      minQty: input.precision?.minQty,
      status: input.status ?? "ACTIVE",
      syncedAt: new Date(),
    },
  });
}

export async function upsertCanonicalBalance(pluginType: ExchangePluginType, balance: CanonicalPortfolioBalance, accountLabel?: string) {
  const balanceKey = `${pluginType}:${accountLabel ?? "default"}:${balance.asset}`;
  return prisma.canonicalBalance.upsert({
    where: { balanceKey },
    create: {
      balanceKey,
      pluginType,
      accountLabel,
      asset: balance.asset,
      free: balance.free,
      locked: balance.locked,
      total: balance.total,
    },
    update: { free: balance.free, locked: balance.locked, total: balance.total, syncedAt: new Date() },
  });
}

export async function persistCanonicalOrder(input: {
  pluginType: ExchangePluginType;
  exchangeOrderId: string;
  canonicalSymbol: string;
  side: CanonicalOrderSide;
  type: CanonicalOrderType;
  status: CanonicalOrderStatusEnum;
  quantity: number;
  executedQty: number;
  price?: number;
  averagePrice?: number;
  dryRun?: boolean;
  metadata?: Record<string, unknown>;
}) {
  return prisma.canonicalOrder.create({
    data: {
      orderKey: key("ord"),
      ...input,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function persistCanonicalTrade(input: {
  pluginType: ExchangePluginType;
  exchangeTradeId: string;
  canonicalSymbol: string;
  side: CanonicalOrderSide;
  price: number;
  quantity: number;
  quoteQty?: number;
  isMaker?: boolean;
  metadata?: Record<string, unknown>;
}) {
  return prisma.canonicalTrade.create({
    data: {
      tradeKey: key("trd"),
      ...input,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function getExchangeDashboard() {
  const [registries, health, latency, symbols, balances, orders, trades] = await Promise.all([
    prisma.exchangeRegistry.findMany({ include: { capabilities: true }, orderBy: { pluginType: "asc" } }),
    prisma.exchangeAbstractionHealth.findMany({ orderBy: { checkedAt: "desc" }, take: 50, include: { registry: true } }),
    prisma.exchangeAbstractionLatency.findMany({ orderBy: { measuredAt: "desc" }, take: 50, include: { registry: true } }),
    prisma.canonicalSymbol.findMany({ where: { status: "ACTIVE" }, take: 100, orderBy: { syncedAt: "desc" } }),
    prisma.canonicalBalance.findMany({ orderBy: { syncedAt: "desc" }, take: 50 }),
    prisma.canonicalOrder.findMany({ orderBy: { placedAt: "desc" }, take: 30 }),
    prisma.canonicalTrade.findMany({ orderBy: { tradedAt: "desc" }, take: 30 }),
  ]);
  return { registries, health, latency, symbols, balances, orders, trades };
}

export async function listCanonicalSymbols(pluginType?: ExchangePluginType, limit = 200) {
  return prisma.canonicalSymbol.findMany({
    where: pluginType ? { pluginType, status: "ACTIVE" } : { status: "ACTIVE" },
    orderBy: { canonicalSymbol: "asc" },
    take: limit,
  });
}

export async function getRegistryByPlugin(pluginType: ExchangePluginType) {
  return prisma.exchangeRegistry.findUnique({
    where: { pluginType },
    include: { capabilities: true, health: { take: 5, orderBy: { checkedAt: "desc" } } },
  });
}

export async function getLatestHealth(pluginType?: ExchangePluginType) {
  return prisma.exchangeAbstractionHealth.findMany({
    where: pluginType ? { registry: { pluginType } } : undefined,
    orderBy: { checkedAt: "desc" },
    take: 20,
    include: { registry: true },
  });
}

export async function getLatestLatency(pluginType?: ExchangePluginType) {
  return prisma.exchangeAbstractionLatency.findMany({
    where: pluginType ? { registry: { pluginType } } : undefined,
    orderBy: { measuredAt: "desc" },
    take: 50,
    include: { registry: true },
  });
}
