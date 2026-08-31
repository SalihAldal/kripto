export type HotPathStageId =
  | "MARKET_DATA"
  | "DISCOVERY"
  | "DECISION"
  | "ENTRY"
  | "SAFETY"
  | "EXECUTION"
  | "EXIT"
  | "PNL";

export type HotPathStageStatus = "CONNECTED" | "PARTIAL" | "MISSING" | "NOT_WIRED";

export type HotPathStageDefinition = {
  id: HotPathStageId;
  label: string;
  description: string;
  modulePaths: string[];
  integrationPaths: string[];
};

export type HotPathStageAudit = {
  id: HotPathStageId;
  label: string;
  status: HotPathStageStatus;
  modulesPresent: string[];
  modulesMissing: string[];
  integrationSignals: Array<{ path: string; pattern: string; found: boolean }>;
  gaps: string[];
};

export type WorkerTier = "CRITICAL" | "SUPPORTING" | "OBSERVE_ONLY";

export type WorkerRuntimeClass = "CANONICAL" | "LEGACY" | "SHADOW_ONLY" | "RESEARCH_ONLY" | "DISABLED";

export type LegacyWorkerDefinition = {
  id: string;
  label: string;
  tier: WorkerTier;
  queueName?: string;
  profitImpact: "direct" | "indirect" | "none";
  runtimeClass?: WorkerRuntimeClass;
  ownership?: string;
};

export type WorkerRuntimeSnapshot = {
  id: string;
  label: string;
  tier: WorkerTier;
  enabled: boolean;
  running: boolean;
  skippedReason?: string;
};

export type HotPathAuditResult = {
  auditKey: string;
  overallStatus: "PASS" | "WARN" | "FAIL";
  generatedAt: string;
  stages: HotPathStageAudit[];
  integrationGaps: string[];
  workerPolicy: {
    freezeEnabled: boolean;
    legacyWorkersEnabled: boolean;
    maxCriticalWorkers: number;
    activeWorkerCount: number;
    frozenWorkerCount: number;
  };
  workers: WorkerRuntimeSnapshot[];
};

export type HotPathWorkerBootResult = {
  workers: WorkerRuntimeSnapshot[];
  activeCount: number;
  frozenCount: number;
  freezeEnabled: boolean;
  legacyWorkersEnabled: boolean;
};
