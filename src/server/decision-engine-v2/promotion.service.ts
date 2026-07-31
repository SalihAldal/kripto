import { env } from "@/lib/config";
import {
  getLatestModelPromotion,
  persistModelPromotion,
  promoteModelToChampion,
  rollbackActiveModel,
  getModelRegistry,
  getActiveModel,
} from "@/src/server/decision-engine-v2/decision-engine-v2.repository";
import {
  compareRuleVsMlShadow,
  getMlShadowTradeCount,
  ML_ENGINE_ID,
} from "@/src/server/decision-engine-v2/shadow-integration.service";
import { syncInferenceCacheFromRegistry } from "@/src/server/decision-engine-v2/model-registry.service";
import { emitDecisionEngineV2Event, DECISION_ENGINE_V2_EVENT } from "@/src/server/decision-engine-v2/decision-engine-v2.events";
import { ML_V2_PROMOTION_RULES } from "@/src/server/decision-engine-v2/decision-engine-v2.types";

export async function evaluateModelPromotion(modelId?: string) {
  const registry = await getModelRegistry();
  const targetModelId = modelId ?? registry.challengerModelId ?? registry.activeModelId;
  if (!targetModelId) {
    return { eligible: false, blockers: ["no_model"], rationale: "No challenger model registered" };
  }

  const shadowTradeCount = await getMlShadowTradeCount();
  const comparison = await compareRuleVsMlShadow(30);
  const blockers: string[] = [];

  if (shadowTradeCount < env.DECISION_ENGINE_V2_SHADOW_MIN_TRADES) {
    blockers.push(`shadowTrades<${env.DECISION_ENGINE_V2_SHADOW_MIN_TRADES}`);
  }
  if (comparison.ml.profitFactor <= comparison.rule.profitFactor * ML_V2_PROMOTION_RULES.minProfitFactorVsBaseline) {
    blockers.push("profitFactor<=baseline");
  }
  if (comparison.ml.expectancy <= ML_V2_PROMOTION_RULES.minExpectancy) {
    blockers.push("expectancy<=0");
  }
  if (comparison.ml.maxDrawdown > comparison.rule.maxDrawdown * (1 + ML_V2_PROMOTION_RULES.maxDrawdownVsBaseline)) {
    blockers.push("maxDrawdown>baseline");
  }
  if (comparison.ml.profitFactor < 0.5) {
    blockers.push("catastrophic_profit_factor");
  }

  const eligible = blockers.length === 0;
  const status = eligible ? "APPROVED" as const : "REJECTED" as const;

  const promotion = await persistModelPromotion({
    modelId: targetModelId,
    status,
    shadowTradeCount,
    profitFactor: comparison.ml.profitFactor,
    expectancy: comparison.ml.expectancy,
    maxDrawdown: comparison.ml.maxDrawdown,
    winRate: comparison.ml.winRate,
    blockers,
    rationale: eligible
      ? "ML model meets shadow promotion thresholds vs rule baseline"
      : `Blocked: ${blockers.join(", ")}`,
    metadata: { comparison },
  });

  if (eligible) {
    await promoteModelToChampion(targetModelId);
    await syncInferenceCacheFromRegistry();
    emitDecisionEngineV2Event(DECISION_ENGINE_V2_EVENT.MODEL_PROMOTED, {
      modelId: targetModelId,
      shadowTradeCount,
    });
  }

  return { eligible, blockers, promotion, comparison };
}

export async function rollbackModelIfUnstable() {
  const active = await getActiveModel();
  const latest = await getLatestModelPromotion(active?.id);
  if (!latest) return null;

  const unstable =
    (latest.profitFactor != null && latest.profitFactor < 0.8) ||
    (latest.maxDrawdown != null && latest.maxDrawdown > 15) ||
    (latest.expectancy != null && latest.expectancy < -0.5);

  if (!unstable) return null;

  const rolled = await rollbackActiveModel();
  if (rolled) {
    await persistModelPromotion({
      modelId: active!.id,
      status: "ROLLED_BACK",
      shadowTradeCount: latest.shadowTradeCount,
      profitFactor: latest.profitFactor ?? undefined,
      expectancy: latest.expectancy ?? undefined,
      maxDrawdown: latest.maxDrawdown ?? undefined,
      blockers: ["automatic_rollback"],
      rationale: "Automatic rollback due to unstable live metrics",
    });
    await syncInferenceCacheFromRegistry();
    emitDecisionEngineV2Event(DECISION_ENGINE_V2_EVENT.MODEL_ROLLED_BACK, {
      modelId: active!.id,
    });
  }
  return rolled;
}

export async function getPromotionStatus(modelId?: string) {
  const [promotion, registry, comparison, shadowTradeCount] = await Promise.all([
    getLatestModelPromotion(modelId),
    getModelRegistry(),
    compareRuleVsMlShadow(30),
    getMlShadowTradeCount(),
  ]);
  return { promotion, registry, comparison, shadowTradeCount, engineId: ML_ENGINE_ID };
}
