import { resolveBalancesForMode } from "@/src/server/execution-management/balance-resolver.service";
import type { PreTradeSafetyInput, SafetyValidationStageResult } from "@/src/server/execution-safety/execution-safety.types";
import { getSafetyCache, setSafetyCache } from "@/src/server/execution-safety/safety-cache.service";

type BalanceSnapshot = {
  availableQuote: number;
  availableBase: number;
  lockedQuote: number;
  lockedBase: number;
};

function snapshotKey(userId: string, mode: string, quote: string, base: string) {
  return `balance:${userId}:${mode}:${quote}:${base}`;
}

export async function validateBalanceSafety(input: PreTradeSafetyInput): Promise<SafetyValidationStageResult> {
  const reasons: string[] = [];
  const balances = await resolveBalancesForMode({
    userId: input.userId,
    mode: input.mode,
    quoteAsset: input.quoteAsset,
    baseAsset: input.baseAsset,
  }).catch(() => null);

  if (!balances) {
    reasons.push("Balance cannot be verified");
    return { stage: "BALANCE", passed: false, reasons };
  }

  const key = snapshotKey(input.userId, input.mode, input.quoteAsset, input.baseAsset);
  const prior = getSafetyCache<BalanceSnapshot>(key);
  if (prior) {
    const quoteDelta = Math.abs(balances.availableQuote - prior.availableQuote);
    const baseDelta = Math.abs(balances.availableBase - prior.availableBase);
    const required = input.quoteSpend ?? input.quantity * input.priceHint;
    if (input.side === "BUY" && quoteDelta > required * 0.05 && quoteDelta > 1) {
      reasons.push("Unexpected quote balance change detected");
    }
    if (input.side === "SELL" && baseDelta > input.quantity * 0.05 && baseDelta > 1e-6) {
      reasons.push("Unexpected base balance change detected");
    }
  }
  setSafetyCache(key, balances, 120_000);

  const reservedQuote = balances.lockedQuote;
  const reservedBase = balances.lockedBase;

  if (balances.availableQuote < 0 || balances.availableBase < 0) {
    reasons.push("Negative balance detected");
  }
  if (input.side === "BUY") {
    const required = input.quoteSpend ?? input.quantity * input.priceHint;
    if (balances.availableQuote < required) {
      reasons.push("Insufficient available quote balance");
    }
    if (reservedQuote > 0 && balances.availableQuote < required) {
      reasons.push("Reserved quote balance reduces available funds");
    }
    const minRequired = required * 1.001;
    if (balances.availableQuote + reservedQuote < minRequired) {
      reasons.push("Minimum required balance not met including reserved");
    }
  } else {
    if (balances.availableBase < input.quantity) {
      reasons.push("Insufficient available base balance");
    }
    if (reservedBase > 0 && balances.availableBase < input.quantity) {
      reasons.push("Reserved base balance blocks full sell");
    }
    const dustThreshold = Math.max(input.quantity * 0.001, 1e-8);
    if (balances.availableBase > 0 && balances.availableBase < dustThreshold) {
      reasons.push("Dust balance below minimum sell quantity");
    }
  }

  return {
    stage: "BALANCE",
    passed: reasons.length === 0,
    reasons,
    metadata: {
      availableQuote: balances.availableQuote,
      availableBase: balances.availableBase,
      lockedQuote: balances.lockedQuote,
      lockedBase: balances.lockedBase,
      reservedQuote,
      reservedBase,
    },
  };
}
