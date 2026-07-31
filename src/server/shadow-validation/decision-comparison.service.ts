import type { DecisionComparisonResult, ShadowDecisionCapture } from "@/src/server/shadow-validation/shadow-validation.types";

export function compareDecisions(
  production: ShadowDecisionCapture,
  shadow: ShadowDecisionCapture,
): DecisionComparisonResult {
  const disagreements: string[] = [];
  if (production.decision !== shadow.decision) {
    disagreements.push(`decision:${production.decision}->${shadow.decision}`);
  }
  const confidenceDelta =
    production.confidence != null && shadow.confidence != null ? shadow.confidence - production.confidence : undefined;
  if (confidenceDelta != null && Math.abs(confidenceDelta) >= 10) {
    disagreements.push(`confidenceDelta:${confidenceDelta.toFixed(1)}`);
  }

  const expertConflicts = extractExpertConflicts(production, shadow);
  let winnerEngineId: string | undefined;
  if (production.decision === shadow.decision) {
    winnerEngineId = production.engineId;
  } else if (shadow.confidence != null && production.confidence != null && shadow.confidence > production.confidence + 5) {
    winnerEngineId = shadow.engineId;
  } else if (production.confidence != null && shadow.confidence != null && production.confidence > shadow.confidence + 5) {
    winnerEngineId = production.engineId;
  }

  return {
    decisionId: production.decisionId,
    symbol: production.symbol,
    productionEngineId: production.engineId,
    shadowEngineId: shadow.engineId,
    productionDecision: production.decision,
    shadowDecision: shadow.decision,
    confidenceDelta,
    reasoningDelta: `${production.reasoning ?? ""} | ${shadow.reasoning ?? ""}`.slice(0, 500),
    disagreements,
    expertConflicts,
    winnerEngineId,
  };
}

function extractExpertConflicts(production: ShadowDecisionCapture, shadow: ShadowDecisionCapture) {
  const prodMaster = (production.payload?.masterDecisionEngine ?? production.payload) as Record<string, unknown> | undefined;
  const shadowMaster = (shadow.payload?.masterDecisionEngine ?? shadow.payload) as Record<string, unknown> | undefined;
  const prodExperts = (prodMaster?.expertOpinions as Array<{ expertType: string; opinion: string }> | undefined) ?? [];
  const shadowExperts = (shadowMaster?.expertOpinions as Array<{ expertType: string; opinion: string }> | undefined) ?? [];
  const conflicts: Array<{ expert: string; productionView: string; shadowView: string }> = [];
  for (const prod of prodExperts) {
    const match = shadowExperts.find((row) => row.expertType === prod.expertType);
    if (match && match.opinion !== prod.opinion) {
      conflicts.push({ expert: prod.expertType, productionView: prod.opinion, shadowView: match.opinion });
    }
  }
  return conflicts;
}

export function normalizeDecision(decision: string) {
  return decision.toUpperCase().replace(/-/g, "_");
}

export function isEntryDecision(decision: string) {
  const normalized = normalizeDecision(decision);
  return normalized === "BUY" || normalized === "STRONG_BUY";
}

export function isRejectDecision(decision: string) {
  const normalized = normalizeDecision(decision);
  return normalized === "NO_TRADE" || normalized === "WAIT" || normalized === "REJECT";
}
