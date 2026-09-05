import { logger } from "@/lib/logger";
import { onExchangeSimulatorEvent } from "@/src/server/exchange-simulator/exchange-simulator.events";
import { subscribeExecutionEvents } from "@/src/server/execution/execution-event-bus";
import { recordPaperFillEvent } from "@/src/server/paper-validation/paper-trade-recorder.service";

let registered = false;

export function ensurePaperValidationEventBridge() {
  if (registered) return;
  registered = true;

  onExchangeSimulatorEvent((event, payload) => {
    if (event !== "paper.order.executed") return;
    void handlePaperOrderExecuted(payload).catch((error) => {
      logger.warn({ error: (error as Error).message }, "Paper validation fill handler failed");
    });
  });

  subscribeExecutionEvents((evt) => {
    if (evt.stage !== "settlement" || evt.status !== "SUCCESS") return;
    const mode = String((evt.context as Record<string, unknown> | undefined)?.mode ?? "");
    if (mode !== "paper") return;
    if (!evt.symbol) return;
    void handlePaperSettlement({
      executionId: evt.executionId,
      symbol: evt.symbol,
      context: evt.context as Record<string, unknown> | undefined,
    }).catch((error) => {
      logger.warn({ error: (error as Error).message }, "Paper validation settlement handler failed");
    });
  });
}

async function handlePaperOrderExecuted(payload: Record<string, unknown>) {
  // Primary execution flow persists paper fills directly; event-bridge is fallback-only.
  if (payload.executionId) return;
  const userId = String(payload.userId ?? "");
  const simulationId = String(payload.simulationId ?? "");
  if (!userId || !simulationId) return;

  await recordPaperFillEvent({
    campaignId: payload.campaignId ? String(payload.campaignId) : undefined,
    userId,
    simulationId,
    executionId: payload.executionId ? String(payload.executionId) : undefined,
    symbol: String(payload.symbol ?? ""),
    side: payload.side === "SELL" ? "SELL" : "BUY",
    executedQty: Number(payload.executedQty ?? 0),
    avgFillPrice: Number(payload.avgFillPrice ?? 0),
    fee: Number(payload.fee ?? 0),
    fillCount: Number(payload.fillCount ?? 1),
  });
}

async function handlePaperSettlement(evt: {
  executionId: string;
  symbol: string;
  context?: Record<string, unknown>;
}) {
  const ctx = evt.context ?? {};
  if (ctx.paperFillPersisted === true) return;
  const simulationId = String(ctx.simulationId ?? ctx.closeSimulationId ?? "");
  const userId = String(ctx.userId ?? "");
  if (!simulationId || !userId) return;

  await recordPaperFillEvent({
    campaignId: ctx.campaignId ? String(ctx.campaignId) : undefined,
    userId,
    simulationId,
    executionId: evt.executionId,
    symbol: evt.symbol,
    side: "SELL",
    executedQty: Number(ctx.quantity ?? ctx.closeQty ?? 0),
    avgFillPrice: Number(ctx.exitPrice ?? ctx.closePrice ?? 0),
    fee: Number(ctx.fee ?? 0),
  });
}
