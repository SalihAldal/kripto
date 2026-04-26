import { env } from "@/lib/config";
import { listAdaptivePolicyHistory, recordAdaptivePolicySnapshot } from "@/src/server/metrics/adaptive-policy-history.service";
import { listAiDecisionHistory } from "@/src/server/repositories/signal.repository";
import { listTradeHistory } from "@/src/server/repositories/trade.repository";

export type PerformanceMetrics = {
  winRatePercent: number;
  closedTrades: number;
  avgHoldSec: number;
  netPnl: number;
  maxDrawdown: number;
  modelHitRates: Array<{ model: string; hitRatePercent: number; samples: number }>;
  coinHitRates: Array<{ symbol: string; hitRatePercent: number; samples: number; netPnl: number }>;
  timeBucketHitRates: Array<{ bucket: string; hitRatePercent: number; samples: number }>;
  bestRules: Array<{ rule: string; netPnl: number; wins: number; losses: number; samples: number }>;
  worstScenarios: Array<{ scenario: string; netPnl: number; losses: number; samples: number }>;
  strategyRecommendations: string[];
  optimizationProfile: {
    coinConfidence: Array<{ symbol: string; confidenceScore: number; samples: number; netPnl: number }>;
    timeConfidence: Array<{ hour: string; confidenceScore: number; samples: number }>;
    strategyConfidence: Array<{ strategy: string; confidenceScore: number; samples: number; netPnl: number }>;
    setupRiskList: Array<{ setup: string; confidenceScore: number; samples: number; netPnl: number }>;
  };
};

export type AdaptiveExecutionPolicy = {
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

function round2(n: number) {
  return Number(n.toFixed(2));
}

function confidenceScore(input: { wins: number; total: number; netPnl: number }) {
  if (input.total <= 0) return 50;
  const winRate = (input.wins / input.total) * 100;
  const pnlPerTrade = input.netPnl / Math.max(input.total, 1);
  const sampleWeight = Math.max(0.35, Math.min(1, input.total / 8));
  const score = 50 + (winRate - 50) * 0.85 * sampleWeight + Math.max(-15, Math.min(15, pnlPerTrade * 3.5));
  return round2(Math.max(0, Math.min(100, score)));
}

export async function getPerformanceMetrics(userId?: string): Promise<PerformanceMetrics> {
  try {
    const [history, signals] = await Promise.all([
      listTradeHistory({ userId, limit: 400 }),
      listAiDecisionHistory({ userId, limit: 400 }),
    ]);

    const dedupClosedMap = new Map<
      string,
      (typeof history)[number] & { position: NonNullable<(typeof history)[number]["position"]> }
    >();
    for (const row of history) {
      if (!row.position || row.position.status !== "CLOSED" || typeof row.position.realizedPnl !== "number") continue;
      if (!row.positionId) continue;
      if (!dedupClosedMap.has(row.positionId)) {
        dedupClosedMap.set(row.positionId, row as (typeof row) & { position: NonNullable<typeof row.position> });
      }
    }
    const closed = Array.from(dedupClosedMap.values());
    const wins = closed.filter((x) => (x.position?.realizedPnl ?? 0) > 0).length;
    const netPnl = closed.reduce((acc, x) => acc + (x.position?.realizedPnl ?? 0), 0);
    const avgHoldSec =
      closed.length > 0
        ? Math.round(
            closed.reduce((acc, x) => {
              const opened = x.position?.openedAt?.getTime() ?? 0;
              const closedAt = x.position?.closedAt?.getTime() ?? opened;
              return acc + Math.max(0, Math.floor((closedAt - opened) / 1000));
            }, 0) / closed.length,
          )
        : 0;

    const chronological = [...closed].sort((a, b) => {
      const ad = a.position?.closedAt?.getTime() ?? 0;
      const bd = b.position?.closedAt?.getTime() ?? 0;
      return ad - bd;
    });
    let equity = 0;
    let peak = 0;
    let maxDrawdown = 0;
    for (const row of chronological) {
      equity += row.position?.realizedPnl ?? 0;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, peak - equity);
    }

    const signalOutcome = new Map<string, boolean>();
    for (const row of closed) {
      if (!row.tradeSignalId) continue;
      signalOutcome.set(row.tradeSignalId, (row.position?.realizedPnl ?? 0) > 0);
    }

    const perModel = new Map<string, { wins: number; total: number }>();
    for (const sig of signals) {
      const model = sig.aiModelConfig?.displayName ?? sig.aiProvider?.name ?? sig.source;
      const hit = signalOutcome.get(sig.id);
      if (hit === undefined) continue;
      const cur = perModel.get(model) ?? { wins: 0, total: 0 };
      cur.total += 1;
      if (hit) cur.wins += 1;
      perModel.set(model, cur);
    }

    const modelHitRates = Array.from(perModel.entries())
      .map(([model, stat]) => ({
        model,
        hitRatePercent: stat.total > 0 ? round2((stat.wins / stat.total) * 100) : 0,
        samples: stat.total,
      }))
      .sort((a, b) => b.hitRatePercent - a.hitRatePercent)
      .slice(0, 6);

    const perCoin = new Map<string, { wins: number; total: number; netPnl: number }>();
    const perTime = new Map<string, { wins: number; total: number }>();
    const perRule = new Map<string, { wins: number; losses: number; netPnl: number; samples: number }>();
    const perScenario = new Map<string, { losses: number; netPnl: number; samples: number }>();
    const perStrategy = new Map<string, { wins: number; total: number; netPnl: number }>();
    const perSetup = new Map<string, { wins: number; total: number; netPnl: number }>();

    for (const row of closed) {
      const position = row.position;
      const symbol = row.tradingPair.symbol;
      const pnl = Number(position.realizedPnl ?? 0);
      const win = pnl > 0;
      const coin = perCoin.get(symbol) ?? { wins: 0, total: 0, netPnl: 0 };
      coin.total += 1;
      coin.netPnl += pnl;
      if (win) coin.wins += 1;
      perCoin.set(symbol, coin);

      const hourBucket = `${position.closedAt?.getHours?.() ?? 0}:00`;
      const tb = perTime.get(hourBucket) ?? { wins: 0, total: 0 };
      tb.total += 1;
      if (win) tb.wins += 1;
      perTime.set(hourBucket, tb);

      const metadata = (position.metadata as Record<string, unknown> | null) ?? {};
      const ruleTagsRaw = Array.isArray(metadata.ruleTags) ? metadata.ruleTags : [];
      const ruleTags = ruleTagsRaw.map((x) => String(x)).filter(Boolean);
      const strategyKey = String(metadata.marketRegimeStrategy ?? "UNKNOWN_STRATEGY");
      const setupKey = ruleTags.length > 0 ? ruleTags.sort().join("+") : "NO_RULE_TAG";
      const strategyStat = perStrategy.get(strategyKey) ?? { wins: 0, total: 0, netPnl: 0 };
      strategyStat.total += 1;
      strategyStat.netPnl += pnl;
      if (win) strategyStat.wins += 1;
      perStrategy.set(strategyKey, strategyStat);
      const setupStat = perSetup.get(setupKey) ?? { wins: 0, total: 0, netPnl: 0 };
      setupStat.total += 1;
      setupStat.netPnl += pnl;
      if (win) setupStat.wins += 1;
      perSetup.set(setupKey, setupStat);
      for (const tag of ruleTags) {
        const stat = perRule.get(tag) ?? { wins: 0, losses: 0, netPnl: 0, samples: 0 };
        stat.samples += 1;
        stat.netPnl += pnl;
        if (win) stat.wins += 1;
        else stat.losses += 1;
        perRule.set(tag, stat);
      }

      const closeReason = String((metadata.closeReason as string | undefined) ?? "unknown_close_reason");
      if (!win) {
        const sc = perScenario.get(closeReason) ?? { losses: 0, netPnl: 0, samples: 0 };
        sc.losses += 1;
        sc.samples += 1;
        sc.netPnl += pnl;
        perScenario.set(closeReason, sc);
      }
    }

    const coinHitRates = Array.from(perCoin.entries())
      .map(([symbol, stat]) => ({
        symbol,
        hitRatePercent: stat.total > 0 ? round2((stat.wins / stat.total) * 100) : 0,
        samples: stat.total,
        netPnl: round2(stat.netPnl),
      }))
      .sort((a, b) => b.hitRatePercent - a.hitRatePercent)
      .slice(0, 12);

    const timeBucketHitRates = Array.from(perTime.entries())
      .map(([bucket, stat]) => ({
        bucket,
        hitRatePercent: stat.total > 0 ? round2((stat.wins / stat.total) * 100) : 0,
        samples: stat.total,
      }))
      .sort((a, b) => b.hitRatePercent - a.hitRatePercent)
      .slice(0, 12);

    const bestRules = Array.from(perRule.entries())
      .map(([rule, stat]) => ({
        rule,
        netPnl: round2(stat.netPnl),
        wins: stat.wins,
        losses: stat.losses,
        samples: stat.samples,
      }))
      .sort((a, b) => b.netPnl - a.netPnl)
      .slice(0, 8);

    const worstScenarios = Array.from(perScenario.entries())
      .map(([scenario, stat]) => ({
        scenario,
        netPnl: round2(stat.netPnl),
        losses: stat.losses,
        samples: stat.samples,
      }))
      .sort((a, b) => a.netPnl - b.netPnl)
      .slice(0, 8);

    const strategyRecommendations: string[] = [];
    const bestCoin = coinHitRates[0];
    const weakestCoin = [...coinHitRates].sort((a, b) => a.hitRatePercent - b.hitRatePercent)[0];
    if (bestCoin && bestCoin.samples >= 3) {
      strategyRecommendations.push(`Coin odak: ${bestCoin.symbol} (hit ${bestCoin.hitRatePercent.toFixed(1)}%, ${bestCoin.samples} islem).`);
    }
    if (weakestCoin && weakestCoin.samples >= 3) {
      strategyRecommendations.push(`Zayif coin filtresi: ${weakestCoin.symbol} icin kalite esigini yukselti.`);
    }
    const worstScenario = worstScenarios[0];
    if (worstScenario) {
      strategyRecommendations.push(`Risk notu: ${worstScenario.scenario} senaryosu zarar uretiyor, trade acilisini kisitla.`);
    }
    if (bestRules.length > 0) {
      strategyRecommendations.push(`Kazandiran kurallar: ${bestRules.slice(0, 3).map((x) => x.rule).join(", ")}`);
    }
    const bestHour = [...perTime.entries()]
      .map(([hour, stat]) => ({ hour, score: confidenceScore({ wins: stat.wins, total: stat.total, netPnl: 0 }), samples: stat.total }))
      .sort((a, b) => b.score - a.score)[0];
    if (bestHour && bestHour.samples >= 4) {
      strategyRecommendations.push(`Saat optimizasyonu: ${bestHour.hour}:00 bandi daha verimli.`);
    }

    const optimizationProfile = {
      coinConfidence: Array.from(perCoin.entries())
        .map(([symbol, stat]) => ({
          symbol,
          confidenceScore: confidenceScore({ wins: stat.wins, total: stat.total, netPnl: stat.netPnl }),
          samples: stat.total,
          netPnl: round2(stat.netPnl),
        }))
        .sort((a, b) => b.confidenceScore - a.confidenceScore)
        .slice(0, 20),
      timeConfidence: Array.from(perTime.entries())
        .map(([hour, stat]) => ({
          hour,
          confidenceScore: confidenceScore({ wins: stat.wins, total: stat.total, netPnl: 0 }),
          samples: stat.total,
        }))
        .sort((a, b) => b.confidenceScore - a.confidenceScore)
        .slice(0, 24),
      strategyConfidence: Array.from(perStrategy.entries())
        .map(([strategy, stat]) => ({
          strategy,
          confidenceScore: confidenceScore({ wins: stat.wins, total: stat.total, netPnl: stat.netPnl }),
          samples: stat.total,
          netPnl: round2(stat.netPnl),
        }))
        .sort((a, b) => b.confidenceScore - a.confidenceScore)
        .slice(0, 20),
      setupRiskList: Array.from(perSetup.entries())
        .map(([setup, stat]) => ({
          setup,
          confidenceScore: confidenceScore({ wins: stat.wins, total: stat.total, netPnl: stat.netPnl }),
          samples: stat.total,
          netPnl: round2(stat.netPnl),
        }))
        .sort((a, b) => a.confidenceScore - b.confidenceScore)
        .slice(0, 20),
    };

    return {
      winRatePercent: closed.length > 0 ? round2((wins / closed.length) * 100) : 0,
      closedTrades: closed.length,
      avgHoldSec,
      netPnl: round2(netPnl),
      maxDrawdown: round2(maxDrawdown),
      modelHitRates,
      coinHitRates,
      timeBucketHitRates,
      bestRules,
      worstScenarios,
      strategyRecommendations,
      optimizationProfile,
    };
  } catch {
    return {
      winRatePercent: 0,
      closedTrades: 0,
      avgHoldSec: 0,
      netPnl: 0,
      maxDrawdown: 0,
      modelHitRates: [],
      coinHitRates: [],
      timeBucketHitRates: [],
      bestRules: [],
      worstScenarios: [],
      strategyRecommendations: [],
      optimizationProfile: {
        coinConfidence: [],
        timeConfidence: [],
        strategyConfidence: [],
        setupRiskList: [],
      },
    };
  }
}

export async function getAdaptiveExecutionPolicy(userId?: string): Promise<AdaptiveExecutionPolicy> {
  const metrics = await getPerformanceMetrics(userId);
  const baseConfidence = env.EXECUTION_FAST_MIN_CONFIDENCE;
  const baseUnanimous = env.EXECUTION_FAST_REQUIRE_UNANIMOUS;

  if (!env.EXECUTION_ADAPTIVE_POLICY_ENABLED || metrics.closedTrades < env.EXECUTION_ADAPTIVE_MIN_TRADES) {
    const baseline: AdaptiveExecutionPolicy = {
      minConfidence: baseConfidence,
      requireUnanimous: baseUnanimous,
      closedTrades: metrics.closedTrades,
      winRatePercent: metrics.winRatePercent,
      strictness: "normal",
      reason: "Adaptive policy inactive or insufficient sample size",
      reasonCodes: ["INSUFFICIENT_SAMPLE"],
      reasonData: {
        baseMinConfidence: baseConfidence,
        appliedMinConfidence: baseConfidence,
        deltaConfidence: 0,
        winRatePercent: metrics.winRatePercent,
        maxDrawdown: metrics.maxDrawdown,
        netPnl: metrics.netPnl,
      },
    };
    recordAdaptivePolicySnapshot(userId, {
      at: new Date().toISOString(),
      ...baseline,
    });
    return baseline;
  }

  let minConfidence = baseConfidence;
  let strictness: AdaptiveExecutionPolicy["strictness"] = "normal";
  const reasons: string[] = [];
  const reasonCodes: string[] = [];
  if (metrics.winRatePercent < 45) {
    minConfidence += 8;
    strictness = "very_strict";
    reasons.push("Win rate below 45%");
    reasonCodes.push("WR_LT_45");
  } else if (metrics.winRatePercent < 55) {
    minConfidence += 5;
    strictness = "strict";
    reasons.push("Win rate below 55%");
    reasonCodes.push("WR_LT_55");
  } else if (metrics.winRatePercent < 62) {
    minConfidence += 2;
    strictness = "strict";
    reasons.push("Win rate below 62%");
    reasonCodes.push("WR_LT_62");
  } else if (metrics.winRatePercent > 76 && metrics.closedTrades > 120) {
    minConfidence -= 2;
    reasons.push("High win rate with large sample, slightly relaxed");
    reasonCodes.push("WR_GT_76_RELAX");
  }

  if (metrics.maxDrawdown > Math.max(5, Math.abs(metrics.netPnl) * 0.85)) {
    minConfidence += 2;
    strictness = "very_strict";
    reasons.push("Drawdown pressure detected");
    reasonCodes.push("DD_PRESSURE");
  }

  minConfidence = Math.max(75, Math.min(98, minConfidence));
  const requireUnanimous = baseUnanimous || metrics.winRatePercent < 60;

  const adaptive = {
    minConfidence,
    requireUnanimous,
    closedTrades: metrics.closedTrades,
    winRatePercent: metrics.winRatePercent,
    strictness,
    reason: reasons.length > 0 ? reasons.join("; ") : "Stable performance window",
    reasonCodes: reasonCodes.length > 0 ? reasonCodes : ["STABLE_WINDOW"],
    reasonData: {
      baseMinConfidence: baseConfidence,
      appliedMinConfidence: minConfidence,
      deltaConfidence: minConfidence - baseConfidence,
      winRatePercent: metrics.winRatePercent,
      maxDrawdown: metrics.maxDrawdown,
      netPnl: metrics.netPnl,
    },
  };
  recordAdaptivePolicySnapshot(userId, {
    at: new Date().toISOString(),
    ...adaptive,
  });
  return adaptive;
}

export function getAdaptivePolicyTimeline(userId?: string, limit = 24) {
  return listAdaptivePolicyHistory(userId, limit);
}

