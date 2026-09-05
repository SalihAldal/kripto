import { randomUUID } from "node:crypto";
import { getForensicSession } from "@/src/server/forensics/forensic-context";

export type CanonicalEventEnvelope = {
  eventId: string;
  campaignId?: string;
  runId: string;
  candidateId?: string;
  positionId?: string;
  executionIntentId?: string;
  symbol?: string;
  venue?: string;
  eventType: string;
  timestamp: string;
  sourceService: string;
  sourceInstanceId: string;
  payload: Record<string, unknown>;
};

const eventLog: CanonicalEventEnvelope[] = [];

export function recordCanonicalEvent(input: Omit<CanonicalEventEnvelope, "eventId" | "runId" | "timestamp"> & {
  runId?: string;
  timestamp?: string;
}) {
  const session = getForensicSession();
  const runId = (input.runId ?? session?.runId ?? "").trim();
  if (!runId) return null;
  const row: CanonicalEventEnvelope = {
    eventId: `evt_${randomUUID()}`,
    campaignId: session?.campaignId,
    runId,
    candidateId: input.candidateId,
    positionId: input.positionId,
    executionIntentId: input.executionIntentId,
    symbol: input.symbol ? input.symbol.toUpperCase() : undefined,
    venue: input.venue,
    eventType: input.eventType,
    timestamp: input.timestamp ?? new Date().toISOString(),
    sourceService: input.sourceService,
    sourceInstanceId: input.sourceInstanceId,
    payload: input.payload,
  };
  eventLog.push(row);
  if (eventLog.length > 50_000) {
    eventLog.splice(0, eventLog.length - 50_000);
  }
  return row;
}

export function getCanonicalEventLog(runId?: string) {
  if (!runId) return [...eventLog];
  return eventLog.filter((row) => row.runId === runId);
}

export function resetCanonicalEventLog() {
  eventLog.length = 0;
}
