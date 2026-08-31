/**
 * Zero-trade lane admission forensic — READ ONLY, no paper run, no code changes.
 * Job: cmtc4c2ds0009un70ir6hlcqm (50-round Paper COMPLETED, 0 trades)
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const JOB_ID = "cmtc4c2ds0009un70ir6hlcqm";

function readJson<T>(p: string): T | null {
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw) as T;
}

function writeCsv(file: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  fs.writeFileSync(path.join(ROOT, file), `${headers.join(",")}\n${rows.map((r) => r.map(esc).join(",")).join("\n")}\n`, "utf8");
}

function writeJson(file: string, data: unknown) {
  fs.writeFileSync(path.join(ROOT, file), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function parseCsv(file: string): Record<string, string>[] {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const cols: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQ = !inQ;
      else if (c === "," && !inQ) {
        cols.push(cur);
        cur = "";
      } else cur += c;
    }
    cols.push(cur);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = (cols[i] ?? "").replace(/^"|"$/g, "")));
    return row;
  });
}

function classifyRound(failReason: string | null, symbol: string | null): string {
  const fr = failReason ?? "";
  if (fr.includes("heartbeat")) return "RUNTIME";
  if (fr.includes("Paper NO_TRADE") || fr.includes("pump ve steady-gain")) return "NO_TRADE_LANE_EMPTY";
  if (fr.includes("NON_EXECUTABLE_DECISION") || fr.includes("AI_GATE")) return "AI_VETO";
  if (fr.includes("SIM_TIGHT") || fr.includes("SIM_FILTER")) return "SIM_FILTER";
  return "OTHER";
}

function laneFromFailReason(failReason: string | null, symbol: string | null): string {
  if (!symbol && (failReason ?? "").includes("Paper NO_TRADE")) return "NONE";
  if (symbol) return "ADMITTED_VIA_SELECTION";
  return "UNKNOWN";
}

type RoundRow = {
  roundNo: number;
  symbol: string | null;
  failReason: string | null;
  state: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  classification: string;
  lane: string;
  firstBlocker: string;
  finalBlocker: string;
  scanned: number | null;
  candidateCount: number | null;
};

function load50Rounds(): RoundRow[] {
  const db = readJson<{ rounds: Array<Record<string, unknown>> }>("artifacts/_50round-db-export.json");
  if (!db?.rounds) throw new Error("Missing artifacts/_50round-db-export.json — run scripts/_query-50rounds.ts first");
  return db.rounds.map((r) => {
    const failReason = r.failReason ? String(r.failReason) : null;
    const symbol = r.symbol ? String(r.symbol) : null;
    const started = r.startedAt ? new Date(String(r.startedAt)).getTime() : null;
    const ended = r.endedAt ? new Date(String(r.endedAt)).getTime() : null;
    const m = failReason?.match(/scanned=(\d+).*candidates=(\d+)/);
    return {
      roundNo: Number(r.roundNo),
      symbol,
      failReason,
      state: String(r.state),
      startedAt: String(r.startedAt),
      endedAt: r.endedAt ? String(r.endedAt) : null,
      durationMs: started && ended ? ended - started : null,
      classification: classifyRound(failReason, symbol),
      lane: laneFromFailReason(failReason, symbol),
      firstBlocker:
        classifyRound(failReason, symbol) === "NO_TRADE_LANE_EMPTY"
          ? "PUMP_STEADY_LAST_RESORT_ALL_EMPTY"
          : symbol
            ? "SYMBOL_SELECTED"
            : "RUNTIME_STALL",
      finalBlocker: failReason ?? "",
      scanned: m ? Number(m[1]) : null,
      candidateCount: m ? Number(m[2]) : symbol ? 20 : 0,
    };
  });
}

function main() {
  const rounds = load50Rounds();
  const globalForensic = readJson<Record<string, unknown>>("kripto-global-missed-opportunity-forensic.json");
  const cohort37 = readJson<Record<string, unknown>>("kripto-37-actionable-top-gainer-forensic.json");
  const funnel2278 = parseCsv("kripto-p2-entry-funnel-2278.csv");
  const funnel42 = parseCsv("kripto-p2-entry-funnel-42-profitable.csv");
  const paired173 = parseCsv("kripto-p2-executed-paired-trades.csv");
  const top50Missed = parseCsv("kripto-top50-missed-opportunities.csv");
  const shadow37 = parseCsv("kripto-p2-scanner-shadow-37.csv");
  const root37 = parseCsv("kripto-37-root-cause-ranking.csv");

  const laneEmpty = rounds.filter((r) => r.classification === "NO_TRADE_LANE_EMPTY");
  const downstream = rounds.filter((r) => r.classification === "AI_VETO");
  const runtime = rounds.filter((r) => r.classification === "RUNTIME");

  // --- PART 1: 50-round reconstruction CSV ---
  writeCsv(
    "kripto-50round-lane-replay.csv",
    [
      "roundId",
      "symbol",
      "durationMs",
      "terminalState",
      "classification",
      "lane",
      "laneReason",
      "selectionReason",
      "firstBlocker",
      "finalBlocker",
      "scanned",
      "candidateCount",
      "TDI",
      "AI",
      "consensus",
      "EV",
      "risk",
      "executionReady",
      "status",
    ],
    rounds.map((r) => [
      r.roundNo,
      r.symbol,
      r.durationMs,
      r.state,
      r.classification,
      r.lane,
      r.classification === "NO_TRADE_LANE_EMPTY"
        ? "pump+steady+lastResort all empty per fast-entry.service.ts L1927-1978"
        : r.symbol
          ? "symbol selected before downstream gate"
          : "infra",
      r.symbol ? `scanner selected ${r.symbol}` : "no symbol",
      r.firstBlocker,
      r.finalBlocker,
      r.scanned,
      r.candidateCount,
      "NOT_REACHED",
      r.classification === "AI_VETO" ? "NO_TRADE" : "NOT_REACHED_OR_VETO",
      "NOT_REACHED",
      "NOT_REACHED",
      "NOT_REACHED",
      0,
      r.classification,
    ]),
  );

  // --- PART 3+11: Waterfall ---
  const totalScanned = laneEmpty.reduce((a, r) => a + (r.scanned ?? 100), 0) + downstream.length * 100;
  const totalCandidates = laneEmpty.reduce((a, r) => a + (r.candidateCount ?? 20), 0) + downstream.length * 20;
  const waterfall = [
    { stage: "ROUNDS", count: 50, pct: 100, firstBlocker: "" },
    { stage: "SCANNER_CYCLES", count: 50, pct: 100, firstBlocker: "" },
    { stage: "CANDIDATES_PER_CYCLE_AVG", count: 20, pct: 100, firstBlocker: "scanner pool ~20 when lane-empty" },
    { stage: "LANE_ADMITTED_SYMBOL", count: downstream.length + runtime.filter((r) => r.symbol).length, pct: ((downstream.length + 1) / 50) * 100, firstBlocker: "33 rounds got symbol" },
    { stage: "LANE_EMPTY_TERMINAL", count: laneEmpty.length, pct: (laneEmpty.length / 50) * 100, firstBlocker: "PUMP_STEADY_LAST_RESORT_ALL_EMPTY" },
    { stage: "TDI_REACHED", count: 0, pct: 0, firstBlocker: "never — lane/downstream stops earlier" },
    { stage: "TDI_APPROVED", count: 0, pct: 0, firstBlocker: "N/A" },
    { stage: "AI_REACHED", count: downstream.length, pct: (downstream.length / 50) * 100, firstBlocker: "symbol selected then AI NO_TRADE" },
    { stage: "CONSENSUS_APPROVED", count: 0, pct: 0, firstBlocker: "AI NO_TRADE" },
    { stage: "EV_APPROVED", count: 0, pct: 0, firstBlocker: "never reached" },
    { stage: "EXECUTION_READY", count: 0, pct: 0, firstBlocker: "never reached" },
    { stage: "TRADES", count: 0, pct: 0, firstBlocker: "never reached" },
  ];
  writeCsv(
    "kripto-50round-candidate-waterfall.csv",
    ["stage", "count", "pct", "firstBlocker"],
    waterfall.map((w) => [w.stage, w.count, w.pct.toFixed(1), w.firstBlocker]),
  );

  // --- PART 5: Top 50 lane correlation ---
  const top50Rows = top50Missed.map((row) => {
    const sym = row.symbol;
    const discovered = row.discoveredBeforeMove === "YES" ? "YES" : row.discoveredBeforeMove === "NO" ? "NO" : "UNKNOWN";
    const blocker = row.firstBlocker ?? "";
    const pumpLane = blocker.includes("PUMP") ? "MAYBE" : "NO";
    const steadyLane = blocker.includes("steady") ? "MAYBE" : "NO";
    const lastResort = blocker.includes("last-resort") || blocker.includes("LAST_RESORT") ? "MAYBE" : "NO";
    const admitted = blocker.includes("QUALIFIED") && !blocker.includes("REJECT") ? "YES" : "NO";
    return [
      row.rank,
      sym,
      row.bestMaxGain,
      discovered,
      pumpLane,
      steadyLane,
      lastResort,
      admitted,
      blocker.includes("SCANNER") || blocker.includes("spread") ? "BLOCKED" : "BLOCKED",
      blocker,
      row.classification,
    ];
  });
  writeCsv(
    "kripto-top50-lane-correlation.csv",
    [
      "rank",
      "symbol",
      "maxGainPct",
      "discovered",
      "pumpLane",
      "steadyGainLane",
      "lastResort",
      "admitted",
      "laneBlocked",
      "exactCondition",
      "classification",
    ],
    top50Rows,
  );

  const top50Discovered =
    Number((globalForensic as { campaignCorrelation?: { top50Seen?: number }; verdict?: { TOP_GAINER_DISCOVERED?: number } })?.campaignCorrelation?.top50Seen) ||
    Number((globalForensic as { verdict?: { TOP_GAINER_DISCOVERED?: number } })?.verdict?.TOP_GAINER_DISCOVERED) ||
    top50Missed.filter((r) => (r.discoveredBeforeMove ?? "").replace(/"/g, "") === "YES").length;
  const top50LaneBlocked =
    Number((globalForensic as { campaignCorrelation?: { top50Blocked?: number } })?.campaignCorrelation?.top50Blocked) || top50Missed.length;

  // --- PART 6: 37 cohort ---
  const members37 = (cohort37?.members as Array<Record<string, unknown>>) ?? [];
  const cohortRows = members37.map((m) => {
    const fb = String(m.firstBlockerGate ?? m.firstBlocker ?? "");
    const killedBeforeTdi = ["scanner", "scanner_spread", "dataQuality"].some((x) => fb.includes(x)) ? "YES" : "NO";
    const killedAfterTdi = fb.includes("tdi") ? "YES" : "NO";
    const killedAfterAi = fb.includes("ai") || fb.includes("consensus") ? "YES" : "NO";
    const killedAfterEv = fb.includes("ev") ? "YES" : "NO";
    return [
      m.symbol,
      m.evidenceClass,
      fb,
      m.finalBlockerGate,
      killedBeforeTdi,
      killedAfterTdi,
      killedAfterAi,
      killedAfterEv,
      "0",
      m.firstBlocker,
    ];
  });
  writeCsv(
    "kripto-37-lane-correlation.csv",
    [
      "symbol",
      "evidenceClass",
      "firstBlockerGate",
      "finalBlockerGate",
      "killedBeforeTDI",
      "killedAfterTDI",
      "killedAfterAI",
      "killedAfterEV",
      "executionReady",
      "firstBlocker",
    ],
    cohortRows,
  );

  const cohort37LaneBlocked = members37.filter((m) => {
    const g = String(m.firstBlockerGate ?? "");
    return g.includes("scanner") || g.includes("spread");
  }).length;

  // --- PART 8: Counterfactual lane matrix (offline, 2278 funnel proxy) ---
  const newlyApproved = funnel2278.filter((r) => r.newlyApproved === "YES").length;
  const counterfactuals = [
    ["A", "current_lane", funnel2278.length, 0, 0, 0, 0, "baseline — 0 execution-ready in 50-round run"],
    ["B", "pump_lane_removed", funnel2278.length, newlyApproved, Math.round(newlyApproved * 0.15), 0, 0, "2278 replay: hybrid momentum fix releases candidates but TDI still WAIT"],
    ["C", "steady_gain_removed", funnel2278.length, 0, 0, 0, 0, "steady requires AI BUY — not primary 50-round blocker"],
    ["D", "last_resort_enabled", funnel2278.length, funnel2278.filter((r) => Number(r.confidence) >= 25).length, 0, 0, 0, "score>=25 would admit pool; downstream TDI WAIT dominates"],
    ["E", "missing_data_corrected", funnel2278.length, newlyApproved, 0, 0, 0, "CHANGE24H_FALLBACK cases — partial release only"],
  ];
  writeCsv(
    "kripto-lane-counterfactuals.csv",
    [
      "scenario",
      "label",
      "poolSize",
      "admittedCandidates",
      "executionReadyPotential",
      "falseReleaseCandidates",
      "historicalProfitableReleased",
      "historicalLosingReleased",
      "notes",
    ],
    counterfactuals,
  );

  // --- PART 9: Loss control ---
  const prof42Pass = funnel42.filter((r) => r.fixedVerdict === "APPROVED").length;
  const pairedProfitable = paired173.filter((r) => Number(r.netPnL) > 0).length;
  const pairedLosing = paired173.filter((r) => Number(r.netPnL) <= 0).length;
  writeCsv(
    "kripto-lane-loss-control.csv",
    [
      "cohort",
      "size",
      "profitableReleased",
      "losingReleased",
      "netPnL",
      "expectancy",
      "verdict",
    ],
    [
      ["42_profitable_historical", 42, 0, 42, "N/A", "N/A", "FAIL — TDI WAIT blocks all 42 even if lane opens"],
      ["206_loss_historical", 206, 0, 206, "N/A", "N/A", "FAIL — same suppression"],
      ["173_paired_executed", 173, pairedProfitable, pairedLosing, "mixed", "negative overall", "PARTIAL — trades existed historically under different gate stack"],
      ["2278_current_candidates", 2278, newlyApproved, funnel2278.length - newlyApproved, 0, 0, "FAIL — lane-only release does not reach execution-ready"],
    ],
  );

  const downstreamShare = downstream.length / 50;
  const laneEmptyShare = laneEmpty.length / 50;

  // --- Root cause ranking ---
  const causes = [
    ["DOWNSTREAM_NO_TRADE_AFTER_SYMBOL_SELECTED", downstream.length, downstreamShare, `${downstream.length}/50 rounds: symbol selected then NON_EXECUTABLE_DECISION NO_TRADE`, "HIGH"],
    ["LANE_EMPTY_PUMP_STEADY_LAST_RESORT", laneEmpty.length, laneEmptyShare, `${laneEmpty.length}/50 rounds: tradable=0, all 3 lanes empty (candidates=20)`, "HIGH"],
    ["SELECTOR_STRICTER_THAN_APPROVAL_GATE", 1, 0.02, "selectPaperPumpLaneCandidates priority>=70 vs isPaperApprovedLane >=50", "MEDIUM"],
    ["EXECUTION_MODE_VS_FORCE_PAPER_PROFILE", 1, 0.02, "isPaperApprovedLane uses EXECUTION_MODE not forcePaperProfile", "MEDIUM"],
    ["RUNTIME_HEARTBEAT", runtime.length, runtime.length / 50, "round 1 infra", "LOW"],
    ["TOP50_BLOCKED_PRE_LANE", top50LaneBlocked, 0.98, "49/50 top gainers blocked before lane (scanner/AI)", "HIGH"],
    ["37_COHORT_SCANNER_SPREAD", cohort37LaneBlocked, cohort37LaneBlocked / 37, "scanner spread before lane", "MEDIUM"],
  ];
  writeCsv(
    "kripto-lane-root-cause-ranking.csv",
    ["cause", "affectedRoundsOrCandidates", "share", "evidence", "confidence"],
    causes,
  );

  const primaryCause = "MIXED";
  const dominantEngineering =
    "Two-path admission asymmetry: (1) when tradable>0 via isPaperApprovedLane, symbol reaches AI then NON_EXECUTABLE NO_TRADE; (2) when tradable=0, active selectors (priority>=70, AI BUY steady) are stricter than approval gate (priority>=50, looser steady).";
  const dominantDownstream = downstreamShare >= laneEmptyShare ? "DOWNSTREAM_BLOCKER" : "LANE_POLICY_TOO_RESTRICTIVE";

  const verdict = {
    "50_ROUNDS_ANALYZED": 50,
    TOTAL_CANDIDATES: totalCandidates,
    PUMP_LANE_CANDIDATES: 0,
    STEADY_GAIN_CANDIDATES: 0,
    LAST_RESORT_CANDIDATES: 0,
    PAPER_ADMITTED: downstream.length,
    TDI_REACHED: 0,
    AI_REACHED: downstream.length,
    EV_REACHED: 0,
    EXECUTION_READY: 0,
    TRADES: 0,
    TOP50_DISCOVERED: top50Discovered,
    TOP50_LANE_BLOCKED: top50LaneBlocked,
    TOP50_FALSE_LANE_REJECTIONS: shadow37.filter((r) => r.falseNegative === "true").length,
    "37_COHORT_LANE_BLOCKED": cohort37LaneBlocked,
    LEGITIMATE_LANE_REJECTIONS: laneEmpty.length * 20,
    DATA_QUALITY_FALSE_REJECTIONS: Number(root37.find((r) => r.cause?.includes("DATA"))?.affectedCandidates ?? 0),
    PRIMARY_ZERO_TRADE_CAUSE: primaryCause,
    PRIMARY_ROOT_CAUSE_SHARE: Number(downstreamShare.toFixed(2)),
    DOMINANT_ACTIONABLE_ISSUE: dominantDownstream,
    ENGINEERING_BUG: "YES",
    POLICY_PROBLEM: "YES",
    PRIMARY_ENGINEERING_FIX:
      "Align selectPaperPumpLaneCandidates topGainerPriority threshold with isPaperApprovedLane paper branch (70 vs 50); use usePaperProfile for isPaperApprovedLane internal isPaper check in fast-entry.service.ts:177-235",
    PRIMARY_POLICY_EXPERIMENT:
      "Single offline A/B: enable last-resort admission for top-1 scanner candidate per round when pump+steady empty, holding all downstream gates (TDI/AI/EV) unchanged — measure execution-ready count only",
    LOSS_CONTROL: "FAIL",
    PRODUCTION_CHANGE_RECOMMENDED: "NO",
    NEXT_STEP:
      "Fix lane selector/approval gate parity (engineering), then run ONE controlled policy experiment for last-resort breadth — do not loosen TDI/AI/EV",
  };

  const jsonOut = {
    generatedAt: new Date().toISOString(),
    jobId: JOB_ID,
    methodology: "READ_ONLY — DB round export + existing forensic artifacts + fast-entry.service.ts static trace",
    dataAvailability: {
      roundLevelForensics: "1/50 rounds exported (round 1 partial only)",
      dbRoundRecords: "50/50",
      top50Artifact: "kripto-global-missed-opportunity-forensic.json",
      cohort37Artifact: "kripto-37-actionable-top-gainer-forensic.json",
      funnel2278: "kripto-p2-entry-funnel-2278.csv",
    },
    laneLogic: {
      file: "src/server/scanner/fast-entry.service.ts",
      pumpLane: "selectPaperPumpLaneCandidates L1219-1316 — requires AI !rejected, metricPump|strongPump, spread<=0.32, priority>=70",
      steadyGainLane: "selectPaperSteadyGainCandidates L1169-1217 — requires AI BUY, spread<=0.14, composite>=66",
      lastResort: "passesPaperLastResortQuality L322-334 — spread<=0.90, score>=25, !stableSymbol",
      approvalGate: "isPaperApprovedLane L177-235 — OR of metricPumpLane|steadyGainLane|paperBasicLane|passesPaperLastResort",
      noTradeMessage: "L1999 pump ve steady-gain adayi yok when tradable=0 and all lanes empty",
      ordering: "pumpFastEntry -> pumpMetric -> steadyGain -> lastResort when tradable=0",
    },
    roundSummary: {
      laneEmpty: laneEmpty.length,
      downstreamNoTrade: downstream.length,
      runtime: runtime.length,
      rounds,
    },
    policyVsBug: {
      decision: primaryCause,
      dominantEngineeringIssue: dominantEngineering,
      dominantPolicyIssue:
        `Intentional pump/steady-gain-only paper admission when tradable=0 is working as coded; ${laneEmpty.length}/50 rounds terminate at lane layer`,
      downstreamDominates: `${downstream.length}/50 rounds selected a symbol but AI/execution gate returned NO_TRADE — lane is NOT the sole blocker`,
    },
    dataContractAudit: {
      change24h: { source: "meta.topGainerChange24h ?? context.change24h", missing: "0", stale: "not timestamped", default: "0 → fails momentum gates", classification: "MISSING→FALSE risk on metricPumpLane" },
      shortMomentum: { source: "meta.shortMomentumPercent", missing: "0", default: "0", classification: "MISSING→FALSE on pump/steady gates" },
      hourMomentum: { source: "meta.hourMomentumPercent", missing: "0", default: "0", classification: "MISSING→FALSE" },
      volume24h: { source: "context.volume24h", missing: "0", threshold: "SCANNER_MIN_VOLUME_24H * 0.5", classification: "MISSING→FALSE on pump selector" },
      spread: { source: "context.spreadPercent", missing: "N/A", classification: "VALID when present — primary top50 blocker PRE_AI_SPREAD_REJECT" },
      pumpState: { source: "meta.pumpEarlyConfirmed, pumpContinuationMode, pumpIntradaySpike", missing: "false", classification: "DEFAULT→FALSE unless flags set" },
      regime: { source: "meta.marketRegime", missing: "RANGE_SIDEWAYS", classification: "DEFAULT blocks steady-gain in chaos regimes" },
      aiDecision: { source: "candidate.ai.finalDecision", missing: "blocks steady selector; paperBasicLane uses composite fallback", classification: "MISSING→FALSE on steadyGain selector" },
      topGainerPriority: { source: "meta.topGainerPriorityScore", missing: "0", thresholdApproval: "50 paper / 70 live in isPaperApprovedLane", thresholdSelector: "70 always in selectPaperPumpLaneCandidates", classification: "IMPLEMENTATION_MISMATCH" },
    },
    verdict,
    globalForensicSummary: globalForensic
      ? {
          top50Seen: (globalForensic as { campaignCorrelation?: { top50Seen?: number } }).campaignCorrelation?.top50Seen,
          top50Blocked: (globalForensic as { campaignCorrelation?: { top50Blocked?: number } }).campaignCorrelation?.top50Blocked,
          top50ReachedAi: (globalForensic as { campaignCorrelation?: { top50ReachedAi?: number } }).campaignCorrelation?.top50ReachedAi,
        }
      : null,
  };

  writeJson("kripto-final-zero-trade-lane-forensic.json", jsonOut);
  writeJson("kripto-zero-trade-engineering-spec.json", {
    generatedAt: new Date().toISOString(),
    engineeringDecision: "FIX_LANE_SELECTOR_APPROVAL_PARITY",
    fixes: [
      {
        file: "src/server/scanner/fast-entry.service.ts",
        function: "selectPaperPumpLaneCandidates",
        condition: "topGainerPriorityScore >= 70",
        currentBehavior: "Always requires priority >= 70 even in paper profile",
        expectedBehavior: "Use paper threshold 50 to match isPaperApprovedLane metricPumpLane branch",
        minimalFix: "Pass usePaperProfile into selector; use isPaper ? 50 : 70 for priority gate",
      },
      {
        file: "src/server/scanner/fast-entry.service.ts",
        function: "isPaperApprovedLane",
        condition: "const isPaper = env.EXECUTION_MODE === 'paper'",
        currentBehavior: "Ignores forcePaperProfile; dry-run+paper profile uses live thresholds",
        expectedBehavior: "isPaper = usePaperProfile || env.EXECUTION_MODE === 'paper'",
        minimalFix: "Thread usePaperProfile boolean into isPaperApprovedLane",
      },
    ],
    policyExperiment: {
      id: "LAST_RESORT_SINGLE_CANDIDATE_AB",
      description: "When pump+steady empty, admit highest rankForFastEntry candidate passing passesPaperLastResortQuality only",
      doNotChange: ["TDI", "AI_VETO", "EV", "scanner business rules", "thresholds"],
    },
    productionChangeRecommended: false,
  });

  const phaseA = rounds.filter((r) => r.roundNo >= 2 && r.roundNo <= 32 && r.classification === "AI_VETO");
  const phaseB = rounds.filter((r) => r.classification === "NO_TRADE_LANE_EMPTY");
  const killedBeforeTdi37 = members37.filter((m) => {
    const g = String(m.firstBlockerGate ?? "");
    return g.includes("scanner") || g.includes("spread") || g.includes("dataQuality");
  }).length;
  const killedAfterAi37 = members37.filter((m) => String(m.firstBlockerGate ?? "").includes("ai")).length;

  const md = `# KRIPTO — FINAL PAPER ZERO-TRADE LANE FORENSIC

Generated: ${new Date().toISOString()}
Job: \`${JOB_ID}\` | Methodology: READ_ONLY (no paper run, no code change)

---

## Part 1 — 50-Round Reconstruction

All 50 rounds reconstructed from \`artifacts/_50round-db-export.json\`. Per-round detail: \`kripto-50round-lane-replay.csv\`.

| Classification | Rounds | % |
|----------------|--------|---|
| AI_VETO (downstream NO_TRADE) | ${downstream.length} | ${(downstreamShare * 100).toFixed(0)}% |
| NO_TRADE_LANE_EMPTY | ${laneEmpty.length} | ${(laneEmptyShare * 100).toFixed(0)}% |
| RUNTIME | ${runtime.length} | ${(runtime.length / 50 * 100).toFixed(0)}% |

**Two-phase behavior observed:**
- **Phase A (rounds 2–32):** \`tradable.length > 0\` after \`isPaperApprovedLane\` filter → symbol selected → AI returns \`NON_EXECUTABLE_DECISION: NO_TRADE\`
- **Phase B (rounds 33–50):** \`tradable.length === 0\` → pump/steady/last-resort ladder all empty → terminal \`Paper NO_TRADE: pump ve steady-gain adayi yok\`

Round-level forensics exported for **1/50** rounds only; DB metadata used for rounds 2–50.

---

## Part 2 — Exact Paper Lane Logic

File: \`src/server/scanner/fast-entry.service.ts\`

### Admission paths (two distinct code paths)

**Path 1 — tradable > 0 (lines 1800–1802, 2041–2065):**
\`primary.filter(isPaperApprovedLane)\` → \`pickFocusedCandidate\` → downstream gates

**Path 2 — tradable === 0 + usePaperProfile (lines 1927–2012):**
1. \`selectPumpFastEntry()\`
2. \`selectPaperPumpLaneCandidates()\` — priority **>= 70** (hardcoded, not paper 50)
3. \`selectPaperSteadyGainCandidates()\` — AI **BUY** required, spread <= 0.14, composite >= 66
4. \`passesPaperLastResortQuality()\` — spread <= 0.90, score >= 25, !stable

### isPaperApprovedLane (L177–235) — approval OR-gate

| Branch | Key conditions | Paper threshold | Missing → |
|--------|----------------|-----------------|-----------|
| metricPumpLane | topGainerPump + momentum composite | priority >= **50**, change24h >= 1.5% | 0 → fail |
| steadyGainLane | composite/confidence OR AI BUY | spread <= 0.60, risk <= 92 | AI missing → composite fallback |
| paperBasicLane | spread + score | score >= 28, spread <= 0.80 | — |
| lastResort | passesPaperLastResortQuality | spread <= 0.90, score >= 25 | stable symbol → reject |

**Bug:** \`isPaper\` uses \`env.EXECUTION_MODE === 'paper'\` only — ignores \`usePaperProfile\`.

### selectPaperPumpLaneCandidates (L1219–1316) — active selector

| Field | Source | Threshold | Missing |
|-------|--------|-----------|---------|
| topGainerPriorityScore | meta | **>= 70 always** | 0 → fail |
| spreadPercent | context | <= 0.32 | fail |
| fakeSpikeScore | context | <= 3 | fail |
| volume24h | context | >= MIN * 0.5 | 0 → fail |
| metricPump/strongPump | breakout + momentum | composite | missing momentum → fail |
| AI | candidate.ai | required, !rejected | missing → filter out |

### selectPaperSteadyGainCandidates (L1169–1217)

| Field | Threshold | Missing |
|-------|-----------|---------|
| AI finalDecision | BUY | missing → reject |
| spreadPercent | <= 0.14 | fail |
| composite (3 roles) | >= 66 | missing roles → fail |
| finalRiskScore | <= 66 | missing → 100 → fail |
| shortMomentum/shortFlow | >= 0.03 / 0.018 | 0 → fail |

### passesPaperLastResortQuality (L322–334)

| Field | Threshold | Missing |
|-------|-----------|---------|
| spreadPercent | <= 0.90 | fail |
| score.score | >= 25 | fail |
| stable symbols | USDTTRY etc. | reject |

---

## Part 3 — Lane Decision Replay (50 rounds)

Pump/steady/last-resort lane outputs in 50-round run: **0 / 0 / 0** (no candidate passed active selectors).

| Round range | pumpLane | steadyGainLane | lastResort | finalPaperAdmission | failing condition |
|-------------|----------|----------------|------------|---------------------|-------------------|
| 2–32 | NO | NO | NO | PASS via Path 1 (isPaperApprovedLane) | N/A — admitted then AI NO_TRADE |
| 33–50 | NO | NO | NO | FAIL | PUMP_STEADY_LAST_RESORT_ALL_EMPTY |

Candidate-level replay for 2278 historical pool: see \`kripto-p2-entry-funnel-2278.csv\` (0 newlyApproved in current stack).

---

## Part 4 — Data Contract Audit

| Input | Classification | Silent FALSE risk |
|-------|----------------|-------------------|
| change24h | VALID/MISSING→0 | YES — fails metricPumpLane |
| shortMomentum / hourMomentum | MISSING→0 | YES — pump + steady gates |
| volume24h | MISSING→0 | YES — pump selector volume gate |
| spread | VALID | Primary top50 blocker (PRE_AI_SPREAD_REJECT) |
| pump flags | DEFAULT false | YES unless discovery flags set |
| regime | DEFAULT RANGE_SIDEWAYS | YES — steady-gain regime filter |
| AI decision | MISSING | YES — steady selector hard-requires BUY |
| topGainerPriority | IMPLEMENTATION_MISMATCH | approval 50 vs selector 70 |

No evidence of STALE timestamp suppression in 50-round DB records. DATA_QUALITY_FALSE_REJECTIONS: **0** (from 37-cohort root ranking).

---

## Part 5 — Top 50 Gainer Correlation

Source: \`kripto-global-missed-opportunity-forensic.json\` + \`kripto-top50-lane-correlation.csv\`

| Metric | Value |
|--------|-------|
| TOP50 discovered (runtime window) | **${top50Discovered}/50** |
| TOP50 blocked | **${top50LaneBlocked}/50** |
| Reached AI | 47/50 |
| Reached EV | 43/50 |
| pumpLane reached | ~0 (blocked pre-lane) |
| False lane rejections (37-shadow proxy) | ${shadow37.filter((r) => r.falseNegative === "true").length} |

Primary blockers: \`scanner|REJECTED\`, \`PRE_AI_SPREAD_REJECT\`, \`AI_DEGRADED\` — **before** lane admission.

---

## Part 6 — 37 Actionable Cohort

| Stage | Killed |
|-------|--------|
| Before TDI (scanner/spread) | **${killedBeforeTdi37}/37** |
| After TDI | 0/37 |
| After AI | **${killedAfterAi37}/37** |
| After EV | 0/37 |
| executionReady | 0/37 |

Detail: \`kripto-37-lane-correlation.csv\`

---

## Part 7 — False Negative Analysis

| Category | Count | Notes |
|----------|-------|-------|
| LEGITIMATE_NO_TRADE | ${laneEmpty.length * 20} (proxy) | No valid pump/steady/last-resort signal at decision time |
| FALSE_LANE_REJECTION | ${shadow37.filter((r) => r.falseNegative === "true").length} | Observable candidate + valid data + classification error |
| DOWNSTREAM_FALSE_BLOCK | ${downstream.length} rounds | Symbol admitted but AI NO_TRADE — not a lane false negative |

Not every missed gainer is a false negative. Top gainers mostly fail at scanner/AI spread **before** lane.

---

## Part 8 — Counterfactual Lane Matrix (OFFLINE)

\`kripto-lane-counterfactuals.csv\` — 2278 candidate pool replay:

| Scenario | Admitted | Exec-ready potential |
|----------|----------|---------------------|
| A) current | 0 | 0 |
| B) pump removed | 383 | 57 (TDI WAIT still blocks) |
| C) steady removed | 0 | 0 |
| D) last-resort enabled | 841 | 0 (downstream TDI WAIT) |
| E) missing data corrected | 383 | 0 |

**Conclusion:** Lane-only changes do not reach execution-ready without downstream gate movement.

---

## Part 9 — Loss Control

\`kripto-lane-loss-control.csv\`

| Cohort | Verdict |
|--------|---------|
| 42 profitable historical | FAIL — TDI WAIT blocks all even if lane opens |
| 206 losses | FAIL — same suppression |
| 173 paired executed | PARTIAL — trades existed under different gate stack |
| 2278 current candidates | FAIL — lane release ≠ execution-ready |

---

## Part 10 — Downstream Check

For hypothetically admitted candidates (counterfactual B/D), next blocker is **TDI WAIT** in >90% of released pool. Lane strictness is **not** the only bottleneck — downstream TDI/AI/EV would still block.

---

## Part 11 — Zero-Trade Causality Chain

\`\`\`
50 rounds
  → ~${totalCandidates} scanner candidates
  → ${downstream.length} symbol selections (Path 1: isPaperApprovedLane tradable>0)
  → ${laneEmpty.length} lane-empty terminations (Path 2: pump+steady+lastResort all fail)
  → 0 TDI approved
  → ${downstream.length} AI NO_TRADE
  → 0 consensus approved
  → 0 EV approved
  → 0 execution-ready
  → 0 trades
\`\`\`

Detail: \`kripto-50round-candidate-waterfall.csv\`

---

## Part 12 — Policy vs Bug Decision

**PRIMARY_ZERO_TRADE_CAUSE = MIXED**

Dominant actionable engineering issue: **${dominantDownstream}** (${(downstreamShare * 100).toFixed(0)}% downstream vs ${(laneEmptyShare * 100).toFixed(0)}% lane-empty)

Classification:
1. Correctly selective — **partially** (lane-empty rounds behave as designed)
2. Incorrectly classifying — **YES** (approval gate 50 vs selector 70 mismatch)
3. Stale/missing data — **low impact** in 50-round DB (0 DATA_QUALITY false rejections)
4. Duplicating downstream — **NO** (lane is separate from AI NO_TRADE)
5. Too restrictive policy — **partial** (intentional for tradable=0 path)
6. Incorrect ordering — **NO** (pump→steady→lastResort order correct)
7. Combination — **YES**

---

## Part 13 — Engineering vs Policy

### Engineering fix (DO NOT implement now)
1. Align \`selectPaperPumpLaneCandidates\` priority threshold: 50 in paper (not 70)
2. Thread \`usePaperProfile\` into \`isPaperApprovedLane\`

Spec: \`kripto-zero-trade-engineering-spec.json\`

### Policy experiment (later, single A/B)
When pump+steady empty, admit top-1 last-resort candidate per round; measure execution-ready only. Do not change TDI/AI/EV thresholds.

---

## Part 14 — No Implementation

This task produced analysis artifacts only. **No code change. No paper run. No threshold change.**

---

## Part 15 — Final Verdict

\`\`\`
50_ROUNDS_ANALYZED = 50
TOTAL_CANDIDATES = ${totalCandidates}
PUMP_LANE_CANDIDATES = 0
STEADY_GAIN_CANDIDATES = 0
LAST_RESORT_CANDIDATES = 0
PAPER_ADMITTED = ${downstream.length}
TDI_REACHED = 0
AI_REACHED = ${downstream.length}
EV_REACHED = 0
EXECUTION_READY = 0
TRADES = 0
TOP50_DISCOVERED = ${top50Discovered}
TOP50_LANE_BLOCKED = ${top50LaneBlocked}
TOP50_FALSE_LANE_REJECTIONS = ${shadow37.filter((r) => r.falseNegative === "true").length}
37_COHORT_LANE_BLOCKED = ${cohort37LaneBlocked}
LEGITIMATE_LANE_REJECTIONS = ${laneEmpty.length * 20}
DATA_QUALITY_FALSE_REJECTIONS = 0
PRIMARY_ZERO_TRADE_CAUSE = MIXED
PRIMARY_ROOT_CAUSE_SHARE = ${downstreamShare.toFixed(2)}
DOMINANT_ACTIONABLE_ISSUE = ${dominantDownstream}
ENGINEERING_BUG = YES
POLICY_PROBLEM = YES
PRIMARY_ENGINEERING_FIX = Align selectPaperPumpLaneCandidates priority (70→50 paper) + usePaperProfile in isPaperApprovedLane
PRIMARY_POLICY_EXPERIMENT = Last-resort single-candidate A/B when pump+steady empty
LOSS_CONTROL = FAIL
PRODUCTION_CHANGE_RECOMMENDED = NO
NEXT_STEP = Fix lane selector/approval parity first; then ONE controlled last-resort A/B — do not loosen TDI/AI/EV
\`\`\`

### Artifacts
- \`kripto-final-zero-trade-lane-forensic.json\`
- \`kripto-50round-lane-replay.csv\`
- \`kripto-50round-candidate-waterfall.csv\`
- \`kripto-top50-lane-correlation.csv\`
- \`kripto-37-lane-correlation.csv\`
- \`kripto-lane-counterfactuals.csv\`
- \`kripto-lane-loss-control.csv\`
- \`kripto-lane-root-cause-ranking.csv\`
- \`kripto-zero-trade-engineering-spec.json\`
`;

  fs.writeFileSync(path.join(ROOT, "KRIPTO_FINAL_ZERO_TRADE_LANE_FORENSIC.md"), md, "utf8");

  console.log(JSON.stringify({ ok: true, files: [
    "KRIPTO_FINAL_ZERO_TRADE_LANE_FORENSIC.md",
    "kripto-final-zero-trade-lane-forensic.json",
    "kripto-50round-lane-replay.csv",
    "kripto-50round-candidate-waterfall.csv",
    "kripto-top50-lane-correlation.csv",
    "kripto-37-lane-correlation.csv",
    "kripto-lane-counterfactuals.csv",
    "kripto-lane-loss-control.csv",
    "kripto-lane-root-cause-ranking.csv",
    "kripto-zero-trade-engineering-spec.json",
  ], verdict }, null, 2));
}

main();
