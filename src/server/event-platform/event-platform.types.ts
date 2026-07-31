import type {
  AggregateType,
  DeadLetterReason,
  EventPlatformJobType,
  EventPriority,
  MessageBrokerType,
  PlatformModuleType,
  ReplayScope,
  SagaStatus,
} from "@prisma/client";

export type EventPlatformJobPayload =
  | { type: "REPLAY"; scope?: ReplayScope; filterCriteria?: Record<string, unknown> }
  | { type: "RETRY" }
  | { type: "DEAD_LETTER_PROCESS" }
  | { type: "EVENT_CLEANUP"; retentionDays?: number }
  | { type: "SCHEMA_VALIDATE" }
  | { type: "CHECKPOINT_SYNC" }
  | { type: "OBSERVABILITY_SNAPSHOT" };

export type CanonicalEvent = {
  eventId: string;
  correlationId: string;
  causationId?: string;
  aggregateId: string;
  aggregateType: AggregateType;
  eventType: string;
  sourceModule: PlatformModuleType;
  targetModule?: PlatformModuleType;
  timestamp: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  schemaVersion: number;
  environment: string;
  priority?: EventPriority;
  idempotencyKey?: string;
  partitionKey?: string;
};

export type PublishOptions = {
  priority?: EventPriority;
  delayMs?: number;
  idempotencyKey?: string;
  causationId?: string;
  targetModule?: PlatformModuleType;
  partitionKey?: string;
  schemaVersion?: number;
};

export type SubscribeFilter = {
  eventTypes?: string[];
  sourceModules?: PlatformModuleType[];
  aggregateTypes?: AggregateType[];
  aggregateId?: string;
};

export type EventHandler = (event: CanonicalEvent) => void | Promise<void>;

export const DOMAIN_EVENTS = {
  SCANNER_COMPLETED: "ScannerCompleted",
  SCANNER_FAILED: "ScannerFailed",
  MARKET_SNAPSHOT_CREATED: "MarketSnapshotCreated",
  NEWS_RECEIVED: "NewsReceived",
  WHALE_DETECTED: "WhaleDetected",
  ONCHAIN_UPDATED: "OnChainUpdated",
  FUSION_UPDATED: "FusionUpdated",
  DECISION_CREATED: "DecisionCreated",
  DECISION_REJECTED: "DecisionRejected",
  RISK_APPROVED: "RiskApproved",
  RISK_REJECTED: "RiskRejected",
  EXECUTION_REQUESTED: "ExecutionRequested",
  EXECUTION_COMPLETED: "ExecutionCompleted",
  EXECUTION_FAILED: "ExecutionFailed",
  PORTFOLIO_UPDATED: "PortfolioUpdated",
  REPLAY_COMPLETED: "ReplayCompleted",
  LEARNING_COMPLETED: "LearningCompleted",
  RESEARCH_COMPLETED: "ResearchCompleted",
  META_ANALYSIS_COMPLETED: "MetaAnalysisCompleted",
} as const;

export const INFRASTRUCTURE_EVENTS = {
  WORKER_STARTED: "WorkerStarted",
  WORKER_STOPPED: "WorkerStopped",
  QUEUE_OVERFLOW: "QueueOverflow",
  CACHE_MISS: "CacheMiss",
  CACHE_HIT: "CacheHit",
  DATABASE_SLOW_QUERY: "DatabaseSlowQuery",
  API_TIMEOUT: "ApiTimeout",
  RECONNECT: "Reconnect",
  RATE_LIMIT: "RateLimit",
  HEALTH_CHANGED: "HealthChanged",
} as const;

export const ALL_EVENT_TYPES = { ...DOMAIN_EVENTS, ...INFRASTRUCTURE_EVENTS };

export const PLATFORM_EVENT = {
  EVENT_PUBLISHED: "PlatformEventPublished",
  EVENT_REPLAYED: "PlatformEventReplayed",
  EVENT_FAILED: "PlatformEventFailed",
  DLQ_ADDED: "DeadLetterAdded",
  RETRY_SCHEDULED: "RetryScheduled",
  SAGA_STARTED: "SagaStarted",
  SAGA_COMPLETED: "SagaCompleted",
  SAGA_FAILED: "SagaFailed",
  CHECKPOINT_UPDATED: "CheckpointUpdated",
  PLUGIN_REGISTERED: "PluginRegistered",
} as const;

export type { AggregateType, DeadLetterReason, EventPlatformJobType, EventPriority, MessageBrokerType, PlatformModuleType, ReplayScope, SagaStatus };
