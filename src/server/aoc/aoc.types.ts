import type {
  AlertChannel,
  AlertSeverity,
  AnomalyType,
  AocJobType,
  IncidentSeverity,
  IncidentStatus,
  RecoveryActionType,
} from "@prisma/client";

export type AocJobPayload =
  | { type: "PLATFORM_HEALTH" }
  | { type: "TRADING_HEALTH" }
  | { type: "INFRASTRUCTURE_MONITOR" }
  | { type: "EXCHANGE_MONITOR" }
  | { type: "QUEUE_MONITOR" }
  | { type: "ANOMALY_DETECT" }
  | { type: "SELF_HEAL" }
  | { type: "ALERT_DISPATCH" }
  | { type: "INCIDENT_PROCESS" }
  | { type: "HEALTH_SCORES" }
  | { type: "DEPENDENCY_MAP" }
  | { type: "KPI_MONITOR" }
  | { type: "AI_HEALTH" };

export const AOC_EVENT = {
  HEALTH_RECORDED: "AocHealthRecorded",
  ANOMALY_DETECTED: "AocAnomalyDetected",
  INCIDENT_OPENED: "AocIncidentOpened",
  INCIDENT_RESOLVED: "AocIncidentResolved",
  ALERT_SENT: "AocAlertSent",
  RECOVERY_EXECUTED: "AocRecoveryExecuted",
  SELF_HEAL_TRIGGERED: "AocSelfHealTriggered",
  SCORES_CALCULATED: "AocScoresCalculated",
  AUDIT_LOGGED: "AocAuditLogged",
} as const;

export type HealthSnapshot = {
  score: number;
  details?: Record<string, unknown>;
};

export type AlertPayload = {
  severity: AlertSeverity;
  channel?: AlertChannel;
  title: string;
  message: string;
  incidentId?: string;
};

export type RecoveryPlan = {
  actionType: RecoveryActionType;
  target: string;
  incidentId?: string;
};

export type { AlertChannel, AlertSeverity, AnomalyType, AocJobType, IncidentSeverity, IncidentStatus, RecoveryActionType };
