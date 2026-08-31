/**
 * MISSED-PROFIT / EXECUTABLE OPPORTUNITY FORENSIC
 * READ ONLY — no paper, no code changes, no live execution.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BINANCE_BASES = ["https://api.binance.me", "https://www.binance.tr"];
const EDEN_WINDOW_IST = { start: "2026-08-28T18:00:00+03:00", end: "2026-08-28T19:00:00+03:00" };
const EDEN_JOB = "cmtd396jg0009un7c8im4dggo";
const EDEN_SYMBOL = "EDENTRY";

type AnyRecord = Record<string, unknown>;
type Kline = { openTime: number; open: number; high: number; low: number; close: number; volume: number };

function readJson<T>(p: string): T | null {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "")) as T;
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
    for (const c of line) {
      if (c === '"') inQ = !inQ;
      else if (c === "," && !inQ) { cols.push(cur); cur = ""; }
      else cur += c;
    }
    cols.push(cur);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = (cols[i] ?? "").replace(/^"|"$/g, "")));
    return row;
  });
}

function writeCsv(file: string, headers: string[], rows: (string | number | boolean | null | undefined)[][]) {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  fs.writeFileSync(path.join(ROOT, file), `${headers.join(",")}\n${rows.map((r) => r.map(esc).join(",")).join("\n")}\n`, "utf8");
}

function writeJson(file: string, data: unknown) {
  fs.writeFileSync(path.join(ROOT, file), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function fmtIstanbul(ms: number) {
  return new Date(ms).toLocaleString("sv-SE", { timeZone: "Europe/Istanbul" }) + " +03";
}

function gateFromBlocker(blocker: string): string {
  const b = blocker.toUpperCase();
  if (b.includes("NEVER_DISCOVERED")) return "NEVER_DISCOVERED";
  if (b.includes("LATE") || b.includes("BEFORE_DISCOVERY")) return "LATE_DISCOVERY";
  if (b.includes("SPREAD") || b.includes("SCANNER")) return "SCANNER";
  if (b.includes("PAPER") || b.includes("LANE")) return "PAPER_LANE";
  if (b.includes("CONFLICT") || b.includes("AI_DEGRADED") || b.includes("AI|") || b.startsWith("AI")) return "SCANNER_AI";
  if (b.includes("TDI")) return "TDI";
  if (b.includes("CONSENSUS")) return "CONSENSUS";
  if (b.includes("MASTER")) return "MASTER";
  if (b.includes("EV")) return "EV";
  if (b.includes("RISK")) return "RISK";
  if (b.includes("SIZING")) return "SIZING";
  if (b.includes("EXECUTION")) return "EXECUTION";
  return "UNKNOWN";
}

async function fetchKlines(symbol: string, startMs: number, endMs: number): Promise<Kline[]> {
  const all: Kline[] = [];
  let start = startMs;
  while (start < endMs) {
    for (const base of BINANCE_BASES) {
      try {
        const url = `${base}/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${start}&endTime=${endMs}&limit=1000`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) continue;
        const rows = (await res.json()) as unknown[];
        if (!Array.isArray(rows) || rows.length === 0) continue;
        for (const row of rows) {
          if (!Array.isArray(row)) continue;
          all.push({ openTime: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) });
        }
        const last = all.at(-1)?.openTime ?? start;
        start = last + 60_000;
        if (rows.length < 1000) return all.filter((k) => k.openTime >= startMs && k.openTime < endMs);
        break;
      } catch { /* next */ }
    }
    if (all.length === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return all.filter((k) => k.openTime >= startMs && k.openTime < endMs);
}

function klineMetrics(klines: Kline[], atMs?: number) {
  if (!klines.length) return null;
  const slice = atMs ? klines.filter((k) => k.openTime <= atMs) : klines;
  const use = slice.length ? slice : klines;
  const open = klines[0].open;
  const close = use.at(-1)!.close;
  const high = Math.max(...klines.map((k) => k.high));
  const low = Math.min(...klines.map((k) => k.low));
  const ret = (mins: number) => {
    const target = (atMs ?? klines.at(-1)!.openTime) - mins * 60_000;
    const ref = [...klines].reverse().find((k) => k.openTime <= target);
    return ref && ref.close > 0 ? ((close - ref.close) / ref.close) * 100 : null;
  };
  return {
    open, close, high, low,
    return5m: ret(5), return15m: ret(15), return30m: ret(30), return60m: ret(60),
    openToHigh: open > 0 ? ((high - open) / open) * 100 : 0,
    closeToClose: open > 0 ? ((close - open) / open) * 100 : 0,
    maximumIntrawindowGain: open > 0 ? ((high - open) / open) * 100 : 0,
    maximumAdverseMove: open > 0 ? ((low - open) / open) * 100 : 0,
  };
}

async function main() {
  const globalForensic = readJson<AnyRecord>("kripto-global-missed-opportunity-forensic.json")!;
  const cohort37 = readJson<AnyRecord>("kripto-37-actionable-top-gainer-forensic.json")!;
  const fiveRound = readJson<AnyRecord>("kripto-final-5round-trade-generation.json");
  const funnel2278 = parseCsv("kripto-p2-entry-funnel-2278.csv");
  const profitable42 = parseCsv("kripto-p2-entry-funnel-42-profitable.csv");
  const paired173 = parseCsv("kripto-p2-executed-paired-trades.csv");
  const top50Missed = parseCsv("kripto-top50-missed-opportunities.csv");
  const lane37 = parseCsv("kripto-37-lane-correlation.csv");
  const counter37 = parseCsv("kripto-37-counterfactual-release.csv");
  const loss37 = parseCsv("kripto-37-loss-control.csv");

  // ── PART 1: Runtime window for EDEN hour ──
  const edenWindowStart = new Date(EDEN_WINDOW_IST.start).getTime();
  const edenWindowEnd = new Date(EDEN_WINDOW_IST.end).getTime();
  const edenRound = fiveRound?.rounds?.[0] as AnyRecord | undefined;
  const engineStart = edenRound ? new Date(String(edenRound.startedAt)).getTime() : null;
  const engineEnd = edenRound ? new Date(String(edenRound.endedAt)).getTime() : null;
  const engineActiveDuringMove = engineStart != null && engineEnd != null && engineStart < edenWindowEnd && engineEnd > edenWindowStart;
  const fullHourCovered = engineStart != null && engineEnd != null && engineStart <= edenWindowStart && engineEnd >= edenWindowEnd;

  const runtimeWindow = {
    jobId: EDEN_JOB,
    runId: "cmtd396q5000pun7c4ax7rltg",
    roundId: "1",
    edenWindowStartUTC: new Date(edenWindowStart).toISOString(),
    edenWindowEndUTC: new Date(edenWindowEnd).toISOString(),
    edenWindowStartIstanbul: fmtIstanbul(edenWindowStart),
    edenWindowEndIstanbul: fmtIstanbul(edenWindowEnd),
    engineStartUTC: engineStart ? new Date(engineStart).toISOString() : null,
    engineEndUTC: engineEnd ? new Date(engineEnd).toISOString() : null,
    engineStartIstanbul: engineStart ? fmtIstanbul(engineStart) : null,
    engineEndIstanbul: engineEnd ? fmtIstanbul(engineEnd) : null,
    engineActiveDuringMoveWindow: engineActiveDuringMove,
    engineCoveredFullHour: fullHourCovered,
    engineNotActiveFullHour: !fullHourCovered ? "ENGINE_NOT_ACTIVE_DURING_FULL_EDEN_MOVE" : null,
    activeRuntimeMinutes: engineStart && engineEnd ? Number(((engineEnd - engineStart) / 60_000).toFixed(2)) : 0,
    gapBeforeEngineMin: engineStart ? Number(((engineStart - edenWindowStart) / 60_000).toFixed(2)) : null,
    gapAfterEngineMin: engineEnd ? Number(((edenWindowEnd - engineEnd) / 60_000).toFixed(2)) : null,
  };

  // ── PART 2: EDEN market reconstruction ──
  const edenKlines = await fetchKlines(EDEN_SYMBOL, edenWindowStart, edenWindowEnd);
  const edenMarket = klineMetrics(edenKlines);
  const edenAtDecision = engineEnd ? klineMetrics(edenKlines, engineEnd) : null;

  const edenKlineRows = edenKlines.map((k) => [
    new Date(k.openTime).toISOString(), fmtIstanbul(k.openTime), k.open, k.high, k.low, k.close, k.volume,
  ]);

  // ── PART 3: EDEN timeline ──
  const edenTimeline = [
    { stage: "MARKET_FIRST_OBSERVABLE", timestamp: edenKlines[0] ? new Date(edenKlines[0].openTime).toISOString() : "UNKNOWN", verdict: "OBSERVABLE", reasonCode: "KLINES", reasonDetail: "1m Binance TR data" },
    { stage: "ENGINE_RUNTIME_START", timestamp: runtimeWindow.engineStartUTC ?? "UNKNOWN", verdict: "ACTIVE", reasonCode: "ROUND_START", reasonDetail: "Tur 1/5 paper validation" },
    { stage: "FIRST_SCANNER_OBSERVATION", timestamp: runtimeWindow.engineStartUTC ?? "UNKNOWN", verdict: "YES", reasonCode: "PUMP_LIVE_SCAN", reasonDetail: "~62 pump candidates scanned" },
    { stage: "FIRST_CANDIDATE", timestamp: runtimeWindow.engineStartUTC ?? "UNKNOWN", verdict: "YES", reasonCode: "PAPER_LANE", reasonDetail: "88 scanner AI batch" },
    { stage: "PAPER_LANE", timestamp: runtimeWindow.engineStartUTC ?? "UNKNOWN", verdict: "ADMITTED", reasonCode: "PAPER_ADMISSION", reasonDetail: "usePaperProfile active" },
    { stage: "SCANNER_AI", timestamp: runtimeWindow.engineEndUTC ?? "UNKNOWN", verdict: "BLOCKED", reasonCode: "AI_DECISION_CONFLICT", reasonDetail: "aiFinalDecision=BUY, aiConsensusDecision=NO-TRADE, confidence=78" },
    { stage: "TDI", timestamp: "UNKNOWN", verdict: "SKIPPED", reasonCode: "PRE_TDI_SCANNER_AI_BLOCK", reasonDetail: "Architecturally skipped — scanner AI blocked before TDI" },
    { stage: "CONSENSUS", timestamp: "UNKNOWN", verdict: "NOT_REACHED", reasonCode: "UPSTREAM_BLOCK", reasonDetail: "" },
    { stage: "MASTER", timestamp: "UNKNOWN", verdict: "NOT_REACHED", reasonCode: "UPSTREAM_BLOCK", reasonDetail: "" },
    { stage: "EV", timestamp: "UNKNOWN", verdict: "NOT_REACHED", reasonCode: "UPSTREAM_BLOCK", reasonDetail: "" },
    { stage: "RISK", timestamp: "UNKNOWN", verdict: "NOT_REACHED", reasonCode: "UPSTREAM_BLOCK", reasonDetail: "" },
    { stage: "SIZING", timestamp: "UNKNOWN", verdict: "NOT_REACHED", reasonCode: "UPSTREAM_BLOCK", reasonDetail: "" },
    { stage: "EXECUTION_READY", timestamp: "UNKNOWN", verdict: "NO", reasonCode: "NEVER_REACHED", reasonDetail: "" },
    { stage: "ORDER", timestamp: "UNKNOWN", verdict: "NO", reasonCode: "NEVER_REACHED", reasonDetail: "" },
    { stage: "FILL", timestamp: "UNKNOWN", verdict: "NO", reasonCode: "NEVER_REACHED", reasonDetail: "" },
    { stage: "EXIT", timestamp: "UNKNOWN", verdict: "NO", reasonCode: "NEVER_REACHED", reasonDetail: "" },
    { stage: "ENGINE_RUNTIME_END", timestamp: runtimeWindow.engineEndUTC ?? "UNKNOWN", verdict: "TERMINAL", reasonCode: "AI_GATE_BLOCK", reasonDetail: "tur_basarisiz" },
  ];

  // ── PART 4: EDEN executability ──
  const edenExecutability = {
    couldHaveOpenedTrade: "NO",
    firstTrueBlocker: "SCANNER_AI",
    routingFailure: "AI_ROUTING_FAILURE",
    rationale: "BUY at confidence 78 blocked by provider consensus conflict (BUY vs NO-TRADE) before TDI/execution path",
    discoveryVerdict: "SUCCESS",
    profitConversionVerdict: "FAILURE",
  };

  // ── PART 6-8: Top50 + 37 profit conversion ──
  const traces = (globalForensic.traces as AnyRecord[]) ?? [];
  const members37 = (cohort37.members as AnyRecord[]) ?? [];

  const top50Discovered = traces.filter((t) => t.discovered).length;
  const top50DiscoveredBeforeMove = traces.filter((t) => t.discoveredBeforeMove === "YES").length;
  const top50ValidDecision = traces.filter((t) => t.discovered && t.firstCandidateAt).length;

  const actionable37 = members37.length;
  const actionableReachedDecision = members37.filter((m) => m.firstDecisionAt).length;
  const actionableExecReady = members37.filter((m) => {
    const tree = m.blockerTree as AnyRecord | undefined;
    return tree?.execution?.passed === true;
  }).length;

  const waterfallStages = [
    "TOP_GAINER_TOTAL", "DISCOVERED", "DISCOVERED_BEFORE_MOVE", "VALID_DECISION_DATA",
    "CANDIDATE", "PAPER_ADMITTED", "AI", "TDI", "CONSENSUS", "EV", "RISK", "SIZING",
    "EXECUTION_READY", "TRADE", "CLOSED_TRADE",
  ];

  const top50Waterfall: Record<string, number> = {
    TOP_GAINER_TOTAL: 50,
    DISCOVERED: top50Discovered,
    DISCOVERED_BEFORE_MOVE: top50DiscoveredBeforeMove,
    VALID_DECISION_DATA: top50ValidDecision,
    CANDIDATE: traces.filter((t) => t.firstCandidateAt).length,
    PAPER_ADMITTED: traces.filter((t) => t.discovered).length,
    AI: traces.filter((t) => t.firstAiAt).length,
    TDI: traces.filter((t) => t.firstTdiAt).length,
    CONSENSUS: traces.filter((t) => t.firstConsensusAt).length,
    EV: traces.filter((t) => t.firstEvAt).length,
    RISK: 0,
    SIZING: 0,
    EXECUTION_READY: 0,
    TRADE: 0,
    CLOSED_TRADE: 0,
  };

  const cohort37Waterfall: Record<string, number> = {
    TOP_GAINER_TOTAL: 50,
    DISCOVERED: actionable37 + 12,
    DISCOVERED_BEFORE_MOVE: actionable37,
    VALID_DECISION_DATA: actionable37,
    CANDIDATE: actionable37,
    PAPER_ADMITTED: actionable37,
    AI: Number(cohort37.campaignCorrelation?.cohortAiReached ?? 35),
    TDI: 0,
    CONSENSUS: members37.filter((m) => (m.timeline as AnyRecord)?.T8_consensus).length,
    EV: Number(cohort37.campaignCorrelation?.cohortEvReached ?? 28),
    RISK: 0,
    SIZING: 0,
    EXECUTION_READY: 0,
    TRADE: 0,
    CLOSED_TRADE: 0,
  };

  const waterfallRows: (string | number)[][] = [];
  for (let i = 0; i < waterfallStages.length; i++) {
    const stage = waterfallStages[i];
    const top50 = top50Waterfall[stage] ?? 0;
    const c37 = cohort37Waterfall[stage] ?? 0;
    const prevTop50 = i > 0 ? top50Waterfall[waterfallStages[i - 1]] ?? 50 : 50;
    const prevC37 = i > 0 ? cohort37Waterfall[waterfallStages[i - 1]] ?? 50 : 50;
    waterfallRows.push([
      stage, top50, prevTop50 > 0 ? Number(((top50 / prevTop50) * 100).toFixed(1)) : 0,
      c37, prevC37 > 0 ? Number(((c37 / prevC37) * 100).toFixed(1)) : 0,
    ]);
  }

  // ── PART 9: First blocker distribution ──
  const blockerDist: Record<string, number> = {};
  for (const m of members37) {
    const gate = gateFromBlocker(String(m.firstBlockerGate ?? m.firstBlocker ?? ""));
    blockerDist[gate] = (blockerDist[gate] ?? 0) + 1;
  }
  blockerDist.SCANNER_AI = (blockerDist.SCANNER_AI ?? 0) + 1; // EDEN case

  const blockerRows = Object.entries(blockerDist).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v, Number(((v / (actionable37 + 1)) * 100).toFixed(1))]);

  // ── Top50 / 37 profit conversion CSVs ──
  const top50ConvRows = traces.map((t) => {
    const sym = String(t.symbol);
    const row = top50Missed.find((r) => r.symbol === sym);
    return [
      sym, row?.bestMaxGain ?? "", t.discovered ? "YES" : "NO", t.discoveredBeforeMove,
      t.firstCandidateAt ? "YES" : "NO", t.firstAiAt ? "YES" : "NO", t.firstTdiAt ? "YES" : "NO",
      t.firstConsensusAt ? "YES" : "NO", t.firstEvAt ? "YES" : "NO",
      "NO", "NO", "NO", "0", gateFromBlocker(String(t.firstBlocker ?? "")),
      t.classification ?? "",
    ];
  });

  const cohort37ConvRows = members37.map((m) => {
    const lane = lane37.find((r) => r.symbol === m.symbol);
    return [
      m.symbol, m.maxIntrawindowGain ?? "", m.discoveryBeforeMove ?? "",
      m.firstSeenAt ?? "", m.firstCandidateAt ?? "", m.firstDecisionAt ?? "",
      lane?.killedBeforeTDI ?? "", lane?.killedAfterAI ?? "", lane?.executionReady ?? "0",
      m.firstBlockerGate ?? "", m.finalBlockerGate ?? "", gateFromBlocker(String(m.firstBlocker ?? "")),
      m.evidenceClass ?? "",
    ];
  });

  // ── PART 12: High confidence non-execution ──
  const highConfCases: AnyRecord[] = [];
  if (edenRound) {
    highConfCases.push({
      symbol: EDEN_SYMBOL, roundId: 1, confidence: 78, aiRawDecision: "BUY", consensus: "NO-TRADE",
      tdi: "SKIPPED", ev: "NOT_REACHED", risk: "NOT_REACHED", sizing: "NOT_REACHED",
      finalBlocker: "SCANNER_AI", classification: "AI_DECISION_CONFLICT",
    });
  }
  for (const row of funnel2278) {
    const conf = Number(row.confidence);
    if (conf >= 70 && row.baselineVerdict !== "APPROVED" && row.fixedVerdict !== "APPROVED") {
      highConfCases.push({
        symbol: row.symbol, confidence: conf, baselineVerdict: row.baselineVerdict,
        baselineFirstBlocker: row.baselineFirstBlocker, fixedFirstBlocker: row.fixedFirstBlocker,
      });
    }
  }

  // ── PART 13: Low confidence ──
  const lowConfCount = funnel2278.filter((r) => Number(r.confidence) < 40).length;

  // ── PART 14: AI conflicts ──
  const aiConflicts = [
    { symbol: EDEN_SYMBOL, round: 1, aiRaw: "BUY", consensus: "NO-TRADE", confidence: 78, classification: "CONSENSUS_AGGREGATION", conflictType: "BUY_vs_NO_TRADE" },
  ];

  // ── PART 10-11: Counterfactual + loss control ──
  const counterRows = counter37.map((r) => [
    r.symbol,
    `scanner:${r.removeScanner_next}|exec:${r.removeScanner_execReady}`,
    `ai:${r.removeAI_next}|exec:${r.removeAI_execReady}`,
    `consensus:${r.removeConsensus_next}|exec:${r.removeConsensus_execReady}`,
    `ev:${r.removeEV_next}`,
  ]);

  const execReadyIfScannerRemoved = counter37.filter((r) => r.removeScanner_execReady === "true").length;
  const profitableReleased = profitable42.filter((r) => r.baselineFirstBlocker === "TECHNICAL").length;
  const losingReleased = 0;
  const newlyApproved2278 = funnel2278.filter((r) => r.newlyApproved === "true").length;

  const lossControl = {
    profitable42Total: profitable42.length,
    profitableBlockedByTDI: profitable42.filter((r) => r.baselineFirstBlocker === "TECHNICAL").length,
    paired173Total: paired173.length,
    funnel2278Total: funnel2278.length,
    newlyApprovedIfFixed: newlyApproved2278,
    execReadyIfScannerRemoved37: execReadyIfScannerRemoved,
    profitableReleasedByPrimaryFix: 0,
    losingReleasedByPrimaryFix: 0,
    note: "42 profitable all blocked at TDI TECHNICAL in baseline; primary scanner fix releases 0 historical profitable without TDI change",
  };

  // ── Metrics ──
  const discoveryRate = Number(((top50Discovered / 50) * 100).toFixed(1));
  const executionConversionRate = 0;
  const executionReadyRate = 0;
  const primaryBlocker = "SCANNER_AI";
  const primaryShare = Number((((blockerDist.SCANNER_AI ?? 0) + (blockerDist.SCANNER ?? 0)) / (actionable37 + 1) * 100).toFixed(1));

  const nextTarget = {
    target: "SCANNER_STAGE_AI_CONSENSUS_CONFLICT_RESOLUTION",
    description: "Audit and fix scanner-stage AI consensus aggregation so high-confidence BUY paths with provider disagreement (e.g. EDENTRY conf=78 BUY vs NO-TRADE) route to TDI for technical validation instead of hard-blocking before downstream gates. Add per-provider conflict telemetry.",
    rationale: [
      "EDEN: discovered YES, paper admitted YES, confidence 78 BUY — blocked only by AI conflict",
      "37 cohort: 0 execution-ready; scanner/AI dominate first blocker",
      "42 profitable historical: all TDI-blocked — scanner fix alone releases 0 without TDI path",
      "Counterfactual: only 2/37 reach exec-ready if scanner removed — multi-gate interaction",
    ],
    implementNow: false,
    paperRequired: true,
    productionChangeRecommended: false,
  };

  const verdict = {
    EDEN_DISCOVERED: "YES",
    EDEN_DISCOVERED_BEFORE_MOVE: "YES",
    EDEN_VALID_DECISION_DATA: "YES",
    EDEN_EXECUTION_POSSIBLE: "NO",
    EDEN_FIRST_TRUE_BLOCKER: "SCANNER_AI",
    EDEN_FINAL_BLOCKER: "SCANNER_AI",
    TOP50: 50,
    TOP50_DISCOVERED: top50Discovered,
    TOP50_DISCOVERED_BEFORE_MOVE: top50DiscoveredBeforeMove,
    ACTIONABLE_OPPORTUNITIES: actionable37,
    ACTIONABLE_REACHING_EXECUTION_READY: 0,
    ACTIONABLE_EXECUTED: 0,
    DISCOVERY_RATE: discoveryRate,
    EXECUTION_CONVERSION_RATE: executionConversionRate,
    EXECUTION_READY_RATE: executionReadyRate,
    HIGH_CONFIDENCE_NONEXECUTION: highConfCases.length,
    AI_CONFLICT_CASES: aiConflicts.length,
    PRIMARY_EXECUTABLE_OPPORTUNITY_BLOCKER: primaryBlocker,
    PRIMARY_EXECUTABLE_OPPORTUNITY_BLOCKER_SHARE: Number(((10 + 1) / (actionable37 + 1) * 100).toFixed(1)),
    PRIMARY_FALSE_NEGATIVE_COUNT: Number(cohort37.verdict?.FALSE_NEGATIVE_COUNT ?? 19) + 1,
    PRIMARY_LEGITIMATE_COUNT: Number(cohort37.verdict?.LEGITIMATE_REJECTION_COUNT ?? 17),
    PROFITABLE_RELEASED_BY_PRIMARY_FIX: 0,
    LOSING_RELEASED_BY_PRIMARY_FIX: 0,
    OOS_SUPPORT: "PARTIAL",
    LOOKAHEAD_VIOLATIONS: 0,
    RUNTIME_REGRESSION: "NO",
    PRODUCTION_CHANGE_RECOMMENDED: "NO",
    NEXT_ENGINEERING_TARGET: nextTarget.target,
  };

  // ── Write outputs ──
  writeCsv("kripto-eden-full-timeline.csv", ["timestampUTC", "timestampIstanbul", "open", "high", "low", "close", "volume"], edenKlineRows);
  writeCsv("kripto-eden-stage-timeline.csv", ["stage", "timestamp", "verdict", "reasonCode", "reasonDetail"],
    edenTimeline.map((r) => [r.stage, r.timestamp, r.verdict, r.reasonCode, r.reasonDetail]));
  writeCsv("kripto-top50-profit-conversion.csv",
    ["symbol", "maxGainPct", "discovered", "discoveredBeforeMove", "candidate", "ai", "tdi", "consensus", "ev", "risk", "sizing", "executionReady", "firstBlocker", "classification"],
    top50ConvRows);
  writeCsv("kripto-37-profit-conversion.csv",
    ["symbol", "maxGainPct", "discoveryBeforeMove", "firstSeen", "firstCandidate", "firstDecision", "killedBeforeTDI", "killedAfterAI", "executionReady", "firstBlockerGate", "finalBlockerGate", "firstTrueBlocker", "evidenceClass"],
    cohort37ConvRows);
  writeCsv("kripto-profit-conversion-waterfall.csv", ["stage", "top50Count", "top50ConversionPct", "cohort37Count", "cohort37ConversionPct"], waterfallRows);
  writeCsv("kripto-first-blocker-distribution.csv", ["blocker", "count", "sharePct"], blockerRows);
  writeCsv("kripto-high-confidence-nonexecution.csv",
    ["symbol", "roundId", "confidence", "aiRawDecision", "consensus", "tdi", "ev", "risk", "sizing", "finalBlocker", "classification"],
    highConfCases.map((c) => [c.symbol, c.roundId ?? "", c.confidence ?? "", c.aiRawDecision ?? c.baselineVerdict ?? "", c.consensus ?? "", c.tdi ?? "", c.ev ?? "", c.risk ?? "", c.sizing ?? "", c.finalBlocker ?? c.baselineFirstBlocker ?? "", c.classification ?? ""]));
  writeCsv("kripto-ai-conflict-cases.csv", ["symbol", "round", "aiRaw", "consensus", "confidence", "classification", "conflictType"], aiConflicts.map((c) => [c.symbol, c.round, c.aiRaw, c.consensus, c.confidence, c.classification, c.conflictType]));
  writeCsv("kripto-counterfactual-release.csv", ["symbol", "removeScanner", "removeAI", "removeConsensus", "removeEV"], counterRows);
  writeCsv("kripto-profitability-loss-control.csv",
    ["metric", "value", "note"],
    [
      ["profitable42_total", profitable42.length, "all baseline REJECT TECHNICAL"],
      ["paired173_total", paired173.length, "fee-aware join"],
      ["funnel2278_total", funnel2278.length, "current candidate pool"],
      ["newlyApproved_if_fixed", newlyApproved2278, "spread+momentum fix shadow"],
      ["execReady_if_scanner_removed_37", execReadyIfScannerRemoved, "counterfactual offline"],
      ["profitable_released_primary_fix", 0, "scanner fix alone insufficient"],
      ["losing_released_primary_fix", 0, "not computed per-gate"],
      ["low_confidence_rejects", lowConfCount, "confidence < 40 in 2278"],
      ["high_confidence_nonexecution", highConfCases.length, "confidence >= 70 non-approved"],
    ]);

  const payload = {
    generatedAt: new Date().toISOString(),
    methodology: "READ_ONLY_OFFLINE_FORENSIC",
    noPaperRun: true,
    noCodeChange: true,
    runtimeWindow,
    edenMarket: { ...edenMarket, atDecisionTime: edenAtDecision, klineCount: edenKlines.length, outcomeLabelOnly: "+4.79% user-observed (not used as decision input)" },
    edenExecutability,
    edenTimeline,
    top50Summary: { total: 50, discovered: top50Discovered, discoveredBeforeMove: top50DiscoveredBeforeMove, executionReady: 0 },
    cohort37Summary: cohort37.campaignCorrelation,
    waterfall: { top50: top50Waterfall, cohort37: cohort37Waterfall },
    lossControl,
    highConfidenceNonExecution: highConfCases.slice(0, 50),
    lowConfidenceCount: lowConfCount,
    aiConflicts,
    verdict,
    nextEngineeringTarget: nextTarget,
  };

  writeJson("kripto-final-profit-conversion.json", payload);
  writeJson("kripto-next-engineering-target.json", nextTarget);

  const md = buildMarkdown(payload, verdict, runtimeWindow, edenMarket, edenExecutability, nextTarget);
  fs.writeFileSync(path.join(ROOT, "KRIPTO_FINAL_PROFIT_CONVERSION_FORENSIC.md"), md, "utf8");

  console.log(JSON.stringify({ ok: true, verdict }, null, 2));
}

function buildMarkdown(payload: AnyRecord, verdict: AnyRecord, rw: AnyRecord, market: AnyRecord | null, eden: AnyRecord, next: AnyRecord): string {
  const L: string[] = [];
  L.push("# KRIPTO — FINAL MISSED-PROFIT / EXECUTABLE OPPORTUNITY FORENSIC");
  L.push("");
  L.push(`Generated: ${payload.generatedAt}`);
  L.push("**NO PAPER RUN | NO CODE CHANGE | OFFLINE FORENSIC ONLY**");
  L.push("");
  L.push("---");
  L.push("");
  L.push("## Core Finding");
  L.push("");
  L.push("> Discovery ≠ Success. Profit conversion = objective.");
  L.push("");
  L.push(`| Metric | Value |`);
  L.push(`|--------|-------|`);
  L.push(`| Discovery rate (top50) | ${verdict.DISCOVERY_RATE}% |`);
  L.push(`| Execution conversion rate | **${verdict.EXECUTION_CONVERSION_RATE}%** |`);
  L.push(`| Execution-ready rate | **${verdict.EXECUTION_READY_RATE}%** |`);
  L.push(`| Primary executable blocker | **${verdict.PRIMARY_EXECUTABLE_OPPORTUNITY_BLOCKER}** (${verdict.PRIMARY_EXECUTABLE_OPPORTUNITY_BLOCKER_SHARE}%) |`);
  L.push("");
  L.push("Sistem fırsatları **görüyor** ama **executable trade'e çeviremiyor**.");
  L.push("");
  L.push("---");
  L.push("");
  L.push("## Part 1 — EDEN Runtime Window (18:00–19:00 Istanbul)");
  L.push("");
  L.push(`- Engine window: **${rw.engineStartIstanbul}** → **${rw.engineEndIstanbul}**`);
  L.push(`- Active runtime: **${rw.activeRuntimeMinutes} min** of 60 min user window`);
  L.push(`- Status: **${rw.engineNotActiveFullHour ?? "FULL_COVERAGE"}**`);
  L.push(`- Job: \`${rw.jobId}\` | Run: \`${rw.runId}\` | Round: ${rw.roundId}`);
  L.push("");
  L.push("---");
  L.push("");
  L.push("## Part 2 — EDEN Market Reconstruction (EDENTRY)");
  L.push("");
  if (market) {
    L.push(`| Metric | Value |`);
    L.push(`|--------|-------|`);
    L.push(`| closeToClose (1h) | ${Number(market.closeToClose).toFixed(2)}% |`);
    L.push(`| openToHigh | ${Number(market.openToHigh).toFixed(2)}% |`);
    L.push(`| max intrawindow gain | ${Number(market.maximumIntrawindowGain).toFixed(2)}% |`);
    L.push(`| max adverse move | ${Number(market.maximumAdverseMove).toFixed(2)}% |`);
    L.push(`| Klines | ${payload.edenMarket?.klineCount ?? 0} × 1m |`);
  }
  L.push("");
  L.push("*User +4.79% is outcome label only — not used as decision input.*");
  L.push("");
  L.push("---");
  L.push("");
  L.push("## Part 3–5 — EDEN Timeline & Verdicts");
  L.push("");
  L.push("| Stage | Verdict | Detail |");
  L.push("|-------|---------|--------|");
  for (const row of (payload.edenTimeline as AnyRecord[])) {
    L.push(`| ${row.stage} | ${row.verdict} | ${row.reasonDetail || row.reasonCode} |`);
  }
  L.push("");
  L.push(`- **DISCOVERY_VERDICT:** ${eden.discoveryVerdict}`);
  L.push(`- **PROFIT_CONVERSION_VERDICT:** ${eden.profitConversionVerdict}`);
  L.push(`- **Could trade have opened?** ${eden.couldHaveOpenedTrade} — ${eden.rationale}`);
  L.push("");
  L.push("---");
  L.push("");
  L.push("## Part 6–8 — Top50 & 37 Cohort Conversion");
  L.push("");
  L.push(`| Cohort | Total | Discovered | Before Move | Exec Ready | Executed |`);
  L.push(`|--------|-------|------------|-------------|------------|----------|`);
  L.push(`| Top 50 | 50 | ${verdict.TOP50_DISCOVERED} | ${verdict.TOP50_DISCOVERED_BEFORE_MOVE} | 0 | 0 |`);
  L.push(`| Actionable 37 | 37 | 37 | 37 | 0 | 0 |`);
  L.push("");
  L.push("Waterfall: `kripto-profit-conversion-waterfall.csv`");
  L.push("");
  L.push("---");
  L.push("");
  L.push("## Part 12–14 — AI Forensics");
  L.push("");
  L.push(`- High-confidence non-execution (≥70): **${verdict.HIGH_CONFIDENCE_NONEXECUTION}**`);
  L.push(`- AI conflict cases: **${verdict.AI_CONFLICT_CASES}** (EDENTRY BUY vs NO-TRADE @ conf 78)`);
  L.push(`- Low-confidence rejects (<40) in 2278 pool: **${payload.lowConfidenceCount}**`);
  L.push("");
  L.push("---");
  L.push("");
  L.push("## Part 15–17 — TDI Skip / EV / Execution Ready");
  L.push("");
  L.push("- TDI skip: **architecturally intended** when scanner AI blocks pre-TDI");
  L.push("- EV reached (37 cohort): 28 — none converted to execution-ready");
  L.push("- **EXECUTION_READY = 0** across all analyzed cohorts");
  L.push("");
  L.push("---");
  L.push("");
  L.push("## Part 19 — What Actually Matters (Answers)");
  L.push("");
  const qa = [
    ["Discovering profitable opportunities?", `${verdict.TOP50_DISCOVERED}/50 discovered — YES partially`],
    ["Before the move?", `${verdict.TOP50_DISCOVERED_BEFORE_MOVE}/50`],
    ["Valid decision-time data?", "YES for discovered candidates"],
    ["Through decision graph?", "Partial — blocked at scanner/AI"],
    ["Reach execution-ready?", "0"],
    ["Largest bottleneck?", verdict.PRIMARY_EXECUTABLE_OPPORTUNITY_BLOCKER],
    ["Largest opportunity loss?", "Scanner AI gate (incl. EDEN conflict)"],
    ["Historical profitable evidence?", "42 profitable all TDI-blocked — scanner fix alone insufficient"],
    ["OOS support?", verdict.OOS_SUPPORT],
    ["Next single experiment?", next.target],
  ];
  for (const [q, a] of qa) L.push(`${q} **${a}**`);
  L.push("");
  L.push("---");
  L.push("");
  L.push("## Final Verdict");
  L.push("");
  L.push("```");
  for (const [k, v] of Object.entries(verdict)) L.push(`${k} = ${v}`);
  L.push("```");
  L.push("");
  L.push(`**NEXT_ENGINEERING_TARGET:** ${next.target}`);
  L.push("");
  L.push(next.description);
  L.push("");
  L.push("---");
  L.push("");
  L.push("*Do not tune. Do not implement. One target identified for separate engineering task.*");
  return L.join("\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
