import { ExchangeType, Prisma, SignalSide, SignalSource, SignalStatus } from "@prisma/client";
import { env } from "@/lib/config";
import { prisma } from "@/src/server/db/prisma";
import { maskSecret, upsertExchangeApiSecret } from "@/src/server/security/secrets";

function maskApiKey(key?: string) {
  if (!key) return "not-configured";
  return maskSecret(key);
}

export async function getRuntimeExecutionContext(inputUserId?: string) {
  let user = inputUserId
    ? await prisma.user.findUnique({ where: { id: inputUserId } })
    : await prisma.user.findFirst({
        where: { status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
      });

  if (!user) {
    user = await prisma.user.upsert({
      where: { email: "local.trader@kinetic.app" },
      create: {
        email: "local.trader@kinetic.app",
        username: "local_trader",
        passwordHash: "local-dev-bootstrap",
        fullName: "Local Trader",
        role: "TRADER",
        status: "ACTIVE",
        timezone: "Europe/Istanbul",
      },
      update: {
        status: "ACTIVE",
      },
    });
  }

  let connection =
    (await prisma.exchangeConnection.findFirst({
      where: { userId: user.id, status: "CONNECTED" },
      orderBy: { createdAt: "asc" },
    })) ??
    (await prisma.exchangeConnection.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    }));

  if (!connection) {
    const encryptedSecret = env.BINANCE_API_SECRET ? await upsertExchangeApiSecret(user.id, "binance-tr", env.BINANCE_API_SECRET) : "not-configured";
    connection = await prisma.exchangeConnection.upsert({
      where: {
        userId_exchange_name: {
          userId: user.id,
          exchange: ExchangeType.BINANCE,
          name: "BinanceTR Primary",
        },
      },
      create: {
        userId: user.id,
        exchange: ExchangeType.BINANCE,
        name: "BinanceTR Primary",
        status: "CONNECTED",
        apiKeyMasked: maskApiKey(env.BINANCE_API_KEY),
        apiSecretEncrypted: encryptedSecret,
        isSandbox: env.BINANCE_ENV !== "live",
        rateLimitPerMinute: 1200,
        providerMetadata: {
          platform: env.BINANCE_PLATFORM,
          environment: env.BINANCE_ENV,
        } as Prisma.InputJsonValue,
      },
      update: {
        status: "CONNECTED",
        apiKeyMasked: maskApiKey(env.BINANCE_API_KEY),
        apiSecretEncrypted: encryptedSecret,
        providerMetadata: {
          platform: env.BINANCE_PLATFORM,
          environment: env.BINANCE_ENV,
        } as Prisma.InputJsonValue,
      },
    });
  } else if (env.BINANCE_API_SECRET) {
    const encryptedSecret = await upsertExchangeApiSecret(user.id, "binance-tr", env.BINANCE_API_SECRET);
    if (connection.apiSecretEncrypted !== encryptedSecret) {
      connection = await prisma.exchangeConnection.update({
        where: { id: connection.id },
        data: {
          apiSecretEncrypted: encryptedSecret,
          apiKeyMasked: maskApiKey(env.BINANCE_API_KEY),
        },
      });
    }
  }

  return { user, connection };
}

export async function getExecutionPolicySetting(userId: string) {
  const keys = [`execution.policy.${userId}`, "execution.policy"];
  const setting = await prisma.appSetting.findFirst({
    where: { key: { in: keys }, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });
  return setting?.value as Record<string, unknown> | undefined;
}

export async function getEmergencyStopState(userId: string) {
  const keys = [`execution.emergency_stop.${userId}`, "execution.emergency_stop"];
  const setting = await prisma.appSetting.findFirst({
    where: { key: { in: keys }, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });
  if (!setting) return false;
  if (typeof setting.value === "boolean") return setting.value;
  if (setting.value && typeof setting.value === "object" && "enabled" in setting.value) {
    return Boolean((setting.value as { enabled?: boolean }).enabled);
  }
  return false;
}

export async function setEmergencyStopState(enabled: boolean, userId?: string) {
  const key = userId ? `execution.emergency_stop.${userId}` : "execution.emergency_stop";
  return prisma.appSetting.upsert({
    where: { key },
    create: {
      key,
      scope: userId ? "USER" : "GLOBAL",
      userId,
      value: { enabled },
      valueType: "json",
      description: "Trade execution emergency stop",
      status: "ACTIVE",
    },
    update: {
      value: { enabled },
      status: "ACTIVE",
    },
  });
}

export async function ensureTradingPair(symbol: string) {
  const normalized = symbol.toUpperCase();
  const quoteCandidates = ["TRY", "USDT", "BUSD", "USDC", "BTC", "ETH"];
  const quoteAsset = quoteCandidates.find((q) => normalized.endsWith(q)) ?? "USDT";
  const baseAsset = normalized.slice(0, normalized.length - quoteAsset.length) || normalized.slice(0, 3);

  return prisma.tradingPair.upsert({
    where: { symbol: normalized },
    create: {
      symbol: normalized,
      baseAsset,
      quoteAsset,
    },
    update: {
      baseAsset,
      quoteAsset,
    },
  });
}

export async function createTradeSignalFromConsensus(input: {
  userId: string;
  tradingPairId: string;
  scannerResultId?: string;
  side: "BUY" | "SELL" | "HOLD";
  confidencePercent: number;
  triggerPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  reason?: string;
  metadata?: Record<string, unknown>;
  status?: SignalStatus;
}) {
  const side: SignalSide = input.side === "BUY" ? SignalSide.BUY : input.side === "SELL" ? SignalSide.SELL : SignalSide.HOLD;
  return prisma.tradeSignal.create({
    data: {
      userId: input.userId,
      tradingPairId: input.tradingPairId,
      scannerResultId: input.scannerResultId,
      side,
      source: SignalSource.AI_MODEL,
      status: input.status ?? SignalStatus.APPROVED,
      confidence: Number((input.confidencePercent / 100).toFixed(4)),
      triggerPrice: input.triggerPrice,
      stopLossPrice: input.stopLossPrice,
      takeProfitPrice: input.takeProfitPrice,
      reason: input.reason,
      metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });
}

export async function createTradeOrder(input: {
  userId: string;
  exchangeConnectionId: string;
  tradingPairId: string;
  tradeSignalId?: string;
  positionId?: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  quantity: number;
  price?: number;
  stopPrice?: number;
  takeProfitPrice?: number;
  status?: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED";
  clientOrderId?: string;
  exchangeOrderId?: string;
  submittedAt?: Date;
  executedAt?: Date;
  fee?: number;
  feeCurrency?: string;
  slippage?: number;
  avgExecutionPrice?: number;
  rejectReason?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.tradeOrder.create({
    data: {
      userId: input.userId,
      exchangeConnectionId: input.exchangeConnectionId,
      tradingPairId: input.tradingPairId,
      tradeSignalId: input.tradeSignalId,
      positionId: input.positionId,
      side: input.side,
      type: input.type,
      quantity: input.quantity,
      price: input.price,
      stopPrice: input.stopPrice,
      takeProfitPrice: input.takeProfitPrice,
      status: input.status ?? "NEW",
      clientOrderId: input.clientOrderId,
      exchangeOrderId: input.exchangeOrderId,
      submittedAt: input.submittedAt,
      executedAt: input.executedAt,
      fee: input.fee ?? 0,
      feeCurrency: input.feeCurrency,
      slippage: input.slippage ?? 0,
      avgExecutionPrice: input.avgExecutionPrice,
      rejectReason: input.rejectReason,
      errorMessage: input.errorMessage,
      metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });
}

export async function addTradeExecution(input: {
  tradeOrderId: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
  executionPrice: number;
  executedQty: number;
  quoteQty?: number;
  fee?: number;
  slippage?: number;
  liquidityType?: string;
  executionRef?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.tradeExecution.create({
    data: {
      tradeOrderId: input.tradeOrderId,
      status: input.status,
      executionPrice: input.executionPrice,
      executedQty: input.executedQty,
      quoteQty: input.quoteQty,
      fee: input.fee ?? 0,
      slippage: input.slippage ?? 0,
      liquidityType: input.liquidityType,
      executionRef: input.executionRef,
      errorMessage: input.errorMessage,
      metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });
}

export async function createPosition(input: {
  userId: string;
  exchangeConnectionId: string;
  tradingPairId: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  quantity: number;
  leverage?: number;
  marginUsed?: number;
  markPrice?: number;
  metadata?: Record<string, unknown>;
}) {
  return prisma.position.create({
    data: {
      userId: input.userId,
      exchangeConnectionId: input.exchangeConnectionId,
      tradingPairId: input.tradingPairId,
      side: input.side,
      entryPrice: input.entryPrice,
      quantity: input.quantity,
      leverage: input.leverage ?? 1,
      marginUsed: input.marginUsed,
      markPrice: input.markPrice ?? input.entryPrice,
      metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });
}

export async function attachOrderToPosition(orderId: string, positionId: string) {
  return prisma.tradeOrder.update({
    where: { id: orderId },
    data: { positionId },
  });
}

export async function updatePositionMarkPrice(positionId: string, markPrice: number, unrealizedPnl: number) {
  return prisma.position.update({
    where: { id: positionId },
    data: {
      markPrice,
      unrealizedPnl,
    },
  });
}

export async function closePositionRecord(input: {
  positionId: string;
  closePrice: number;
  realizedPnl: number;
  feeTotal?: number;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.position.update({
    where: { id: input.positionId },
    data: {
      status: "CLOSED",
      closePrice: input.closePrice,
      realizedPnl: input.realizedPnl,
      feeTotal: input.feeTotal,
      closedAt: new Date(),
      errorMessage: input.errorMessage,
      metadata: input.metadata
        ? { ...(input.metadata as Prisma.InputJsonObject) }
        : undefined,
    },
  });
}

export async function updateOrderStatus(input: {
  orderId: string;
  status: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED";
  executedAt?: Date;
  canceledAt?: Date;
  avgExecutionPrice?: number;
  fee?: number;
  slippage?: number;
  errorMessage?: string;
  rejectReason?: string;
}) {
  return prisma.tradeOrder.update({
    where: { id: input.orderId },
    data: {
      status: input.status,
      executedAt: input.executedAt,
      canceledAt: input.canceledAt,
      avgExecutionPrice: input.avgExecutionPrice,
      fee: input.fee,
      slippage: input.slippage,
      errorMessage: input.errorMessage,
      rejectReason: input.rejectReason,
    },
  });
}

export async function createPnlRecord(input: {
  userId: string;
  tradingPairId: string;
  positionId?: string;
  tradeOrderId?: string;
  realizedPnl: number;
  unrealizedPnl: number;
  grossPnl: number;
  netPnl: number;
  feeTotal: number;
  slippageCost: number;
  roePercent?: number;
  notes?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.profitLossRecord.create({
    data: {
      userId: input.userId,
      tradingPairId: input.tradingPairId,
      positionId: input.positionId,
      tradeOrderId: input.tradeOrderId,
      realizedPnl: input.realizedPnl,
      unrealizedPnl: input.unrealizedPnl,
      grossPnl: input.grossPnl,
      netPnl: input.netPnl,
      feeTotal: input.feeTotal,
      slippageCost: input.slippageCost,
      roePercent: input.roePercent,
      notes: input.notes,
      metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });
}

export async function findTradeOrderById(orderId: string) {
  return prisma.tradeOrder.findUnique({
    where: { id: orderId },
    include: {
      tradingPair: true,
      tradeSignal: true,
      position: true,
      executions: true,
    },
  });
}

export async function findLatestPendingCloseOrder(input: { positionId: string; side: "BUY" | "SELL" }) {
  // SELL-FLOW FIX: Duplicate close/sell order engeli icin acik close emirlerini tek noktadan cekiyoruz.
  return prisma.tradeOrder.findFirst({
    where: {
      positionId: input.positionId,
      side: input.side,
      status: { in: ["NEW", "PARTIALLY_FILLED"] },
    },
    include: {
      executions: {
        orderBy: { executedAt: "desc" },
        take: 1,
      },
      tradingPair: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function listOpenPositionsByUser(userId: string) {
  return prisma.position.findMany({
    where: { userId, status: "OPEN" },
    include: { tradingPair: true, exchangeConnection: true, tradeOrders: true },
    orderBy: { openedAt: "desc" },
  });
}

export async function getPositionById(positionId: string) {
  return prisma.position.findUnique({
    where: { id: positionId },
    include: { tradingPair: true, exchangeConnection: true, tradeOrders: true },
  });
}

export async function findLatestClosedPositionBySymbol(userId: string, symbol: string) {
  return prisma.position.findFirst({
    where: {
      userId,
      status: "CLOSED",
      tradingPair: {
        symbol: symbol.toUpperCase(),
      },
    },
    include: {
      tradingPair: true,
    },
    orderBy: {
      closedAt: "desc",
    },
  });
}
