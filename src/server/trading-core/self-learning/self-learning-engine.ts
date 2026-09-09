import { AppSettingScope, ConfigStatus, Prisma } from "@prisma/client";
import { tradingConfig } from "@/src/server/trading-core/config";
import { botPerformanceTracker } from "@/src/server/trading-core/bots/bot-performance-tracker";
import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";
import { PatternMemory, type PatternMemorySnapshot } from "@/src/server/trading-core/self-learning/pattern-memory";
import { buildDynamicLearningWeight } from "@/src/server/trading-core/self-learning/dynamic-learning-weight";
import { detectRegimeMismatch } from "@/src/server/trading-core/self-learning/regime-mismatch-detector";
import type { PostTradeCritic, StrategyLearningPatch, TpslOptimizationSuggestion, TradeLearningHorizon, TradeLearningInput, TradeLearningReport } from "@/src/server/trading-core/self-learning/self-learning-types";
import { classifyNetExitOutcome } from "@/src/server/execution/profit-thresholds";
import { prisma } from "@/src/server/db/prisma";
import { guardPaperStrategyMutation } from "@/src/server/forensics/paper-strategy-freeze.service";

const LEARNING_MEMORY_KEY = "trading-core.self-learning.memory";

export class SelfLearningEngine {
  private readonly memory = new PatternMemory();
  private lastReport: TradeLearningReport | null = null;
  private hydratePromise: Promise<void> | null = null;

  async learn(input: TradeLearningInput, apply = false): Promise<TradeLearningReport> {
    await this.ensureHydrated();
    const regimeCompatibility = input.regimeCompatibility ?? detectRegimeMismatch({
      strategy: input.strategy,
      marketRegime: input.marketRegime,
      regimeConfidence: input.learningWeightProfile?.confidence,
      volatilityPercent: input.learningWeightProfile?.factors.find((factor) => factor.key === "volatilityState")?.value as number | undefined,
      mtfAlignment: input.learningWeightProfile?.factors.find((factor) => factor.key === "mtfAlignment")?.value as number | undefined,
    });
    const learningWeight = input.learningWeightProfile ?? buildDynamicLearningWeight({
      marketRegime: input.marketRegime,
      qualityScore: input.qualityScore,
      deepAnalysis: {
        professionalSummary: regimeCompatibility.explanation,
        rootCause: regimeCompatibility.explanation,
        rootCauseFactors: regimeCompatibility.evidence,
        marketRead: {
          volume: "",
          orderbook: "",
          flow: "",
          momentumBreakout: "",
          mtf: "",
          volatility: "",
          manipulation: "",
        },
        entryMistake: regimeCompatibility.explanation,
        exitMistake: "",
        riskMistake: "",
        learningTags: regimeCompatibility.learningTags,
        policyRecommendation: regimeCompatibility.recommendedAction === "STRONG_PENALTY" ? "TIGHTEN" : "KEEP_TESTING",
        nextSetupRules: [],
        tradeQuality: regimeCompatibility.status === "HIGH_RISK_REGIME_CONFLICT" ? "DANGEROUS" : regimeCompatibility.status === "REGIME_MISMATCH" ? "WEAK" : "ACCEPTABLE",
        aiVerdict: "NOT_AVAILABLE",
        confidence: regimeCompatibility.confidence,
        deterministicScore: regimeCompatibility.compatibilityScore,
        aiSummary: "Regime compatibility pre-critic profile",
        regimeCompatibility,
        generatedAt: regimeCompatibility.generatedAt,
        source: "RULES_ONLY",
      },
      metadata: {
        qualityScore: input.qualityScore,
      },
    });
    const weightedInput = {
      ...input,
      regimeCompatibility,
      learningWeight: input.learningWeight ?? learningWeight.weight,
      learningWeightProfile: learningWeight,
    };
    botPerformanceTracker.record({
      botId: weightedInput.botId,
      symbol: weightedInput.symbol,
      strategy: weightedInput.strategy,
      realizedPnl: weightedInput.realizedPnl,
      returnPercent: weightedInput.returnPercent,
      openedAt: weightedInput.openedAt,
      closedAt: weightedInput.closedAt,
    });
    const pattern = this.memory.record(weightedInput);
    const indicatorImpact = this.memory.indicatorImpact();
    const strategyPatch = this.strategyPatch(weightedInput.strategy, pattern);
    if (apply && strategyPatch && guardPaperStrategyMutation()) {
      tradingConfig.updateStrategy(weightedInput.strategy, { minScore: strategyPatch.nextMinScore });
    }
    const postTradeCritic = this.critic(weightedInput, pattern);
    const tpslSuggestion = this.tpslSuggestion(weightedInput, pattern);
    const report: TradeLearningReport = {
      tradeId: weightedInput.tradeId,
      outcome: classifyNetExitOutcome(weightedInput.returnPercent),
      winLossReasons: this.reasons(weightedInput, pattern),
      pattern,
      indicatorImpact,
      strategyPatch: apply ? strategyPatch : strategyPatch ? { ...strategyPatch, reason: `${strategyPatch.reason} (dry-run)` } : undefined,
      postTradeCritic,
      learningWeight,
      tpslSuggestion,
      blacklistedPatterns: this.blacklistedPatterns(),
      boostedPatterns: this.boostedPatterns(),
      generatedAt: new Date().toISOString(),
    };
    this.lastReport = report;
    await this.persist();
    tradingLogger.info({
      category: "BOT",
      source: "trading-core.self-learning",
      message: `Self-learning trade ${report.outcome}: ${weightedInput.strategy} (${postTradeCritic.verdict})`,
      status: "SUCCESS",
      symbol: weightedInput.symbol,
      metricName: "self_learning.pattern_score",
      metricValue: pattern.score,
      context: { patternKey: pattern.patternKey, apply, strategyPatch, postTradeCritic, tpslSuggestion, learningWeight },
    });
    return report;
  }

  async snapshot() {
    await this.ensureHydrated();
    return {
      patterns: this.memory.all(),
      indicatorImpact: this.memory.indicatorImpact(),
      blacklistedPatterns: this.blacklistedPatterns(),
      boostedPatterns: this.boostedPatterns(),
      lastReport: this.lastReport,
      persistent: true,
      storageKey: LEARNING_MEMORY_KEY,
      updatedAt: new Date().toISOString(),
    };
  }

  private async ensureHydrated() {
    this.hydratePromise ??= this.hydrate();
    await this.hydratePromise;
  }

  private async hydrate() {
    const row = await prisma.appSetting.findUnique({ where: { key: LEARNING_MEMORY_KEY } }).catch(() => null);
    const value = (row?.value as Record<string, unknown> | null) ?? null;
    if (!value) return;
    this.memory.importSnapshot(value.memory as PatternMemorySnapshot | undefined);
    this.lastReport = (value.lastReport as TradeLearningReport | null | undefined) ?? null;
  }

  private async persist() {
    const value = {
      version: 1,
      updatedAt: new Date().toISOString(),
      memory: this.memory.exportSnapshot(),
      lastReport: this.lastReport,
    } satisfies Record<string, unknown>;
    await prisma.appSetting.upsert({
      where: { key: LEARNING_MEMORY_KEY },
      create: {
        key: LEARNING_MEMORY_KEY,
        scope: AppSettingScope.GLOBAL,
        valueType: "json",
        status: ConfigStatus.ACTIVE,
        description: "Persistent self-learning pattern memory and professional post-trade critic state",
        value: value as Prisma.InputJsonValue,
      },
      update: {
        status: ConfigStatus.ACTIVE,
        value: value as Prisma.InputJsonValue,
      },
    });
  }

  private strategyPatch(strategy: string, pattern: TradeLearningReport["pattern"]): StrategyLearningPatch | undefined {
    if (pattern.trades < 4) return undefined;
    const current = tradingConfig.getStrategy(strategy);
    const previousMinScore = current.minScore;
    const nextMinScore =
      pattern.status === "BLACKLISTED"
        ? Math.min(90, previousMinScore + 4)
        : pattern.status === "BOOSTED"
          ? Math.max(45, previousMinScore - 2)
          : previousMinScore;
    if (nextMinScore === previousMinScore) return undefined;
    return {
      strategy,
      previousMinScore,
      nextMinScore,
      reason: pattern.status === "BLACKLISTED" ? "Bad pattern blacklisted, raising entry threshold" : "Successful pattern boosted, slightly lowering entry threshold",
    };
  }

  private reasons(input: TradeLearningInput, pattern: TradeLearningReport["pattern"]) {
    const edge = input.edgeConditions?.map((condition) => `${condition.type}:${condition.edgeScore}`).join(", ");
    return [
      input.realizedPnl > 0 ? "Trade won with positive realized PnL" : input.realizedPnl < 0 ? "Trade lost with negative realized PnL" : "Trade closed near breakeven",
      input.marketRegime ? `market=${input.marketRegime}` : "market=unknown",
      pattern.indicatorTags.length ? `indicators=${pattern.indicatorTags.join(",")}` : "indicators=none",
      edge ? `edge=${edge}` : null,
      input.learningWeightProfile ? input.learningWeightProfile.summary : `learningWeight=${input.learningWeight ?? 1}`,
      `patternStatus=${pattern.status}`,
      `patternScore=${pattern.score}`,
    ].filter((reason): reason is string => Boolean(reason));
  }

  private horizon(input: TradeLearningInput): TpslOptimizationSuggestion["horizon"] {
    const maxDurationSec = Number(input.maxDurationSec ?? 0);
    if (maxDurationSec > 0 && maxDurationSec <= 600) return "SCALP_5M";
    if (maxDurationSec > 0 && maxDurationSec <= 900) return "INTRADAY_15M";
    if (maxDurationSec > 0 && maxDurationSec <= 1800) return "SHORT_30M";
    if (maxDurationSec > 0 && maxDurationSec <= 3600) return "INTRADAY_1H";
    if (maxDurationSec > 0 && maxDurationSec <= 14400) return "INTRADAY_4H";
    return "SESSION";
  }

  private critic(input: TradeLearningInput, pattern: TradeLearningReport["pattern"]): PostTradeCritic {
    const outcome = classifyNetExitOutcome(input.returnPercent);
    const weakProfit = input.returnPercent > 0 && input.returnPercent < 0.5;
    const repeatedPattern = pattern.trades >= 4;
    const grade: PostTradeCritic["grade"] =
      outcome === "WIN" && pattern.score >= 72
        ? "A"
        : outcome === "WIN"
          ? "B"
          : weakProfit || outcome === "BREAKEVEN"
            ? "C"
            : pattern.status === "BLACKLISTED"
              ? "F"
              : "D";
    const verdict: PostTradeCritic["verdict"] =
      pattern.status === "BLACKLISTED"
        ? "PAUSE_SETUP"
        : outcome === "LOSS"
          ? "TIGHTEN_FILTERS"
          : weakProfit || outcome === "BREAKEVEN"
            ? "KEEP_TESTING"
            : pattern.status === "BOOSTED"
              ? "SCALE_UP"
              : "KEEP_TESTING";
    const lessons = [
      outcome === "LOSS"
        ? "Bu setup net zarar yazdi; ayni kosullarda giris esigi ve risk azaltmali."
        : weakProfit || outcome === "BREAKEVEN"
          ? "Islem pozitif olsa bile hedeflenen net basari esigine ulasmadi; kar kalitesi dusuk."
          : "Setup net kar esigini gecti; ayni kosullar tekrar test edilebilir.",
      repeatedPattern
        ? `Pattern ${pattern.trades} ornekle anlamli hale geliyor: winrate %${pattern.winrate}, ortalama getiri %${pattern.averageReturnPercent}.`
        : `Pattern henuz erken asamada (${pattern.trades}/4); agresif karar icin daha fazla ornek lazim.`,
      pattern.status === "BLACKLISTED"
        ? "Pattern blacklist seviyesinde; otomatik girislerde daha sert filtre uygulanmali."
        : pattern.status === "BOOSTED"
          ? "Pattern boosted seviyesinde; kontrollu sekilde daha fazla denenebilir."
          : "Pattern notr; veri toplamaya devam edilmeli.",
    ];
    return {
      grade,
      verdict,
      summary: `${input.symbol} ${this.horizon(input)} sonucu: ${outcome}, pattern=${pattern.status}, score=${pattern.score}.`,
      lessons,
      nextActions:
        verdict === "PAUSE_SETUP"
          ? ["Bu setup'i gecici durdur.", "Min score'u yukselt.", "Benzer market rejiminde yeni islem acmadan once daha guclu momentum iste."]
          : verdict === "TIGHTEN_FILTERS"
            ? ["Min confidence/quality esigini yukselt.", "TP/SL oranini yeniden dengele.", "Ayni coin tekrarini azalt."]
            : verdict === "SCALE_UP"
              ? ["Ayni horizon icin kontrollu tekrar dene.", "Risk artisini kademeli tut.", "Drawdown baslarsa tekrar notr moda don."]
              : ["Daha fazla ornek topla.", "Kar kalitesi dusukse TP/SL onerilerini uygula.", "Sonuclari ayni horizon icinde karsilastir."],
    };
  }

  private tpslSuggestion(input: TradeLearningInput, pattern: TradeLearningReport["pattern"]): TpslOptimizationSuggestion {
    const horizon = this.horizon(input);
    const horizonDefaults: Record<TradeLearningHorizon, { takeProfitPercent: number; stopLossPercent: number; maxDurationSec: number }> = {
      SCALP_5M: { takeProfitPercent: 0.8, stopLossPercent: 0.6, maxDurationSec: 300 },
      INTRADAY_15M: { takeProfitPercent: 1.1, stopLossPercent: 0.8, maxDurationSec: 900 },
      SHORT_30M: { takeProfitPercent: 1.4, stopLossPercent: 1.0, maxDurationSec: 1800 },
      INTRADAY_1H: { takeProfitPercent: 2.2, stopLossPercent: 1.4, maxDurationSec: 3600 },
      INTRADAY_4H: { takeProfitPercent: 4.5, stopLossPercent: 2.2, maxDurationSec: 14400 },
      SESSION: { takeProfitPercent: 6, stopLossPercent: 3, maxDurationSec: 43200 },
    };
    const defaults = horizonDefaults[horizon];
    const currentTp = Number(input.targetProfitPercent ?? defaults.takeProfitPercent);
    const currentSl = Number(input.stopLossPercent ?? defaults.stopLossPercent);
    const currentDuration = Number(input.maxDurationSec ?? defaults.maxDurationSec);
    const outcome = classifyNetExitOutcome(input.returnPercent);
    const weakProfit = input.returnPercent > 0 && input.returnPercent < 0.5;
    const tp =
      outcome === "WIN" && pattern.status === "BOOSTED"
        ? currentTp * 1.08
        : weakProfit
          ? currentTp * 1.12
          : outcome === "LOSS"
            ? currentTp * 0.92
            : currentTp;
    const sl =
      outcome === "LOSS"
        ? currentSl * 0.88
        : pattern.status === "BOOSTED"
          ? currentSl * 1.03
          : currentSl;
    const duration =
      weakProfit || outcome === "BREAKEVEN"
        ? currentDuration * 1.15
        : outcome === "LOSS"
          ? currentDuration * 0.9
          : currentDuration;
    return {
      horizon,
      suggestedTakeProfitPercent: Number(Math.max(0.2, Math.min(25, tp)).toFixed(3)),
      suggestedStopLossPercent: Number(Math.max(0.15, Math.min(5, sl)).toFixed(3)),
      suggestedMaxDurationSec: Math.round(Math.max(120, Math.min(86_400, duration))),
      confidence: Number(Math.min(95, 35 + pattern.trades * 7 + Math.abs(pattern.score - 50) * 0.5).toFixed(2)),
      reason:
        outcome === "LOSS"
          ? "Zarar sonrasi hedef biraz dusuruldu, stop ve sure sikilastirildi."
          : weakProfit
            ? "Kar kalitesi dusuk; TP biraz yukseltildi ve sure uzatildi."
            : pattern.status === "BOOSTED"
              ? "Boosted pattern; TP kademeli artabilir."
              : "Yeterli guven olusana kadar mevcut ayarlar korunur.",
    };
  }

  private blacklistedPatterns() {
    return this.memory.all().filter((pattern) => pattern.status === "BLACKLISTED");
  }

  private boostedPatterns() {
    return this.memory.all().filter((pattern) => pattern.status === "BOOSTED");
  }
}

const globalLearning = globalThis as typeof globalThis & { __selfLearningEngine?: SelfLearningEngine };
export const selfLearningEngine = globalLearning.__selfLearningEngine ?? new SelfLearningEngine();
globalLearning.__selfLearningEngine = selfLearningEngine;
