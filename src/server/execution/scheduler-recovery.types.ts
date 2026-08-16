import type { AtomicSpawnResult } from "@/src/server/execution/scheduler-ownership.types";
import type { RoundProgressAssessment } from "@/src/server/execution/round-progress-state.service";

export type RecoveryFailureKind =
  | "SCHEDULER_CRASH"
  | "WORKER_CRASH"
  | "SCHEDULER_LEASE_STALE"
  | "RUNTIME_STALL"
  | "HEARTBEAT_LOSS"
  | "SCANNER_FAILURE"
  | "AI_TIMEOUT"
  | "DISCOVERY_TIMEOUT"
  | "DATABASE_DISCONNECT"
  | "NETWORK_INTERRUPTION"
  | "REGISTRY_INTEGRITY"
  | "WAITING_RUN_OVERDUE"
  | "LEASE_HELD_BY_PEER";

export type RecoveryActionKind =
  | "RESUME"
  | "RETRY"
  | "RESTART_CURRENT_STAGE"
  | "RESTART_CURRENT_ROUND"
  | "FAIL_CURRENT_ROUND"
  | "CONTINUE_NEXT_ROUND"
  | "STOP_JOB"
  | "NO_ACTION"
  | "RECONCILE";

export type RecoveryOperator = "automatic" | "manual";

export type RecoveryComponent =
  | "scheduler"
  | "runtime"
  | "round_ownership"
  | "heartbeat"
  | "scanner"
  | "ai"
  | "database"
  | "watchdog"
  | "recovery_manager"
  | "lease"
  | "registry";

export type RecoveryHealthIssue = {
  component: RecoveryComponent;
  failure: RecoveryFailureKind;
  severity: "info" | "warn" | "critical";
  message: string;
  evidence?: Record<string, unknown>;
};

export type RecoveryPolicyDecision = {
  action: RecoveryActionKind;
  reason: string;
  failure: RecoveryFailureKind;
  component: RecoveryComponent;
  escalationLevel: number;
  safeResume: boolean;
};

export type RecoveryAuditEvent = {
  id: string;
  timestamp: string;
  jobId: string;
  component: RecoveryComponent;
  failure: RecoveryFailureKind;
  decision: RecoveryPolicyDecision;
  action: RecoveryActionKind;
  result: "success" | "failure" | "skipped" | "partial";
  durationMs: number;
  operator: RecoveryOperator;
  trigger: "watchdog" | "manual" | "startup" | "status_poll" | "fault_injection";
  message?: string;
  evidence?: Record<string, unknown>;
};

export type RecoveryState = {
  recoveryCount: number;
  recoverySuccess: number;
  recoveryFailure: number;
  lastRecoveryAt: string | null;
  lastCause: RecoveryFailureKind | null;
  lastDurationMs: number;
  escalationLevel: number;
  windowStartedAt: string;
};

export type RecoveryProgressTelemetry = {
  roundId?: string;
  stage?: string;
  progressState: string;
  recoveryDecision: string;
  reasonCode: string;
  reasonDetail?: string;
  recoveryCount: number;
  lastProgressAt?: string | null;
  heartbeatAt?: string | null;
  elapsedMs: number;
  selectionBudgetMs: number;
  stallElapsedMs: number;
  selectionBudgetRemainingMs: number;
};

export type JobHealthEvaluation = {
  jobId: string;
  jobStatus: string;
  issues: RecoveryHealthIssue[];
  score: number;
  canRecover: boolean;
  hasLocalLoop: boolean;
  hasLiveLease: boolean;
  leaseOwnerId: string | null;
  activeRunId: string | null;
  activeRunRoundNo?: number | null;
  progressAssessment?: RoundProgressAssessment | null;
  progressTelemetry?: RecoveryProgressTelemetry | null;
  recoveryState: RecoveryState;
};

export type ProductionHealthSnapshot = {
  generatedAt: string;
  overallScore: number;
  schedulerHealth: number;
  runtimeHealth: number;
  recoveryHealth: number;
  watchdogHealth: number;
  scannerHealth: number;
  aiHealth: number;
  databaseHealth: number;
  ownershipHealth: number;
  heartbeatHealth: number;
  leaseHealth: number;
  registryHealth: number;
  jobs: JobHealthEvaluation[];
  watchdog: {
    activeCount: number;
    entries: Array<{ jobId: string; ownerId: string; startedAt: string; tickCount: number }>;
  };
  recoveryManager: {
    processOwnerId: string;
    pendingRecoveries: number;
  };
};

export type SchedulerRecoveryResult = {
  jobId: string;
  action: RecoveryActionKind;
  result: RecoveryAuditEvent["result"];
  decision: RecoveryPolicyDecision;
  spawn?: AtomicSpawnResult;
  auditEvent: RecoveryAuditEvent;
  skipped?: boolean;
  reason?: string;
};

export type SchedulerRecoveryDeps = {
  spawnScheduler: (jobId: string) => Promise<AtomicSpawnResult>;
  reconcileStaleWaitingRuns: (jobId: string) => Promise<void>;
  recoverRoundRegistry: (input: {
    jobId: string;
    ownerId: string;
    runs: Array<{
      id: string;
      roundNo: number;
      state: string;
      startedAt: Date;
      endedAt: Date | null;
      metadata: unknown;
    }>;
  }) => void;
  cancelRoundSelection: (jobId: string) => void;
  stopJob: (jobId: string, reason: string) => Promise<void>;
  failActiveRound?: (jobId: string, reason: string) => Promise<void>;
};
