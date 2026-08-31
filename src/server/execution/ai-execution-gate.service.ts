import type { AIConsensusResult } from "@/src/types/ai";
import type { TradingMode } from "@/src/server/execution/types";
import { env } from "@/lib/config";
import { resolveConsensusForExecutionGate } from "@/src/server/decision-engine/decision-contract.service";

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

const BLOCKING_DECISIONS = new Set(["NO_TRADE", "HOLD", "REJECT", "WAIT", "NO_OPINION"]);
const EXECUTABLE_DECISIONS = new Set(["BUY", "SELL"]);
const NO_OPINION_DECISIONS = new Set(["", "NO_OPINION", "TIMEOUT", "MISSING", "UNKNOWN"]);

export type AiExecutionGateOverride = {
  overridePolicy: "ADVISORY";
  overrideReason: string;
  overrideSource: string;
  overrideAudit: string;
  allowedAiDecisions?: string[];
};

function isExecutableDecision(decision: string): decision is "BUY" | "SELL" {
  return EXECUTABLE_DECISIONS.has(decision);
}

function normalizeDecision(decision: string | null | undefined): string {
  const raw = String(decision ?? "").trim().toUpperCase();
  if (!raw) return "";
  if (raw === "NO-TRADE" || raw === "NO TRADE") return "NO_TRADE";
  if (raw === "NO OPINION" || raw === "NO-OPINION") return "NO_OPINION";
  return raw;
}

export function normalizeAiDecision(decision: string | null | undefined): string {
  return normalizeDecision(decision);
}

export function isBlockingAiDecision(decision: string | null | undefined): boolean {
  const normalized = normalizeDecision(decision);
  return !normalized || BLOCKING_DECISIONS.has(normalized);
}

export function isExecutableAiDecision(decision: string | null | undefined): boolean {
  const normalized = normalizeDecision(decision);
  return isExecutableDecision(normalized);
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

function advisoryEvaluation(input: {
  aiRawDecision: string;
  aiFinalDecision: string;
  consensusDecision: string | null;
  reasonCode: string;
  reasonDetail: string;
  executionSide?: "BUY" | "SELL";
}): AiExecutionGateEvaluation {
  return {
    verdict: "AI_ADVISORY_ONLY",
    policy: "ADVISORY",
    aiRawDecision: input.aiRawDecision,
    aiFinalDecision: input.aiFinalDecision,
    consensusDecision: input.consensusDecision,
    executionSide: input.executionSide ?? "BUY",
    reasonCode: input.reasonCode,
    reasonDetail: input.reasonDetail,
    timestamp: new Date().toISOString(),
  };
}

export function resolveAiExecutionGatePolicy(_input?: { mode: TradingMode; learningLane: boolean }): AiExecutionGatePolicy {
  const mode = _input?.mode ?? (env.EXECUTION_MODE as TradingMode);
  // Canonical guard: paper/dry-run must stay advisory to avoid synthetic hard vetoes.
  if (mode === "paper" || mode === "dry-run") return "ADVISORY";
  return env.EXECUTION_AI_GATE_POLICY === "VETO" ? "VETO" : "ADVISORY";
}

export function resolveConsensusDecision(
  ai: Pick<AIConsensusResult, "finalConsensusDecision" | "decisionPayload" | "finalDecision"> | null | undefined,
): string | null {
  return resolveConsensusForExecutionGate(ai);
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
  override?: AiExecutionGateOverride;
}): AiExecutionGateEvaluation {
  const aiRawDecision = normalizeDecision(input.aiDecision ?? "NO_TRADE");
  const aiFinalDecision = aiRawDecision;
  const consensusDecision = normalizeDecision(input.consensusDecision) || null;
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

  if (input.policy === "ADVISORY") {
    const noOpinion = NO_OPINION_DECISIONS.has(aiRawDecision);
    return advisoryEvaluation({
      aiRawDecision: aiRawDecision || "NO_OPINION",
      aiFinalDecision: aiFinalDecision || "NO_OPINION",
      consensusDecision,
      reasonCode: noOpinion ? "AI_NO_OPINION" : "AI_ADVISORY",
      reasonDetail: `AI finalDecision=${aiRawDecision || "NO_OPINION"} is advisory; deterministic path continues`,
    });
  }

  const hasAuditedOverride =
    input.override?.overridePolicy === "ADVISORY" &&
    Boolean(input.override.overrideReason?.trim()) &&
    Boolean(input.override.overrideSource?.trim()) &&
    Boolean(input.override.overrideAudit?.trim());
  const overrideAllowsDecision =
    !input.override?.allowedAiDecisions || input.override.allowedAiDecisions.includes(aiRawDecision);

  if (input.learningLane && input.microTradeEligible && hasAuditedOverride && overrideAllowsDecision) {
    return {
      verdict: "AI_ADVISORY_ONLY",
      policy: "ADVISORY",
      aiRawDecision,
      aiFinalDecision,
      consensusDecision,
      executionSide: "BUY",
      reasonCode: "AI_ADVISORY_OVERRIDE",
      reasonDetail: `Audited override active (${input.override!.overrideSource}): ${input.override!.overrideReason}`,
      timestamp,
    };
  }

  return blockEvaluation({
    policy: input.policy,
    aiRawDecision,
    aiFinalDecision,
    consensusDecision,
    reasonCode: BLOCKING_DECISIONS.has(aiRawDecision) ? "AI_VETO" : "AI_NOT_EXECUTABLE",
    reasonDetail: `AI finalDecision=${aiRawDecision} blocked by ${input.policy} gate policy`,
  });
}

/** Canonical pre-order AI readiness check — advisory on production; VETO remains explicit-only. */
export function evaluateAiExecutionReadiness(input: {
  ai: AIConsensusResult | null | undefined;
  policy: AiExecutionGatePolicy;
  learningLane: boolean;
  microTradeEligible: boolean;
  override?: AiExecutionGateOverride;
}): AiExecutionGateEvaluation {
  const advisory = input.policy === "ADVISORY";

  if (!input.ai) {
    if (advisory) {
      return advisoryEvaluation({
        aiRawDecision: "MISSING",
        aiFinalDecision: "MISSING",
        consensusDecision: null,
        reasonCode: "AI_TIMEOUT",
        reasonDetail: "AI consensus missing/timeout; advisory only, deterministic path continues",
      });
    }
    return blockEvaluation({
      policy: input.policy,
      aiRawDecision: "MISSING",
      aiFinalDecision: "MISSING",
      consensusDecision: null,
      reasonCode: "AI_VERDICT_MISSING",
      reasonDetail: "AI consensus result missing; execution blocked",
    });
  }

  const aiFinalDecision = normalizeDecision(input.ai.finalDecision);
  if (!aiFinalDecision) {
    if (advisory) {
      return advisoryEvaluation({
        aiRawDecision: "MISSING",
        aiFinalDecision: "NO_OPINION",
        consensusDecision: resolveConsensusDecision(input.ai),
        reasonCode: "AI_NO_OPINION",
        reasonDetail: "AI finalDecision missing; advisory only",
      });
    }
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
    if (advisory) {
      return advisoryEvaluation({
        aiRawDecision: aiFinalDecision,
        aiFinalDecision,
        consensusDecision,
        reasonCode: "AI_TIMEOUT",
        reasonDetail: "No healthy AI provider outputs; advisory only",
      });
    }
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
    if (advisory) {
      return advisoryEvaluation({
        aiRawDecision: aiFinalDecision,
        aiFinalDecision,
        consensusDecision: null,
        reasonCode: "AI_NO_OPINION",
        reasonDetail: "Consensus missing; advisory only",
      });
    }
    return blockEvaluation({
      policy: input.policy,
      aiRawDecision: aiFinalDecision,
      aiFinalDecision,
      consensusDecision: null,
      reasonCode: "AI_CONSENSUS_MISSING",
      reasonDetail: "AI verdict present but consensus decision missing; execution blocked",
    });
  }

  const normalizedConsensus = normalizeDecision(consensusDecision);
  const consensusExecutable = isExecutableDecision(normalizedConsensus);
  const aiExecutable = isExecutableDecision(aiFinalDecision);
  const consensusBlocking = BLOCKING_DECISIONS.has(normalizedConsensus);
  const aiBlocking = BLOCKING_DECISIONS.has(aiFinalDecision);
  const mismatch =
    (consensusExecutable && aiExecutable && normalizedConsensus !== aiFinalDecision) ||
    (consensusBlocking && aiExecutable) ||
    (aiBlocking && consensusExecutable);
  if (mismatch) {
    if (advisory) {
      return advisoryEvaluation({
        aiRawDecision: aiFinalDecision,
        aiFinalDecision,
        consensusDecision: normalizedConsensus,
        reasonCode: "AI_DECISION_CONFLICT",
        reasonDetail: `AI finalDecision (${aiFinalDecision}) conflicts with consensus (${normalizedConsensus}); advisory only`,
      });
    }
    return blockEvaluation({
      policy: input.policy,
      aiRawDecision: aiFinalDecision,
      aiFinalDecision,
      consensusDecision: normalizedConsensus,
      reasonCode: "AI_DECISION_CONFLICT",
      reasonDetail: `AI finalDecision (${aiFinalDecision}) conflicts with consensus (${normalizedConsensus})`,
    });
  }

  return evaluateAiExecutionGate({
    aiDecision: aiFinalDecision,
    policy: input.policy,
    learningLane: input.learningLane,
    microTradeEligible: input.microTradeEligible,
    consensusDecision: normalizedConsensus,
    override: input.override,
  });
}
