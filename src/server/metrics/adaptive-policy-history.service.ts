type AdaptivePolicySnapshot = {
  at: string;
  minConfidence: number;
  requireUnanimous: boolean;
  closedTrades: number;
  winRatePercent: number;
  strictness: "normal" | "strict" | "very_strict";
  reason: string;
  reasonCodes: string[];
  reasonData: {
    baseMinConfidence: number;
    appliedMinConfidence: number;
    deltaConfidence: number;
    winRatePercent: number;
    maxDrawdown: number;
    netPnl: number;
  };
};

const history = new Map<string, AdaptivePolicySnapshot[]>();

function keyForUser(userId?: string) {
  return userId ?? "global";
}

export function recordAdaptivePolicySnapshot(userId: string | undefined, snapshot: AdaptivePolicySnapshot) {
  const key = keyForUser(userId);
  const prev = history.get(key) ?? [];
  const last = prev[prev.length - 1];
  if (
    last &&
    last.minConfidence === snapshot.minConfidence &&
    last.requireUnanimous === snapshot.requireUnanimous &&
    last.strictness === snapshot.strictness &&
    last.closedTrades === snapshot.closedTrades &&
    last.winRatePercent === snapshot.winRatePercent
  ) {
    return;
  }
  const next = [...prev, snapshot].slice(-60);
  history.set(key, next);
}

export function listAdaptivePolicyHistory(userId?: string, limit = 24) {
  const key = keyForUser(userId);
  return (history.get(key) ?? []).slice(-Math.max(1, limit));
}

