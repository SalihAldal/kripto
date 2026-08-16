import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ensureForensicSession, clearForensicSession } from "@/src/server/forensics/forensic-context";
import { runRoundForensicExport } from "@/src/server/forensics/forensic-export-runner.service";
import * as exportService from "@/src/server/forensics/round-forensic-export.service";

describe("forensic export runner", () => {
  const sessionId = "export-runner-session";
  const roundId = "2";
  const runId = "run-export-2";
  const exportRoot = path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds", roundId);

  beforeEach(() => {
    clearForensicSession();
    if (existsSync(path.join(process.cwd(), "artifacts", "forensics", sessionId))) {
      rmSync(path.join(process.cwd(), "artifacts", "forensics", sessionId), { recursive: true, force: true });
    }
    ensureForensicSession({ sessionId, jobId: sessionId, runId, mode: "paper" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(path.join(process.cwd(), "artifacts", "forensics", sessionId))) {
      rmSync(path.join(process.cwd(), "artifacts", "forensics", sessionId), { recursive: true, force: true });
    }
    clearForensicSession();
  });

  it("writes failed-round partial bundle for execution safety failure", async () => {
    const session = ensureForensicSession({ sessionId, jobId: sessionId, runId });
    const result = await runRoundForensicExport({
      session,
      roundId,
      runId,
      jobId: sessionId,
      roundNo: 2,
      startedAt: new Date(Date.now() - 120_000),
      endedAt: new Date(),
      failReason: "Clock synchronization failed (skew 300000ms)",
      result: "failed",
      terminalState: "tur_basarisiz",
      currentStage: "EXECUTING",
    });
    expect(result.exportStatus).toBe("COMPLETED");
    expect(existsSync(path.join(exportRoot, "round-summary.json"))).toBe(true);
    expect(existsSync(path.join(exportRoot, "recovery-decisions.json"))).toBe(true);
    expect(existsSync(path.join(exportRoot, "recovery-telemetry.json"))).toBe(true);
    const summary = JSON.parse(readFileSync(path.join(exportRoot, "round-summary.json"), "utf8"));
    expect(summary.exportKind).toBe("failed-round-partial");
    expect(summary.failReason).toContain("Clock synchronization failed");
  });

  it("creates export-error.json when export throws without mutating business state", async () => {
    const session = ensureForensicSession({ sessionId, jobId: sessionId, runId });
    vi.spyOn(exportService, "exportRoundForensicArtifacts").mockRejectedValueOnce(new Error("simulated export failure"));
    const result = await runRoundForensicExport({
      session,
      roundId,
      runId,
      jobId: sessionId,
      roundNo: 2,
      failReason: "simulated failure",
      result: "failed",
    });
    expect(result.exportStatus).toBe("FAILED");
    expect(result.errorMessage).toContain("simulated export failure");
    expect(existsSync(path.join(exportRoot, "export-error.json"))).toBe(true);
  });
});
