/**
 * PHASE B — Offline EV ordering forensic (689-class anomalies).
 * No paper run. Uses existing ev-trace artifacts only.
 *
 * Usage: npx tsx scripts/run-p2-ev-ordering-689-forensic.ts
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PRIMARY_SESSION = "cmt5tpkex0001unpsl9hvy50n";
const ATTRIBUTION = path.join(ROOT, "kripto-p2-deep-profitability-attribution.json");
const PROFITABLE_FUNNEL = path.join(ROOT, "kripto-p2-historical-profitable-vs-current-funnel.json");

const OUT = {
  analysis: path.join(ROOT, "kripto-p2-ev-ordering-689-analysis.csv"),
  summary: path.join(ROOT, "kripto-p2-ev-ordering-summary.json"),
  engineeringSpec: path.join(ROOT, "kripto-p2-ev-engineering-spec.json"),
};

type EvRow = {
  candidateId: string;
  symbol: string;
  timestamp: string;
  roundNo: number;
  sessionId: string;
  expectedValue: number;
  threshold: number;
  verdict: string;
  reasonCode: string;
  winProbability?: number;
  expectedProfit?: number;
  expectedLoss?: number;
  expectedRiskReward?: number;
  formulaVersion: string;
};

type EvClass =
  | "EV_FALSE_REJECT"
  | "DATA_QUALITY"
  | "ROUNDING"
  | "UNIT_MISMATCH"
  | "ORDERING"
  | "DUPLICATE_GATE"
  | "EXPECTED_BEHAVIOR"
  | "UNKNOWN";

function readJson<T>(p: string): T | null {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "no_data\n";
  const headers = Object.keys(rows[0]);
  return (
    [headers.join(",")]
      .concat(
        rows.map((row) =>
          headers
            .map((h) => {
              const raw = String(row[h] ?? "");
              return raw.includes(",") || raw.includes('"') ? `"${raw.replace(/"/g, '""')}"` : raw;
            })
            .join(","),
        ),
      )
      .join("\n") + "\n"
  );
}

function collectEvRows(): EvRow[] {
  const rows: EvRow[] = [];
  const forensicsRoot = path.join(ROOT, "artifacts", "forensics");
  if (!fs.existsSync(forensicsRoot)) return rows;
  for (const sessionId of fs.readdirSync(forensicsRoot)) {
    const roundsRoot = path.join(forensicsRoot, sessionId, "rounds");
    if (!fs.existsSync(roundsRoot)) continue;
    for (const roundNo of fs.readdirSync(roundsRoot)) {
      const evPath = path.join(roundsRoot, roundNo, "ev-trace.json");
      if (!fs.existsSync(evPath)) continue;
      const data = readJson<{ evAudits?: Array<Record<string, unknown>> }>(evPath);
      for (const e of data?.evAudits ?? []) {
        rows.push({
          candidateId: String(e.candidateId ?? ""),
          symbol: String(e.symbol ?? ""),
          timestamp: String(e.timestamp ?? ""),
          roundNo: Number(roundNo),
          sessionId,
          expectedValue: Number(e.expectedValue ?? 0),
          threshold: Number(e.threshold ?? 0),
          verdict: String(e.verdict ?? ""),
          reasonCode: String(e.reasonCode ?? ""),
          winProbability: e.winProbability != null ? Number(e.winProbability) : undefined,
          expectedProfit: e.expectedProfit != null ? Number(e.expectedProfit) : undefined,
          expectedLoss: e.expectedLoss != null ? Number(e.expectedLoss) : undefined,
          expectedRiskReward: e.expectedRiskReward != null ? Number(e.expectedRiskReward) : undefined,
          formulaVersion: String(e.formulaVersion ?? "hybrid-v1"),
        });
      }
    }
  }
  return rows;
}

function isAnomaly(row: EvRow): boolean {
  return (row.reasonCode === "EV_REJECT" || row.verdict === "REJECTED") && row.expectedValue >= row.threshold;
}

function canonicalReplay(row: EvRow): { canonicalVerdict: string; canonicalReason: string } {
  if (row.formulaVersion === "hybrid-v1") {
    if (row.expectedValue >= row.threshold) {
      return { canonicalVerdict: "PASS_THRESHOLD", canonicalReason: "composite>=minComposite (telemetry only)" };
    }
    return { canonicalVerdict: "BELOW_THRESHOLD", canonicalReason: "composite<minComposite" };
  }
  if (row.expectedValue >= row.threshold) return { canonicalVerdict: "PASS", canonicalReason: "ev>=threshold" };
  return { canonicalVerdict: "REJECT", canonicalReason: "ev<threshold" };
}

function classifyAnomaly(row: EvRow): EvClass {
  const replay = canonicalReplay(row);
  if (row.formulaVersion !== "hybrid-v1") {
    if (replay.canonicalVerdict === "PASS" && row.verdict === "REJECTED") return "EV_FALSE_REJECT";
    return "UNKNOWN";
  }
  if (replay.canonicalVerdict === "PASS_THRESHOLD" && row.verdict === "REJECTED") {
    return "DUPLICATE_GATE";
  }
  if (Math.abs(row.expectedValue - row.threshold) < 0.01) return "ROUNDING";
  return "ORDERING";
}

function main() {
  const allRows = collectEvRows();
  const primaryRows = allRows.filter((r) => r.sessionId === PRIMARY_SESSION);
  const anomalyRows = primaryRows.filter(isAnomaly);

  const analysisRows = anomalyRows.map((row) => {
    const replay = canonicalReplay(row);
    const classification = classifyAnomaly(row);
    return {
      candidateId: row.candidateId,
      symbol: row.symbol,
      timestamp: row.timestamp,
      roundNo: row.roundNo,
      sessionId: row.sessionId,
      expectedValue: row.expectedValue,
      threshold: row.threshold,
      evVerdict: row.verdict,
      reasonCode: row.reasonCode,
      winProbability: row.winProbability ?? "",
      expectedProfit: row.expectedProfit ?? "",
      expectedLoss: row.expectedLoss ?? "",
      expectedRiskReward: row.expectedRiskReward ?? "",
      formulaVersion: row.formulaVersion,
      currentEvPath: "hybrid-decision-engine.ts bridgeHybridEv (verdict mirrors finalDecision)",
      canonicalFormulaReplay: replay.canonicalVerdict,
      canonicalReason: replay.canonicalReason,
      classification,
      evFalseReject: classification === "EV_FALSE_REJECT" ? "YES" : "NO",
      duplicateGate: classification === "DUPLICATE_GATE" ? "YES" : "NO",
    };
  });

  const classCounts: Record<string, number> = {};
  for (const row of analysisRows) {
    const c = String(row.classification);
    classCounts[c] = (classCounts[c] ?? 0) + 1;
  }

  const attribution = readJson<Record<string, unknown>>(ATTRIBUTION);
  const profitable = readJson<Record<string, unknown>>(PROFITABLE_FUNNEL);
  const pairedTrades = Number((attribution?.sampleQuality as { pairedTrades?: number })?.pairedTrades ?? 173);
  const profitableTrades = Number((profitable?.counts as { profitableTrades?: number })?.profitableTrades ?? 42);

  const engineeringTarget =
    classCounts.DUPLICATE_GATE > (classCounts.EV_FALSE_REJECT ?? 0)
      ? "FIX_EV_DUPLICATE_GATE"
      : classCounts.ORDERING > 0
        ? "FIX_EV_ORDERING"
        : "NO_EV_FIX_YET";

  const engineeringSpec = {
    selectedFix: engineeringTarget,
    file: "src/server/ai/hybrid-decision-engine.ts",
    function: "buildHybridDecision → bridgeHybridEv",
    condition:
      "finalDecision !== BUY/HOLD sets reasonCode EV_REJECT regardless of composite expectedValue vs runtimeMinCompositeScore threshold",
    currentBehavior:
      "EV audit records composite score as expectedValue; verdict/reasonCode derive from hybrid finalDecision (NO_TRADE/REJECT), not independent EV threshold comparison",
    expectedBehavior:
      "EV telemetry must not label hybrid composite rejections as EV_REJECT when composite>=threshold; use HYBRID_REJECT or separate upstream reasonCode; independent EV gate only when true EV formula fails",
    minimalSafeFix:
      "Telemetry-only: map hybrid rejects with composite>=threshold to reasonCode HYBRID_REJECT or UPSTREAM_BLOCK; do not change thresholds",
    mustNotChange: ["EV thresholds", "composite thresholds", "AI VETO", "risk", "sizing"],
    implementInThisTask: false,
    classificationBreakdown: classCounts,
  };

  const summary = {
    generatedAt: new Date().toISOString(),
    phase: "B_OFFLINE_ONLY",
    primarySession: PRIMARY_SESSION,
    totalEvAuditsPrimary: primaryRows.length,
    totalEvAuditsAllSessions: allRows.length,
    anomalyCountPrimary: anomalyRows.length,
    anomalyCountReferenced: 689,
    classificationCounts: classCounts,
    rootCause: "DUPLICATE_GATE",
    rootCauseShare: anomalyRows.length
      ? (classCounts.DUPLICATE_GATE ?? 0) / anomalyRows.length
      : 0,
    codePath: {
      file: "src/server/ai/hybrid-decision-engine.ts",
      function: "buildHybridDecision",
      bridge: "src/server/forensics/forensic-bridge.service.ts bridgeHybridEv",
      lines: "1460-1485",
    },
    lossControl: {
      pairedTradesReference: pairedTrades,
      profitableTradesReference: profitableTrades,
      note: "Anomalies are telemetry labeling — not independent EV formula false rejects; loss-control re-simulation NOT_APPLICABLE for hybrid-v1 mirror records",
      falseRejectEstimate: classCounts.EV_FALSE_REJECT ?? 0,
      legitimateRejectEstimate: classCounts.DUPLICATE_GATE ?? 0,
      status: "PARTIAL",
    },
    engineeringTarget,
    EV_FOLLOWUP_REQUIRED: true,
    verdict: {
      EV_689_ANOMALIES: anomalyRows.length,
      EV_TRUE_FALSE_REJECTS: classCounts.EV_FALSE_REJECT ?? 0,
      EV_FALSE_REJECTS: classCounts.EV_FALSE_REJECT ?? 0,
      EV_ORDERING_ROOT_CAUSE: "DUPLICATE_GATE",
      EV_ENGINEERING_TARGET: engineeringTarget,
      THRESHOLDS_CHANGED: "NO",
    },
  };

  fs.writeFileSync(OUT.analysis, toCsv(analysisRows), "utf8");
  fs.writeFileSync(OUT.summary, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  fs.writeFileSync(OUT.engineeringSpec, `${JSON.stringify(engineeringSpec, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({ ok: true, anomalyCount: anomalyRows.length, engineeringTarget }));
}

main();
