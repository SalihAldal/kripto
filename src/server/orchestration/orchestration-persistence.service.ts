import { Prisma } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";
import { writeStructuredLog } from "@/src/server/observability/structured-log";
import {
  ORCHESTRATION_VERSIONS,
  type OrchestrationAdaptiveRecommendation,
  type OrchestrationPersistenceEnvelope,
  type PersistenceAuditInput,
} from "@/src/server/orchestration/orchestration-types";

function json(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

function maybeDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function nextRetryDate(attemptCount: number) {
  const delayMs = Math.min(15 * 60_000, 2 ** Math.max(0, attemptCount - 1) * 30_000);
  return new Date(Date.now() + delayMs);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeAdaptiveAction(action: OrchestrationAdaptiveRecommendation) {
  return {
    actionType: action.actionType,
    scope: action.scope,
    targetKey: action.targetKey,
    reason: action.reason,
    confidence: action.confidence,
    thresholdDelta: action.thresholdDelta ?? 0,
    confidenceDelta: action.confidenceDelta ?? 0,
    sizeMultiplier: action.sizeMultiplier ?? 1,
    riskMultiplier: action.riskMultiplier ?? 1,
    cooldownUntil: maybeDate(action.cooldownUntil),
    parameters: json(action.parameters),
    metadata: json({
      source: "orchestration-intelligence",
      ...ORCHESTRATION_VERSIONS,
    }),
  };
}

export async function recordOrchestrationPersistenceAudit(input: PersistenceAuditInput) {
  return prisma.orchestrationPersistenceAudit.create({
    data: {
      userId: input.userId,
      outboxId: input.outboxId,
      eventType: input.eventType,
      targetModel: input.targetModel,
      targetId: input.targetId,
      status: input.status,
      message: input.message,
      error: input.error,
      payload: json(input.payload),
      metadata: json(input.metadata),
    },
  });
}

async function recordFailedOutbox(input: {
  envelope: OrchestrationPersistenceEnvelope;
  error: string;
}) {
  const decision = input.envelope.decision;
  const outbox = await prisma.orchestrationPersistenceOutbox.upsert({
    where: { idempotencyKey: `${decision.idempotencyKey}:decision` },
    create: {
      idempotencyKey: `${decision.idempotencyKey}:decision`,
      eventType: "DECISION",
      aggregateType: "OrchestrationDecision",
      aggregateId: decision.executionId ?? decision.tradeId ?? decision.positionId ?? decision.symbol,
      status: "RETRYING",
      attemptCount: 1,
      nextRetryAt: nextRetryDate(1),
      lastError: input.error,
      payload: json(input.envelope),
      metadata: json({
        failedAt: new Date().toISOString(),
        ...ORCHESTRATION_VERSIONS,
      }),
    },
    update: {
      status: "RETRYING",
      attemptCount: { increment: 1 },
      nextRetryAt: nextRetryDate(2),
      lastError: input.error,
      payload: json(input.envelope),
      metadata: json({
        failedAt: new Date().toISOString(),
        ...ORCHESTRATION_VERSIONS,
      }),
    },
  });

  await recordOrchestrationPersistenceAudit({
    userId: decision.userId,
    outboxId: outbox.id,
    eventType: "DECISION",
    targetModel: "OrchestrationDecision",
    targetId: decision.executionId ?? decision.tradeId ?? decision.positionId,
    status: "FAILED",
    message: "Orchestration decision persistence failed; outbox retry scheduled",
    error: input.error,
    payload: input.envelope as unknown as Record<string, unknown>,
    metadata: ORCHESTRATION_VERSIONS,
  }).catch(() => null);

  await writeStructuredLog({
    level: "WARN",
    source: "orchestration-persistence",
    message: "Orchestration persistence failed; retry scheduled",
    actionType: "retry_triggered",
    status: "FAILED",
    userId: decision.userId,
    transactionId: decision.executionId,
    symbol: decision.symbol,
    errorCode: "ORCHESTRATION_PERSISTENCE_FAILED",
    errorDetail: input.error,
    context: {
      idempotencyKey: decision.idempotencyKey,
      outboxId: outbox.id,
    },
  });

  return outbox;
}

export async function persistOrchestrationEnvelope(envelope: OrchestrationPersistenceEnvelope) {
  const decisionInput = envelope.decision;
  try {
    return await prisma.$transaction(async (tx) => {
      const decision = await tx.orchestrationDecision.upsert({
        where: { idempotencyKey: decisionInput.idempotencyKey },
        create: {
          userId: decisionInput.userId,
          idempotencyKey: decisionInput.idempotencyKey,
          executionId: decisionInput.executionId,
          tradeId: decisionInput.tradeId,
          positionId: decisionInput.positionId,
          symbol: decisionInput.symbol,
          mode: decisionInput.mode,
          decisionStage: decisionInput.decisionStage ?? "PRE_TRADE",
          action: decisionInput.action,
          strategy: decisionInput.strategy,
          marketRegime: decisionInput.marketRegime,
          regimeLifecyclePhase: decisionInput.regimeLifecyclePhase,
          confidenceOriginal: decisionInput.confidenceOriginal,
          confidenceAdjusted: decisionInput.confidenceAdjusted,
          confidencePenalty: decisionInput.confidencePenalty ?? 0,
          riskMultiplier: decisionInput.riskMultiplier ?? 1,
          suppressionScore: decisionInput.suppressionScore ?? 0,
          orchestrationScore: decisionInput.orchestrationScore ?? 0,
          uncertaintyScore: decisionInput.uncertaintyScore ?? 0,
          edgeHealthScore: decisionInput.edgeHealthScore,
          clusterRiskScore: decisionInput.clusterRiskScore,
          vetoLayer: decisionInput.vetoLayer,
          vetoReasons: json(decisionInput.vetoReasons ?? []),
          reasonMap: json(decisionInput.reasonMap ?? {}),
          factorWeights: json(decisionInput.factorWeights ?? {}),
          forensicReport: json(decisionInput.forensicReport ?? {}),
          adaptiveActions: json(decisionInput.adaptiveActions ?? []),
          ...ORCHESTRATION_VERSIONS,
          metadata: json(decisionInput.metadata ?? {}),
        },
        update: {
          action: decisionInput.action,
          decisionStage: decisionInput.decisionStage ?? "PRE_TRADE",
          confidenceOriginal: decisionInput.confidenceOriginal,
          confidenceAdjusted: decisionInput.confidenceAdjusted,
          confidencePenalty: decisionInput.confidencePenalty ?? 0,
          riskMultiplier: decisionInput.riskMultiplier ?? 1,
          suppressionScore: decisionInput.suppressionScore ?? 0,
          orchestrationScore: decisionInput.orchestrationScore ?? 0,
          uncertaintyScore: decisionInput.uncertaintyScore ?? 0,
          edgeHealthScore: decisionInput.edgeHealthScore,
          clusterRiskScore: decisionInput.clusterRiskScore,
          vetoLayer: decisionInput.vetoLayer,
          vetoReasons: json(decisionInput.vetoReasons ?? []),
          reasonMap: json(decisionInput.reasonMap ?? {}),
          factorWeights: json(decisionInput.factorWeights ?? {}),
          forensicReport: json(decisionInput.forensicReport ?? {}),
          adaptiveActions: json(decisionInput.adaptiveActions ?? []),
          metadata: json(decisionInput.metadata ?? {}),
        },
      });

      if (envelope.uncertainty) {
        await tx.orchestrationUncertaintySnapshot.create({
          data: {
            orchestrationDecisionId: decision.id,
            executionId: envelope.uncertainty.executionId,
            tradeId: envelope.uncertainty.tradeId,
            positionId: envelope.uncertainty.positionId,
            symbol: envelope.uncertainty.symbol,
            marketRegime: envelope.uncertainty.marketRegime,
            uncertaintyScore: envelope.uncertainty.uncertaintyScore,
            confidenceReliability: envelope.uncertainty.confidenceReliability,
            predictionStability: envelope.uncertainty.predictionStability,
            decisionAmbiguity: envelope.uncertainty.decisionAmbiguity,
            conflictingSignalScore: envelope.uncertainty.conflictingSignalScore,
            dataConfidenceScore: envelope.uncertainty.dataConfidenceScore,
            manipulationSuspicion: envelope.uncertainty.manipulationSuspicion,
            reasonMap: json(envelope.uncertainty.reasonMap ?? {}),
            metadata: json(envelope.uncertainty.metadata ?? {}),
          },
        });
      }

      if (envelope.edgeHealth) {
        await tx.orchestrationEdgeHealthSnapshot.create({
          data: {
            userId: envelope.edgeHealth.userId,
            strategy: envelope.edgeHealth.strategy,
            symbol: envelope.edgeHealth.symbol,
            marketRegime: envelope.edgeHealth.marketRegime,
            horizon: envelope.edgeHealth.horizon,
            rollingWindow: envelope.edgeHealth.rollingWindow ?? 50,
            sampleCount: envelope.edgeHealth.sampleCount ?? 0,
            rollingWinrate: envelope.edgeHealth.rollingWinrate ?? 0,
            rollingEv: envelope.edgeHealth.rollingEv ?? 0,
            regimeExpectancy: envelope.edgeHealth.regimeExpectancy ?? 0,
            strategyDecayScore: envelope.edgeHealth.strategyDecayScore ?? 0,
            falsePositiveScore: envelope.edgeHealth.falsePositiveScore ?? 0,
            drawdownAcceleration: envelope.edgeHealth.drawdownAcceleration ?? 0,
            confidenceCalibrationError: envelope.edgeHealth.confidenceCalibrationError ?? 0,
            edgeStabilityScore: envelope.edgeHealth.edgeStabilityScore ?? 50,
            manipulationExposure: envelope.edgeHealth.manipulationExposure ?? 0,
            volatilityExposure: envelope.edgeHealth.volatilityExposure ?? 0,
            slippageDegradation: envelope.edgeHealth.slippageDegradation ?? 0,
            executionQualityDrift: envelope.edgeHealth.executionQualityDrift ?? 0,
            diagnostics: json(envelope.edgeHealth.diagnostics ?? {}),
            recommendedActions: json(envelope.edgeHealth.recommendedActions ?? []),
            metadata: json(envelope.edgeHealth.metadata ?? {}),
          },
        });
      }

      if (envelope.cluster) {
        await tx.orchestrationClusterSnapshot.create({
          data: {
            clusterKey: envelope.cluster.clusterKey,
            clusterType: envelope.cluster.clusterType,
            symbol: envelope.cluster.symbol,
            strategy: envelope.cluster.strategy,
            marketRegime: envelope.cluster.marketRegime,
            sessionKey: envelope.cluster.sessionKey,
            sampleCount: envelope.cluster.sampleCount ?? 0,
            consecutiveLosses: envelope.cluster.consecutiveLosses ?? 0,
            sameRegimeLosses: envelope.cluster.sameRegimeLosses ?? 0,
            manipulationLosses: envelope.cluster.manipulationLosses ?? 0,
            volatilityClusterScore: envelope.cluster.volatilityClusterScore ?? 0,
            executionDegradationScore: envelope.cluster.executionDegradationScore ?? 0,
            marketHostilityScore: envelope.cluster.marketHostilityScore ?? 0,
            recommendedAction: envelope.cluster.recommendedAction,
            cooldownUntil: maybeDate(envelope.cluster.cooldownUntil),
            evidence: json(envelope.cluster.evidence ?? {}),
            metadata: json(envelope.cluster.metadata ?? {}),
          },
        });
      }

      if (decisionInput.adaptiveActions?.length) {
        await tx.orchestrationAdaptiveAction.createMany({
          data: decisionInput.adaptiveActions.map((action) => ({
            userId: decisionInput.userId,
            orchestrationDecisionId: decision.id,
            ...normalizeAdaptiveAction(action),
            status: "WRITTEN",
            appliedAt: new Date(),
          })),
        });
      }

      const outbox = await tx.orchestrationPersistenceOutbox.upsert({
        where: { idempotencyKey: `${decisionInput.idempotencyKey}:decision` },
        create: {
          idempotencyKey: `${decisionInput.idempotencyKey}:decision`,
          eventType: "DECISION",
          aggregateType: "OrchestrationDecision",
          aggregateId: decision.id,
          status: "WRITTEN",
          attemptCount: 1,
          processedAt: new Date(),
          payload: json(envelope),
          metadata: json(ORCHESTRATION_VERSIONS),
        },
        update: {
          aggregateId: decision.id,
          status: "WRITTEN",
          processedAt: new Date(),
          lastError: null,
          payload: json(envelope),
          metadata: json(ORCHESTRATION_VERSIONS),
        },
      });

      await tx.orchestrationPersistenceAudit.create({
        data: {
          userId: decisionInput.userId,
          outboxId: outbox.id,
          eventType: "DECISION",
          targetModel: "OrchestrationDecision",
          targetId: decision.id,
          status: "WRITTEN",
          message: "Orchestration decision persisted",
          payload: json({
            idempotencyKey: decisionInput.idempotencyKey,
            action: decisionInput.action,
          }),
          metadata: json(ORCHESTRATION_VERSIONS),
        },
      });

      return { decisionId: decision.id, outboxId: outbox.id };
    });
  } catch (error) {
    const message = errorMessage(error);
    await recordFailedOutbox({ envelope, error: message }).catch(() => null);
    return { decisionId: null, outboxId: null, error: message };
  }
}

export async function retryPendingOrchestrationOutbox(limit = 25) {
  const rows = await prisma.orchestrationPersistenceOutbox.findMany({
    where: {
      status: { in: ["PENDING", "RETRYING", "FAILED"] },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(100, limit)),
  });

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const row of rows) {
    const payload = row.payload as unknown as OrchestrationPersistenceEnvelope;
    const result = await persistOrchestrationEnvelope(payload);
    const retryError = "error" in result ? result.error : undefined;
    results.push({ id: row.id, ok: !retryError, error: retryError });
    if (retryError && row.attemptCount + 1 >= row.maxAttempts) {
      await prisma.orchestrationPersistenceOutbox.update({
        where: { id: row.id },
        data: {
          status: "DEAD_LETTER",
          lastError: retryError,
          processedAt: new Date(),
        },
      }).catch(() => null);
    }
  }
  return results;
}

export async function verifyOrchestrationPersistence(input: {
  userId?: string;
  lookbackHours?: number;
  limit?: number;
} = {}) {
  const since = new Date(Date.now() - Math.max(1, input.lookbackHours ?? 24) * 60 * 60_000);
  const limit = Math.max(1, Math.min(200, input.limit ?? 100));
  const [recentLearningTrades, recentDecisions, failedOutbox] = await Promise.all([
    prisma.learningTrade.findMany({
      where: {
        ...(input.userId ? { userId: input.userId } : {}),
        createdAt: { gte: since },
      },
      select: { tradeId: true, positionId: true, symbol: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.orchestrationDecision.findMany({
      where: {
        ...(input.userId ? { userId: input.userId } : {}),
        createdAt: { gte: since },
      },
      select: { tradeId: true, positionId: true, executionId: true, symbol: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: limit * 2,
    }),
    prisma.orchestrationPersistenceOutbox.findMany({
      where: {
        status: { in: ["FAILED", "RETRYING", "DEAD_LETTER"] },
        createdAt: { gte: since },
      },
      select: { id: true, idempotencyKey: true, status: true, attemptCount: true, lastError: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);
  const decisionKeys = new Set(
    recentDecisions.flatMap((decision) => [decision.tradeId, decision.positionId].filter((value): value is string => Boolean(value))),
  );
  const missingLearningTrades = recentLearningTrades.filter((trade) => {
    const keys = [trade.tradeId, trade.positionId].filter((value): value is string => Boolean(value));
    return keys.length > 0 && keys.every((key) => !decisionKeys.has(key));
  });

  if (missingLearningTrades.length > 0 || failedOutbox.length > 0) {
    await recordOrchestrationPersistenceAudit({
      userId: input.userId,
      eventType: "PERSISTENCE_AUDIT",
      targetModel: "OrchestrationPersistence",
      status: failedOutbox.length > 0 ? "FAILED" : "RETRYING",
      message: "Orchestration persistence verification detected gaps",
      payload: {
        missingLearningTrades,
        failedOutbox,
      },
      metadata: {
        since: since.toISOString(),
        ...ORCHESTRATION_VERSIONS,
      },
    }).catch(() => null);
  }

  return {
    since: since.toISOString(),
    checkedLearningTrades: recentLearningTrades.length,
    orchestrationDecisions: recentDecisions.length,
    missingLearningTrades,
    failedOutbox,
    ok: missingLearningTrades.length === 0 && failedOutbox.length === 0,
  };
}
