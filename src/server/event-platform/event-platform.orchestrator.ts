import { startReplay } from "@/src/server/event-platform/event-replay.service";
import { processPendingRetries } from "@/src/server/event-platform/retry-engine.service";
import { processDeadLetterQueue } from "@/src/server/event-platform/dead-letter.service";
import { cleanupOldEvents, cleanupResolvedDeadLetters } from "@/src/server/event-platform/event-cleaner.service";
import { bootstrapEventSchemas } from "@/src/server/event-platform/schema-validator.service";
import { syncCheckpoints } from "@/src/server/event-platform/checkpoint.service";
import { captureObservabilitySnapshot } from "@/src/server/event-platform/observability.service";
import type { EventPlatformJobPayload } from "@/src/server/event-platform/event-platform.types";

export async function runEventPlatformJob(payload: EventPlatformJobPayload) {
  switch (payload.type) {
    case "REPLAY":
      return startReplay(payload.scope, payload.filterCriteria);
    case "RETRY":
      return processPendingRetries();
    case "DEAD_LETTER_PROCESS":
      return processDeadLetterQueue();
    case "EVENT_CLEANUP":
      return Promise.all([cleanupOldEvents(payload.retentionDays), cleanupResolvedDeadLetters()]);
    case "SCHEMA_VALIDATE":
      return bootstrapEventSchemas();
    case "CHECKPOINT_SYNC":
      return syncCheckpoints();
    case "OBSERVABILITY_SNAPSHOT":
      return captureObservabilitySnapshot();
    default:
      return { skipped: true };
  }
}
