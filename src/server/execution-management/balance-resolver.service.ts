import { getAccountBalances } from "@/services/binance.service";
import { getPaperAccount } from "@/src/server/simulation/paper-trading.service";
import type { TradingExecutionMode } from "@/src/server/execution-management/execution-management.types";

export async function resolveBalancesForMode(input: {
  userId: string;
  mode: TradingExecutionMode;
  quoteAsset: string;
  baseAsset: string;
}) {
  if (input.mode === "paper") {
    const account = await getPaperAccount(input.userId);
    const quote = Number(account.balances[input.quoteAsset.toUpperCase()] ?? 0);
    const base = Number(account.balances[input.baseAsset.toUpperCase()] ?? 0);
    return { availableQuote: quote, availableBase: base, lockedQuote: 0, lockedBase: 0 };
  }
  const balances = await getAccountBalances().catch(() => []);
  const quoteRow = balances.find((row) => row.asset.toUpperCase() === input.quoteAsset.toUpperCase());
  const baseRow = balances.find((row) => row.asset.toUpperCase() === input.baseAsset.toUpperCase());
  return {
    availableQuote: Number(quoteRow?.free ?? 0),
    availableBase: Number(baseRow?.free ?? 0),
    lockedQuote: Number(quoteRow?.locked ?? 0),
    lockedBase: Number(baseRow?.locked ?? 0),
  };
}
