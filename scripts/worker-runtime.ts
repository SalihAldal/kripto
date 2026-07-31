import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { validateStartupConfig } from "@/src/server/startup/validate-startup";
import {
  bootHotPathWorkers,
  collectWorkerHeartbeatSnapshots,
  getHotPathWorkerBootResult,
} from "@/src/server/hot-path/worker-orchestrator.service";
import { markHeartbeat } from "@/src/server/observability/heartbeat";

async function startWorker() {
  validateStartupConfig();
  const bootResult = await bootHotPathWorkers();

  logger.info(
    {
      appEnv: env.APP_ENV,
      appRole: env.APP_ROLE,
      hotPathFreezeEnabled: bootResult.freezeEnabled,
      legacyWorkersEnabled: bootResult.legacyWorkersEnabled,
      activeWorkerCount: bootResult.activeCount,
      frozenWorkerCount: bootResult.frozenCount,
      workers: bootResult.workers,
    },
    "Background worker booted",
  );

  markHeartbeat({
    service: "background-worker",
    status: "UP",
    message: "Background worker started",
    details: {
      activeWorkerCount: bootResult.activeCount,
      frozenWorkerCount: bootResult.frozenCount,
      hotPathFreezeEnabled: bootResult.freezeEnabled,
    },
  });

  setInterval(() => {
    const boot = getHotPathWorkerBootResult();
    const workers = collectWorkerHeartbeatSnapshots();
    logger.debug(
      {
        hotPathFreezeEnabled: boot?.freezeEnabled ?? env.HOT_PATH_V2_FREEZE_ENABLED,
        activeWorkerCount: workers.filter((w) => w.enabled && w.running).length,
        frozenWorkerCount: workers.filter((w) => !w.enabled).length,
        workers,
      },
      "Background worker heartbeat",
    );
  }, 30_000);
}

void startWorker().catch((error) => {
  logger.error({ error: (error as Error).message }, "Background worker crashed on startup");
  process.exit(1);
});

process.on("SIGINT", () => {
  logger.warn("Background worker stopped by SIGINT");
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.warn("Background worker stopped by SIGTERM");
  process.exit(0);
});
