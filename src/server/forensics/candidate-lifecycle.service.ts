import type { ForensicStage, TerminalVerdict } from "@/src/server/forensics/forensic.types";
import {
  createCandidateId,
  recordTerminalOutcome,
} from "@/src/server/forensics/forensic-collector.service";
import { getForensicSession } from "@/src/server/forensics/forensic-context";

export type CandidateTerminalStatus = "TRADED" | "WAIT" | "REJECTED" | "FAILED" | "UNKNOWN";

export type CandidateLifecycleRecord = {
  candidateId: string;
  campaignId?: string;
  symbol: string;
  stage: ForensicStage;
  verdict: CandidateTerminalStatus;
  reasonCode: string;
  reasonDetail: string;
  timestamp: string;
  runId?: string;
  roundNo?: number;
};

const lifecycleLog: CandidateLifecycleRecord[] = [];

function mapTerminalVerdict(status: CandidateTerminalStatus): TerminalVerdict {
  if (status === "TRADED") return "APPROVED";
  return status;
}

export function recordCandidateLifecycle(input: {
  symbol: string;
  stage: ForensicStage;
  verdict: CandidateTerminalStatus;
  reasonCode: string;
  reasonDetail: string;
  candidateId?: string;
  runId?: string;
  roundNo?: number;
}) {
  const session = getForensicSession();
  const record: CandidateLifecycleRecord = {
    candidateId: input.candidateId ?? createCandidateId(input.symbol, input.stage),
    campaignId: session?.campaignId,
    symbol: input.symbol.toUpperCase(),
    stage: input.stage,
    verdict: input.verdict,
    reasonCode: input.reasonCode,
    reasonDetail: input.reasonDetail,
    timestamp: new Date().toISOString(),
    roundNo: input.roundNo ?? (session?.roundId ? Number(session.roundId) : undefined),
    runId: input.runId ?? session?.runId,
  };
  lifecycleLog.push(record);
  if (lifecycleLog.length > 5000) lifecycleLog.shift();
  recordTerminalOutcome({
    candidateId: record.candidateId,
    symbol: record.symbol,
    stage: record.stage,
    verdict: mapTerminalVerdict(record.verdict),
    reasonCode: record.reasonCode,
    reasonDetail: record.reasonDetail,
    timestamp: record.timestamp,
    metadata: { lifecycleVerdict: record.verdict, runId: record.runId, campaignId: record.campaignId },
  });
  return record;
}

export function traceCandidateReject(input: {
  symbol: string;
  stage: ForensicStage;
  reasonCode: string;
  reasonDetail: string;
  candidateId?: string;
}) {
  return recordCandidateLifecycle({
    ...input,
    verdict: "REJECTED",
  });
}

export function traceCandidateFailed(input: {
  symbol: string;
  stage: ForensicStage;
  reasonCode: string;
  reasonDetail: string;
  candidateId?: string;
}) {
  return recordCandidateLifecycle({
    ...input,
    verdict: "FAILED",
  });
}

export function traceCandidateTraded(input: {
  symbol: string;
  stage?: ForensicStage;
  reasonDetail?: string;
  candidateId?: string;
}) {
  return recordCandidateLifecycle({
    symbol: input.symbol,
    stage: input.stage ?? "execution",
    verdict: "TRADED",
    reasonCode: "TRADED",
    reasonDetail: input.reasonDetail ?? "Trade opened",
    candidateId: input.candidateId,
  });
}

export function traceCandidateWait(input: {
  symbol: string;
  stage: ForensicStage;
  reasonCode: string;
  reasonDetail: string;
}) {
  return recordCandidateLifecycle({
    ...input,
    verdict: "WAIT",
  });
}

export function traceCandidateUnknown(input: {
  symbol: string;
  stage: ForensicStage;
  reasonCode: string;
  reasonDetail: string;
}) {
  return recordCandidateLifecycle({
    ...input,
    verdict: "UNKNOWN",
  });
}

export function getCandidateLifecycleLog(runId?: string) {
  if (!runId) return [...lifecycleLog];
  return lifecycleLog.filter((row) => row.runId === runId);
}

export function resetCandidateLifecycleLog() {
  lifecycleLog.length = 0;
}

export function assertNoSilentCandidateLoss(records: CandidateLifecycleRecord[]) {
  return records.every((row) => Boolean(row.reasonCode && row.reasonDetail && row.verdict));
}
