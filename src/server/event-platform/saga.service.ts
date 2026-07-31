import { createSaga, updateSaga } from "@/src/server/event-platform/event-platform.repository";
import { publishDomainEvent } from "@/src/server/event-platform/event-bus.service";
import { emitPlatformEvent, PLATFORM_EVENT } from "@/src/server/event-platform/event-platform.events";
import { DOMAIN_EVENTS } from "@/src/server/event-platform/event-platform.types";

const TRADE_SAGA_STEPS = [
  { name: "decision", event: DOMAIN_EVENTS.DECISION_CREATED },
  { name: "risk", event: DOMAIN_EVENTS.RISK_APPROVED },
  { name: "execution", event: DOMAIN_EVENTS.EXECUTION_REQUESTED },
  { name: "portfolio", event: DOMAIN_EVENTS.PORTFOLIO_UPDATED },
  { name: "learning", event: DOMAIN_EVENTS.LEARNING_COMPLETED },
  { name: "replay", event: DOMAIN_EVENTS.REPLAY_COMPLETED },
  { name: "complete", event: "SagaCompleted" },
];

export async function startTradeSaga(correlationId: string, aggregateId: string, context?: Record<string, unknown>) {
  const saga = await createSaga("TradeWorkflow", correlationId, TRADE_SAGA_STEPS);
  await updateSaga(saga.id, { status: "RUNNING", context });
  emitPlatformEvent(PLATFORM_EVENT.SAGA_STARTED, { sagaKey: saga.sagaKey, correlationId });

  await publishDomainEvent(DOMAIN_EVENTS.DECISION_CREATED, "DECISION", aggregateId, "DECISION", { correlationId, sagaKey: saga.sagaKey, ...context }, correlationId);
  return saga;
}

export async function advanceSaga(sagaKey: string, stepName: string, success: boolean, context?: Record<string, unknown>) {
  const { prisma } = await import("@/src/server/db/prisma");
  const saga = await prisma.sagaInstance.findUnique({ where: { sagaKey } });
  if (!saga) return { advanced: false };

  if (!success) {
    await updateSaga(saga.id, { status: "COMPENSATING", compensation: { failedStep: stepName } });
    emitPlatformEvent(PLATFORM_EVENT.SAGA_FAILED, { sagaKey, step: stepName });
    await compensateSaga(saga.id, stepName);
    return { advanced: false, compensating: true };
  }

  const steps = saga.steps as Array<{ name: string; event: string }>;
  const currentIdx = steps.findIndex((s) => s.name === stepName);
  const nextStep = steps[currentIdx + 1];

  if (!nextStep || nextStep.name === "complete") {
    await updateSaga(saga.id, { status: "COMPLETED", currentStep: "complete", context });
    emitPlatformEvent(PLATFORM_EVENT.SAGA_COMPLETED, { sagaKey });
    return { advanced: true, completed: true };
  }

  await updateSaga(saga.id, { currentStep: nextStep.name, context });
  return { advanced: true, nextStep: nextStep.name };
}

async function compensateSaga(sagaId: string, failedStep: string) {
  await updateSaga(sagaId, { status: "COMPENSATED", compensation: { rolledBackFrom: failedStep } });
}

export { TRADE_SAGA_STEPS };
