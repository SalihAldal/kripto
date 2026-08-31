import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
  ensureRoundHangSnapshotForAbnormalTerminal,
  writeRoundHangSnapshotArtifact,
} from "@/src/server/forensics/round-progress-watchdog.service";
import { classifyRoundTerminalReason } from "@/src/server/forensics/round-terminal-classification.service";

const sessionId = "hang-snapshot-test-session";
const root = path.join(process.cwd(), "artifacts", "forensics", sessionId);

function roundRootFor(roundId: string) {
  return path.join(root, "rounds", roundId);
}

function cleanup() {
  rmSync(root, { recursive: true, force: true });
}

function readSnapshot(roundId = "1") {
  return JSON.parse(
    readFileSync(path.join(roundRootFor(roundId), "round-hang-snapshot.json"), "utf8"),
  ) as Record<string, unknown>;
}

function writeFor(reason: string, reasonCode?: string, roundId = "1") {
  return ensureRoundHangSnapshotForAbnormalTerminal({
    sessionId,
    roundId,
    runId: "run-1",
    jobId: sessionId,
    nowIso: new Date().toISOString(),
    startedAt: new Date(Date.now() - 120_000).toISOString(),
    endedAt: new Date().toISOString(),
    terminalReason: reason,
    terminalReasonCode: reasonCode,
    currentStage: "AI_ANALYSIS",
    runtime: {
      step: "TIMEOUT",
      selectionBudgetMs: 1_200_000,
      elapsedMs: 1_236_000,
      heartbeatAt: new Date(Date.now() - 2_000).toISOString(),
      lastMeaningfulProgressAt: new Date(Date.now() - 15_000).toISOString(),
      poolActive: 0,
      poolQueued: 0,
      retryCount: 2,
      lastPersistAt: new Date().toISOString(),
    },
    watchdog: {
      progressState: "STALLED",
      decision: "FAIL_ROUND",
    },
  });
}

describe("hang snapshot contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("classifies abnormal and normal terminal reasons", () => {
    expect(
      classifyRoundTerminalReason({ reason: "Tur secim suresi doldu (1200s)" }).terminalClass,
    ).toBe("ABNORMAL_RUNTIME_TERMINAL");
    expect(classifyRoundTerminalReason({ reason: "AI_GATE_BLOCK: AI_VETO" }).terminalClass).toBe("NORMAL_TERMINAL");
  });

  it("creates snapshot for SELECTION_BUDGET_EXCEEDED", () => {
    const result = writeFor("Tur secim suresi doldu (1200s)", "SELECTION_BUDGET_EXCEEDED");
    expect(result.written).toBe(true);
    expect(existsSync(path.join(roundRootFor("1"), "round-hang-snapshot.json"))).toBe(true);
  });

  it("creates snapshot for ROUND_STALLED, JOB_TIMEOUT, PERSIST_TIMEOUT, and retry budget exhausted", () => {
    for (const reasonCode of [
      "ROUND_STALLED",
      "JOB_TIMEOUT",
      "PERSIST_TIMEOUT",
      "DEPENDENCY_RETRY_BUDGET_EXHAUSTED",
    ]) {
      cleanup();
      const result = writeFor(reasonCode, reasonCode, `ab-${reasonCode}`);
      expect(result.written).toBe(true);
      expect(existsSync(path.join(roundRootFor(`ab-${reasonCode}`), "round-hang-snapshot.json"))).toBe(true);
    }
  });

  it("does not require snapshot for normal business terminals", () => {
    const veto = writeFor("AI_GATE_BLOCK: AI_VETO", "AI_GATE_BLOCK");
    const tdi = writeFor("TDI_REJECT", "TDI_REJECT");
    const sim = writeFor("SIM_TIGHT_FILTER_profile", "SIM_TIGHT_FILTER");
    expect(veto.attempted).toBe(false);
    expect(tdi.attempted).toBe(false);
    expect(sim.attempted).toBe(false);
    expect(existsSync(path.join(roundRootFor("1"), "round-hang-snapshot.json"))).toBe(false);
  });

  it("is idempotent for same round + same abnormal reason", () => {
    const first = writeFor("ROUND_STALLED: no progress", "ROUND_STALLED");
    const second = writeFor("ROUND_STALLED: no progress", "ROUND_STALLED");
    expect(first.written).toBe(true);
    expect(second.written).toBe(false);
    expect(second.reason).toMatch(/IDEMPOTENT_SKIP|EXISTING_MATCH/);
  });

  it("writes export-error.json when snapshot export fails", () => {
    vi.spyOn(JSON, "stringify").mockImplementationOnce(() => {
      throw new Error("snapshot-fail");
    });
    const result = writeFor("ROUND_STALLED: forced failure", "ROUND_STALLED", "exp-fail-1");
    expect(result.reason).toBe("EXPORT_FAILED");
    expect(existsSync(path.join(roundRootFor("exp-fail-1"), "export-error.json"))).toBe(true);
  });

  it("snapshot contains required forensic fields", () => {
    writeFor("Tur secim suresi doldu (1200s)", "SELECTION_BUDGET_EXCEEDED", "schema-1");
    const snapshot = readSnapshot("schema-1");
    for (const field of [
      "schemaVersion",
      "roundId",
      "jobId",
      "sessionId",
      "terminalReason",
      "terminalClass",
      "currentStage",
      "startedAt",
      "snapshotAt",
      "selectionBudgetMs",
      "selectionElapsedMs",
      "remainingBudgetMs",
      "lastMeaningfulProgressAt",
      "lastHeartbeatAt",
      "activeCandidates",
      "poolActive",
      "poolQueued",
      "retryCount",
      "watchdogState",
      "terminalizationStartedAt",
      "selectionTimeBudgetBreakdownRef",
      "roundLivenessRef",
      "recoveryTelemetryRef",
    ]) {
      expect(snapshot[field]).not.toBeUndefined();
    }
  });

  it("cyclic/deep runtime payload does not crash snapshot export", () => {
    const cyclic: Record<string, unknown> = {
      step: "TIMEOUT",
      selectionBudgetMs: 1000,
      elapsedMs: 2000,
      heartbeatAt: new Date().toISOString(),
      lastMeaningfulProgressAt: new Date().toISOString(),
    };
    cyclic.self = cyclic;
    const result = ensureRoundHangSnapshotForAbnormalTerminal({
      sessionId,
      roundId: "cyclic-1",
      runId: "run-1",
      jobId: sessionId,
      nowIso: new Date().toISOString(),
      terminalReason: "ROUND_STALLED",
      terminalReasonCode: "ROUND_STALLED",
      runtime: cyclic,
    });
    expect(result.written).toBe(true);
    expect(existsSync(path.join(roundRootFor("cyclic-1"), "round-hang-snapshot.json"))).toBe(true);
  });

  it("export failure does not throw and business flow remains non-blocking", () => {
    vi.spyOn(JSON, "stringify").mockImplementationOnce(() => {
      throw new Error("non-blocking-export-failure");
    });
    expect(() => writeFor("JOB_TIMEOUT", "JOB_TIMEOUT", "exp-fail-2")).not.toThrow();
    expect(existsSync(path.join(roundRootFor("exp-fail-2"), "export-error.json"))).toBe(true);
  });

  it("writer sanitizes payload without embedding raw runtime objects", () => {
    writeRoundHangSnapshotArtifact({
      sessionId,
      roundId: "sanitize-1",
      nowIso: new Date().toISOString(),
      terminalReason: "PERSIST_TIMEOUT",
      terminalReasonCode: "PERSIST_TIMEOUT",
      runtime: {
        step: "TIMEOUT",
        selectionBudgetMs: 1000,
        elapsedMs: 2000,
        nested: { deep: { value: "kept only via summaries" } },
      },
    });
    const snapshot = readSnapshot("sanitize-1");
    expect(snapshot.runtime).toBeUndefined();
    expect(snapshot.terminalReasonCode).toBe("PERSIST_TIMEOUT");
  });
});
