import { env } from "@/lib/config";
import type { AIConsensusResult } from "@/src/types/ai";
import type { TradingMode } from "@/src/server/execution/types";

export type AiExecutionGateVerdict = "AI_GATE_PASS" | "AI_GATE_BLOCK" | "AI_ADVISORY_ONLY";

export type AiExecutionGatePolicy = "VETO" | "ADVISORY";

export type AiExecutionGateEvaluation = {
  verdict: AiExecutionGateVerdict;
  policy: AiExecutionGatePolicy;
  aiRawDecision: string;
  aiFinalDecision: string;
  consensusDecision: string | null;
  executionSide: "BUY" | "SELL" | null;
  reasonCode: string;
  reasonDetail: string;
  timestamp: string;
};

const BLOCKING_DECISIONS = new Set(["NO_TRADE", "HOLD", "REJECT", "WAIT"]);

function isExecutableDecision(decision: string): decision is "BUY" | "SELL" {
  return decision === "BUY" || decision === "SELL";
}

function blockEvaluation(input: {
  policy: AiExecutionGatePolicy;
  aiRawDecision: string;
  aiFinalDecision: string;
  consensusDecision: string | null;
  reasonCode: string;
  reasonDetail: string;
}): AiExecutionGateEvaluation {
  return {
    verdict: "AI_GATE_BLOCK",
    policy: input.policy,
    aiRawDecision: input.aiRawDecision,
    aiFinalDecision: input.aiFinalDecision,
    consensusDecision: input.consensusDecision,
    executionSide: null,
    reasonCode: input.reasonCode,
    reasonDetail: input.reasonDetail,
    timestamp: new Date().toISOString(),
  };
}

export function resolveAiExecutionGatePolicy(input: { mode: TradingMode; learningLane: boolean }): AiExecutionGatePolicy {
  if (input.mode !== "paper") return "VETO";
  if (env.EXECUTION_AI_GATE_POLICY === "ADVISORY" && input.learningLane) return "ADVISORY";
  return "VETO";
}

export function resolveConsensusDecision(
  ai: Pick<AIConsensusResult, "finalConsensusDecision" | "decisionPayload"> | null | undefined,
): string | null {
  if (!ai) return null;
  const raw =
    ai.finalConsensusDecision ??
    ai.decisionPayload?.consensusEngine?.finalDecision ??
    null;
  if (raw === null || raw === undefined) return null;
  const normalized = String(raw).trim();
  return normalized.length > 0 ? normalized : null;
}

export function hasAiProviderEvidence(ai: Pick<AIConsensusResult, "outputs"> | null | undefined) {
  return Boolean(ai?.outputs?.some((row) => row.ok && row.output));
}

export function evaluateAiExecutionGate(input: {
  aiDecision: string;
  policy: AiExecutionGatePolicy;
  learningLane: boolean;
  microTradeEligible: boolean;
  consensusDecision?: string | null;
}): AiExecutionGateEvaluation {
  const aiRawDecision = String(input.aiDecision ?? "NO_TRADE").toUpperCase();
  const aiFinalDecision = aiRawDecision;
  const consensusDecision = input.consensusDecision ?? null;
  const timestamp = new Date().toISOString();

  if (isExecutableDecision(aiRawDecision)) {
    return {
      verdict: "AI_GATE_PASS",
      policy: input.policy,
      aiRawDecision,
      aiFinalDecision,
      consensusDecision,
      executionSide: aiRawDecision,
      reasonCode: "AI_GATE_PASS",
      reasonDetail: `AI finalDecision=${aiRawDecision}`,
      timestamp,
    };
  }

  if (input.policy === "ADVISORY" && input.learningLane && input.microTradeEligible) {
    return {
      verdict: "AI_ADVISORY_ONLY",
      policy: input.policy,
      aiRawDecision,
      aiFinalDecision,
      consensusDecision,
      executionSide: "BUY",
      reasonCode: "LEARNING_LANE_EXPLORATION_MICRO_TRADE",
      reasonDetail: `AI ${aiRawDecision} treated as advisory-only; paper learning lane may proceed with micro BUY exploration`,
      timestamp,
    };
  }

  return blockEvaluation({
    policy: input.policy,
    aiRawDecision,
    aiFinalDecision,
    consensusDecision,
    reasonCode: BLOCKING_DECISIONS.has(aiRawDecision) ? aiRawDecision : "AI_NOT_EXECUTABLE",
    reasonDetail: `AI finalDecision=${aiRawDecision} blocked by ${input.policy} gate policy`,
  });
}

/** Canonical pre-order AI readiness check — missing evidence never approves execution. */
export function evaluateAiExecutionReadiness(input: {
  ai: AIConsensusResult | null | undefined;
  policy: AiExecutionGatePolicy;
  learningLane: boolean;
  microTradeEligible: boolean;
}): AiExecutionGateEvaluation {
  if (!input.ai) {
    return blockEvaluation({
      policy: input.policy,
      aiRawDecision: "MISSING",
      aiFinalDecision: "MISSING",
      consensusDecision: null,
      reasonCode: "AI_VERDICT_MISSING",
      reasonDetail: "AI consensus result missing; execution blocked",
    });
  }

  const aiFinalDecision = String(input.ai.finalDecision ?? "").trim().toUpperCase();
  if (!aiFinalDecision) {
    return blockEvaluation({
      policy: input.policy,
      aiRawDecision: "MISSING",
      aiFinalDecision: "MISSING",
      consensusDecision: resolveConsensusDecision(input.ai),
      reasonCode: "AI_VERDICT_MISSING",
      reasonDetail: "AI finalDecision missing; execution blocked",
    });
  }

  const consensusDecision = resolveConsensusDecision(input.ai);

  if (!hasAiProviderEvidence(input.ai)) {
    return blockEvaluation({
      policy: input.policy,
      aiRawDecision: aiFinalDecision,
      aiFinalDecision,
      consensusDecision,
      reasonCode: "AI_EVIDENCE_MISSING",
      reasonDetail: "No healthy AI provider outputs; execution blocked",
    });
  }

  if (!consensusDecision) {
    return blockEvaluation({
      policy: input.policy,
      aiRawDecision: aiFinalDecision,
      aiFinalDecision,
      consensusDecision: null,
      reasonCode: "CONSENSUS_MISSING",
      reasonDetail: "AI verdict present but consensus decision missing; execution blocked",
    });
  }

  return evaluateAiExecutionGate({
    aiDecision: aiFinalDecision,
    policy: input.policy,
    learningLane: input.learningLane,
    microTradeEligible: input.microTradeEligible,
    consensusDecision,
  });
}
