import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { markHeartbeat } from "@/src/server/observability/heartbeat";
import { runRestartRecovery } from "@/src/server/recovery/failsafe-recovery.service";

let validated = false;

export function validateStartupConfig() {
  if (validated) return;

  const issues: string[] = [];
  const warnings: string[] = [];
  const strictMode = env.STARTUP_STRICT_ENV || env.APP_ENV === "stage" || env.APP_ENV === "prod";
  if (!env.DATABASE_URL) issues.push("DATABASE_URL is missing");
  if (!env.REDIS_URL) issues.push("REDIS_URL is missing");
  if (!env.APP_TOKEN && env.NODE_ENV === "production") {
    issues.push("APP_TOKEN should be set in production");
  }
  if (!env.APP_TOKEN_NEXT && env.NODE_ENV === "production") {
    warnings.push("APP_TOKEN_NEXT is missing; token rotation fallback disabled");
  }
  if (!env.APP_ENCRYPTION_KEY && env.NODE_ENV === "production") {
    issues.push("APP_ENCRYPTION_KEY is required in production");
  }
  if (!env.NEXT_PUBLIC_API_BASE_URL && (env.APP_ENV === "stage" || env.APP_ENV === "prod")) {
    issues.push("NEXT_PUBLIC_API_BASE_URL is required in stage/prod");
  }
  if (env.APP_ENV !== "dev" && env.NODE_ENV !== "production") {
    issues.push("APP_ENV stage/prod requires NODE_ENV=production");
  }
  if (env.EXECUTION_MODE === "live" && (!env.BINANCE_API_KEY || !env.BINANCE_API_SECRET)) {
    issues.push("Live mode requires BINANCE_API_KEY and BINANCE_API_SECRET");
  }

  if (issues.length > 0 || warnings.length > 0) {
    markHeartbeat({
      service: "startup",
      status: issues.length > 0 ? "DEGRADED" : "UP",
      message: issues.length > 0 ? "Startup validation has issues" : "Startup validation has warnings",
      details: { issues, warnings, strictMode },
    });
    logger.warn({ issues, warnings, strictMode }, "Startup config validation result");
  } else {
    markHeartbeat({ service: "startup", status: "UP", message: "Startup config validated" });
  }

  if (strictMode && issues.length > 0) {
    throw new Error(`Startup validation failed: ${issues.join(" | ")}`);
  }

  validated = true;
  void runRestartRecovery().catch((error) => {
    logger.warn({ error: (error as Error).message }, "Startup recovery reconcile skipped");
  });
}
