export const STALL_ERROR_CODES = {
  AI_TIMEOUT: "AI_TIMEOUT",
  AI_FAILED: "AI_FAILED",
  CONSENSUS_TIMEOUT: "CONSENSUS_TIMEOUT",
  CONSENSUS_FAILED: "CONSENSUS_FAILED",
  PUMP_SCAN_FAILED: "PUMP_SCAN_FAILED",
  SELECTION_TIMEOUT: "SELECTION_TIMEOUT",
  SELECTION_FAILED: "SELECTION_FAILED",
  DB_TIMEOUT: "DB_TIMEOUT",
  DB_TRANSACTION_TIMEOUT: "DB_TRANSACTION_TIMEOUT",
  ROUND_STALLED: "ROUND_STALLED",
  RECOVERY_EXHAUSTED: "RECOVERY_EXHAUSTED",
} as const;

export type StallErrorCode = (typeof STALL_ERROR_CODES)[keyof typeof STALL_ERROR_CODES];

export type StallErrorRecord = {
  stage: string;
  reasonCode: StallErrorCode;
  reasonDetail: string;
  timestamp: string;
  symbol?: string;
  candidateId?: string;
  metadata?: Record<string, unknown>;
};

export function createStallError(input: Omit<StallErrorRecord, "timestamp">): StallErrorRecord {
  return { ...input, timestamp: new Date().toISOString() };
}
