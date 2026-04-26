import { describe, expect, it } from "vitest";
import { resolvePartialTakeProfitPlan, resolveSmartTakeProfitPercent } from "../src/server/execution/smart-targeting.service";

describe("smart-targeting", () => {
  it("volatilite ve confidence ile TP optimize eder", () => {
    const tp = resolveSmartTakeProfitPercent({
      baseTpPercent: 1.2,
      volatilityPercent: 1.7,
      confidencePercent: 91,
      expectedProfitPercent: 2.1,
    });
    expect(tp).toBeGreaterThan(1.2);
  });

  it("partial TP planı üretir", () => {
    const plan = resolvePartialTakeProfitPlan({
      takeProfitPercent: 2.4,
      stopLossPercent: 0.9,
    });
    expect(plan.enabled).toBe(true);
    expect(plan.firstTargetPercent).toBeGreaterThan(0);
    expect(plan.trailingDrawdownPercent).toBeGreaterThan(0);
  });
});
