import type {
  BotBehaviorContext,
  BotBehaviorDecision,
  BotBehaviorProfile,
  DcaPlanStep,
} from "@/src/server/trading-core/bot-behavior/bot-behavior-types";
import { BotBehaviorRegistry, botBehaviorRegistry } from "@/src/server/trading-core/bot-behavior/bot-behavior-registry";

function priceBySide(side: "BUY" | "SELL", price: number, percent: number, target: "TP" | "SL") {
  const factor = percent / 100;
  if (target === "TP") return Number((side === "BUY" ? price * (1 + factor) : price * (1 - factor)).toFixed(8));
  return Number((side === "BUY" ? price * (1 - factor) : price * (1 + factor)).toFixed(8));
}

export class BotBehaviorEngine {
  constructor(private readonly registry: BotBehaviorRegistry = botBehaviorRegistry) {}

  decide(context: BotBehaviorContext): BotBehaviorDecision {
    const botId = context.botAllocation?.botId ?? "scalping-bot";
    const profile = this.registry.get(botId) ?? this.registry.all()[0];
    const volatility = context.volatilityPercent ?? Number(context.signal.marketRegime?.metrics?.volatilityPercent ?? 0);
    const currentPrice = context.currentPrice ?? Number(context.signal.strategySignals.at(-1)?.indicators.emaFast ?? 0);
    const reasons: string[] = [];

    if (context.signal.score < profile.minSignalScore) reasons.push(`Signal score below ${profile.behaviorType} minimum`);
    if (context.signal.confidence < profile.minConfidence) reasons.push(`Signal confidence below ${profile.behaviorType} minimum`);
    const regime = context.signal.marketRegime?.regime;
    if (regime && !profile.preferredRegimes.includes(regime)) reasons.push(`${profile.behaviorType} does not prefer ${regime}`);
    if (volatility < profile.preferredVolatilityPercent.min || volatility > profile.preferredVolatilityPercent.max) {
      reasons.push(`Volatility ${volatility.toFixed(2)}% outside ${profile.behaviorType} range`);
    }

    const action = this.resolveAction(profile, reasons, volatility);
    const adjustedSizeMultiplier = this.sizeMultiplier(profile, volatility, action);
    const dcaPlan = profile.dca?.enabled && currentPrice > 0 ? this.buildDcaPlan(profile, context.side, currentPrice, volatility) : [];
    const allowed = action !== "WAIT" || profile.behaviorType === "DCA";

    return {
      botId: profile.botId,
      behaviorType: profile.behaviorType,
      allowed,
      action,
      riskAppetite: profile.riskAppetite,
      tradePace: profile.tradePace,
      takeProfitPercent: profile.takeProfitPercent,
      stopLossPercent: profile.stopLossPercent,
      takeProfitPrice: currentPrice > 0 ? priceBySide(context.side, currentPrice, profile.takeProfitPercent, "TP") : undefined,
      stopLossPrice: currentPrice > 0 ? priceBySide(context.side, currentPrice, profile.stopLossPercent, "SL") : undefined,
      positionSizeMultiplier: adjustedSizeMultiplier,
      entryAggression: profile.entryAggression,
      maxHoldMinutes: profile.maxHoldMinutes,
      dcaPlan,
      reasons: reasons.length > 0 ? reasons : profile.notes,
      metadata: {
        behaviorType: profile.behaviorType,
        trailingEnabled: profile.trailingEnabled,
        partialTakeProfitPercent: profile.partialTakeProfitPercent,
        preferredRegimes: profile.preferredRegimes,
      },
      decidedAt: new Date().toISOString(),
    };
  }

  profiles() {
    return this.registry.all();
  }

  private resolveAction(profile: BotBehaviorProfile, reasons: string[], volatility: number): BotBehaviorDecision["action"] {
    if (profile.behaviorType === "DCA") return "DCA_PLAN";
    if (reasons.length === 0) return "ENTER";
    if (profile.riskAppetite === "HIGH" && reasons.length === 1 && volatility <= profile.preferredVolatilityPercent.max * 1.15) return "REDUCE_SIZE";
    if (profile.behaviorType === "SCALPER" && reasons.length === 1) return "REDUCE_SIZE";
    return "WAIT";
  }

  private sizeMultiplier(profile: BotBehaviorProfile, volatility: number, action: BotBehaviorDecision["action"]) {
    const riskBoost = profile.riskAppetite === "HIGH" ? 1.15 : profile.riskAppetite === "LOW" ? 0.85 : 1;
    const volatilityPenalty = volatility > profile.preferredVolatilityPercent.max ? 0.65 : 1;
    const actionPenalty = action === "REDUCE_SIZE" ? 0.5 : action === "DCA_PLAN" ? 0.8 : 1;
    return Number((profile.positionSizeMultiplier * riskBoost * volatilityPenalty * actionPenalty).toFixed(4));
  }

  private buildDcaPlan(profile: BotBehaviorProfile, side: "BUY" | "SELL", currentPrice: number, volatility: number): DcaPlanStep[] {
    if (!profile.dca?.enabled) return [];
    const stepPercent = profile.dca.stepPercent + volatility * profile.dca.volatilityMultiplier;
    return Array.from({ length: profile.dca.maxAdds }).map((_, index) => {
      const step = index + 1;
      const triggerPercent = stepPercent * step;
      const triggerPrice = side === "BUY" ? currentPrice * (1 - triggerPercent / 100) : currentPrice * (1 + triggerPercent / 100);
      return {
        step,
        triggerPrice: Number(triggerPrice.toFixed(8)),
        sizeMultiplier: Number((profile.dca!.sizeMultiplier ** step).toFixed(4)),
        reason: `DCA add ${step} after ${triggerPercent.toFixed(2)}% adverse move`,
      };
    });
  }
}

const globalEngine = globalThis as typeof globalThis & { __botBehaviorEngine?: BotBehaviorEngine };
export const botBehaviorEngine = globalEngine.__botBehaviorEngine ?? new BotBehaviorEngine();
globalEngine.__botBehaviorEngine = botBehaviorEngine;
