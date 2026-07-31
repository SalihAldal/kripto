import { getDecisionLogByDecisionId } from "@/src/server/repositories/decision-log.repository";
import { buildAIInput, runLegacyAIConsensusFromInput } from "@/src/server/ai/analysis-orchestrator";
import { adjudicateWithMasterDecisionEngine } from "@/src/server/decision-engine/master-decision-engine.service";
import { createDecisionId } from "@/src/server/observability/decision-observability.service";
import type { ShadowDecisionCapture, ShadowEngineDefinition } from "@/src/server/shadow-validation/shadow-validation.types";

function extractPrice(decision: NonNullable<Awaited<ReturnType<typeof getDecisionLogByDecisionId>>>) {
  const raw = decision.featureSnapshot?.raw as Record<string, unknown> | null | undefined;
  const fromRaw = Number(raw?.lastPrice ?? 0);
  if (Number.isFinite(fromRaw) && fromRaw > 0) return fromRaw;
  const marketState = decision.marketState as Record<string, unknown> | null | undefined;
  const fromState = Number(marketState?.lastPrice ?? 0);
  return Number.isFinite(fromState) && fromState > 0 ? fromState : undefined;
}

export async function runShadowEngineAdapter(
  engine: ShadowEngineDefinition,
  decisionId: string,
): Promise<ShadowDecisionCapture | null> {
  const decision = await getDecisionLogByDecisionId(decisionId);
  if (!decision) return null;

  const productionDecision = decision.decision;
  const entryPrice = extractPrice(decision);
  const base = {
    decisionId,
    symbol: decision.symbol,
    engineId: engine.engineId,
    engineMode: engine.mode,
    productionDecision,
    entryPrice,
  };

  if (engine.adapter === "production-mirror") {
    return {
      ...base,
      decision: productionDecision,
      confidence: decision.confidence ?? undefined,
      reasoning: decision.humanSummary ?? undefined,
      isProduction: true,
      payload: { source: "production-mirror" },
    };
  }

  try {
    const input = await buildAIInput(decision.symbol);
    const legacy = await runLegacyAIConsensusFromInput(input);

    if (engine.adapter === "legacy-hybrid") {
      return {
        ...base,
        decision: legacy.finalDecision,
        confidence: legacy.finalConfidence,
        targetPrice: legacy.decisionPayload?.targetPrice ?? undefined,
        stopPrice: legacy.decisionPayload?.stopPrice ?? undefined,
        reasoning: legacy.explanation,
        payload: { adapter: engine.adapter, roleScores: legacy.roleScores },
      };
    }

    if (engine.adapter === "decision-engine-v1") {
      const adjudicated = await adjudicateWithMasterDecisionEngine({
        decisionId: createDecisionId(),
        input,
        legacyResult: legacy,
      });
      const master = (adjudicated.decisionPayload as Record<string, unknown> | undefined)?.masterDecisionEngine as
        | Record<string, unknown>
        | undefined;
      return {
        ...base,
        decision: adjudicated.finalDecision,
        confidence: adjudicated.finalConfidence,
        targetPrice: adjudicated.decisionPayload?.targetPrice ?? undefined,
        stopPrice: adjudicated.decisionPayload?.stopPrice ?? undefined,
        reasoning: adjudicated.explanation,
        payload: { adapter: engine.adapter, masterDecision: master?.decision, matrix: master?.matrix },
      };
    }

    if (engine.adapter === "decision-engine-v2") {
      const { runDecisionEngineV2ShadowAdapter } = await import(
        "@/src/server/decision-engine-v2/shadow-integration.service"
      );
      return runDecisionEngineV2ShadowAdapter(decisionId);
    }

    if (engine.adapter === "momentum-heuristic") {
      const mom = Number(input.marketSignals?.shortMomentumPercent ?? 0);
      const change = Number(input.marketSignals?.change5m ?? 0);
      const decisionOut = mom > 1.2 && change > 0.4 ? "BUY" : mom < -1.2 && change < -0.4 ? "SELL" : "NO_TRADE";
      const confidence = Math.min(100, Math.abs(mom) * 20 + Math.abs(change) * 10);
      return {
        ...base,
        decision: decisionOut,
        confidence,
        reasoning: `Momentum heuristic mom=${mom.toFixed(2)} change5m=${change.toFixed(2)}`,
        payload: { adapter: engine.adapter, mom, change },
      };
    }

    if (engine.adapter === "experimental-ai" || engine.adapter === "research-ai" || engine.adapter === "institutional-ai") {
      const regime = input.marketRegime?.mode ?? "UNKNOWN";
      const alignment = input.multiTimeframe?.alignmentScore ?? 50;
      const vol = input.volatility ?? 0;
      const experimentalScore = alignment * 0.5 + (100 - vol * 5) * 0.3 + (legacy.finalConfidence ?? 0) * 0.2;
      const decisionOut = experimentalScore >= 68 ? "BUY" : experimentalScore <= 35 ? "SELL" : "NO_TRADE";
      return {
        ...base,
        decision: decisionOut,
        confidence: experimentalScore,
        reasoning: `${engine.adapter} score=${experimentalScore.toFixed(1)} regime=${regime}`,
        payload: { adapter: engine.adapter, experimentalScore, regime, alignment },
      };
    }
  } catch {
    return {
      ...base,
      decision: "NO_TRADE",
      confidence: 0,
      reasoning: "Shadow adapter failed safely",
      payload: { adapter: engine.adapter, error: true },
    };
  }

  return null;
}
