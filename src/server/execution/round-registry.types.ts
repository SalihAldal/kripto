export type RoundLifecycleStatus =
  | "ROUND_CREATED"
  | "OWNERSHIP_ACQUIRED"
  | "SELECTION_RUNNING"
  | "EXECUTION_RUNNING"
  | "ROUND_COMPLETED"
  | "ROUND_FAILED"
  | "OWNERSHIP_RELEASED";

export type RoundOwnershipRecord = {
  jobId: string;
  roundNo: number;
  roundOwner: string;
  runId: string;
  status: RoundLifecycleStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type RoundRegistrySnapshot = {
  entries: RoundOwnershipRecord[];
  activeCount: number;
};

export type AcquireRoundOwnershipResult = {
  action: "acquired" | "attached" | "rejected";
  record: RoundOwnershipRecord | null;
  reason?: string;
};

export type RoundRegistryRecoveryReport = {
  rebuilt: number;
  orphansFailed: number;
  duplicatesConsolidated: number;
  staleReleased: number;
};
