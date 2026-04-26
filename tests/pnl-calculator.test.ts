import { describe, expect, it } from "vitest";
import { calculateRealizedPnl, calculateUnrealizedPnl } from "../src/server/execution/pnl-calculator";

describe("pnl-calculator", () => {
  it("calculates unrealized pnl for long", () => {
    const value = calculateUnrealizedPnl("LONG", 100, 105, 2);
    expect(value).toBe(10);
  });

  it("calculates realized pnl with costs", () => {
    const value = calculateRealizedPnl({
      side: "LONG",
      entryPrice: 100,
      exitPrice: 110,
      quantity: 2,
      openFee: 0.5,
      closeFee: 0.6,
      slippageCost: 0.4,
    });
    expect(value.grossPnl).toBe(20);
    expect(value.netPnl).toBeCloseTo(18.5, 4);
    expect(value.roePercent).toBeGreaterThan(9);
  });
});
