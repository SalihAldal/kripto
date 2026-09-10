import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaperDbUnavailableError } from "@/src/server/forensics/db-health.service";

const preflightMocks = vi.hoisted(() => ({
  validatePaperDbHealth: vi.fn(async () => ({ ok: true as const })),
  getEmergencyStopState: vi.fn(async () => false),
  listRunningAutoRoundJobs: vi.fn(async () => [] as Array<{ id: string; userId: string; aiMode: string; status: string }>),
  findRunningAutoRoundJob: vi.fn(async () => null),
  getAutoRoundJobById: vi.fn(async () => null),
  loadSchedulerLease: vi.fn(async () => null),
  updateAutoRoundJob: vi.fn(async (input: unknown) => input),
  updateAutoRoundRun: vi.fn(async (input: unknown) => input),
  getTicker: vi.fn(async () => ({ price: 3_000_000, change24h: 0, volume24h: 1 })),
  prismaFindMany: vi.fn(async () => [] as unknown[]),
}));

// Unit preflight tests must not wait for public exchange time endpoints.
vi.mock("@/src/server/execution-safety/clock-sync.service", () => ({
  evaluateClockSync: async () => ({ ok: true, skewMs: 0, forensics: { localTime: "2026-09-09", serverTime: "2026-09-09", clockOffsetMs: 0, clockSkewMs: 0, measuredLatencyMs: 1, skewThresholdMs: 5000, endpoint: "UNIT_FIXTURE", timestampSource: "UNIT_FIXTURE" } }),
  persistClockSyncForensics: vi.fn(),
}));

vi.mock("@/src/server/forensics/db-health.service", async () => {
  const actual = await vi.importActual<typeof import("@/src/server/forensics/db-health.service")>(
    "@/src/server/forensics/db-health.service",
  );
  return {
    ...actual,
    validatePaperDbHealth: preflightMocks.validatePaperDbHealth,
  };
});

vi.mock("@/src/server/repositories/execution.repository", () => ({
  getEmergencyStopState: preflightMocks.getEmergencyStopState,
  getRuntimeExecutionContext: vi.fn(async () => ({ user: { id: "user-1" } })),
}));

vi.mock("@/src/server/repositories/auto-round.repository", () => ({
  findRunningAutoRoundJob: preflightMocks.findRunningAutoRoundJob,
  listRunningAutoRoundJobs: preflightMocks.listRunningAutoRoundJobs,
  getAutoRoundJobById: preflightMocks.getAutoRoundJobById,
  loadSchedulerLease: preflightMocks.loadSchedulerLease,
  updateAutoRoundJob: preflightMocks.updateAutoRoundJob,
  updateAutoRoundRun: preflightMocks.updateAutoRoundRun,
}));

vi.mock("@/src/server/db/prisma", () => ({
  prisma: {
    autoRoundRun: {
      findMany: preflightMocks.prismaFindMany,
    },
  },
}));

vi.mock("@/services/binance.service", () => ({
  getTicker: preflightMocks.getTicker,
}));

vi.mock("@/src/server/config/strategy-runtime.service", () => ({
  getRuntimeStrategyParams: vi.fn(async () => ({ trade: {}, risk: {} })),
}));

describe("paper preflight blockers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preflightMocks.validatePaperDbHealth.mockResolvedValue({ ok: true });
    preflightMocks.getEmergencyStopState.mockResolvedValue(false);
    preflightMocks.listRunningAutoRoundJobs.mockResolvedValue([]);
    preflightMocks.findRunningAutoRoundJob.mockResolvedValue(null);
    preflightMocks.getAutoRoundJobById.mockResolvedValue(null);
    preflightMocks.loadSchedulerLease.mockResolvedValue(null);
    preflightMocks.prismaFindMany.mockResolvedValue([]);
    preflightMocks.getTicker.mockResolvedValue({ price: 3_000_000, change24h: 0, volume24h: 1 });
  });

  it("returns controlled PAPER_DB_UNAVAILABLE without ReferenceError on start path", async () => {
    preflightMocks.validatePaperDbHealth.mockRejectedValue(new PaperDbUnavailableError("db down"));
    const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
    const result = await runPaperSessionPreflight({ userId: "user-1", attemptId: "test-db-fail" });
    expect(result.canStart).toBe(false);
    expect(result.overallVerdict).toBe("BLOCKED");
    expect(result.database.reasonCode).toBe("PAPER_DB_UNAVAILABLE");
    expect(result.database.reasonDetail).toContain("db down");
    expect(() => new PaperDbUnavailableError("x")).not.toThrow();
  });

  it("reconciles stale RUNNING jobs without live scheduler evidence", async () => {
    preflightMocks.listRunningAutoRoundJobs.mockResolvedValue([
      { id: "job-stale", userId: "user-1", aiMode: "learning", status: "RUNNING" },
    ]);
    preflightMocks.getAutoRoundJobById.mockResolvedValue({
      id: "job-stale",
      status: "RUNNING",
      failedRounds: 0,
      rounds: [
        {
          id: "run-z1",
          state: "tariyor",
          endedAt: null,
          startedAt: new Date(Date.now() - 3600_000),
          metadata: {},
        },
      ],
    });

    const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
    const result = await runPaperSessionPreflight({ userId: "user-1", attemptId: "test-stale-job" });

    expect(preflightMocks.updateAutoRoundJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-stale", status: "STOPPED" }),
    );
    expect(preflightMocks.updateAutoRoundRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-z1", state: "tur_basarisiz" }),
    );
    expect(result.reconciledJobs).toHaveLength(1);
    expect(result.reconciledJobs[0]).toMatchObject({
      jobId: "job-stale",
      previousStatus: "RUNNING",
      newStatus: "STOPPED",
      reasonCode: "PREFLIGHT_STALE_RUNNING_JOB",
    });
  });

  it("reconciles zombie rounds with no live evidence", async () => {
    preflightMocks.prismaFindMany.mockResolvedValue([
      {
        id: "run-zombie",
        jobId: "job-old",
        state: "tariyor",
        endedAt: null,
        startedAt: new Date(Date.now() - 7200_000),
        metadata: {},
        job: { id: "job-old", status: "FAILED", aiMode: "learning", stopRequested: true },
      },
    ]);

    const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
    const result = await runPaperSessionPreflight({ userId: "user-1", attemptId: "test-zombie-round" });

    expect(preflightMocks.updateAutoRoundRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-zombie",
        state: "tur_basarisiz",
      }),
    );
    expect(result.reconciledRounds[0]).toMatchObject({
      roundId: "run-zombie",
      previousState: "tariyor",
      newState: "tur_basarisiz",
      reasonCode: "PREFLIGHT_ZOMBIE_ROUND_RECONCILED",
    });
  });

  it("reports emergency stop as paper-safe WARN rather than blocking live safety", async () => {
    preflightMocks.getEmergencyStopState.mockResolvedValue(true);
    const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
    const result = await runPaperSessionPreflight({ userId: "user-1", attemptId: "test-emergency-stop" });

    expect(result.emergencyStop.status).toBe("WARN");
    expect(result.emergencyStop.reasonCode).toBe("EMERGENCY_STOP_ACTIVE");
    expect(result.emergencyStop.metadata).toMatchObject({ blocksPaper: false, blocksLiveTrading: true });
    expect(result.canStart).toBe(true);
  });

  it("writes preflight artifact json under artifacts/forensics/preflight", async () => {
    const attemptId = `test-artifact-${Date.now()}`;
    const artifactDir = path.join(process.cwd(), "artifacts", "forensics", "preflight", attemptId);
    rmSync(artifactDir, { recursive: true, force: true });

    const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
    const result = await runPaperSessionPreflight({ userId: "user-1", attemptId });

    const artifactPath = path.join(artifactDir, "preflight.json");
    expect(result.artifactPath).toBe(artifactDir);
    expect(existsSync(artifactPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(artifactPath, "utf8"));
    expect(parsed.overallVerdict).toBeTruthy();
    expect(parsed.database.status).toBe("PASS");
    expect(parsed.resolvedConfig.status).toMatch(/PASS|WARN/);
  });
});

describe("startAutoRoundJob paper import regression", () => {
  it("routes paper startup through runPaperSessionPreflight instead of bare PaperDbUnavailableError reference", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/server/execution/auto-round-engine.service.ts"),
      "utf8",
    );
    expect(source).toContain('from "@/src/server/forensics/paper-preflight.service"');
    expect(source).toContain("runPaperSessionPreflight");
    expect(source).not.toMatch(/instanceof PaperDbUnavailableError/);
  });
});
