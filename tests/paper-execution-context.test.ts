import { executionMarketFixture } from "./helpers/execution-market-fixture";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ScannerCandidate } from "@/src/types/scanner";
const m = vi.hoisted(() => ({ snapshot: vi.fn(), resolve: vi.fn(), build: vi.fn(), score: vi.fn(), format: vi.fn(), ai: vi.fn() }));
vi.mock("@/src/server/execution/paper-execution-symbol.service", () => ({ resolvePaperExecutionSymbol: m.resolve }));
vi.mock("@/src/server/scanner/market-context-builder", () => ({ buildMarketContext: m.build }));
vi.mock("@/src/server/scanner/signal-scoring.engine", () => ({ scoreContext: m.score }));
vi.mock("@/src/server/scanner/ai-request-formatter", () => ({ formatAIRequest: m.format }));
vi.mock("@/src/server/ai/analysis-orchestrator", () => ({ runAIConsensusFromInput: m.ai }));
vi.mock("@/src/server/config/strategy-runtime.service", () => ({ getRuntimeStrategyParams: async () => ({}) }));
vi.mock("@/src/server/execution/execution-market-snapshot.service", async importOriginal => ({
  ...await importOriginal<typeof import("@/src/server/execution/execution-market-snapshot.service")>(), loadExecutionMarketSnapshot: m.snapshot,
}));
import { preparePaperExecutionContext } from "@/src/server/execution/paper-execution-context.service";
const source = () => ({ rank: 1, context: { symbol: "EGLDUSDT", lastPrice: 20,
  metadata: { opportunityCandidateId: "source:1", canonicalHandoff: { symbol: "EGLDUSDT" }, stopPrice: 19 } },
  score: { symbol: "EGLDUSDT", score: 70 }, ai: { targetPrice: 21 } }) as unknown as ScannerCandidate;
beforeEach(() => {
  vi.resetAllMocks();
  m.snapshot.mockImplementation(async symbol => executionMarketFixture(symbol));
  m.resolve.mockResolvedValue({ resolved: true, executionSymbol: "EGLDTRY" });
  m.build.mockResolvedValue({ symbol: "EGLDTRY", lastPrice: 900, metadata: { liveDataHealthy: true, dataQualityOk: true, stopPrice: 880 } });
  m.score.mockReturnValue({ symbol: "EGLDTRY", score: 61 });
  m.format.mockImplementation(async context => context);
  m.ai.mockResolvedValue({ finalDecision: "NO_TRADE", targetPrice: 920 });
});
it("rebuilds quantity inputs and absolute targets on execution quote, preserving source identity only", async () => {
  const candidate = source();
  const result = await preparePaperExecutionContext(candidate);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  expect(result.candidate).toMatchObject({ context: { symbol: "EGLDTRY", lastPrice: 900,
    metadata: { opportunityCandidateId: "source:1", signalSymbol: "EGLDUSDT", stopPrice: 880 } },
    score: { symbol: "EGLDTRY" }, ai: { finalDecision: "NO_TRADE", targetPrice: 920 } });
  expect(m.build).toHaveBeenCalledWith("EGLDTRY", expect.objectContaining({ forceLive: true, priority: "high", executionBundle: expect.any(Object), allowBackgroundIntelCapture: false }));
  expect(m.format.mock.calls[0][0].lastPrice).toBe(900);
  expect(candidate.context.lastPrice).toBe(20);
});
it.each([{ symbol: "EGLDUSDT", lastPrice: 20 }, { symbol: "EGLDTRY", lastPrice: 0 },
  { symbol: "EGLDTRY", lastPrice: 900, metadata: { liveDataHealthy: false } }])("fails closed on invalid execution data %j", async row => {
  m.build.mockResolvedValue({ metadata: { liveDataHealthy: true }, ...row });
  expect(await preparePaperExecutionContext(source())).toMatchObject({ ok: false, reason: "MARKET_DATA:EXECUTION_CONTEXT_UNAVAILABLE" });
  expect(m.ai).not.toHaveBeenCalled();
});
it("rebuilds even same-market consensus using actual execution venue data", async () => {
  const candidate = source(); candidate.context.symbol = "EGLDTRY";
  const result = await preparePaperExecutionContext(candidate);
  expect(result.ok).toBe(true);
  expect(m.snapshot).toHaveBeenCalledWith("EGLDTRY", expect.any(AbortSignal));
  expect(m.ai).toHaveBeenCalledTimes(1);
});
it("fails closed when TRY pair is unavailable", async () => {
  m.resolve.mockResolvedValue({ resolved: false, reasonCode: "TRY_PAIR_NOT_SUPPORTED" });
  expect(await preparePaperExecutionContext(source())).toEqual({ ok: false, reason: "SYMBOL_FILTER:TRY_PAIR_NOT_SUPPORTED" });
  expect(m.build).not.toHaveBeenCalled();
});

afterEach(() => vi.useRealTimers());
it("rejects stale snapshot before AI or context construction", async () => {
  const snap = executionMarketFixture("EGLDTRY"); snap.bundle.ticker.updatedAt = new Date(Date.now() - 60000).toISOString();
  m.snapshot.mockResolvedValue(snap);
  expect(await preparePaperExecutionContext(source())).toMatchObject({ ok: false, reason: "MARKET_DATA:EXECUTION_TICKER_STALE" });
  expect(m.build).not.toHaveBeenCalled(); expect(m.ai).not.toHaveBeenCalled();
});
it("bounds pending preparation and never invokes AI after cancellation", async () => {
  vi.useFakeTimers(); let resolve!: (value: unknown) => void;
  m.snapshot.mockReturnValue(new Promise(r => { resolve = r; }));
  const result = preparePaperExecutionContext(source());
  await vi.advanceTimersByTimeAsync(45001);
  expect(await result).toMatchObject({ ok: false, reason: "MARKET_DATA:EXECUTION_PREPARATION_TIMEOUT" });
  resolve(executionMarketFixture("EGLDTRY")); await Promise.resolve(); await Promise.resolve();
  expect(m.ai).not.toHaveBeenCalled();
});

it("distinguishes inactive execution trades from a broken market data provider", async () => {
  m.build.mockResolvedValue({ symbol: "EGLDTRY", lastPrice: 900, metadata: { liveDataHealthy: true, dataQualityOk: false, lastTradeAgeSec: 900, dataQualityIssues: ["PRICE_STALE"] } });
  expect(await preparePaperExecutionContext(source())).toMatchObject({ ok: false, reason: "STRATEGY:EXECUTION_TRADE_FLOW_STALE", details: { lastTradeAgeSec: 900 } });
  expect(m.ai).not.toHaveBeenCalled();
});
