import { ConfigStatus, Prisma, ScannerResultStatus, SignalSource, SignalStatus } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";

export async function getWatchlistFromSettings(userId?: string): Promise<string[] | null> {
  const keys = userId ? [`scanner.watchlist.${userId}`, "scanner.watchlist"] : ["scanner.watchlist"];
  const setting = await prisma.appSetting.findFirst({
    where: {
      key: { in: keys },
      status: ConfigStatus.ACTIVE,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!setting) return null;
  const value = setting.value as unknown;
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === "string").map((x) => x.toUpperCase());
  }
  if (typeof value === "object" && value && "symbols" in value) {
    const symbols = (value as { symbols?: unknown }).symbols;
    if (Array.isArray(symbols)) {
      return symbols.filter((x): x is string => typeof x === "string").map((x) => x.toUpperCase());
    }
  }
  return null;
}

export async function upsertTradingPairBySymbol(symbol: string) {
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

export async function persistScannerResult(input: {
  userId?: string;
  symbol: string;
  scannerName: string;
  score: number;
  confidence: number;
  rank: number;
  reason: string;
  metadata?: Record<string, unknown>;
  status: "QUALIFIED" | "REJECTED";
}) {
  const pair = await upsertTradingPairBySymbol(input.symbol);
  return prisma.scannerResult.create({
    data: {
      userId: input.userId,
      tradingPairId: pair.id,
      scannerName: input.scannerName,
      score: input.score,
      confidence: input.confidence,
      rank: input.rank,
      reason: input.reason,
      status: input.status === "QUALIFIED" ? ScannerResultStatus.QUALIFIED : ScannerResultStatus.REJECTED,
      metadata: input.metadata
        ? (input.metadata as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    },
  });
}

export async function persistTradeSignalFromScanner(input: {
  userId?: string;
  symbol: string;
  scannerResultId?: string;
  confidence: number;
  side: "BUY" | "SELL" | "HOLD" | "NO_TRADE";
  reason: string;
  metadata?: Record<string, unknown>;
}) {
  const pair = await upsertTradingPairBySymbol(input.symbol);
  const mappedSide = input.side === "NO_TRADE" ? "HOLD" : input.side;
  return prisma.tradeSignal.create({
    data: {
      userId: input.userId,
      tradingPairId: pair.id,
      scannerResultId: input.scannerResultId,
      side: mappedSide,
      source: SignalSource.SCANNER,
      status: input.side === "NO_TRADE" ? SignalStatus.REJECTED : SignalStatus.NEW,
      confidence: Number((input.confidence / 100).toFixed(4)),
      reason: input.reason,
      metadata: input.metadata
        ? (input.metadata as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    },
  });
}
