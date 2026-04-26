import { describe, expect, it, vi } from "vitest";

const persistedEvents: Array<Record<string, unknown>> = [];

vi.mock("@/src/server/repositories/trade-lifecycle.repository", () => ({
  addTradeLifecycleEvent: vi.fn(async (event: Record<string, unknown>) => {
    persistedEvents.unshift(event);
  }),
  listTradeLifecycleEvents: vi.fn(async () => persistedEvents.slice(0, 100)),
}));

describe("execution event bus integration", () => {
  it("eventleri memory + kalici repoya yazar", async () => {
    const {
      listExecutionEvents,
      listPersistedExecutionEvents,
      publishExecutionEvent,
      subscribeExecutionEvents,
    } = await import("../src/server/execution/execution-event-bus");

    const sink: Array<Record<string, unknown>> = [];
    const unsubscribe = subscribeExecutionEvents((row) => sink.push(row));

    publishExecutionEvent({
      executionId: "exec-ev-1",
      symbol: "BTCTRY",
      stage: "scanner-start",
      status: "RUNNING",
      message: "Tarama basladi",
    });
    publishExecutionEvent({
      executionId: "exec-ev-1",
      symbol: "BTCTRY",
      stage: "buy-order",
      status: "SUCCESS",
      message: "Alim tamamlandi",
    });
    unsubscribe();

    const history = listExecutionEvents(10);
    const persisted = await listPersistedExecutionEvents({ limit: 10 });

    expect(sink.length).toBeGreaterThanOrEqual(2);
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(persisted.length).toBeGreaterThanOrEqual(2);
    expect(String(history[0].executionId)).toBe("exec-ev-1");
  });

  it("abonelik kapandiginda websocket kopma senaryosunda yeni event almamali", async () => {
    const { publishExecutionEvent, subscribeExecutionEvents } = await import("../src/server/execution/execution-event-bus");
    const sink: Array<Record<string, unknown>> = [];
    const off = subscribeExecutionEvents((row) => sink.push(row));
    publishExecutionEvent({
      executionId: "exec-ev-2",
      stage: "scanner-start",
      status: "RUNNING",
      message: "x",
    });
    off();
    publishExecutionEvent({
      executionId: "exec-ev-2",
      stage: "scanner-summary",
      status: "RUNNING",
      message: "y",
    });
    expect(sink.length).toBe(1);
  });
});
