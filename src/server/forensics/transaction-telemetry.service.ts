import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import { STALL_ERROR_CODES } from "@/src/server/forensics/stall-error-taxonomy";

export type TransactionDurationClass = "NORMAL" | "SLOW" | "TIMEOUT";

export type TransactionDurationRecord = {
  operation: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  outcome: "commit" | "rollback";
  queryCount?: number;
  classification: TransactionDurationClass;
  errorType?: string;
  reasonDetail?: string;
};

const transactionLog: TransactionDurationRecord[] = [];
const SLOW_MS = 2_000;
const TIMEOUT_MS = 8_000;

function classify(durationMs: number, errorType?: string): TransactionDurationClass {
  if (errorType?.includes("timeout") || errorType === STALL_ERROR_CODES.DB_TRANSACTION_TIMEOUT) return "TIMEOUT";
  if (durationMs >= TIMEOUT_MS) return "TIMEOUT";
  if (durationMs >= SLOW_MS) return "SLOW";
  return "NORMAL";
}

export function recordTransactionDuration(record: TransactionDurationRecord) {
  transactionLog.push(record);
  if (transactionLog.length > 500) transactionLog.shift();
  return record;
}

export function getTransactionDurationLog(limit = 100) {
  return transactionLog.slice(-limit);
}

export async function runInstrumentedTransaction<T>(
  operation: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { timeoutMs?: number; maxWaitMs?: number },
): Promise<T> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const timeoutMs = options?.timeoutMs ?? TIMEOUT_MS;
  const maxWaitMs = options?.maxWaitMs ?? 5_000;
  try {
    const result = await prisma.$transaction(fn, { timeout: timeoutMs, maxWait: maxWaitMs });
    recordTransactionDuration({
      operation,
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      outcome: "commit",
      classification: classify(Date.now() - started),
    });
    return result;
  } catch (error) {
    const message = (error as Error).message;
    const errorType = message.toLowerCase().includes("timeout")
      ? STALL_ERROR_CODES.DB_TRANSACTION_TIMEOUT
      : STALL_ERROR_CODES.DB_TIMEOUT;
    recordTransactionDuration({
      operation,
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      outcome: "rollback",
      classification: classify(Date.now() - started, errorType),
      errorType,
      reasonDetail: message,
    });
    throw error;
  }
}

export function writeTransactionDurationArtifact(input: { sessionId: string; roundId: string }) {
  const root = path.join(process.cwd(), "artifacts", "forensics", input.sessionId, "rounds", input.roundId);
  mkdirSync(root, { recursive: true });
  const filePath = path.join(root, "transaction-duration.json");
  writeFileSync(
    filePath,
    `${JSON.stringify({ records: getTransactionDurationLog(100), generatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
  return filePath;
}

export function resetTransactionTelemetry() {
  transactionLog.length = 0;
}
