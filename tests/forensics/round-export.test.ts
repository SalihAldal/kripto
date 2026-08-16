import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { exportRoundForensicArtifacts } from "@/src/server/forensics/round-forensic-export.service";
import { ensureForensicSession, clearForensicSession } from "@/src/server/forensics/forensic-context";
import { traceCandidateReject } from "@/src/server/forensics/candidate-lifecycle.service";

describe("round forensic export", () => {
  const sessionId = "export-test-session";
  const roundId = "14";
  const runId = "run-export-14";
  const exportRoot = path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds", roundId);

  beforeEach(() => {
    clearForensicSession();
    if (existsSync(exportRoot)) {
      rmSync(path.join(process.cwd(), "artifacts", "forensics", sessionId), { recursive: true, force: true });
    }
    const session = ensureForensicSession({ sessionId, jobId: sessionId, runId, mode: "paper" });
    traceCandidateReject({
      symbol: "AVNTTRY",
      stage: "scanner",
      reasonCode: "NO_CANDIDATE",
      reasonDetail: "selection empty",
    });
    session.decisions.push({
      candidateId: "d1",
      symbol: "AVNTTRY",
      stage: "decision",
      verdict: "REJECT",
      reasonCode: "NO_CANDIDATE",
      reasonDetail: "selection empty",
      timestamp: new Date().toISOString(),
    });
  });

  afterEach(() => {
    if (existsSync(path.join(process.cwd(), "artifacts", "forensics", sessionId))) {
      rmSync(path.join(process.cwd(), "artifacts", "forensics", sessionId), { recursive: true, force: true });
    }
    clearForensicSession();
  });

  it("writes round-summary and trace artifacts on round end", async () => {
    const session = ensureForensicSession({ sessionId, jobId: sessionId, runId });
    const result = await exportRoundForensicArtifacts({
      session,
      roundId,
      runId,
      jobId: sessionId,
      roundNo: 14,
      startedAt: new Date(Date.now() - 60_000),
      endedAt: new Date(),
      failReason: "PUMP_SCAN_FAILED: timeout",
      result: "failed",
    });
    expect(result.rootDir).toContain(path.join("rounds", roundId));
    expect(existsSync(path.join(result.rootDir, "round-summary.json"))).toBe(true);
    expect(existsSync(path.join(result.rootDir, "recovery-decisions.json"))).toBe(true);
    expect(existsSync(path.join(result.rootDir, "recovery-telemetry.json"))).toBe(true);
    expect(existsSync(path.join(result.rootDir, "candidate-trace.json"))).toBe(true);
    expect(existsSync(path.join(result.rootDir, "decision-trace.json"))).toBe(true);
    const summary = JSON.parse(readFileSync(path.join(result.rootDir, "round-summary.json"), "utf8"));
    expect(summary.roundNo).toBe(14);
    expect(summary.failureCount).toBeGreaterThan(0);
    expect(summary.artifactRefs.scanner).toBe("scanner-summary.json");
  });
});
