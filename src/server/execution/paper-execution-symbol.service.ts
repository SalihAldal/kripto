import { env } from "@/lib/config";
import { prisma } from "@/src/server/db/prisma";

export type PaperExecutionSymbolResolution = {
  signalSymbol: string;
  executionSymbol: string;
  quoteAsset: string;
  resolved: boolean;
  reasonCode: string | null;
  reasonDetail: string | null;
};

async function findActivePair(symbol: string) {
  return prisma.tradingPair.findFirst({
    where: { symbol: symbol.toUpperCase(), status: "ACTIVE" },
    select: { symbol: true, baseAsset: true, quoteAsset: true },
  });
}

/** Paper TR spot: prefer supported TRY pair when signal arrives on USDT. */
export async function resolvePaperExecutionSymbol(signalSymbol: string): Promise<PaperExecutionSymbolResolution> {
  const signal = signalSymbol.trim().toUpperCase();
  if (!signal) {
    return {
      signalSymbol: signal,
      executionSymbol: signal,
      quoteAsset: "",
      resolved: false,
      reasonCode: "SYMBOL_EMPTY",
      reasonDetail: "Empty signal symbol",
    };
  }

  if (env.BINANCE_PLATFORM === "tr" && signal.endsWith("USDT")) {
    const trySymbol = `${signal.slice(0, -4)}TRY`;
    const tryPair = await findActivePair(trySymbol);
    if (tryPair) {
      return {
        signalSymbol: signal,
        executionSymbol: tryPair.symbol,
        quoteAsset: tryPair.quoteAsset,
        resolved: true,
        reasonCode: "USDT_SIGNAL_MAPPED_TO_TRY",
        reasonDetail: `${signal} mapped to supported TRY pair ${tryPair.symbol}`,
      };
    }
    const usdtPair = await findActivePair(signal);
    if (usdtPair) {
      return {
        signalSymbol: signal,
        executionSymbol: usdtPair.symbol,
        quoteAsset: usdtPair.quoteAsset,
        resolved: false,
        reasonCode: "TRY_PAIR_NOT_SUPPORTED",
        reasonDetail: `USDT signal ${signal} has no active TRY execution pair on TR platform`,
      };
    }
    return {
      signalSymbol: signal,
      executionSymbol: signal,
      quoteAsset: "USDT",
      resolved: false,
      reasonCode: "TRY_PAIR_NOT_SUPPORTED",
      reasonDetail: `No active TRY pair for USDT signal ${signal}`,
    };
  }

  const direct = await findActivePair(signal);
  if (direct) {
    return {
      signalSymbol: signal,
      executionSymbol: direct.symbol,
      quoteAsset: direct.quoteAsset,
      resolved: true,
      reasonCode: null,
      reasonDetail: null,
    };
  }

  return {
    signalSymbol: signal,
    executionSymbol: signal,
    quoteAsset: "",
    resolved: false,
    reasonCode: "TRADING_PAIR_NOT_FOUND",
    reasonDetail: `No active trading pair for ${signal}`,
  };
}

/** One snapshot per selection round; discovery can remain global but execution must be supported. */
export async function loadPaperExecutionSignalUniverse(): Promise<Set<string> | null> {
  if (env.BINANCE_PLATFORM !== "tr") return null;
  const rows = await prisma.tradingPair.findMany({
    where: { status: "ACTIVE", quoteAsset: "TRY" }, select: { symbol: true, baseAsset: true },
  });
  return new Set(rows.flatMap(row => [row.symbol.toUpperCase(), `${row.baseAsset.toUpperCase()}USDT`]));
}
