export type PaperProgressRuntimeEvidence = {
  scannerSymbolsProcessed?: number;
  candidatesProcessed?: number;
  selectionAttempt?: number;
  step?: string;
  selectionBudgetMs?: number;
  selectionStartedAtMs?: number;
};

export type PaperProgressSample = {
  nowMs: number;
  openPositions: number;
  rounds: Array<{ id: string; state: string; endedAt: Date | null; failReason: string | null }>;
  runtime?: PaperProgressRuntimeEvidence | null;
};

/** Healthy NO_TRADE is a market observation; a stalled execution chain is not. */
export class PaperProgressWatchdog {
  private roundSignature = "";
  private evidenceSignature = "";
  private progressedAt: number;

  constructor(startedAt: number, private stallMs = 10 * 60000) {
    this.progressedAt = startedAt;
  }

  private buildRoundSignature(rounds: PaperProgressSample["rounds"]) {
    return JSON.stringify(rounds.map((r) => [r.id, r.state, r.endedAt?.getTime()]));
  }

  private buildEvidenceSignature(runtime?: PaperProgressRuntimeEvidence | null) {
    if (!runtime) return "";
    return JSON.stringify([
      runtime.scannerSymbolsProcessed ?? 0,
      runtime.candidatesProcessed ?? 0,
      runtime.selectionAttempt ?? 0,
      runtime.step ?? "",
    ]);
  }

  observe(input: PaperProgressSample) {
    const roundSignature = this.buildRoundSignature(input.rounds);
    const evidenceSignature = this.buildEvidenceSignature(input.runtime);

    if (roundSignature !== this.roundSignature || evidenceSignature !== this.evidenceSignature) {
      if (roundSignature !== this.roundSignature) this.roundSignature = roundSignature;
      if (evidenceSignature !== this.evidenceSignature) this.evidenceSignature = evidenceSignature;
      this.progressedAt = input.nowMs;
    }

    const recent = input.rounds.filter((r) => r.endedAt).slice(0, 3);
    const technical = (reason: string) => {
      // DB prepends stages (execution:, ai_evaluation:); these are not failure domains.
      const canonical = reason.replace(/^(?:(?:execution|ai_evaluation|selection|preflight):)+/, "");
      return /^(?:SAFE_MODE(?=:)|MARKET_DATA(?=[:_])|PAPER_DB_UNAVAILABLE|AI_INPUT_KLINES_MISSING|HANDOFF_(?:INVALID|CANDIDATE_NOT_FOUND|IDENTITY_MISSING|SYMBOL_MISMATCH)|PROVIDER_UNAVAILABLE|DATABASE(?:_UNAVAILABLE|:)|REDIS:|EXECUTION:API_FAILURE_BREAKER_OPEN)(?:.*)$/.test(canonical);
    };

    const budgetMs = input.runtime?.selectionBudgetMs;
    const selectionStartedAtMs = input.runtime?.selectionStartedAtMs;
    if (
      input.rounds.some((round) => !round.endedAt) &&
      budgetMs &&
      selectionStartedAtMs != null &&
      Number.isFinite(selectionStartedAtMs) &&
      input.openPositions === 0 &&
      input.nowMs - selectionStartedAtMs >= budgetMs
    ) {
      return {
        shouldStop: true,
        reason: "SELECTION_BUDGET_EXCEEDED",
        lastProgressAtMs: this.progressedAt,
        recentFailures: recent.map((r) => r.failReason).filter(Boolean),
      };
    }

    const reason =
      input.openPositions > 0
        ? null
        : recent.length === 3 && recent.every((r) => technical(r.failReason ?? ""))
          ? "REPEATED_TECHNICAL_FAILURE"
          : input.nowMs - this.progressedAt >= this.stallMs
            ? "NO_ROUND_PROGRESS"
            : null;

    return {
      shouldStop: reason !== null,
      reason,
      lastProgressAtMs: this.progressedAt,
      recentFailures: recent.map((r) => r.failReason).filter(Boolean),
    };
  }
}
