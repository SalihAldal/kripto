import { describe, expect, it } from "vitest";
import { resolveMtfAlignmentContract } from "@/src/server/trading-core/backtest/paper-round-gates";

describe("paper round mtf contract", () => {
  it("prefers AI alignment when available", () => {
    const resolved = resolveMtfAlignmentContract({
      aiAlignment: 62.5,
      contextAlignment: 41,
    });
    expect(resolved.status).toBe("AVAILABLE");
    expect(resolved.source).toBe("AI");
    expect(resolved.score).toBe(62.5);
  });

  it("falls back to market context when AI is unavailable", () => {
    const resolved = resolveMtfAlignmentContract({
      aiAlignment: undefined,
      contextAlignment: 44.2,
    });
    expect(resolved.status).toBe("AVAILABLE");
    expect(resolved.source).toBe("MARKET_CONTEXT");
    expect(resolved.score).toBe(44.2);
  });

  it("returns explicit unavailable when both missing", () => {
    const resolved = resolveMtfAlignmentContract({
      aiAlignment: null,
      contextAlignment: undefined,
    });
    expect(resolved.status).toBe("UNAVAILABLE");
    expect(resolved.source).toBe("NONE");
    expect(resolved.score).toBeNull();
  });
});
