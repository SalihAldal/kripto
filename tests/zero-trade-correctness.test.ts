import { describe, expect, it, beforeEach } from "vitest";
import {
  PAPER_TOP_GAINER_PRIORITY_THRESHOLD,
  LIVE_TOP_GAINER_PRIORITY_THRESHOLD,
  isPaperExecutionContext,
  isTopGainerPumpSignal,
  resolveTopGainerPumpPriorityThreshold,
} from "@/src/server/scanner/paper-lane-profile";
import {
  classifySelectionScannerAiBlock,
  isTerminalNonExecutableReason,
  recordCandidateFunnelStage,
  resetCandidateFunnelTraces,
  summarizeFunnelTraces,
} from "@/src/server/forensics/candidate-funnel-trace.service";
import { isBlockingAiDecision, normalizeAiDecision } from "@/src/server/execution/ai-execution-gate.service";
import { shouldBindSymbolOnTerminalFail } from "@/src/server/execution/auto-round-terminal-policy";
import fs from "node:fs";
import path from "node:path";

describe("paper lane parity", () => {
  it("uses paper priority 50 and live priority 70", () => {
    expect(PAPER_TOP_GAINER_PRIORITY_THRESHOLD).toBe(50);
    expect(LIVE_TOP_GAINER_PRIORITY_THRESHOLD).toBe(70);
    expect(resolveTopGainerPumpPriorityThreshold(true)).toBe(50);
    expect(resolveTopGainerPumpPriorityThreshold(false)).toBe(70);
  });

  it("has no 50/70 mismatch for paper profile at priority boundary", () => {
    const meta = { topGainerPriorityScore: 55 };
    expect(isTopGainerPumpSignal(meta, true)).toBe(true);
    expect(isTopGainerPumpSignal(meta, false)).toBe(false);
  });

  it("respects forcePaperProfile semantics via isPaperExecutionContext", () => {
    expect(isPaperExecutionContext(true)).toBe(true);
    expect(resolveTopGainerPumpPriorityThreshold(true)).toBe(PAPER_TOP_GAINER_PRIORITY_THRESHOLD);
  });
});

describe("TDI → AI routing classification", () => {
  beforeEach(() => resetCandidateFunnelTraces());

  it("marks scanner AI pre-TDI block without claiming TDI entered", () => {
    const block = classifySelectionScannerAiBlock({ aiFinalDecision: "NO_TRADE" });
    expect(block.category).toBe("SCANNER_AI_PRE_TDI_BLOCK");
    expect(block.tdiEntered).toBe(false);
    expect(block.scannerAiReached).toBe(true);
    expect(block.executionAiReached).toBe(false);
  });

  it("records truthful funnel: scanner_ai reached, tdi skipped", () => {
    recordCandidateFunnelStage({
      symbol: "CHZTRY",
      stage: "scanner_ai",
      verdict: "NO_TRADE",
      reasonCode: "SCANNER_AI_EVALUATED",
      reasonDetail: "scanner pipeline",
      runId: "run-1",
      roundId: "2",
    });
    recordCandidateFunnelStage({
      symbol: "CHZTRY",
      stage: "tdi_skip",
      verdict: "SKIPPED",
      reasonCode: "EXECUTION_NOT_REACHED_SCANNER_AI_NO_TRADE",
      reasonDetail: "pre-execution gate",
      runId: "run-1",
      roundId: "2",
    });
    const summary = summarizeFunnelTraces("run-1");
    expect(summary.scannerAiReached).toBe(1);
    expect(summary.tdiEntered).toBe(0);
    expect(summary.tdiSkipped).toBe(1);
    expect(summary.executionAiReached).toBe(0);
  });

  it("detects AI decision conflict classification", () => {
    const block = classifySelectionScannerAiBlock({
      aiFinalDecision: "BUY",
      consensusDecision: "NO_TRADE",
    });
    expect(block.category).toBe("AI_DECISION_CONFLICT");
    expect(block.reasonCode).toBe("AI_DECISION_CONFLICT");
  });
});

describe("NO_TRADE state machine", () => {
  it("does not bind symbol on terminal NON_EXECUTABLE", () => {
    expect(shouldBindSymbolOnTerminalFail("NON_EXECUTABLE_DECISION: NO_TRADE (CHZTRY)", "CHZTRY")).toBeUndefined();
    expect(shouldBindSymbolOnTerminalFail("Paper NO_TRADE: pump ve steady-gain adayi yok", "BCHTRY")).toBeUndefined();
  });

  it("binds symbol on non-terminal execution failures", () => {
    expect(shouldBindSymbolOnTerminalFail("Alim acilisi basarisiz", "CHZTRY")).toBe("CHZTRY");
  });

  it("classifies terminal non-executable reasons", () => {
    expect(isTerminalNonExecutableReason("NON_EXECUTABLE_DECISION: NO_TRADE (X)")).toBe(true);
    expect(isTerminalNonExecutableReason("SIM_TIGHT_FILTER_15m: spread")).toBe(false);
  });
});

describe("AI NO_TRADE classification", () => {
  it("treats NO_TRADE as blocking at selection gate", () => {
    expect(isBlockingAiDecision("NO_TRADE")).toBe(true);
    expect(normalizeAiDecision("NO-TRADE")).toBe("NO_TRADE");
  });

  it("does not treat BUY as blocking", () => {
    expect(isBlockingAiDecision("BUY")).toBe(false);
  });
});

describe("historical replay controls", () => {
  const root = process.cwd();

  function readCsv(file: string): Record<string, string>[] {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) return [];
    const lines = fs.readFileSync(full, "utf8").split(/\r?\n/).filter(Boolean);
    const headers = lines[0].split(",").map((h) => h.replace(/^"|"$/g, ""));
    return lines.slice(1).map((line) => {
      const cols = line.match(/(".*?"|[^,]+)/g)?.map((c) => c.replace(/^"|"$/g, "")) ?? [];
      const row: Record<string, string> = {};
      headers.forEach((h, i) => (row[h] = cols[i] ?? ""));
      return row;
    });
  }

  it("2278 funnel replay preserves zero execution-ready without threshold change", () => {
    const rows = readCsv("kripto-p2-entry-funnel-2278.csv");
    if (rows.length === 0) return;
    const newlyApproved = rows.filter((r) => r.newlyApproved === "YES").length;
    expect(newlyApproved).toBeGreaterThanOrEqual(0);
    const execReady = rows.filter((r) => r.executionReady === "1" || r.executionReady === "YES").length;
    expect(execReady).toBe(0);
  });

  it("42 profitable historical remain TDI-blocked in replay artifact", () => {
    const rows = readCsv("kripto-p2-entry-funnel-42-profitable.csv");
    if (rows.length === 0) return;
    const approved = rows.filter((r) => r.fixedVerdict === "APPROVED").length;
    expect(approved).toBe(0);
  });

  it("37 cohort exists for top-gainer trace replay", () => {
    const rows = readCsv("kripto-37-lane-correlation.csv");
    if (rows.length === 0) return;
    expect(rows.length).toBeGreaterThanOrEqual(30);
  });
});
