import { describe, expect, it } from "vitest";
import { evaluateTakeProfitStopLoss } from "../src/server/execution/tp-sl-evaluator";
import { isExecutionTimedOut } from "../src/server/execution/timeout-closer";

describe("core services", () => {
  it("evaluates take profit for long", () => {
    const result = evaluateTakeProfitStopLoss("LONG", 105, 104, 98);
    expect(result.shouldClose).toBe(true);
    expect(result.reason).toBe("TAKE_PROFIT");
  });

  it("evaluates timeout", () => {
    const openedAt = new Date(Date.now() - 11_000);
    expect(isExecutionTimedOut(openedAt, 10)).toBe(true);
    expect(isExecutionTimedOut(new Date(), 10)).toBe(false);
  });
});
