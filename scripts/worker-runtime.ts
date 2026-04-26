import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { validateStartupConfig } from "@/src/server/startup/validate-startup";
import { ensureScannerWorkerStarted, getScannerWorkerState } from "@/src/server/scanner/scanner-worker.service";
import { markHeartbeat } from "@/src/server/observability/heartbeat";

async function startWorker() {
  validateStartupConfig();
  const scannerState = ensureScannerWorkerStarted();
  logger.info(
    {
      appEnv: env.APP_ENV,
      scannerRunning: scannerState.running,
      intervalMs: scannerState.intervalMs,
    },
    "Background worker booted",
  );
  markHeartbeat({
    service: "background-worker",
    status: "UP",
    message: "Background worker started",
  });

  // Process manager (PM2/Docker) process'i alive tuttugu surece worker aktif kalir.
  setInterval(() => {
    const state = getScannerWorkerState();
    logger.debug(
      {
        running: state.running,
        lastRunAt: state.lastRunAt,
        lastRunOk: state.lastRunOk,
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
