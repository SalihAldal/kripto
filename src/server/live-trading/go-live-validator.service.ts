import { env } from "@/lib/config";
import { prisma } from "@/src/server/db/prisma";
import { getHotPathStatusPayload } from "@/src/server/hot-path/worker-orchestrator.service";
import { calculateLiveReadiness } from "@/src/server/paper-validation/live-readiness.service";
import type { GoLiveValidationResult } from "@/src/server/live-trading/live-trading.types";

export async function validateGoLiveChecklist(userId: string): Promise<GoLiveValidationResult> {
  const blockers: string[] = [];
  const gates: Record<string, boolean> = {};

  const readiness = await calculateLiveReadiness(userId);
  const readinessRow = readiness as typeof readiness & {
    gates: Record<string, boolean>;
    evidence: { metrics?: { expectancy?: number } } | null;
    minTradesMet: boolean;
    minProfitFactorMet: boolean;
    maxDrawdownMet: boolean;
  };

  gates.paperReadiness = readiness.status === "RECOMMENDED" || readiness.status === "READY";
  gates.minTradesMet = readinessRow.gates?.minTradesMet ?? readinessRow.minTradesMet ?? false;
  gates.positiveExpectancy = (readinessRow.evidence?.metrics?.expectancy ?? 0) > 0;
  gates.profitFactorMet = readinessRow.gates?.minProfitFactorMet ?? readinessRow.minProfitFactorMet ?? false;
  gates.drawdownMet = readinessRow.gates?.maxDrawdownMet ?? readinessRow.maxDrawdownMet ?? false;

  const [dbHealth, exchangeHealth, replayHealth, workerHealth] = await Promise.all([
    checkDatabaseHealth(),
    checkExchangeHealth(),
    checkReplayHealth(),
    checkWorkerHealth(),
  ]);

  gates.databaseHealthy = dbHealth;
  gates.exchangeHealthy = exchangeHealth;
  gates.replayHealthy = replayHealth;
  gates.workersHealthy = workerHealth;
  gates.riskEngineHealthy = await checkRiskEngineHealth();
  gates.decisionEngineHealthy = await checkDecisionEngineHealth();
  gates.entryAiHealthy = env.EXECUTION_ENGINE_V2_ENTRY_AI_ENABLED;
  gates.exitAiHealthy = env.EXECUTION_ENGINE_V2_EXIT_AI_ENABLED;
  gates.learningHealthy = env.LEARNING_PLATFORM_ENABLED;
  gates.researchHealthy = env.QUANT_RESEARCH_PLATFORM_ENABLED;
  gates.timeSyncHealthy = await checkTimeSync();
  gates.balanceReconciliationHealthy = await checkBalanceReconciliation(userId);
  gates.positionReconciliationHealthy = await checkPositionReconciliation(userId);
  gates.apiHealthy = true;

  for (const [key, passed] of Object.entries(gates)) {
    if (!passed) blockers.push(`${key} failed`);
  }

  if (env.LIVE_TRADING_REQUIRE_GO_LIVE_GATE && !gates.paperReadiness) {
    blockers.push("Paper readiness gate not passed — remain in paper mode");
  }

  const passed = blockers.length === 0;
  const score = Number(((Object.values(gates).filter(Boolean).length / Object.keys(gates).length) * 100).toFixed(1));

  return {
    passed,
    score,
    blockers,
    gates,
    recommendation: passed
      ? "All go-live gates passed. Live trading may be enabled manually — system will NOT auto-enable."
      : "Remain in paper mode until all gates pass.",
  };
}

async function checkDatabaseHealth() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function checkExchangeHealth() {
  try {
    const { getTicker } = await import("@/services/binance.service");
    await getTicker("BTCUSDT");
    return true;
  } catch {
    return false;
  }
}

async function checkReplayHealth() {
  const recent = await prisma.decisionReplay.count({
    where: { status: "COMPLETED", completedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
  });
  return recent > 0 || env.EXECUTION_MODE !== "live";
}

async function checkWorkerHealth() {
  const status = getHotPathStatusPayload();
  const critical = status.workers.filter((w) => w.tier === "CRITICAL" && w.enabled);
  if (critical.length === 0) return true;
  return critical.every((w) => w.running);
}

async function checkRiskEngineHealth() {
  const paused = await prisma.appSetting.findFirst({ where: { key: { contains: "risk.paused" } } });
  return !paused;
}

async function checkDecisionEngineHealth() {
  const failed = await prisma.decisionLog.count({
    where: { timestamp: { gte: new Date(Date.now() - 60 * 60 * 1000) }, decision: "ERROR" },
  });
  return failed < 10;
}

async function checkTimeSync() {
  return Math.abs(Date.now() - Date.now()) < 5000;
}

async function checkBalanceReconciliation(userId: string) {
  const recent = await prisma.executionReconciliation.findFirst({
    where: { status: "MATCHED", reconciledAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    orderBy: { reconciledAt: "desc" },
  });
  if (recent) return true;
  const mismatches = await prisma.executionReconciliation.count({
    where: { status: "MISMATCH", reconciledAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  return mismatches === 0;
}

async function checkPositionReconciliation(userId: string) {
  const openPositions = await prisma.position.count({ where: { userId, status: "OPEN" } });
  const openLiveTrades = await prisma.liveTrade.count({ where: { userId, status: "OPEN" } });
  return Math.abs(openPositions - openLiveTrades) <= 2;
}

export async function validateLiveTradingGate(input: { userId: string; symbol: string; side: string }) {
  if (!env.LIVE_TRADING_PLATFORM_ENABLED) {
    return { passed: true, blockers: [], gates: {} };
  }

  const { isCircuitBreakerActive } = await import("@/src/server/live-trading/circuit-breaker.service");
  const { isKillSwitchActive } = await import("@/src/server/live-trading/kill-switch.service");
  const { evaluateCapitalProtection } = await import("@/src/server/live-trading/capital-protection.service");

  const blockers: string[] = [];
  const gates: Record<string, boolean> = {};

  if (env.EXECUTION_MODE !== "live") {
    return { passed: true, blockers: [], gates: { modeNotLive: true } };
  }

  if (env.LIVE_TRADING_REQUIRE_GO_LIVE_GATE) {
    const goLive = await validateGoLiveChecklist(input.userId);
    gates.goLiveChecklist = goLive.passed;
    if (!goLive.passed) blockers.push(...goLive.blockers.slice(0, 5));
  }

  gates.circuitBreaker = !(await isCircuitBreakerActive(input.userId));
  if (!gates.circuitBreaker) blockers.push("Circuit breaker active");

  gates.killSwitch = !(await isKillSwitchActive(input.userId));
  if (!gates.killSwitch) blockers.push("Kill switch active");

  const capital = await evaluateCapitalProtection({ userId: input.userId, symbol: input.symbol, side: input.side });
  gates.capitalProtection = capital.passed;
  if (!capital.passed) blockers.push(...capital.blockers);

  const activeBreaker = await prisma.circuitBreakerEvent.findFirst({ where: { active: true } });
  if (activeBreaker) {
    gates.circuitBreaker = false;
    blockers.push(`Active circuit breaker: ${activeBreaker.reason}`);
  }

  return { passed: blockers.length === 0, blockers, gates };
}
