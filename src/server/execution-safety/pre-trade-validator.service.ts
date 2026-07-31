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

export async function runPreTradeSafetyValidation(input: PreTradeSafetyInput): Promise<PreTradeSafetyResult> {
  const safetyId = randomUUID();
  const startedAt = Date.now();

  const [
    emergency,
    balance,
    price,
    market,
    duplicate,
    position,
    api,
    exchange,
    quantity,
    order,
  ] = await Promise.all([
    validateEmergencySafety(input),
    validateBalanceSafety(input),
    validatePriceSafety(input),
    validateMarketSafety(input),
    validateDuplicateSafety(input),
    validatePositionSafety(input),
    validateApiHealth(input),
    validateExchangeSafety(input),
    validateQuantitySafety(input),
    validateOrderSafety(input),
  ]);

  const stages = [emergency, balance, price, market, duplicate, position, api, exchange, quantity, order];
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
    emitExecutionSafetyEvent(SAFETY_EVENT.PASSED, { safetyId, executionId: input.executionId, symbol: input.symbol });
  } else {
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
