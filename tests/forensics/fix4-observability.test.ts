import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { ensureForensicSession, clearForensicSession } from "@/src/server/forensics/forensic-context";
import { resolveRuntimeConfigSnapshot } from "@/src/server/forensics/resolved-config.service";
import { evaluateConfigDrift } from "@/src/server/forensics/config-hash.service";
import { getCanonicalCandidateStore, resetCanonicalCandidateStoreForTests } from "@/src/server/candidate/candidate-store.service";
import { getCanonicalEventLog, resetCanonicalEventLog } from "@/src/server/forensics/canonical-event.service";
import { runRoundForensicExport } from "@/src/server/forensics/forensic-export-runner.service";
import { generateValidationReport } from "@/src/server/forensics/validation-report-generator.service";

describe("fix4 observability", () => {
  const sessionId = "fix4-observability-session";
  const runId = "run-fix4-observability";
  const roundId = "4";
  const exportRoot = path.join(process.cwd(), "artifacts", "forensics", sessionId);

  beforeEach(() => {
    clearForensicSession();
    resetCanonicalEventLog();
    resetCanonicalCandidateStoreForTests();
    if (existsSync(exportRoot)) {
      rmSync(exportRoot, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    clearForensicSession();
    resetCanonicalEventLog();
    resetCanonicalCandidateStoreForTests();
    if (existsSync(exportRoot)) {
      rmSync(exportRoot, { recursive: true, force: true });
    }
  });

  it("produces deterministic config hash and drift signal", async () => {
    const a = await resolveRuntimeConfigSnapshot();
    const b = await resolveRuntimeConfigSnapshot();
    expect(typeof a.configHash).toBe("string");
    expect(a.configHash?.length).toBeGreaterThan(10);
    expect(a.configHash).toBe(b.configHash);

    const stable = evaluateConfigDrift({
      runId,
      initialHash: String(a.configHash),
      currentHash: String(b.configHash),
    });
    expect(stable.driftDetected).toBe(false);

    const drift = evaluateConfigDrift({
      runId,
      initialHash: String(a.configHash),
      currentHash: `${String(a.configHash)}-drift`,
    });
    expect(drift.driftDetected).toBe(true);
    expect(drift.status).toBe("CONFIG_DRIFT_DETECTED");
  });

  it("records canonical candidate lifecycle events with terminal reason", () => {
    ensureForensicSession({ sessionId, runId, roundId, mode: "paper" });
    const store = getCanonicalCandidateStore();
    const candidate = store.createCandidate({
      candidateId: "cand-fix4-1",
      symbol: "BTCUSDT",
      lane: "STEADY",
      detectedAt: Date.now(),
      detectedPrice: 100,
    });

    store.transitionCandidate(candidate.candidateId, "HOT", ["HOT_SCORE_CONFIRMED"]);
    store.transitionCandidate(candidate.candidateId, "MICRO_ANALYZED", ["MICRO_SAMPLE_READY"]);
    store.transitionCandidate(candidate.candidateId, "MICRO_REJECTED", ["MICRO_WIDE_SPREAD"]);

    const events = getCanonicalEventLog(runId);
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events.some((row) => row.eventType === "CANDIDATE_HOT")).toBe(true);
    expect(events.some((row) => row.eventType === "MICRO_REJECTED")).toBe(true);
    const terminal = store.getCandidate(candidate.candidateId);
    expect(terminal?.terminalReason).toBe("MICRO_WIDE_SPREAD");
  });

  it("exports fix4 runtime/shadow artifacts", async () => {
    const session = ensureForensicSession({ sessionId, runId, roundId, mode: "paper" });
    const result = await runRoundForensicExport({
      session,
      roundId,
      runId,
      roundNo: 4,
      jobId: sessionId,
      startedAt: new Date(Date.now() - 20_000),
      endedAt: new Date(),
      result: "completed",
    });
    expect(result.exportStatus).toBe("COMPLETED");
    const roundRoot = path.join(exportRoot, "rounds", roundId);
    expect(existsSync(path.join(roundRoot, "run-identity.json"))).toBe(true);
    expect(existsSync(path.join(roundRoot, "config-drift.json"))).toBe(true);
    expect(existsSync(path.join(roundRoot, "canonical-events.json"))).toBe(true);
    expect(existsSync(path.join(roundRoot, "runtime-telemetry.json"))).toBe(true);
    expect(existsSync(path.join(roundRoot, "edge-analytics.json"))).toBe(true);
    const identity = JSON.parse(readFileSync(path.join(roundRoot, "run-identity.json"), "utf8")) as {
      runId: string;
      configHash: string | null;
    };
    expect(identity.runId).toBe(runId);
    expect(identity.configHash === null || identity.configHash.length > 10).toBe(true);
    const generated = generateValidationReport(runId);
    expect(generated.found).toBe(true);
    expect(String(generated.report)).toContain("## RUN INFO");
  });
});
