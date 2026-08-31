import { describe, expect, it } from "vitest";
import {
  isBlockingAiDecision,
  isExecutableAiDecision,
  normalizeAiDecision,
} from "@/src/server/execution/ai-execution-gate.service";

describe("NO_TRADE execution gate", () => {
  it("blocks non-executable AI decisions", () => {
    expect(isBlockingAiDecision("NO_TRADE")).toBe(true);
    expect(isBlockingAiDecision("NO TRADE")).toBe(true);
    expect(isBlockingAiDecision("HOLD")).toBe(true);
    expect(isBlockingAiDecision("REJECT")).toBe(true);
    expect(isBlockingAiDecision("WAIT")).toBe(true);
    expect(isBlockingAiDecision("")).toBe(true);
  });

  it("allows executable BUY/SELL decisions", () => {
    expect(isExecutableAiDecision("BUY")).toBe(true);
    expect(isExecutableAiDecision("SELL")).toBe(true);
    expect(isBlockingAiDecision("BUY")).toBe(false);
  });

  it("normalizes decision aliases", () => {
    expect(normalizeAiDecision("no-trade")).toBe("NO_TRADE");
    expect(normalizeAiDecision("No Trade")).toBe("NO_TRADE");
  });
});
