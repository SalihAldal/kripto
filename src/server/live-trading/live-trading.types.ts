import type {
  CircuitBreakerReason,
  KillSwitchSource,
  LiveAlertChannel,
  LiveAlertSeverity,
  LiveTradingJobType,
  ProductionReportCadence,
} from "@prisma/client";

export type LiveTradingJobPayload =
  | { type: "HEALTH_MONITOR"; userId?: string }
  | { type: "POSITION_RECOVERY"; userId?: string }
  | { type: "RECONCILIATION"; userId?: string }
  | { type: "EXECUTION_AUDIT"; userId?: string; limit?: number }
  | { type: "ALERT_DISPATCH"; limit?: number }
  | { type: "CIRCUIT_BREAKER_CHECK"; userId?: string }
  | { type: "KILL_SWITCH_MONITOR" }
  | { type: "PRODUCTION_REPORT"; userId?: string; cadence?: ProductionReportCadence }
  | { type: "GO_LIVE_VALIDATE"; userId?: string };

export type GoLiveValidationResult = {
  passed: boolean;
  score: number;
  blockers: string[];
  gates: Record<string, boolean>;
  recommendation: string;
};

export type LiveGateResult = {
  passed: boolean;
  blockers: string[];
  gates: Record<string, boolean>;
};

export type CapitalProtectionCheck = {
  passed: boolean;
  blockers: string[];
  state: Record<string, unknown>;
};

export const LIVE_TRADING_EVENT = {
  GATE_BLOCKED: "LiveGateBlocked",
  EXECUTION_RECORDED: "LiveExecutionRecorded",
  CIRCUIT_BREAKER_TRIGGERED: "CircuitBreakerTriggered",
  KILL_SWITCH_ACTIVATED: "KillSwitchActivated",
  RECONCILIATION_MISMATCH: "ReconciliationMismatch",
  GO_LIVE_VALIDATED: "GoLiveValidated",
} as const;

export type { CircuitBreakerReason, KillSwitchSource, LiveAlertChannel, LiveAlertSeverity, LiveTradingJobType, ProductionReportCadence };
