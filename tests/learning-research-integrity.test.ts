import { describe, expect, it, vi } from "vitest";
import { patternEconomics } from "@/src/server/learning-engine/pattern-economics";
import { researchSeedRecords } from "@/src/server/learning-engine/research-seed";
import { PaperProgressWatchdog } from "@/src/server/forensics/paper-progress-watchdog";
const db = vi.hoisted(() => ({ learningMemory: { upsert: vi.fn(async (x: unknown) => x) }, knowledgeBase: { upsert: vi.fn(async (x: unknown) => x) }, $transaction: vi.fn(async (x: Promise<unknown>[]) => Promise.all(x)) }));
vi.mock("@/src/server/db/prisma", () => ({ prisma: db }));
import { syncResearchSeedKnowledge } from "@/src/server/learning-engine/research-seed.service";
import { persistTradeLearningMemory } from "@/src/server/learning-engine/learning-engine.repository";
describe("learning evidence integrity", () => {
  it("computes PF from realized return gains/losses instead of expectancy", () => {
    const r = patternEconomics([10,-2,1,-1], ["paper"]);
    expect(r.profitFactor).toBeCloseTo(11/3); expect(r.expectancy).toBe(2); expect(r.status).toBe("NEUTRAL");
    expect(patternEconomics(Array(30).fill(1), ["paper"]).profitFactor).toBeUndefined();
    expect(patternEconomics([...Array(29).fill(1),-1], ["paper","live"]).status).toBe("NEUTRAL");
    expect(patternEconomics([...Array(29).fill(1),-1], ["paper"]).status).toBe("NEUTRAL");
    expect(patternEconomics([...Array(29).fill(1),-1], ["paper"], true).status).toBe("WINNING");
  });
  it("does not make seed knowledge available before its research timestamp", () => {
    expect(researchSeedRecords(Date.parse("2026-09-01"))).toHaveLength(0);
    const rows = researchSeedRecords(Date.parse("2026-09-11")); expect(rows).toHaveLength(33);
    expect(new Set(rows.map(r => r.id)).size).toBe(33);
    expect(rows.every(r => !r.metadata.trainingEligible && !r.metadata.autoApply)).toBe(true);
  });
  it("upserts only knowledge and uses stable trade-memory identifiers", async () => {
    await syncResearchSeedKnowledge(Date.parse("2026-09-11"));
    expect(db.knowledgeBase.upsert).toHaveBeenCalledTimes(33);
    const memory = { tradeId: "t1", symbol: "BTCTRY", features: {} };
    await persistTradeLearningMemory(memory); await persistTradeLearningMemory(memory);
    expect(db.learningMemory.upsert.mock.calls[0][0]).toMatchObject({ where: { id: "trade-learning:t1" } });
    expect(db.learningMemory.upsert.mock.calls[1][0]).toEqual(db.learningMemory.upsert.mock.calls[0][0]);
  });
});
describe("paper progress watchdog", () => {
  const stalledRound = [{ id: "1", state: "tariyor", endedAt: null, failReason: null }];
  const runtimeBase = {
    scannerSymbolsProcessed: 0,
    candidatesProcessed: 0,
    selectionAttempt: 1,
    step: "FULL_SCAN",
    selectionBudgetMs: 2_700_000,
    selectionStartedAtMs: 0,
  };

  it("stops a stalled empty chain but does not stop an open position monitor", () => {
    const w = new PaperProgressWatchdog(0);
    expect(w.observe({ nowMs: 0, openPositions: 0, rounds: [] }).shouldStop).toBe(false);
    expect(w.observe({ nowMs: 600001, openPositions: 0, rounds: [] }).reason).toBe("NO_ROUND_PROGRESS");
    expect(w.observe({ nowMs: 600002, openPositions: 1, rounds: [] }).shouldStop).toBe(false);
  });

  it("treats scanner counter progress as real progress even when round state is unchanged", () => {
    const w = new PaperProgressWatchdog(0);
    expect(w.observe({ nowMs: 0, openPositions: 0, rounds: stalledRound, runtime: runtimeBase }).shouldStop).toBe(false);
    expect(
      w.observe({
        nowMs: 9 * 60000,
        openPositions: 0,
        rounds: stalledRound,
        runtime: { ...runtimeBase, scannerSymbolsProcessed: 48 },
      }).shouldStop,
    ).toBe(false);
    expect(
      w.observe({
        nowMs: 19 * 60000,
        openPositions: 0,
        rounds: stalledRound,
        runtime: { ...runtimeBase, scannerSymbolsProcessed: 48 },
      }).reason,
    ).toBe("NO_ROUND_PROGRESS");
  });

  it("does not treat heartbeat-only time advancement as progress when counters are frozen", () => {
    const w = new PaperProgressWatchdog(0);
    const frozenRuntime = { ...runtimeBase, scannerSymbolsProcessed: 12, candidatesProcessed: 2 };
    expect(w.observe({ nowMs: 0, openPositions: 0, rounds: stalledRound, runtime: frozenRuntime }).shouldStop).toBe(false);
    expect(w.observe({ nowMs: 11 * 60000, openPositions: 0, rounds: stalledRound, runtime: frozenRuntime }).reason).toBe(
      "NO_ROUND_PROGRESS",
    );
  });

  it("keeps monitoring while an open position exists even without counter movement", () => {
    const w = new PaperProgressWatchdog(0);
    const frozenRuntime = { ...runtimeBase, scannerSymbolsProcessed: 12 };
    expect(w.observe({ nowMs: 0, openPositions: 1, rounds: stalledRound, runtime: frozenRuntime }).shouldStop).toBe(false);
    expect(w.observe({ nowMs: 20 * 60000, openPositions: 1, rounds: stalledRound, runtime: frozenRuntime }).shouldStop).toBe(false);
  });

  it("enforces the selection budget backstop without extending the stall window indefinitely", () => {
    const w = new PaperProgressWatchdog(0);
    const runtime = { ...runtimeBase, scannerSymbolsProcessed: 12, selectionStartedAtMs: 0, selectionBudgetMs: 2_700_000 };
    expect(w.observe({ nowMs: 2_700_001, openPositions: 0, rounds: stalledRound, runtime }).reason).toBe("SELECTION_BUDGET_EXCEEDED");
  });

  it.each(["execution:SAFE_MODE:SAFE_MODE_ACTIVE", "ai_evaluation:DATABASE:P2024", "execution:MARKET_DATA:EXECUTION_CONTEXT_UNAVAILABLE"])("recognizes persisted technical stage prefixes: %s", failReason => {
    const rounds = [3, 2, 1].map(id => ({ id: String(id), state: "done", endedAt: new Date(id), failReason }));
    expect(new PaperProgressWatchdog(0).observe({ nowMs: 100, openPositions: 0, rounds }).reason).toBe("REPEATED_TECHNICAL_FAILURE");
  });
  it("does not mislabel strategy rejection as infrastructure failure", () => {
    const rounds = [3, 2, 1].map(id => ({ id: String(id), state: "done", endedAt: new Date(id), failReason: "execution:STRATEGY:AI_NO_TRADE: low volume" }));
    expect(new PaperProgressWatchdog(0).observe({ nowMs: 100, openPositions: 0, rounds }).shouldStop).toBe(false);
  });
  it("does not apply completed round selection budgets to an idle job", () => {
    const rounds = [{ id: "1", state: "done", endedAt: new Date(1), failReason: "NO_VALID_SETUP" }];
    expect(new PaperProgressWatchdog(0).observe({ nowMs: 3_000_000, openPositions: 0, rounds, runtime: runtimeBase }).shouldStop).toBe(false);
  });

  it("allows healthy no-trades while detecting repeated infrastructure failures", () => {
    const w = new PaperProgressWatchdog(0);
    const rounds = [3, 2, 1].map((id) => ({ id: String(id), state: "tur_tamamlandi", endedAt: new Date(id), failReason: "NO_VALID_SETUP" }));
    expect(w.observe({ nowMs: 100, openPositions: 0, rounds }).shouldStop).toBe(false);
    rounds.forEach((r) => (r.failReason = "MARKET_DATA_NOT_READY"));
    expect(w.observe({ nowMs: 101, openPositions: 0, rounds }).reason).toBe("REPEATED_TECHNICAL_FAILURE");
  });

  it("detects repeated SAFE_MODE terminal failures as technical stall", () => {
    const w = new PaperProgressWatchdog(0);
    const rounds = [3, 2, 1].map((id) => ({
      id: String(id),
      state: "tur_basarisiz",
      endedAt: new Date(id),
      failReason: "SAFE_MODE:SAFE_MODE_ACTIVE",
    }));
    expect(w.observe({ nowMs: 200, openPositions: 0, rounds }).reason).toBe("REPEATED_TECHNICAL_FAILURE");
  });
});
