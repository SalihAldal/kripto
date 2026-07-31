import type { AiConsensus } from "@/lib/types";
import { runAIConsensus } from "@/src/server/ai";
import { pushLog } from "@/services/log.service";

export async function analyzeSymbol(symbol: string): Promise<AiConsensus> {
  const ai = await runAIConsensus(symbol);
  const votes = ai.outputs.map((row) => ({
    model: row.providerName,
    signal: row.output?.decision === "NO_TRADE" ? "HOLD" : (row.output?.decision ?? "HOLD"),
    confidence: Number(((row.output?.confidence ?? 0) / 100).toFixed(4)),
    reason: row.output?.reasoningShort ?? row.error ?? "Provider error",
  }));

  const mappedFinalSignal = ai.finalDecision === "NO_TRADE" ? "HOLD" : ai.finalDecision;
  const confidence = Number((ai.finalConfidence / 100).toFixed(4));

  const consensus: AiConsensus = {
    symbol,
    finalSignal: mappedFinalSignal,
    confidence,
    votes,
    marketMode: ai.decisionPayload?.marketMode,
    marketModeReason: ai.decisionPayload?.marketModeReason,
    selectedStrategy: ai.decisionPayload?.selectedStrategy,
    marketRegimeProfile: ai.decisionPayload?.marketRegimeProfile,
    executionAction: ai.decisionPayload?.executionAction,
    executionReason: ai.decisionPayload?.executionReason,
    noTradeMode: ai.decisionPayload?.noTradeMode,
    consensusEngine: ai.decisionPayload?.consensusEngine,
    selfCriticReview: ai.decisionPayload?.selfCriticReview,
    liquidityZones: ai.decisionPayload?.liquidityZones,
    riskyAreas: ai.decisionPayload?.riskyAreas,
    liquidityIntel: ai.decisionPayload?.liquidityIntel,
    safeEntryPoint: ai.decisionPayload?.safeEntryPoint,
    entryRejectReason: ai.decisionPayload?.entryRejectReason,
    timeframeAnalysis: ai.decisionPayload?.timeframeAnalysis,
    createdAt: new Date().toISOString(),
  };

  pushLog("SIGNAL", `${symbol} icin AI karar: ${mappedFinalSignal} (${ai.finalConfidence}%)`);
  return consensus;
}
