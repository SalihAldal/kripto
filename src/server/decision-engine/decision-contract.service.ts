import type { AIConsensusResult } from "@/src/types/ai";

function normalizeDecision(decision: string | null | undefined): string {
  const raw = String(decision ?? "").trim().toUpperCase();
  if (!raw) return "";
  if (raw === "NO-TRADE" || raw === "NO TRADE") return "NO_TRADE";
  return raw;
}

export type DataContractStatus = "AVAILABLE" | "UNAVAILABLE" | "STALE" | "INVALID";

export type MtfAlignmentContract = {
  status: DataContractStatus;
  source: "AI" | "MARKET_CONTEXT" | "NONE";
  score: number | null;
};

export type PumpRiskContract = {
  status: DataContractStatus;
  source: "FUTURES_INTEL" | "CONTEXT" | "NONE";
  score: number | null;
  degraded: boolean;
};

export function resolveMtfAlignmentContract(input: {
  aiAlignment?: unknown;
  contextAlignment?: unknown;
}): MtfAlignmentContract {
  const aiValid =
    input.aiAlignment !== undefined &&
    input.aiAlignment !== null &&
    Number.isFinite(Number(input.aiAlignment));
  const contextValid =
    input.contextAlignment !== undefined &&
    input.contextAlignment !== null &&
    Number.isFinite(Number(input.contextAlignment));
  if (aiValid) {
    return { status: "AVAILABLE", source: "AI", score: Number(input.aiAlignment) };
  }
  if (contextValid) {
    return { status: "AVAILABLE", source: "MARKET_CONTEXT", score: Number(input.contextAlignment) };
  }
  return { status: "UNAVAILABLE", source: "NONE", score: null };
}

export function resolvePumpRiskContract(input: {
  manipulationPressureScore?: unknown;
  contextPumpRisk?: unknown;
  futuresDegraded?: boolean;
}): PumpRiskContract {
  if (input.futuresDegraded) {
    return { status: "UNAVAILABLE", source: "FUTURES_INTEL", score: null, degraded: true };
  }
  const futuresValid =
    input.manipulationPressureScore !== undefined &&
    input.manipulationPressureScore !== null &&
    Number.isFinite(Number(input.manipulationPressureScore));
  if (futuresValid) {
    return {
      status: "AVAILABLE",
      source: "FUTURES_INTEL",
      score: Number(input.manipulationPressureScore),
      degraded: false,
    };
  }
  const contextValid =
    input.contextPumpRisk !== undefined &&
    input.contextPumpRisk !== null &&
    Number.isFinite(Number(input.contextPumpRisk));
  if (contextValid) {
    return {
      status: "AVAILABLE",
      source: "CONTEXT",
      score: Number(input.contextPumpRisk),
      degraded: false,
    };
  }
  return { status: "UNAVAILABLE", source: "NONE", score: null, degraded: false };
}

export function isPreservedHybridBuy(ai: Pick<AIConsensusResult, "finalDecision" | "decisionPayload"> | null | undefined) {
  if (!ai) return false;
  const payload = ai.decisionPayload as { masterDecisionEngine?: { preservedHybridBuy?: boolean } } | undefined;
  return Boolean(payload?.masterDecisionEngine?.preservedHybridBuy && normalizeDecision(ai.finalDecision) === "BUY");
}

/** Execution gate must not treat preserved hybrid BUY as conflicting with master deferral consensus. */
export function resolveConsensusForExecutionGate(
  ai: Pick<AIConsensusResult, "finalDecision" | "finalConsensusDecision" | "decisionPayload"> | null | undefined,
): string | null {
  if (!ai) return null;
  if (isPreservedHybridBuy(ai)) return "BUY";
  const raw =
    ai.finalConsensusDecision ??
    (ai.decisionPayload as { consensusEngine?: { finalDecision?: string } } | undefined)?.consensusEngine?.finalDecision ??
    null;
  if (raw === null || raw === undefined) return null;
  const normalized = normalizeDecision(raw);
  return normalized.length > 0 ? normalized : null;
}

export type AiDecisionInvariantResult = {
  ok: boolean;
  violations: string[];
};

export function validateAiDecisionInvariants(
  ai: Pick<AIConsensusResult, "finalDecision" | "finalConsensusDecision" | "decisionPayload"> | null | undefined,
): AiDecisionInvariantResult {
  const violations: string[] = [];
  if (!ai) return { ok: false, violations: ["AI_RESULT_MISSING"] };

  const finalDecision = normalizeDecision(ai.finalDecision);
  const consensus = normalizeDecision(resolveConsensusForExecutionGate(ai) ?? ai.finalConsensusDecision);
  const preserved = isPreservedHybridBuy(ai);

  if (preserved) {
    if (finalDecision !== "BUY") violations.push("PRESERVED_HYBRID_BUY_REQUIRES_FINAL_BUY");
    if (consensus !== "BUY") violations.push("PRESERVED_HYBRID_BUY_REQUIRES_CONSENSUS_BUY");
  }

  if (
    finalDecision === "BUY" &&
    consensus &&
    (consensus === "NO_TRADE" || consensus === "REJECT" || consensus === "HOLD" || consensus === "WAIT") &&
    !preserved
  ) {
    violations.push("BUY_CONSENSUS_MISALIGNMENT");
  }

  return { ok: violations.length === 0, violations };
}
