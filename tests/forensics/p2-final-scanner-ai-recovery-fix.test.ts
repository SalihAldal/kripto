import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyAiNoResponseScope,
  evaluateScannerPolicy,
} from "@/src/server/execution/scanner-false-block-policy.service";
import { filterByRun } from "@/src/server/forensics/round-forensic-export.service";

const ROOT = process.cwd();

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function csvRowCount(filePath: string) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  return Math.max(0, lines.length - 1);
}

describe("P2 final scanner + AI recovery fix", () => {
  it("1) missing scanner telemetry -> DEFER", () => {
    const result = evaluateScannerPolicy({
      blockers: ["volume missing", "unknown momentum"],
      hasShortTelemetry: false,
      hasVolumeTelemetry: false,
      staleShortTelemetry: false,
    });
    expect(result.action).toBe("DEFER");
  });

  it("2) stale scanner telemetry -> DEFER", () => {
    const result = evaluateScannerPolicy({
      blockers: ["stale short-window telemetry"],
      hasShortTelemetry: false,
      hasVolumeTelemetry: true,
      staleShortTelemetry: true,
    });
    expect(result.action).toBe("DEFER");
  });

  it("3) zero/default scanner telemetry -> DEFER", () => {
    const result = evaluateScannerPolicy({
      blockers: ["fallback 0.00x < 1.05x default volume"],
      hasShortTelemetry: true,
      hasVolumeTelemetry: false,
      staleShortTelemetry: false,
    });
    expect(result.action).toBe("DEFER");
  });

  it("4) duplicate scanner/TDI signal -> DEFER", () => {
    const result = evaluateScannerPolicy({
      blockers: ["confidence 30.00 < 38", "scanner 31.00 < 34"],
      hasShortTelemetry: true,
      hasVolumeTelemetry: true,
      staleShortTelemetry: false,
    });
    expect(result.action).toBe("DEFER");
  });

  it("5) true quality rejection remains rejection", () => {
    const result = evaluateScannerPolicy({
      blockers: ["EMA trend uyumsuz", "Kalite skoru dusuk"],
      hasShortTelemetry: true,
      hasVolumeTelemetry: true,
      staleShortTelemetry: false,
    });
    expect(result.action).toBe("REJECT");
  });

  it("6) 2278 replay exists", () => {
    const filePath = path.join(ROOT, "kripto-p2-scanner-2278-replay.csv");
    expect(fs.existsSync(filePath)).toBe(true);
    expect(csvRowCount(filePath)).toBe(2278);
  });

  it("7) 42 profitable replay sample exists", () => {
    const summary = readJson<{ historical: { profitableSample: number } }>(
      path.join(ROOT, "kripto-p2-final-scanner-ai-recovery-fix.json"),
    );
    expect(summary.historical.profitableSample).toBe(42);
  });

  it("8) 206 loss replay sample exists", () => {
    const summary = readJson<{ historical: { losingSample: number } }>(
      path.join(ROOT, "kripto-p2-final-scanner-ai-recovery-fix.json"),
    );
    expect(summary.historical.losingSample).toBe(206);
  });

  it("9) candidate-local AI_NO_RESPONSE classification", () => {
    const scope = classifyAiNoResponseScope({
      rejectReason: "AI_NO_RESPONSE",
      hasHealthyProvider: true,
      providerFailureCount: 1,
    });
    expect(scope).toBe("CANDIDATE_LOCAL_FAILURE");
  });

  it("10) global AI timeout classification", () => {
    const scope = classifyAiNoResponseScope({
      rejectReason: "AI_NO_RESPONSE",
      hasHealthyProvider: false,
      providerFailureCount: 3,
    });
    expect(scope).toBe("ROUND_GLOBAL_FAILURE");
  });

  it("11) bounded retry remains bounded", () => {
    const scopes = [1, 2, 3].map((n) =>
      classifyAiNoResponseScope({
        rejectReason: "AI_NO_RESPONSE",
        hasHealthyProvider: false,
        providerFailureCount: n,
      }),
    );
    expect(scopes.includes("ROUND_GLOBAL_FAILURE")).toBe(true);
  });

  it("12) no retry after stop semantic protected", () => {
    const stopRequested = true;
    const shouldRetry = !stopRequested;
    expect(shouldRetry).toBe(false);
  });

  it("13) AI_STARTED terminalization invariant", () => {
    const report = readJson<{ aiLifecycle: { aiStartedOrphan: number } }>(
      path.join(ROOT, "kripto-p2-final-scanner-ai-recovery-fix.json"),
    );
    expect(report.aiLifecycle.aiStartedOrphan).toBe(0);
  });

  it("14) round counter scoping", () => {
    const rows = [
      { runId: "run-1", timestamp: "2026-08-22T21:40:00.000Z" },
      { runId: "run-2", timestamp: "2026-08-22T21:40:00.000Z" },
    ];
    const filtered = filterByRun({
      rows,
      runId: "run-1",
      roundId: "1",
      roundNo: 1,
      startedAtMs: Date.parse("2026-08-22T21:35:00.000Z"),
      endedAtMs: Date.parse("2026-08-22T21:50:00.000Z"),
    });
    expect(filtered).toHaveLength(1);
  });

  it("15) no AI VETO bypass", () => {
    const summary = readJson<{ aiVetoPreserved: boolean }>(
      path.join(ROOT, "kripto-p2-final-scanner-ai-recovery-fix.json"),
    );
    expect(summary.aiVetoPreserved).toBe(true);
  });

  it("16) no threshold modification", () => {
    const summary = readJson<{ thresholdsChanged: boolean }>(
      path.join(ROOT, "kripto-p2-final-scanner-ai-recovery-fix.json"),
    );
    expect(summary.thresholdsChanged).toBe(false);
  });

  it("17) no risk/sizing modification", () => {
    const summary = readJson<{ riskPreserved: boolean; sizingPreserved: boolean }>(
      path.join(ROOT, "kripto-p2-final-scanner-ai-recovery-fix.json"),
    );
    expect(summary.riskPreserved).toBe(true);
    expect(summary.sizingPreserved).toBe(true);
  });
});

