export type CanonicalAuthorityCounters = {
  aiEvaluationCount: number;
  aiPositiveModifierCount: number;
  aiNegativeModifierCount: number;
  aiNeutralCount: number;
  aiTimeoutCount: number;
  aiNoOpinionCount: number;
  aiHardVetoCount: number;
  tdiEvaluationCount: number;
  tdiBuyCount: number;
  tdiRejectOpinionCount: number;
  tdiNoOpinionCount: number;
  tdiHardVetoCount: number;
  learningEvaluationCount: number;
  learningAdvisoryRejectCount: number;
  learningHardVetoCount: number;
  legacyScannerInvocationCount: number;
  legacyScannerPersistCount: number;
};

const counters: CanonicalAuthorityCounters = {
  aiEvaluationCount: 0,
  aiPositiveModifierCount: 0,
  aiNegativeModifierCount: 0,
  aiNeutralCount: 0,
  aiTimeoutCount: 0,
  aiNoOpinionCount: 0,
  aiHardVetoCount: 0,
  tdiEvaluationCount: 0,
  tdiBuyCount: 0,
  tdiRejectOpinionCount: 0,
  tdiNoOpinionCount: 0,
  tdiHardVetoCount: 0,
  learningEvaluationCount: 0,
  learningAdvisoryRejectCount: 0,
  learningHardVetoCount: 0,
  legacyScannerInvocationCount: 0,
  legacyScannerPersistCount: 0,
};

export function recordAiEvaluation(input: {
  verdict: "AI_GATE_PASS" | "AI_GATE_BLOCK" | "AI_ADVISORY_ONLY";
  reasonCode: string;
  modifier?: number;
}) {
  counters.aiEvaluationCount += 1;
  const modifier = Number(input.modifier ?? 0);
  if (modifier > 0) counters.aiPositiveModifierCount += 1;
  else if (modifier < 0) counters.aiNegativeModifierCount += 1;
  else counters.aiNeutralCount += 1;
  if (input.reasonCode === "AI_TIMEOUT") counters.aiTimeoutCount += 1;
  if (input.reasonCode === "AI_NO_OPINION") counters.aiNoOpinionCount += 1;
  if (input.verdict === "AI_GATE_BLOCK") counters.aiHardVetoCount += 1;
}

export function recordTdiEvaluation(input: { decision: string }) {
  counters.tdiEvaluationCount += 1;
  const decision = input.decision.trim().toUpperCase();
  if (decision.includes("BUY") || decision === "APPROVED") counters.tdiBuyCount += 1;
  if (decision.includes("REJECT") || decision.includes("WAIT") || decision.includes("BLOCK")) {
    counters.tdiRejectOpinionCount += 1;
  }
  if (!decision || decision === "NO_OPINION" || decision === "SHADOW") counters.tdiNoOpinionCount += 1;
}

export function recordLearningEvaluation(input: { advisoryRejected: boolean; hardVeto: boolean }) {
  counters.learningEvaluationCount += 1;
  if (input.advisoryRejected) counters.learningAdvisoryRejectCount += 1;
  if (input.hardVeto) counters.learningHardVetoCount += 1;
}

export function setLegacyScannerCounters(input: { invocation: number; persist: number }) {
  counters.legacyScannerInvocationCount = Math.max(0, input.invocation);
  counters.legacyScannerPersistCount = Math.max(0, input.persist);
}

export function getCanonicalAuthorityCounters(): CanonicalAuthorityCounters {
  return { ...counters };
}

export function resetCanonicalAuthorityCountersForTests() {
  for (const key of Object.keys(counters) as Array<keyof CanonicalAuthorityCounters>) {
    counters[key] = 0;
  }
}
