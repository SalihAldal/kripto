type ExecutionAttemptRecord = {
  candidateId: string;
  executionId: string;
  claimedAt: string;
};

const attempts = new Map<string, ExecutionAttemptRecord>();

export function claimCanonicalExecutionAttempt(input: {
  candidateId: string;
  executionId: string;
}): { ok: true } | { ok: false; reason: string; existingExecutionId: string } {
  const key = input.candidateId.trim().toUpperCase();
  const existing = attempts.get(key);
  if (existing) {
    return {
      ok: false,
      reason: "DUPLICATE_EXECUTION_PATH",
      existingExecutionId: existing.executionId,
    };
  }
  attempts.set(key, {
    candidateId: key,
    executionId: input.executionId,
    claimedAt: new Date().toISOString(),
  });
  return { ok: true };
}

export function getCanonicalExecutionAttempt(candidateId: string): ExecutionAttemptRecord | null {
  return attempts.get(candidateId.trim().toUpperCase()) ?? null;
}

export function releaseCanonicalExecutionAttempt(candidateId: string): void {
  attempts.delete(candidateId.trim().toUpperCase());
}

export function resetCanonicalExecutionAttemptsForTests(): void {
  attempts.clear();
}
