import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "@/src/server/db/prisma";
import { addTradeLifecycleEvent } from "@/src/server/repositories/trade-lifecycle.repository";
import { recordPaperFillEvent } from "@/src/server/paper-validation/paper-trade-recorder.service";
import { resolveExecutionAdapter } from "@/src/server/paper-runtime/execution-port";

async function main() {
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) throw new Error("P0_SMOKE_USER_MISSING");

  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const campaignId = `cmp:p0-execution-smoke:${suffix}`;
  const jobId = `job:${suffix}`;
  const sessionId = `session:${suffix}`;
  const runId = `run:${suffix}`;
  const roundId = "fixture-round-1";
  const candidateId = `candidate:${suffix}`;
  const executionId = `execution:${suffix}`;
  const simulationId = `simulation:${suffix}`;
  const symbol = "BTCTRY";
  let liveSubmissionCount = 0;

  const identity = {
    campaignId,
    jobId,
    sessionId,
    runId,
    roundId,
    candidateId,
    venue: "BINANCE_TR",
    executionMode: "paper",
  };
  const event = async (
    stage: string,
    status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED",
    message: string,
    context?: Record<string, unknown>,
  ) =>
    addTradeLifecycleEvent({
      executionId,
      symbol,
      stage,
      status,
      message,
      level: status === "FAILED" ? "ERROR" : "INFO",
      context: { ...identity, ...context },
      createdAt: new Date().toISOString(),
    });

  await event("SYMBOL_SELECTED", "SUCCESS", "Deterministic selected candidate fixture");
  await event("EXECUTION_PRECHECK_STARTED", "RUNNING", "Deterministic paper pre-check started");
  await event("EXECUTION_DEPENDENCY_CALL_STARTED", "RUNNING", "Fixture market and symbol validation started", {
    operation: "execution_precheck",
    dependency: "deterministic_fixture",
  });
  await event("EXECUTION_DEPENDENCY_CALL_SUCCEEDED", "SUCCESS", "Fixture market and symbol validation succeeded", {
    operation: "execution_precheck",
    dependency: "deterministic_fixture",
  });
  await event("EXECUTION_PRECHECK_PASSED", "SUCCESS", "Deterministic paper pre-check passed");

  const adapter = resolveExecutionAdapter("paper");
  if (adapter.kind !== "PAPER") throw new Error("P0_SMOKE_PAPER_ADAPTER_NOT_SELECTED");
  await event("PAPER_ORDER_SIMULATION_STARTED", "RUNNING", "Deterministic simulated order started");

  // Deterministic fixture: no market endpoint and no live adapter call.
  const simulatedFill = {
    orderId: `paper-order:${suffix}`,
    simulationId,
    executedQty: 1,
    avgFillPrice: 100,
    fee: 0.1,
    fillCount: 1,
  };
  await recordPaperFillEvent({
    campaignId,
    userId: user.id,
    simulationId,
    executionId,
    symbol,
    side: "BUY",
    executedQty: simulatedFill.executedQty,
    avgFillPrice: simulatedFill.avgFillPrice,
    fee: simulatedFill.fee,
    fillCount: simulatedFill.fillCount,
  });
  await event("PAPER_ORDER_SIMULATION_SUCCEEDED", "SUCCESS", "Deterministic simulated fill persisted", {
    orderId: simulatedFill.orderId,
    simulationId,
  });

  const [paperTrades, paperExecutions, lifecycle, breakerEvents] = await Promise.all([
    prisma.paperTrade.findMany({ where: { campaignId, executionId } }),
    prisma.paperExecution.findMany({ where: { campaignId, executionId } }),
    prisma.tradeLifecycleEvent.findMany({ where: { campaignId, executionId }, orderBy: { createdAt: "asc" } }),
    prisma.tradeLifecycleEvent.count({ where: { campaignId, executionId, stage: "BREAKER_OPENED" } }),
  ]);
  const requiredStages = [
    "SYMBOL_SELECTED",
    "EXECUTION_PRECHECK_STARTED",
    "EXECUTION_DEPENDENCY_CALL_STARTED",
    "EXECUTION_DEPENDENCY_CALL_SUCCEEDED",
    "EXECUTION_PRECHECK_PASSED",
    "PAPER_ORDER_SIMULATION_STARTED",
    "PAPER_ORDER_SIMULATION_SUCCEEDED",
  ];
  const stages = lifecycle.map((row) => row.stage);
  const opened = paperTrades.length === 1 && paperExecutions.length === 1;
  const result = {
    status:
      opened &&
      liveSubmissionCount === 0 &&
      breakerEvents === 0 &&
      requiredStages.every((stage) => stages.includes(stage))
        ? "PASS"
        : "FAIL",
    fixtureOnly: true,
    profitabilityEvidence: false,
    opened,
    campaignId,
    jobId,
    sessionId,
    runId,
    roundId,
    candidateId,
    executionId,
    paperAdapterKind: adapter.kind,
    simulatedOrder: simulatedFill.orderId,
    simulatedFill: simulationId,
    paperTradeCount: paperTrades.length,
    paperExecutionCount: paperExecutions.length,
    liveSubmissionCount,
    breakerOpenedCount: breakerEvents,
    lifecycleStages: stages,
    identityConsistent:
      paperTrades.every((row) => row.campaignId === campaignId) &&
      paperExecutions.every((row) => row.campaignId === campaignId) &&
      lifecycle.every((row) => row.campaignId === campaignId),
  };

  const outputDir = path.join(process.cwd(), "artifacts", "forensics", "p0-execution-smoke");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${suffix}.json`);
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  await prisma.paperExecution.deleteMany({ where: { campaignId, executionId } });
  await prisma.paperTrade.deleteMany({ where: { campaignId, executionId } });
  await prisma.tradeLifecycleEvent.deleteMany({ where: { campaignId, executionId } });

  console.log(JSON.stringify({ ...result, outputPath }, null, 2));
  if (result.status !== "PASS") process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
