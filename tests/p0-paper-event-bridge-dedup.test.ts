import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeHandler: null as ((event: string, payload: Record<string, unknown>) => void) | null,
  executionHandler: null as ((event: { stage: string; status: string; executionId: string; symbol?: string; context?: Record<string, unknown> }) => void) | null,
  recordPaperFillEvent: vi.fn(),
}));

vi.mock("@/src/server/exchange-simulator/exchange-simulator.events", () => ({
  onExchangeSimulatorEvent: (handler: (event: string, payload: Record<string, unknown>) => void) => {
    mocks.exchangeHandler = handler;
  },
}));

vi.mock("@/src/server/execution/execution-event-bus", () => ({
  subscribeExecutionEvents: (
    handler: (event: { stage: string; status: string; executionId: string; symbol?: string; context?: Record<string, unknown> }) => void,
  ) => {
    mocks.executionHandler = handler;
    return () => undefined;
  },
}));

vi.mock("@/src/server/paper-validation/paper-trade-recorder.service", () => ({
  recordPaperFillEvent: mocks.recordPaperFillEvent,
}));

describe("P0 paper event bridge de-duplication", () => {
  it("ignores simulator events that already have execution context", async () => {
    const { ensurePaperValidationEventBridge } = await import(
      "@/src/server/paper-validation/paper-validation-events.service"
    );
    ensurePaperValidationEventBridge();
    expect(mocks.exchangeHandler).toBeTypeOf("function");
    mocks.exchangeHandler?.("paper.order.executed", {
      userId: "user-1",
      simulationId: "sim-1",
      executionId: "exec-1",
      symbol: "BTCTRY",
      side: "BUY",
      executedQty: 1,
      avgFillPrice: 100,
      fee: 0.1,
    });
    await Promise.resolve();
    expect(mocks.recordPaperFillEvent).not.toHaveBeenCalled();
  });

  it("ignores settlement success when direct persistence already succeeded", async () => {
    const { ensurePaperValidationEventBridge } = await import(
      "@/src/server/paper-validation/paper-validation-events.service"
    );
    ensurePaperValidationEventBridge();
    expect(mocks.executionHandler).toBeTypeOf("function");
    mocks.executionHandler?.({
      stage: "settlement",
      status: "SUCCESS",
      executionId: "exec-2",
      symbol: "BTCTRY",
      context: {
        mode: "paper",
        userId: "user-1",
        closeSimulationId: "sim-2",
        paperFillPersisted: true,
      },
    });
    await Promise.resolve();
    expect(mocks.recordPaperFillEvent).not.toHaveBeenCalled();
  });
});
