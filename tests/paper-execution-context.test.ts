import { beforeEach, expect, it, vi } from "vitest";
import type { ScannerCandidate } from "@/src/types/scanner";
const m = vi.hoisted(() => ({ resolve: vi.fn(), build: vi.fn(), score: vi.fn(), format: vi.fn(), ai: vi.fn() }));
vi.mock("@/src/server/execution/paper-execution-symbol.service", () => ({ resolvePaperExecutionSymbol: m.resolve }));
vi.mock("@/src/server/scanner/market-context-builder", () => ({ buildMarketContext: m.build }));
vi.mock("@/src/server/scanner/signal-scoring.engine", () => ({ scoreContext: m.score }));
vi.mock("@/src/server/scanner/ai-request-formatter", () => ({ formatAIRequest: m.format }));
vi.mock("@/src/server/ai/analysis-orchestrator", () => ({ runAIConsensusFromInput: m.ai }));
vi.mock("@/src/server/config/strategy-runtime.service", () => ({ getRuntimeStrategyParams: async () => ({}) }));
import { preparePaperExecutionContext } from "@/src/server/execution/paper-execution-context.service";
const source = () => ({ rank: 1, context: { symbol: "EGLDUSDT", lastPrice: 20,
  metadata: { opportunityCandidateId: "source:1", canonicalHandoff: { symbol: "EGLDUSDT" }, stopPrice: 19 } },
  score: { symbol: "EGLDUSDT", score: 70 }, ai: { targetPrice: 21 } }) as unknown as ScannerCandidate;
beforeEach(() => {
  vi.resetAllMocks();
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
  expect(m.build).toHaveBeenCalledWith("EGLDTRY", { forceLive: true, priority: "high" });
  expect(m.format.mock.calls[0][0].lastPrice).toBe(900);
  expect(candidate.context.lastPrice).toBe(20);
});
it.each([{ symbol: "EGLDUSDT", lastPrice: 20 }, { symbol: "EGLDTRY", lastPrice: 0 },
  { symbol: "EGLDTRY", lastPrice: 900, metadata: { liveDataHealthy: false } }])("fails closed on invalid execution data %j", async row => {
  m.build.mockResolvedValue({ metadata: { liveDataHealthy: true }, ...row });
  expect(await preparePaperExecutionContext(source())).toMatchObject({ ok: false, reason: "MARKET_DATA:EXECUTION_CONTEXT_UNAVAILABLE" });
  expect(m.ai).not.toHaveBeenCalled();
});
it("does not recompute or overwrite same-market consensus", async () => {
  m.resolve.mockResolvedValue({ resolved: true, executionSymbol: "EGLDUSDT" });
  const candidate = source();
  expect(await preparePaperExecutionContext(candidate)).toEqual({ ok: true, candidate });
  expect(m.build).not.toHaveBeenCalled();
});
it("fails closed when TRY pair is unavailable", async () => {
  m.resolve.mockResolvedValue({ resolved: false, reasonCode: "TRY_PAIR_NOT_SUPPORTED" });
  expect(await preparePaperExecutionContext(source())).toEqual({ ok: false, reason: "SYMBOL_FILTER:TRY_PAIR_NOT_SUPPORTED" });
  expect(m.build).not.toHaveBeenCalled();
});
