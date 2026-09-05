import { randomUUID } from "node:crypto";
import { validateBalanceSafety } from "@/src/server/execution-safety/balance-validation.service";
import { validatePriceSafety } from "@/src/server/execution-safety/price-validation.service";
import { validateMarketSafety } from "@/src/server/execution-safety/market-validation.service";
import { validateDuplicateSafety } from "@/src/server/execution-safety/duplicate-protection.service";
import { validatePositionSafety } from "@/src/server/execution-safety/position-validation.service";
import { validateApiHealth } from "@/src/server/execution-safety/api-health-validation.service";
import {
  evaluateSafetyRules,
  validateExchangeSafety,
  validateOrderSafety,
  validateQuantitySafety,
} from "@/src/server/execution-safety/safety-rules.service";
import { validateEmergencySafety } from "@/src/server/execution-safety/emergency-protection.service";
import { calculateSafetyScores } from "@/src/server/execution-safety/safety-scoring.service";
import {
  persistExecutionSafety,
  persistSafetyDecision,
  persistSafetyValidations,
} from "@/src/server/execution-safety/execution-safety.repository";
import {
  generateFailureReport,
  generateSafetyReport,
  generateValidationReport,
} from "@/src/server/execution-safety/execution-audit.service";
import { emitExecutionSafetyEvent, SAFETY_EVENT } from "@/src/server/execution-safety/execution-safety.events";
import type { PreTradeSafetyInput, PreTradeSafetyResult } from "@/src/server/execution-safety/execution-safety.types";
import { publishExecutionEvent } from "@/src/server/execution/execution-event-bus";
import {
  classifyExecutionFailure,
  preserveExecutionFailure,
  type ExecutionFailureDomain,
} from "@/src/server/execution/execution-failure-contract";

function executionIdentity(input: PreTradeSafetyInput) {
  return {
    campaignId: input.campaignId ?? null,
    jobId: input.jobId ?? null,
    sessionId: input.sessionId ?? null,
    runId: input.runId ?? null,
    roundId: input.roundId ?? null,
    candidateId: input.candidateId ?? null,
    symbol: input.symbol,
    venue: input.venue ?? null,
    executionMode: input.mode,
  };
}

const STAGE_FAILURE_DOMAIN: Record<string, ExecutionFailureDomain> = {
  BALANCE: "BALANCE",
  PRICE: "PRICE",
  MARKET: "MARKET_DATA",
  API: "MARKET_DATA",
  EXCHANGE: "SYMBOL_FILTER",
  QUANTITY: "SYMBOL_FILTER",
  ORDER: "PAPER_EXECUTION",
};

export async function runPreTradeSafetyValidation(input: PreTradeSafetyInput): Promise<PreTradeSafetyResult> {
  const safetyId = randomUUID();
  const startedAt = Date.now();
  const identity = executionIdentity(input);
  if (!input.suppressStartedEvent) {
    publishExecutionEvent({
      executionId: input.executionId,
      symbol: input.symbol,
      stage: "EXECUTION_PRECHECK_STARTED",
      status: "RUNNING",
      message: "Execution pre-check started",
      level: "INFO",
      context: identity,
    });
  }

  const validators = [
    ["emergency", validateEmergencySafety],
    ["paper_balance", validateBalanceSafety],
    ["ticker_price", validatePriceSafety],
    ["exchange_info", validateMarketSafety],
    ["idempotency", validateDuplicateSafety],
    ["position_state", validatePositionSafety],
    ["market_api_health", validateApiHealth],
    ["symbol_filters", validateExchangeSafety],
    ["quantity_filters", validateQuantitySafety],
    ["order_shape", validateOrderSafety],
  ] as const;
  const stages = await Promise.all(
    validators.map(async ([dependency, validator]) => {
      publishExecutionEvent({
        executionId: input.executionId,
        symbol: input.symbol,
        stage: "EXECUTION_DEPENDENCY_CALL_STARTED",
        status: "RUNNING",
        message: `${dependency} validation started`,
        level: "INFO",
        context: { ...identity, operation: "execution_precheck", dependency },
      });
      try {
        const result = await validator(input);
        if (result.passed) {
          publishExecutionEvent({
            executionId: input.executionId,
            symbol: input.symbol,
            stage: "EXECUTION_DEPENDENCY_CALL_SUCCEEDED",
            status: "SUCCESS",
            message: `${dependency} validation succeeded`,
            level: "INFO",
            context: { ...identity, operation: "execution_precheck", dependency },
          });
        } else {
          const failure = classifyExecutionFailure(new Error(result.reasons.join(", ")), {
            operation: "execution_precheck",
            dependency,
            executionMode: input.mode,
            domainHint: STAGE_FAILURE_DOMAIN[result.stage] ?? "UNKNOWN",
          });
          publishExecutionEvent({
            executionId: input.executionId,
            symbol: input.symbol,
            stage: "EXECUTION_DEPENDENCY_CALL_FAILED",
            status: "FAILED",
            message: `${failure.failureDomain}:${failure.failureCode}`,
            level: "WARN",
            context: { ...identity, ...failure },
          });
        }
        return result;
      } catch (error) {
        const failure = classifyExecutionFailure(error, {
          operation: "execution_precheck",
          dependency,
          executionMode: input.mode,
        });
        publishExecutionEvent({
          executionId: input.executionId,
          symbol: input.symbol,
          stage: "EXECUTION_DEPENDENCY_CALL_FAILED",
          status: "FAILED",
          message: `${failure.failureDomain}:${failure.failureCode}`,
          level: "ERROR",
          context: { ...identity, ...failure },
        });
        throw preserveExecutionFailure(error, {
          operation: "execution_precheck",
          dependency,
          executionMode: input.mode,
        });
      }
    }),
  );

  const api = stages.find((stage) => stage.stage === "API")!;
  const price = stages.find((stage) => stage.stage === "PRICE")!;
  const rules = evaluateSafetyRules(stages);
  const scores = calculateSafetyScores({
    stages,
    apiLatencyMs: Number(api.metadata?.latencyMs ?? 0),
    driftPct: Number(price.metadata?.driftPct ?? 0),
  });

  const outcome = rules.passed ? "ALLOW" : "BLOCK";
  await persistExecutionSafety({
    id: safetyId,
    executionId: input.executionId,
    userId: input.userId,
    symbol: input.symbol,
    side: input.side,
    mode: input.mode,
    passed: rules.passed,
    blockedBy: rules.blockedBy,
    rejectReason: rules.rejectReason,
    scores,
    stages,
    durationMs: Date.now() - startedAt,
  }).catch(() => null);

  await persistSafetyValidations({ safetyId, executionId: input.executionId, stages }).catch(() => null);
  await persistSafetyDecision({
    safetyId,
    executionId: input.executionId,
    userId: input.userId,
    symbol: input.symbol,
    outcome,
    scores,
    rejectReason: rules.rejectReason,
  }).catch(() => null);

  await generateValidationReport({
    executionId: input.executionId,
    userId: input.userId,
    symbol: input.symbol,
    result: {
      passed: rules.passed,
      rejectReason: rules.rejectReason,
      safetyId,
      ...scores,
      stages,
      blockedBy: rules.blockedBy,
    },
  }).catch(() => null);

  await generateSafetyReport({
    executionId: input.executionId,
    userId: input.userId,
    symbol: input.symbol,
    safetyId,
    scores,
    passed: rules.passed,
  }).catch(() => null);

  if (!rules.passed) {
    await generateFailureReport({
      executionId: input.executionId,
      userId: input.userId,
      symbol: input.symbol,
      reason: rules.rejectReason ?? "Safety validation failed",
      stage: rules.blockedBy,
      metadata: { safetyId, stages },
    }).catch(() => null);
  }

  if (rules.passed) {
    publishExecutionEvent({
      executionId: input.executionId,
      symbol: input.symbol,
      stage: "EXECUTION_PRECHECK_PASSED",
      status: "SUCCESS",
      message: "Execution pre-check passed",
      level: "INFO",
      context: identity,
    });
    emitExecutionSafetyEvent(SAFETY_EVENT.PASSED, { safetyId, executionId: input.executionId, symbol: input.symbol });
  } else {
    const failedStage = stages.find((stage) => !stage.passed);
    const failure = classifyExecutionFailure(new Error(rules.rejectReason ?? "Execution pre-check rejected"), {
      operation: "execution_precheck",
      dependency: String(failedStage?.stage ?? "unknown").toLowerCase(),
      executionMode: input.mode,
      domainHint: STAGE_FAILURE_DOMAIN[String(failedStage?.stage ?? "")] ?? "UNKNOWN",
    });
    publishExecutionEvent({
      executionId: input.executionId,
      symbol: input.symbol,
      stage: "EXECUTION_PRECHECK_REJECTED",
      status: "FAILED",
      message: `${failure.failureDomain}:${failure.failureCode}`,
      level: "WARN",
      context: { ...identity, ...failure },
    });
    emitExecutionSafetyEvent(SAFETY_EVENT.REJECTED, {
      safetyId,
      executionId: input.executionId,
      symbol: input.symbol,
      reason: rules.rejectReason,
    });
    emitExecutionSafetyEvent(SAFETY_EVENT.BLOCKED, { safetyId, blockedBy: rules.blockedBy });
  }

  return {
    passed: rules.passed,
    rejectReason: rules.rejectReason,
    safetyId,
    ...scores,
    stages,
    blockedBy: rules.blockedBy,
    metadata: { durationMs: Date.now() - startedAt, mode: input.mode },
  };
}

export { runPreTradeSafetyValidation as runPreTradeValidator };
