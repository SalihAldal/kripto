/**
 * Short PAPER smoke: safe-mode gate, terminal reason contract, no orphan RUNNING job.
 * Does not force trades; validates post-safe-mode evaluation path only.
 */
import { loadEnvFile } from "./paper-campaign-runner-core";

loadEnvFile();

async function main() {
  const { prisma } = await import("@/src/server/db/prisma");
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
  const {
    assessSafeModeExecutionGate,
    acknowledgeSafeModeThroughPolicy,
    describeSafeModeAckRequirement,
  } = await import("@/src/server/recovery/paper-safe-mode-policy.service");
  const { normalizeExecutionTerminalReason } = await import("@/src/server/execution/execution-failure-contract");
  const { resolvePaperExecutionSymbol } = await import("@/src/server/execution/paper-execution-symbol.service");

  const { user } = await getRuntimeExecutionContext();
  const gateBefore = await assessSafeModeExecutionGate(user.id);
  const ackGuide = describeSafeModeAckRequirement(gateBefore);

  let ackResult: unknown = null;
  if (gateBefore.blocked && gateBefore.safeModeEnabled && !gateBefore.breakerOpen && gateBefore.requireManualAck) {
    ackResult = await acknowledgeSafeModeThroughPolicy({
      userId: user.id,
      reason: "Post-fix smoke verification — stale safe mode cleared after breaker recovery",
      operator: "post-fix-smoke",
    });
  }

  const gateAfter = await assessSafeModeExecutionGate(user.id);
  const preflight = await runPaperSessionPreflight({ userId: user.id });
  const symbolCheck = await resolvePaperExecutionSymbol("EGLDUSDT");
  const terminalSample = normalizeExecutionTerminalReason({
    rejectReason: "SAFE_MODE:SAFE_MODE_ACTIVE",
    details: { failureDomain: "SAFE_MODE", failureCode: "SAFE_MODE_ACTIVE" },
  });
  const runningJobs = await prisma.autoRoundJob.count({ where: { userId: user.id, status: "RUNNING" } });

  const result = {
    userId: user.id,
    executionMode: process.env.EXECUTION_MODE,
    liveTradingEnabled: process.env.LIVE_TRADING_ENABLED,
    gateBefore: {
      blocked: gateBefore.blocked,
      failureDomain: gateBefore.failureDomain,
      failureCode: gateBefore.failureCode,
      requireManualAck: gateBefore.requireManualAck,
      breakerOpen: gateBefore.breakerOpen,
    },
    ackGuide,
    ackResult,
    gateAfter: {
      blocked: gateAfter.blocked,
      failureDomain: gateAfter.failureDomain,
      failureCode: gateAfter.failureCode,
    },
    preflight: {
      canStart: preflight.canStart,
      overallVerdict: preflight.overallVerdict,
      blockCode: preflight.blockCode ?? null,
    },
    symbolCheck: {
      signalSymbol: symbolCheck.signalSymbol,
      executionSymbol: symbolCheck.executionSymbol,
      resolved: symbolCheck.resolved,
      quoteAsset: symbolCheck.quoteAsset,
    },
    terminalReasonContract: terminalSample,
    runningJobs,
    pass:
      terminalSample === "SAFE_MODE:SAFE_MODE_ACTIVE" &&
      symbolCheck.resolved &&
      symbolCheck.executionSymbol.endsWith("TRY") &&
      runningJobs === 0 &&
      (gateAfter.blocked ? preflight.canStart === false : true),
  };

  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
  if (!result.pass) process.exit(2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
