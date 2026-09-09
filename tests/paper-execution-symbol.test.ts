import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  pairs: new Map<string, { symbol: string; baseAsset: string; quoteAsset: string }>(),
  platform: "tr" as "tr" | "com",
}));

vi.mock("@/lib/config", () => ({
  env: { BINANCE_PLATFORM: mocks.platform },
}));

vi.mock("@/src/server/db/prisma", () => ({
  prisma: {
    tradingPair: {
      findFirst: vi.fn(async ({ where }: { where: { symbol: string } }) => mocks.pairs.get(where.symbol) ?? null),
    },
  },
}));

import { resolvePaperExecutionSymbol } from "@/src/server/execution/paper-execution-symbol.service";

beforeEach(() => {
  mocks.platform = "tr";
  mocks.pairs = new Map([
    ["EGLDUSDT", { symbol: "EGLDUSDT", baseAsset: "EGLD", quoteAsset: "USDT" }],
    ["EGLDTRY", { symbol: "EGLDTRY", baseAsset: "EGLD", quoteAsset: "TRY" }],
    ["WLFITRY", { symbol: "WLFITRY", baseAsset: "WLFI", quoteAsset: "TRY" }],
  ]);
});

describe("resolvePaperExecutionSymbol", () => {
  it("prefers TRY execution over direct USDT pair on TR platform", async () => {
    const result = await resolvePaperExecutionSymbol("EGLDUSDT");
    expect(result.resolved).toBe(true);
    expect(result.executionSymbol).toBe("EGLDTRY");
    expect(result.quoteAsset).toBe("TRY");
    expect(result.reasonCode).toBe("USDT_SIGNAL_MAPPED_TO_TRY");
  });

  it("rejects USDT signal when TRY pair is missing", async () => {
    const result = await resolvePaperExecutionSymbol("XYZUSDT");
    expect(result.resolved).toBe(false);
    expect(result.reasonCode).toBe("TRY_PAIR_NOT_SUPPORTED");
  });

  it("uses direct pair when signal already matches an active pair", async () => {
    const result = await resolvePaperExecutionSymbol("WLFITRY");
    expect(result.resolved).toBe(true);
    expect(result.executionSymbol).toBe("WLFITRY");
    expect(result.reasonCode).toBeNull();
  });
});
