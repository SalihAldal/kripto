import type { RoundOwnershipRecord } from "@/src/server/execution/round-registry.types";
import type { AutoRoundState } from "@/src/server/repositories/auto-round.repository";

export type HarnessJobRow = {
  id: string;
  persistVersion: number;
  activeRunId: string | null;
  currentRound: number;
  completedRounds: number;
  failedRounds: number;
  activeState: string;
  lastError: string | null;
  status: string;
  stopRequested: boolean;
  totalRounds: number;
  metadata: Record<string, unknown> | null;
};

export type HarnessRunRow = {
  id: string;
  jobId: string;
  roundNo: number;
  state: string;
  idempotencyKey: string | null;
  persistVersion: number;
  endedAt: Date | null;
  result: string | null;
  failReason: string | null;
  symbol: string | null;
  metadata: Record<string, unknown> | null;
  startedAt: Date;
};

export const BUSINESS_REJECT_REASONS = [
  "AI_VETO: paper policy",
  "Paper NO_TRADE: pump ve steady-gain adayi yok",
  "SIM_TIGHT_FILTER_15m: momentum low",
  "TDI_WAIT: slot not ready",
  "EV_REJECT: fee-aware edge negative",
] as const;

export function ownership(jobId: string, roundNo: number): RoundOwnershipRecord {
  return {
    jobId,
    roundNo,
    roundOwner: "owner-endurance:g1",
    runId: "pending",
    status: "OWNERSHIP_ACQUIRED",
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function validateCounterIntegrity(job: HarnessJobRow, runs: HarnessRunRow[]) {
  const terminal = runs.filter((r) => r.endedAt);
  const failedTerminal = terminal.filter((r) => r.result === "failed");
  const completedTerminal = terminal.filter((r) => r.result !== "failed" && r.result !== null);
  const active = runs.filter((r) => !r.endedAt);

  const issues: string[] = [];
  if (job.failedRounds !== failedTerminal.length) {
    issues.push(`failedRounds mismatch: job=${job.failedRounds} runs=${failedTerminal.length}`);
  }
  if (job.completedRounds !== completedTerminal.length) {
    issues.push(`completedRounds mismatch: job=${job.completedRounds} runs=${completedTerminal.length}`);
  }
  if (job.currentRound > job.totalRounds) {
    issues.push(`currentRound exceeds totalRounds: ${job.currentRound}/${job.totalRounds}`);
  }

  const activeByRound = new Map<number, number>();
  for (const run of active) {
    activeByRound.set(run.roundNo, (activeByRound.get(run.roundNo) ?? 0) + 1);
  }
  for (const [roundNo, count] of activeByRound) {
    if (count > 1) issues.push(`duplicate active round ${roundNo}: ${count}`);
  }

  if (job.activeRunId) {
    const pointed = runs.find((r) => r.id === job.activeRunId);
    if (!pointed) issues.push(`orphan activeRunId ${job.activeRunId}`);
    else if (pointed.endedAt) issues.push(`activeRunId points to terminal run ${job.activeRunId}`);
  }

  return { ok: issues.length === 0, issues };
}

export function pickBusinessReason(roundNo: number): string {
  return BUSINESS_REJECT_REASONS[roundNo % BUSINESS_REJECT_REASONS.length];
}

export const IN_PROGRESS_STATES: AutoRoundState[] = [
  "tariyor",
  "coin_secildi",
  "alim_yapildi",
  "satis_bekleniyor",
];
