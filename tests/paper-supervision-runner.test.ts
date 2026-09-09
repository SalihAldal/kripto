import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const m = vi.hoisted(() => ({ status: "RUNNING", stop: vi.fn(), merge: vi.fn(async () => 1), disconnect: vi.fn(async () => undefined) }));
vi.mock("@/src/server/repositories/execution.repository", () => ({ getRuntimeExecutionContext: async () => ({ user: { id: "paper-user" } }) }));
vi.mock("@/src/server/execution/auto-round-engine.service", () => ({ startAutoRoundJob: async () => ({ started: true, jobId: "paper-job" }), getAutoRoundStatus: async () => ({ active: { id: "paper-job", status: m.status } }), stopAutoRoundJob: async () => { m.stop(); m.status = "STOPPED"; } }));
vi.mock("@/src/server/forensics/paper-preflight.service", () => ({ runPaperSessionPreflight: async () => ({ canStart: true }) }));
vi.mock("@/src/server/simulation/paper-trading.service", () => ({ ensurePaperAccountInitialized: async () => ({ balances: { TRY: 10000 } }) }));
vi.mock("@/src/server/forensics/paper-campaign-summary.service", () => ({ buildPaperCampaignSummary: async () => ({}) }));
vi.mock("@/src/server/db/prisma", () => ({ prisma: {
  $executeRaw: m.merge, $disconnect: m.disconnect,
  autoRoundJob: { findUnique: async () => ({ id: "paper-job", status: m.status, rounds: [] }) },
  autoRoundRun: { findMany: async () => [] }, position: { count: async () => 0, findMany: async () => [] }, paperTrade: { findMany: async () => [] },
} }));
import { runPaperCampaign } from "../scripts/paper-campaign-runner-core";
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it("stops a stalled production runner early and writes a zero-trade terminal result", async () => {
  vi.stubEnv("EXECUTION_MODE", "paper"); vi.stubEnv("LIVE_TRADING_ENABLED", "false");
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-10"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kripto-paper-supervision-"));
  const listeners = process.listenerCount("SIGTERM");
  try {
    const promise = runPaperCampaign({ campaignId: "unit", artifactRoot: root, resultFile: path.join(root, "result.json"), durationMs: 15*3600000, heartbeatMs: 60000, pollMs: 15000, terminalWaitMs: 120000, budgetPerTrade: 1000, maxWaitSec: 600 });
    await vi.advanceTimersByTimeAsync(11*60000);
    const result = await promise;
    expect(result).toMatchObject({ stopReason: "technical_stall", progressFailure: "NO_ROUND_PROGRESS", reachedTerminal: true, tradeCount: 0, completedFullDuration: false });
    expect(m.stop).toHaveBeenCalledOnce(); expect(m.merge).toHaveBeenCalledOnce();
    expect(fs.existsSync(path.join(root, "result.json"))).toBe(true);
    expect(process.listenerCount("SIGTERM")).toBe(listeners);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
