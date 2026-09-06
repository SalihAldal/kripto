import { evaluateEntryForBuyCandidate } from "@/src/server/execution-engine-v2/entry-ai.gateway.service";
import { evaluateExitForOpenPosition } from "@/src/server/execution-engine-v2/exit-ai.gateway.service";
import { executeApprovedSpotOrder } from "@/src/server/execution-engine-v2/execution-flow.service";
import { verifyExecutionOrder, verifyRecentUnverifiedLogs } from "@/src/server/execution-engine-v2/order-verification.service";
import { reconcileOpenPositions, reconcileSymbolState } from "@/src/server/execution-engine-v2/reconciliation.service";
import { reconcileFix02ExitBundles } from "@/src/server/execution/fix02-exit-reconciliation.service";
import { recoverFailedExecution } from "@/src/server/execution-engine-v2/failure-recovery.service";
import { listExecutionLogs, listExecutionReconciliations, listExecutionAudits, listExecutionFailures, listOpenPositions } from "@/src/server/execution-engine-v2/execution-engine-v2.repository";
import { processWaitReevaluations } from "@/src/server/entry-timing/wait-mode.service";
import { processHoldReevaluations } from "@/src/server/exit-timing/hold-mode.service";
import { scanAllOpenPositions } from "@/src/server/exit-timing/exit-analysis.service";
import type { ExecutionEngineV2JobPayload } from "@/src/server/execution-engine-v2/execution-engine-v2.types";

export async function runExecutionEngineV2Job(payload: ExecutionEngineV2JobPayload) {
  switch (payload.type) {
    case "ENTRY_EVALUATE":
      return evaluateEntryForBuyCandidate(payload);
    case "EXIT_EVALUATE":
      return evaluateExitForOpenPosition({ positionId: payload.positionId, symbol: payload.symbol });
    case "EXECUTE_ORDER":
      return executeApprovedSpotOrder(payload);
    case "VERIFY_ORDER":
      if (payload.logKey === "batch") return verifyRecentUnverifiedLogs();
      return verifyExecutionOrder(payload.logKey);
    case "RECONCILE":
      if (payload.symbol) {
        const symbolResult = await reconcileSymbolState(payload.symbol);
        const fix02 = await reconcileFix02ExitBundles(10);
        return { symbolResult, fix02 };
      }
      return reconcileOpenPositions();
    case "RECOVERY":
      return payload.executionId ? recoverFailedExecution(payload.executionId) : verifyRecentUnverifiedLogs();
    case "WAIT_REEVALUATE":
      return processWaitReevaluations();
    case "HOLD_REEVALUATE":
      return processHoldReevaluations();
    default:
      return { skipped: true };
  }
}

export async function getExecutionEngineV2Dashboard() {
  const [logs, reconciliations, audits, failures, openPositions] = await Promise.all([
    listExecutionLogs(30),
    listExecutionReconciliations(20),
    listExecutionAudits(20),
    listExecutionFailures(20),
    listOpenPositions(20),
  ]);
  let openExitScan = null;
  try {
    openExitScan = await scanAllOpenPositions();
  } catch {
    openExitScan = { analyzed: 0, results: [] };
  }
  return { logs, reconciliations, audits, failures, openPositions: openPositions.map((p) => ({
    id: p.id,
    symbol: p.tradingPair.symbol,
    quantity: p.quantity,
    status: p.status,
  })), openExitScan };
}
