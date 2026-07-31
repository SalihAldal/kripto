-- CreateEnum
CREATE TYPE "EventPlatformJobType" AS ENUM ('REPLAY', 'RETRY', 'DEAD_LETTER_PROCESS', 'EVENT_CLEANUP', 'SCHEMA_VALIDATE', 'CHECKPOINT_SYNC', 'OBSERVABILITY_SNAPSHOT');
CREATE TYPE "MessageBrokerType" AS ENUM ('RABBITMQ', 'KAFKA', 'REDIS_STREAMS', 'NATS', 'AZURE_SERVICE_BUS', 'AWS_SQS', 'GOOGLE_PUBSUB', 'IN_MEMORY');
CREATE TYPE "EventPriority" AS ENUM ('CRITICAL', 'HIGH', 'NORMAL', 'LOW', 'DEFERRED');
CREATE TYPE "AggregateType" AS ENUM ('TRADE', 'DECISION', 'PORTFOLIO', 'RISK', 'LEARNING', 'REPLAY', 'EXECUTION', 'META_AI', 'FUSION', 'SCANNER', 'MARKET', 'NEWS', 'WHALE', 'ONCHAIN', 'PLATFORM');
CREATE TYPE "PlatformModuleType" AS ENUM ('SCANNER', 'DECISION', 'RISK', 'EXECUTION', 'PORTFOLIO', 'LEARNING', 'RESEARCH', 'GOVERNANCE', 'META_AI', 'FUSION', 'EXCHANGE', 'EVENT_PLATFORM', 'INFRASTRUCTURE');
CREATE TYPE "ReplayScope" AS ENUM ('DAY', 'WEEK', 'MONTH', 'COIN', 'TRADE', 'DECISION', 'PORTFOLIO', 'PLATFORM');
CREATE TYPE "SagaStatus" AS ENUM ('STARTED', 'RUNNING', 'COMPLETED', 'FAILED', 'COMPENSATING', 'COMPENSATED');
CREATE TYPE "DeadLetterReason" AS ENUM ('FAILED', 'EXPIRED', 'INVALID', 'DUPLICATE', 'RETRY_EXHAUSTED');

CREATE TABLE "EventStore" (
    "id" TEXT NOT NULL, "eventId" TEXT NOT NULL, "correlationId" TEXT NOT NULL, "causationId" TEXT,
    "aggregateId" TEXT NOT NULL, "aggregateType" "AggregateType" NOT NULL, "eventType" TEXT NOT NULL,
    "sourceModule" "PlatformModuleType" NOT NULL, "targetModule" "PlatformModuleType",
    "schemaVersion" INTEGER NOT NULL DEFAULT 1, "environment" TEXT NOT NULL DEFAULT 'production',
    "priority" "EventPriority" NOT NULL DEFAULT 'NORMAL', "payload" JSONB NOT NULL,
    "signature" TEXT, "sequenceNumber" BIGINT NOT NULL DEFAULT 0, "partitionKey" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventStore_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventMetadata" (
    "id" TEXT NOT NULL, "eventStoreId" TEXT NOT NULL, "traceId" TEXT, "spanId" TEXT, "userId" TEXT,
    "idempotencyKey" TEXT, "processed" BOOLEAN NOT NULL DEFAULT false, "processedAt" TIMESTAMP(3),
    "consumerId" TEXT, "retryCount" INTEGER NOT NULL DEFAULT 0, "tags" TEXT[],
    "headers" JSONB, "checksum" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventMetadata_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventReplay" (
    "id" TEXT NOT NULL, "replayKey" TEXT NOT NULL, "scope" "ReplayScope" NOT NULL,
    "filterCriteria" JSONB, "fromTimestamp" TIMESTAMP(3), "toTimestamp" TIMESTAMP(3),
    "eventCount" INTEGER NOT NULL DEFAULT 0, "processedCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING', "speed" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventReplay_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeadLetterEvent" (
    "id" TEXT NOT NULL, "dlqKey" TEXT NOT NULL, "originalEventId" TEXT NOT NULL, "eventType" TEXT NOT NULL,
    "reason" "DeadLetterReason" NOT NULL, "payload" JSONB NOT NULL, "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0, "resolved" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "DeadLetterEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RetryEvent" (
    "id" TEXT NOT NULL, "retryKey" TEXT NOT NULL, "originalEventId" TEXT NOT NULL, "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL, "attempt" INTEGER NOT NULL DEFAULT 0, "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextRetryAt" TIMESTAMP(3) NOT NULL, "backoffMs" INTEGER NOT NULL DEFAULT 1000,
    "status" TEXT NOT NULL DEFAULT 'PENDING', "lastError" TEXT, "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RetryEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventTimeline" (
    "id" TEXT NOT NULL, "timelineKey" TEXT NOT NULL, "timelineType" TEXT NOT NULL,
    "aggregateId" TEXT, "aggregateType" "AggregateType", "title" TEXT NOT NULL,
    "entries" JSONB NOT NULL, "entryCount" INTEGER NOT NULL DEFAULT 0,
    "fromTimestamp" TIMESTAMP(3), "toTimestamp" TIMESTAMP(3), "metadata" JSONB,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventTimeline_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventSchema" (
    "id" TEXT NOT NULL, "schemaKey" TEXT NOT NULL, "eventType" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
    "schema" JSONB NOT NULL, "backwardCompat" BOOLEAN NOT NULL DEFAULT true,
    "forwardCompat" BOOLEAN NOT NULL DEFAULT true, "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventSchema_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConsumerCheckpoint" (
    "id" TEXT NOT NULL, "consumerId" TEXT NOT NULL, "pluginType" "PlatformModuleType" NOT NULL,
    "partitionKey" TEXT NOT NULL DEFAULT 'default', "lastEventId" TEXT,
    "lastSequence" BIGINT NOT NULL DEFAULT 0, "lag" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE', "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConsumerCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SagaInstance" (
    "id" TEXT NOT NULL, "sagaKey" TEXT NOT NULL, "sagaType" TEXT NOT NULL, "correlationId" TEXT NOT NULL,
    "currentStep" TEXT NOT NULL, "status" "SagaStatus" NOT NULL DEFAULT 'STARTED',
    "steps" JSONB NOT NULL, "context" JSONB, "compensation" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3), "metadata" JSONB,
    CONSTRAINT "SagaInstance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModulePluginRegistration" (
    "id" TEXT NOT NULL, "pluginKey" TEXT NOT NULL, "moduleType" "PlatformModuleType" NOT NULL,
    "displayName" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true,
    "subscribedEvents" TEXT[], "publishedEvents" TEXT[], "consumerId" TEXT,
    "metadata" JSONB, "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ModulePluginRegistration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventObservabilitySnapshot" (
    "id" TEXT NOT NULL, "snapshotKey" TEXT NOT NULL, "eventRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "consumerLag" INTEGER NOT NULL DEFAULT 0, "queueLength" INTEGER NOT NULL DEFAULT 0,
    "avgProcessingMs" DOUBLE PRECISION NOT NULL DEFAULT 0, "failureCount" INTEGER NOT NULL DEFAULT 0,
    "replaySpeed" DOUBLE PRECISION, "workerHealth" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "brokerType" "MessageBrokerType" NOT NULL DEFAULT 'REDIS_STREAMS', "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventObservabilitySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventPlatformJobState" (
    "id" TEXT NOT NULL, "jobType" "EventPlatformJobType" NOT NULL,
    "lastProcessedAt" TIMESTAMP(3), "status" TEXT NOT NULL DEFAULT 'IDLE', "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventPlatformJobState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventStore_eventId_key" ON "EventStore"("eventId");
CREATE INDEX "EventStore_aggregateType_aggregateId_publishedAt_idx" ON "EventStore"("aggregateType", "aggregateId", "publishedAt");
CREATE INDEX "EventStore_eventType_publishedAt_idx" ON "EventStore"("eventType", "publishedAt");
CREATE INDEX "EventStore_correlationId_idx" ON "EventStore"("correlationId");
CREATE INDEX "EventStore_sourceModule_publishedAt_idx" ON "EventStore"("sourceModule", "publishedAt");
CREATE INDEX "EventStore_partitionKey_sequenceNumber_idx" ON "EventStore"("partitionKey", "sequenceNumber");

CREATE UNIQUE INDEX "EventMetadata_eventStoreId_key" ON "EventMetadata"("eventStoreId");
CREATE INDEX "EventMetadata_idempotencyKey_idx" ON "EventMetadata"("idempotencyKey");
CREATE INDEX "EventMetadata_processed_createdAt_idx" ON "EventMetadata"("processed", "createdAt");

CREATE UNIQUE INDEX "EventReplay_replayKey_key" ON "EventReplay"("replayKey");
CREATE INDEX "EventReplay_status_createdAt_idx" ON "EventReplay"("status", "createdAt");
CREATE INDEX "EventReplay_scope_createdAt_idx" ON "EventReplay"("scope", "createdAt");

CREATE UNIQUE INDEX "DeadLetterEvent_dlqKey_key" ON "DeadLetterEvent"("dlqKey");
CREATE INDEX "DeadLetterEvent_reason_resolved_createdAt_idx" ON "DeadLetterEvent"("reason", "resolved", "createdAt");
CREATE INDEX "DeadLetterEvent_originalEventId_idx" ON "DeadLetterEvent"("originalEventId");

CREATE UNIQUE INDEX "RetryEvent_retryKey_key" ON "RetryEvent"("retryKey");
CREATE INDEX "RetryEvent_status_nextRetryAt_idx" ON "RetryEvent"("status", "nextRetryAt");
CREATE INDEX "RetryEvent_originalEventId_idx" ON "RetryEvent"("originalEventId");

CREATE UNIQUE INDEX "EventTimeline_timelineKey_key" ON "EventTimeline"("timelineKey");
CREATE INDEX "EventTimeline_timelineType_generatedAt_idx" ON "EventTimeline"("timelineType", "generatedAt");
CREATE INDEX "EventTimeline_aggregateType_aggregateId_idx" ON "EventTimeline"("aggregateType", "aggregateId");

CREATE UNIQUE INDEX "EventSchema_schemaKey_key" ON "EventSchema"("schemaKey");
CREATE UNIQUE INDEX "EventSchema_eventType_key" ON "EventSchema"("eventType");
CREATE INDEX "EventSchema_eventType_version_idx" ON "EventSchema"("eventType", "version");

CREATE UNIQUE INDEX "ConsumerCheckpoint_consumerId_pluginType_partitionKey_key" ON "ConsumerCheckpoint"("consumerId", "pluginType", "partitionKey");
CREATE INDEX "ConsumerCheckpoint_pluginType_status_idx" ON "ConsumerCheckpoint"("pluginType", "status");

CREATE UNIQUE INDEX "SagaInstance_sagaKey_key" ON "SagaInstance"("sagaKey");
CREATE INDEX "SagaInstance_status_startedAt_idx" ON "SagaInstance"("status", "startedAt");
CREATE INDEX "SagaInstance_correlationId_idx" ON "SagaInstance"("correlationId");

CREATE UNIQUE INDEX "ModulePluginRegistration_pluginKey_key" ON "ModulePluginRegistration"("pluginKey");
CREATE UNIQUE INDEX "ModulePluginRegistration_moduleType_key" ON "ModulePluginRegistration"("moduleType");

CREATE UNIQUE INDEX "EventObservabilitySnapshot_snapshotKey_key" ON "EventObservabilitySnapshot"("snapshotKey");
CREATE INDEX "EventObservabilitySnapshot_recordedAt_idx" ON "EventObservabilitySnapshot"("recordedAt");

CREATE UNIQUE INDEX "EventPlatformJobState_jobType_key" ON "EventPlatformJobState"("jobType");

ALTER TABLE "EventMetadata" ADD CONSTRAINT "EventMetadata_eventStoreId_fkey" FOREIGN KEY ("eventStoreId") REFERENCES "EventStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
