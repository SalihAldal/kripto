import type { ForensicSessionContext } from "@/src/server/forensics/forensic-context";
import type { PaperSessionSnapshot, PaperSessionStatus } from "@/src/server/forensics/forensic.types";

const STALE_MS = 15 * 60_000;

export function createPaperSessionSnapshot(input: {
  sessionId: string;
  status?: PaperSessionStatus;
  roundId?: string;
  currentStage?: PaperSessionSnapshot["currentStage"];
  currentRound?: number;
  error?: string | null;
}): PaperSessionSnapshot {
  const now = new Date().toISOString();
  return {
    sessionId: input.sessionId,
    roundId: input.roundId,
    status: input.status ?? "CREATED",
    currentStage: input.currentStage,
    currentRound: input.currentRound,
    lastProgressAt: now,
    error: input.error ?? null,
    updatedAt: now,
  };
}

export function transitionPaperSession(
  snapshot: PaperSessionSnapshot,
  next: PaperSessionStatus,
  input?: Partial<Pick<PaperSessionSnapshot, "roundId" | "currentStage" | "currentRound" | "error">>,
): PaperSessionSnapshot {
  const now = new Date().toISOString();
  return {
    ...snapshot,
    ...input,
    status: next,
    lastProgressAt: now,
    updatedAt: now,
  };
}

export function detectStalePaperSession(snapshot: PaperSessionSnapshot, nowMs = Date.now()) {
  const last = Date.parse(snapshot.lastProgressAt);
  if (!Number.isFinite(last)) return { stale: true, reason: "INVALID_LAST_PROGRESS" as const };
  if (nowMs - last > STALE_MS && ["RUNNING", "RUNNING_ROUND", "EXIT_WAIT", "ROUND_INITIALIZING"].includes(snapshot.status)) {
    return { stale: true, reason: "STALE_RUNNING" as const };
  }
  return { stale: false as const };
}

export function recoverStalePaperSession(snapshot: PaperSessionSnapshot) {
  const stale = detectStalePaperSession(snapshot);
  if (!stale.stale) return snapshot;
  return transitionPaperSession(snapshot, "FAILED", {
    error: `Paper session stale: ${stale.reason}`,
  });
}

export function attachSessionState(session: ForensicSessionContext, snapshot: PaperSessionSnapshot) {
  session.sessionState = snapshot;
  return snapshot;
}
