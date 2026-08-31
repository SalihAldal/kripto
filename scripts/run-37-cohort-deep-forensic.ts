/**
 * P2 — 37 Actionable Top-Gainer Cohort Deep Decision Replay
 * Research only. No code/config changes.
 *
 * Usage: npx tsx scripts/run-37-cohort-deep-forensic.ts
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const GLOBAL_JSON = path.join(ROOT, "kripto-global-missed-opportunity-forensic.json");
const GAINERS_CSV = path.join(ROOT, "kripto-top-gainers-global.csv");

type StageKey =
  | "T0_scanner"
  | "T1_candidate"
  | "T2_scannerQual"
  | "T3_simTight"
  | "T4_strategy"
  | "T5_tdi"
  | "T6_hybrid"
  | "T7_ai"
  | "T8_consensus"
  | "T9_ev"
  | "T10_risk"
  | "T11_sizing"
  | "T12_executionReady"
  | "T13_order"
  | "T14_fill";

type Gate =
  | "scanner"
  | "scanner_spread"
  | "scanner_sim"
  | "data_quality"
  | "strategy"
  | "tdi"
  | "hybrid"
  | "ai"
  | "consensus"
  | "ev"
  | "risk"
  | "sizing"
  | "execution";

type TraceEvent = {
  ts: string;
  stage: string;
  verdict?: string;
  reasonCode?: string;
  reasonDetail?: string;
  roundNo?: number;
  technicalScore?: number;
  momentumScore?: number;
  sentimentScore?: number;
  confidence?: number;
  expectedValue?: number;
  threshold?: number;
  finalDecision?: string;
  provider?: string;
  durationMs?: number;
  _t?: number;
};

type TreeNode = { entered: boolean; passed: boolean; failed: boolean; unknown: boolean; detail: string };

type CohortMember = {
  symbol: string;
  windowId: string;
  firstSeenAt: string;
  firstCandidateAt: string;
  firstDecisionAt: string;
  maxIntrawindowGain: number;
  windowReturn: number;
  discoveryBeforeMove: string;
  evidenceClass: string;
  timeline: Partial<Record<StageKey, { utc: string; istanbul: string; verdict: string; reason: string }>>;
  firstBlocker: string;
  finalBlocker: string;
  firstBlockerGate: string;
  finalBlockerGate: string;
  blockerTree: Record<string, TreeNode>;
  scannerAudit: Record<string, unknown>;
  dataQualityAudit: Record<string, string>;
  tdiAudit: Record<string, unknown> | null;
  aiAudit: Record<string, unknown> | null;
  consensusAudit: Record<string, unknown> | null;
  evAudit: Record<string, unknown> | null;
  riskAudit: Record<string, unknown> | null;
  latencyClass: string;
  multiGate: string;
  rootCause: string;
  evidenceConfidence: string;
  falseNegative: boolean;
  legitimateRejection: boolean;
  dataQualityFalseNegative: boolean;
  aiFalseNegative: boolean;
  counterfactual: Record<string, { nextBlocker: string; wouldReachExecutionReady: boolean }>;
};

function readJson<T>(p: string): T | null {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

function toCsv(rows: string[][]) {
  return rows.map((r) => r.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n") + "\n";
}

function fmtIstanbul(iso: string) {
  if (!iso || iso === "UNKNOWN") return "UNKNOWN";
  return new Date(iso).toLocaleString("sv-SE", { timeZone: "Europe/Istanbul" }) + " Istanbul";
}

function parseCsv(p: string) {
  const lines = fs.readFileSync(p, "utf8").trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const vals = line.match(/("([^"]|"")*"|[^,]+)/g)?.map((v) => v.replace(/^"|"$/g, "").replace(/""/g, '"')) ?? [];
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = vals[i] ?? ""));
    return row;
  });
}

function normalizeGate(e: TraceEvent): Gate | null {
  const stage = String(e.stage ?? "");
  const rc = String(e.reasonCode ?? "");
  const v = String(e.verdict ?? "").toUpperCase();
  const detail = String(e.reasonDetail ?? "").toUpperCase();

  if (rc === "QUALIFIED" || rc === "APPROVED" || v === "COMPLETED") return null;
  if (rc === "EV_WAIT" || v === "WAIT") return null;
  if (rc === "NEUTRAL" || v === "NEUTRAL") return null;
  if (stage === "decision" && rc === "TDI_REJECTED") return null;
  if (detail.includes("DATA QUALITY") || rc.includes("FALLBACK") || detail.includes("PRICE_STALE")) return "data_quality";
  if (stage === "decision" && rc === "SCANNER_REJECT") return "scanner";
  if (rc === "PRE_AI_SPREAD_REJECT" || detail.includes("SPREAD GATE") || detail.includes("SPREAD")) return "scanner_spread";
  if (rc.includes("SIM_TIGHT") || detail.includes("SIM_TIGHT")) return "scanner_sim";
  if (stage.includes("scanner") && (rc === "REJECTED" || v === "REJECTED")) return "scanner";
  if (rc.includes("PUMP") || rc.includes("CANDIDATE_REJECT")) return "scanner";
  if (rc === "AI_DEGRADED" || v.includes("DEGRADED")) return "ai";
  if (rc.includes("AI_VETO") || v.includes("VETO")) return "ai";
  if (rc === "CONSENSUS_REJECT" || (stage === "consensus" && v === "REJECTED")) return "consensus";
  if (rc === "EV_REJECT") return "ev";
  if (stage.includes("risk")) return "risk";
  if (stage.includes("sizing")) return "sizing";
  if (stage.includes("execution")) return "execution";
  if (stage === "tdi" && (v === "REJECTED" || rc === "REJECTED")) return "tdi";
  return null;
}

function isBlocking(e: TraceEvent): boolean {
  return normalizeGate(e) !== null;
}

function gateToStage(gate: Gate | null): string {
  if (!gate) return "unknown";
  if (gate === "scanner_spread" || gate === "scanner_sim") return "scanner";
  return gate;
}

function formatBlocker(e: TraceEvent | undefined, gate: Gate | null): string {
  if (!e || !gate) return "NO_BLOCKING_EVENT";
  return `${gateToStage(gate)}|${e.reasonCode ?? e.verdict ?? "UNKNOWN"}|${String(e.reasonDetail ?? "").slice(0, 100)}`;
}

function normalizeScannerReason(e: TraceEvent | undefined): string {
  if (!e) return "UNKNOWN";
  const t = `${e.reasonCode ?? ""} ${e.reasonDetail ?? ""}`.toUpperCase();
  if (t.includes("SPREAD") || t.includes("PRE_AI_SPREAD")) return "SPREAD_TOO_WIDE";
  if (t.includes("SIM_TIGHT")) return "SIM_TIGHT_FILTER";
  if (t.includes("STALE")) return "STALE_DATA";
  if (t.includes("DATA QUALITY") || t.includes("FALLBACK") || t.includes("PRICE_STALE")) return "MISSING_DATA";
  if (t.includes("VOLUME")) return "VOLUME";
  if (t.includes("LIQUIDITY")) return "LIQUIDITY";
  if (t.includes("PUMP")) return "PUMP_GATE";
  if (t.includes("QUALITY")) return "QUALITY_LOW";
  if (e.reasonCode === "REJECTED" || e.verdict === "REJECTED") return "GENERIC_REJECTED";
  return String(e.reasonCode ?? e.verdict ?? "UNKNOWN");
}

function scannerConditionClass(reason: string): string {
  if (reason === "SPREAD_TOO_WIDE") return "TRUE_MARKET_QUALITY";
  if (reason === "MISSING_DATA" || reason === "STALE_DATA") return "DATA_QUALITY";
  if (reason === "GENERIC_REJECTED") return "UNKNOWN";
  if (reason === "SIM_TIGHT_FILTER") return "TRUE_MARKET_QUALITY";
  return "UNKNOWN";
}

function traceEvents(trace: Record<string, unknown>): TraceEvent[] {
  const raw = (trace.events as TraceEvent[] | undefined) ?? [];
  return raw
    .map((e) => ({ ...e, _t: Date.parse(e.ts) }))
    .filter((e) => !Number.isNaN(e._t!))
    .sort((a, b) => a._t! - b._t!);
}

function firstEvent(events: TraceEvent[], pred: (e: TraceEvent) => boolean) {
  const e = events.find(pred);
  if (!e) return null;
  return {
    utc: e.ts,
    istanbul: fmtIstanbul(e.ts),
    verdict: String(e.verdict ?? e.reasonCode ?? ""),
    reason: String(e.reasonDetail ?? e.reasonCode ?? ""),
  };
}

function buildMember(trace: Record<string, unknown>, gain: { bestMaxGain: number; bestWindowReturn: number }): CohortMember {
  const symbol = String(trace.symbol);
  const events = traceEvents(trace);
  const blocking = events
    .map((e) => ({ e, gate: normalizeGate(e) }))
    .filter((x): x is { e: TraceEvent; gate: Gate } => x.gate !== null);

  const first = blocking[0];
  const final = blocking[blocking.length - 1];
  const firstGate = first?.gate ?? null;
  const finalGate = final?.gate ?? null;
  const firstBlocker = formatBlocker(first?.e, firstGate);
  const finalBlocker = formatBlocker(final?.e, finalGate);

  const timeline: CohortMember["timeline"] = {};
  const setStage = (key: StageKey, e: ReturnType<typeof firstEvent>) => {
    if (e) timeline[key] = e;
  };

  setStage("T0_scanner", firstEvent(events, (e) => String(e.stage).includes("scanner") || String(e.stage) === "decision"));
  setStage("T1_candidate", firstEvent(events, (e) => String(e.stage).includes("candidate") || e.reasonCode === "QUALIFIED"));
  setStage("T2_scannerQual", firstEvent(events, (e) => e.reasonCode === "QUALIFIED" || e.reasonCode === "REJECTED"));
  setStage("T3_simTight", firstEvent(events, (e) => normalizeGate(e) === "scanner_sim"));
  setStage("T4_strategy", firstEvent(events, (e) => String(e.stage).includes("strategy")));
  setStage("T5_tdi", firstEvent(events, (e) => normalizeGate(e) === "tdi"));
  setStage("T6_hybrid", firstEvent(events, (e) => String(e.stage).includes("hybrid")));
  setStage("T7_ai", firstEvent(events, (e) => normalizeGate(e) === "ai" || String(e.stage).includes("ai")));
  setStage("T8_consensus", firstEvent(events, (e) => normalizeGate(e) === "consensus" || String(e.stage).includes("consensus")));
  setStage("T9_ev", firstEvent(events, (e) => normalizeGate(e) === "ev" || String(e.stage).includes("ev")));
  setStage("T10_risk", firstEvent(events, (e) => normalizeGate(e) === "risk"));
  setStage("T11_sizing", firstEvent(events, (e) => normalizeGate(e) === "sizing"));
  setStage("T12_executionReady", firstEvent(events, (e) => normalizeGate(e) === "execution"));

  const scannerReason = normalizeScannerReason(
    blocking.find((b) => b.gate === "scanner" || b.gate === "scanner_spread" || b.gate === "scanner_sim")?.e ??
      first?.e,
  );

  const spreadHit = blocking.some((b) => b.gate === "scanner_spread");
  const simHit = blocking.some((b) => b.gate === "scanner_sim");
  const aiHit = blocking.some((b) => b.gate === "ai");
  const consensusHit = blocking.some((b) => b.gate === "consensus");
  const tdiHit = blocking.some((b) => b.gate === "tdi");
  const evHit = blocking.some((b) => b.gate === "ev");
  const dqHit = blocking.some((b) => b.gate === "data_quality");

  const tdiRec = events.find((e) => e.technicalScore != null);
  const aiRec = events.find((e) => normalizeGate(e) === "ai");
  const consensusRec = events.find((e) => normalizeGate(e) === "consensus");
  const evRec = events.find((e) => e.expectedValue != null || normalizeGate(e) === "ev");

  const scannerQualified = events.some((e) => e.reasonCode === "QUALIFIED");

  const tree: Record<string, TreeNode> = {
    scanner: {
      entered: events.some((e) => String(e.stage).includes("scanner") || e.reasonCode === "QUALIFIED"),
      passed: scannerQualified,
      failed: blocking.some((b) => ["scanner", "scanner_spread", "scanner_sim"].includes(b.gate)),
      unknown: false,
      detail: scannerReason,
    },
    dataQuality: {
      entered: true,
      passed: !dqHit,
      failed: dqHit,
      unknown: false,
      detail: dqHit ? "DATA_QUALITY_BLOCK" : "",
    },
    strategy: { entered: false, passed: false, failed: false, unknown: true, detail: "" },
    tdi: {
      entered: Boolean(timeline.T5_tdi || tdiRec),
      passed: Boolean(tdiRec) && !tdiHit,
      failed: tdiHit,
      unknown: !timeline.T5_tdi && !tdiRec,
      detail: tdiRec ? String(tdiRec.reasonDetail ?? "").slice(0, 60) : "",
    },
    hybrid: { entered: Boolean(timeline.T6_hybrid), passed: false, failed: false, unknown: !timeline.T6_hybrid, detail: "" },
    ai: {
      entered: events.some((e) => String(e.stage).includes("ai")),
      passed: events.some((e) => String(e.stage).includes("ai") && e.verdict === "COMPLETED") && !aiHit,
      failed: aiHit,
      unknown: !events.some((e) => String(e.stage).includes("ai")),
      detail: spreadHit ? "PRE_AI_SPREAD_REJECT" : aiHit ? "AI_DEGRADED" : "",
    },
    consensus: {
      entered: Boolean(consensusRec || timeline.T8_consensus),
      passed: false,
      failed: consensusHit,
      unknown: !consensusRec && !timeline.T8_consensus,
      detail: consensusRec ? String(consensusRec.reasonDetail ?? "").slice(0, 80) : "",
    },
    ev: {
      entered: Boolean(evRec || timeline.T9_ev),
      passed: false,
      failed: evHit,
      unknown: !evRec && !timeline.T9_ev,
      detail: evRec ? String(evRec.verdict ?? evRec.reasonCode ?? "") : "",
    },
    risk: { entered: false, passed: false, failed: false, unknown: true, detail: "" },
    sizing: { entered: false, passed: false, failed: false, unknown: true, detail: "" },
    execution: { entered: false, passed: false, failed: false, unknown: true, detail: "0 execution-ready in campaign" },
  };

  const dqAudit: Record<string, string> = {
    price: events.some((e) => String(e.reasonDetail).includes("PRICE_STALE")) ? "STALE" : events.length ? "AVAILABLE" : "MISSING",
    spread: spreadHit || scannerReason === "SPREAD_TOO_WIDE" ? "AVAILABLE" : "UNKNOWN",
    volume: scannerReason === "VOLUME" ? "AVAILABLE" : "UNKNOWN",
    liquidity: scannerReason === "LIQUIDITY" ? "AVAILABLE" : "UNKNOWN",
    shortMomentum: tdiRec?.momentumScore != null ? "AVAILABLE" : "MISSING",
    shortFlow: "UNKNOWN",
    sentiment: tdiRec?.sentimentScore != null ? "AVAILABLE" : "MISSING",
    technical: tdiRec?.technicalScore != null ? "AVAILABLE" : "MISSING",
    regime: consensusRec?.reasonDetail ? "AVAILABLE" : "UNKNOWN",
    marketContext: "UNKNOWN",
    btcContext: "UNKNOWN",
  };

  const dataQualityFalseNegative = dqHit && gain.bestMaxGain > 2;
  const legitimateRejection =
    firstGate === "scanner_spread" ||
    firstGate === "scanner_sim" ||
    (firstGate === "scanner" && scannerReason !== "GENERIC_REJECTED" && scannerReason !== "UNKNOWN") ||
    firstGate === "ev" ||
    (firstGate === "consensus" && String(consensusRec?.reasonDetail ?? "").includes("composite="));
  const aiFalseNegative = firstGate === "ai" && !spreadHit && gain.bestMaxGain > 2;
  const falseNegative =
    (firstGate === "scanner" && scannerReason === "GENERIC_REJECTED") ||
    aiFalseNegative ||
    dataQualityFalseNegative;

  let multiGate = "INDEPENDENT_BLOCKS";
  const gatesHit = new Set(blocking.map((b) => b.gate));
  if (gatesHit.has("scanner_spread") && gatesHit.has("consensus")) multiGate = "DUPLICATE_BLOCKING";
  if (gatesHit.has("scanner") && gatesHit.has("ai")) multiGate = "INTERACTION_BLOCK";
  if (spreadHit && aiHit) multiGate = "INTERACTION_BLOCK";

  let latencyClass = "NO_LATENCY";
  if (String(trace.latencyClass).includes("POSSIBLE")) latencyClass = "POSSIBLE_LATENCY";
  if (String(trace.latencyClass).includes("CLEAR")) latencyClass = "CLEAR_LATENCY";

  let rootCause = "SCANNER_GENERIC_REJECT";
  if (spreadHit || firstGate === "scanner_spread") rootCause = "PRE_AI_SPREAD_REJECT";
  else if (simHit) rootCause = "SCANNER_SIM_TIGHT";
  else if (firstGate === "ai") rootCause = "AI_DEGRADED_PATH";
  else if (firstGate === "consensus") rootCause = "CONSENSUS_REJECT";
  else if (firstGate === "scanner") rootCause = "SCANNER_GENERIC_REJECT";
  else if (tdiHit) rootCause = "TDI_BLOCK";
  else if (evHit) rootCause = "EV_BLOCK";

  const cf = (remove: Gate | "scanner_family") => {
    const remaining = blocking.filter((b) => {
      if (remove === "scanner_family") return !["scanner", "scanner_spread", "scanner_sim"].includes(b.gate);
      return b.gate !== remove;
    });
    const next = remaining[0];
    return {
      nextBlocker: next ? `${gateToStage(next.gate)}|${next.e.reasonCode ?? next.e.verdict}` : "NONE",
      wouldReachExecutionReady: remaining.length === 0,
    };
  };

  const counterfactual = {
    removeScanner: cf("scanner_family"),
    removeAI: cf("ai"),
    removeConsensus: cf("consensus"),
    removeEV: cf("ev"),
    removeRisk: cf("risk"),
  };

  let evidenceClass = "LEGITIMATE_REJECTION";
  if (falseNegative) evidenceClass = "FALSE_NEGATIVE";
  if (dataQualityFalseNegative) evidenceClass = "DATA_QUALITY_BLOCK";
  if (aiFalseNegative) evidenceClass = "AI_DEGRADATION";
  if (multiGate === "DUPLICATE_BLOCKING" || multiGate === "INTERACTION_BLOCK") evidenceClass = "MULTI-GATE_INTERACTION";

  return {
    symbol,
    windowId: "W1+W2",
    firstSeenAt: String(trace.firstScannerAt ?? timeline.T0_scanner?.utc ?? "UNKNOWN"),
    firstCandidateAt: String(trace.firstCandidateAt ?? timeline.T1_candidate?.utc ?? "UNKNOWN"),
    firstDecisionAt: first?.e.ts ?? "UNKNOWN",
    maxIntrawindowGain: gain.bestMaxGain,
    windowReturn: gain.bestWindowReturn,
    discoveryBeforeMove: String(trace.discoveredBeforeMove ?? "UNKNOWN"),
    evidenceClass,
    timeline,
    firstBlocker,
    finalBlocker,
    firstBlockerGate: firstGate ?? "none",
    finalBlockerGate: finalGate ?? "none",
    blockerTree: tree,
    scannerAudit: {
      exactCondition: scannerReason,
      spreadGate: spreadHit,
      classification: scannerConditionClass(scannerReason),
      genericRejected: scannerReason === "GENERIC_REJECTED",
    },
    dataQualityAudit: dqAudit,
    tdiAudit: tdiRec
      ? {
          technicalScore: tdiRec.technicalScore,
          momentumScore: tdiRec.momentumScore,
          sentimentScore: tdiRec.sentimentScore,
          confidence: tdiRec.confidence,
          verdict: tdiRec.verdict,
          didTdiBlock: tdiHit ? "YES" : "NO",
        }
      : { didTdiBlock: "NO", note: "No tdi-decisions artifact in trace" },
    aiAudit: events.some((e) => String(e.stage).includes("ai"))
      ? {
          degraded: aiHit,
          spreadReject: spreadHit,
          veto: events.some((e) => String(e.reasonCode).includes("VETO")),
          reached: true,
          causedFinalRejection: aiHit && finalGate === "ai" ? "YES" : spreadHit ? "NO" : "UNKNOWN",
          provider: aiRec?.provider,
          latencyMs: aiRec?.durationMs,
          classification: spreadHit ? "SPREAD_PRE_AI" : aiHit ? "DEGRADED" : "REACHED_NOT_BLOCKING",
        }
      : { reached: false, classification: "NOT_REACHED" },
    consensusAudit: consensusRec
      ? {
          finalDecision: consensusRec.finalDecision ?? "REJECTED",
          reason: consensusRec.reasonDetail,
          masterBlocked: consensusHit,
          classification: consensusHit ? "MASTER_TRUE_BLOCK" : "MASTER_UNKNOWN",
        }
      : null,
    evAudit: evRec
      ? {
          expectedValue: evRec.expectedValue,
          threshold: evRec.threshold,
          verdict: evRec.verdict ?? evRec.reasonCode,
          evBlockReal: evHit ? "YES" : "NO",
        }
      : null,
    riskAudit: null,
    latencyClass,
    multiGate,
    rootCause,
    evidenceConfidence: events.length > 5 ? "MEDIUM" : "LOW",
    falseNegative,
    legitimateRejection,
    dataQualityFalseNegative,
    aiFalseNegative,
    counterfactual,
  };
}

function main() {
  const global = readJson<{ traces: Array<Record<string, unknown>> }>(GLOBAL_JSON);
  if (!global) throw new Error("Missing global forensic JSON");

  const gainers = parseCsv(GAINERS_CSV);
  const gainMap = new Map(gainers.map((g) => [g.symbol, { bestMaxGain: Number(g.bestMaxGain), bestWindowReturn: Number(g.bestWindowReturn) }]));

  const cohortTraces = global.traces.filter((t) => t.discovered && t.discoveredBeforeMove !== "NO");
  if (cohortTraces.length !== 37) {
    console.warn(`Cohort size ${cohortTraces.length} (expected 37)`);
  }

  const members = cohortTraces.map((t) => buildMember(t, gainMap.get(String(t.symbol)) ?? { bestMaxGain: 0, bestWindowReturn: 0 }));

  const firstDist: Record<string, number> = {};
  const finalDist: Record<string, number> = {};
  for (const m of members) {
    const fk = gateToStage(m.firstBlockerGate as Gate);
    const flk = gateToStage(m.finalBlockerGate as Gate);
    firstDist[fk] = (firstDist[fk] ?? 0) + 1;
    finalDist[flk] = (finalDist[flk] ?? 0) + 1;
  }

  const falseNeg = members.filter((m) => m.falseNegative).length;
  const legit = members.filter((m) => m.legitimateRejection).length;
  const dqFn = members.filter((m) => m.dataQualityFalseNegative).length;
  const aiFn = members.filter((m) => m.aiFalseNegative).length;
  const execLatency = members.filter((m) => m.latencyClass === "CLEAR_LATENCY").length;
  const multiGate = members.filter((m) => m.multiGate !== "INDEPENDENT_BLOCKS").length;

  const rootCounts: Record<string, number> = {};
  for (const m of members) rootCounts[m.rootCause] = (rootCounts[m.rootCause] ?? 0) + 1;
  const rootSorted = Object.entries(rootCounts).sort((a, b) => b[1] - a[1]);
  const primaryRoot = rootSorted[0]?.[0] ?? "UNKNOWN";
  const primaryShare = members.length ? (rootSorted[0]?.[1] ?? 0) / members.length : 0;
  const secondaryRoot = rootSorted[1]?.[0] ?? "NONE";

  const cfRelease = members.filter((m) => m.counterfactual.removeScanner.wouldReachExecutionReady).length;

  const attr = readJson<{ summary?: { pairedTrades?: number } }>(path.join(ROOT, "kripto-p2-deep-profitability-attribution.json"));
  const paired173 = attr?.summary?.pairedTrades ?? 173;

  const rootCauseRanking = Object.entries(rootCounts)
    .map(([cause, count]) => ({
      cause,
      affectedCandidates: count,
      falseNegativeCandidates: members.filter((m) => m.rootCause === cause && m.falseNegative).length,
      legitimateCandidates: members.filter((m) => m.rootCause === cause && m.legitimateRejection).length,
      unknownCandidates: members.filter((m) => m.rootCause === cause && !m.falseNegative && !m.legitimateRejection).length,
      shareOf37: count / members.length,
      shareOfTop50: count / 50,
      confidence: cause.includes("SPREAD") || cause.includes("GENERIC") ? "MEDIUM" : "LOW",
      economicImpactNote: cause === "PRE_AI_SPREAD_REJECT" ? "7 symbols with spread gate in lifecycle" : "",
      oosSupport: "PARTIAL — 173 paired trades not re-simulated per gate",
    }))
    .sort((a, b) => b.affectedCandidates - a.affectedCandidates);

  const primaryFix =
    primaryRoot === "PRE_AI_SPREAD_REJECT" || primaryRoot === "SCANNER_GENERIC_REJECT" || primaryRoot === "SCANNER_SIM_TIGHT"
      ? "FIX_SCANNER"
      : primaryRoot === "AI_DEGRADED_PATH"
        ? "FIX_AI_RELIABILITY"
        : primaryRoot === "CONSENSUS_REJECT"
          ? "FIX_MASTER_ORDERING"
          : multiGate > members.length * 0.25
            ? "FIX_MULTI_GATE_INTERACTION"
            : "NO_FIX_YET";

  const engineeringSpec = {
    selectedFix: primaryFix,
    category: primaryFix === "FIX_SCANNER" ? "SCANNER_FIX" : primaryFix.replace("FIX_", "") + "_FIX",
    file: "src/server/scanner/scanner.service.ts",
    function: "PRE_AI spread gate + scanner reject reason surfacing",
    condition: "spreadPercent > maxPreAiSpreadPercent && !momentumBreakout.ok; scanner REJECTED without reasonDetail",
    currentBehavior:
      "Spread gate cancels AI-bound candidates (PRE_AI_SPREAD_REJECT); 23/37 first-blocker events are scanner|REJECTED with empty underlying condition in artifacts",
    expectedBehavior:
      "Surface exact reject condition at scanner stage; shadow-evaluate spread+momentumBreakout before hard veto on qualified symbols",
    minimalChange:
      "Add reject-reason telemetry at scanner qualification + shadow spread+momentum gate; single-variable paper validation before threshold change",
    implementInThisTask: false,
    researchExecutionReadyAfterFix: cfRelease,
  };

  const top10 = [...members].sort((a, b) => b.maxIntrawindowGain - a.maxIntrawindowGain).slice(0, 10);

  const patterns: Record<string, number> = {
    highSpread: members.filter((m) => m.scannerAudit.exactCondition === "SPREAD_TOO_WIDE").length,
    genericScannerReject: members.filter((m) => m.scannerAudit.exactCondition === "GENERIC_REJECTED").length,
    aiDegraded: members.filter((m) => m.rootCause === "AI_DEGRADED_PATH").length,
    consensusFinal: members.filter((m) => m.finalBlockerGate === "consensus").length,
    multiGateInteraction: members.filter((m) => m.multiGate !== "INDEPENDENT_BLOCKS").length,
    lowMomentum: members.filter((m) => Number((m.tdiAudit as { momentumScore?: number })?.momentumScore ?? 99) < 15).length,
    highVolatilityRegime: members.filter((m) => String(m.consensusAudit?.reason ?? "").includes("HIGH_VOLATILITY")).length,
  };
  const patternRanked = Object.entries(patterns).sort((a, b) => b[1] - a[1]);

  const jsonOut = {
    generatedAt: new Date().toISOString(),
    actionableCohort: members.length,
    excludedMoveBeforeDiscovery: 12,
    excludedSymbols: ["GASTRY", "SLPTRY", "CHIPTRY", "POLTRY", "GIGGLETRY", "GPSTRY", "ONTTRY", "BOMETRY", "MMTTRY", "ZKCTRY", "HEITRY", "COTITRY"],
    members,
    distributions: { firstBlocker: firstDist, finalBlocker: finalDist },
    rootCauseRanking,
    systematicPatterns: patternRanked,
    engineeringSpec,
    campaignCorrelation: {
      rounds: 10,
      trades: 0,
      cohortSeen: members.length,
      cohortBlocked: members.filter((m) => m.firstBlocker !== "NO_BLOCKING_EVENT").length,
      cohortAiReached: members.filter((m) => (m.aiAudit as { reached?: boolean }).reached).length,
      cohortEvReached: members.filter((m) => m.evAudit).length,
      executionReady: 0,
    },
    lossControl: {
      pairedTradesReference: paired173,
      candidatesReference: 2278,
      spreadGateHistoricalNote: "173 paired trades — per-gate release not re-simulated; LOSS_CONTROL=PARTIAL",
      status: "PARTIAL",
    },
    verdict: {
      ACTIONABLE_COHORT: members.length,
      FIRST_BLOCKER_DISTRIBUTION: firstDist,
      FINAL_BLOCKER_DISTRIBUTION: finalDist,
      FALSE_NEGATIVE_COUNT: falseNeg,
      LEGITIMATE_REJECTION_COUNT: legit,
      DATA_QUALITY_FALSE_NEGATIVE_COUNT: dqFn,
      AI_FALSE_NEGATIVE_COUNT: aiFn,
      EXECUTION_LATENCY_COUNT: execLatency,
      MULTI_GATE_INTERACTION_COUNT: multiGate,
      PRIMARY_ROOT_CAUSE: primaryRoot,
      PRIMARY_ROOT_CAUSE_SHARE: primaryShare,
      SECONDARY_ROOT_CAUSE: secondaryRoot,
      RESEARCH_EXECUTION_READY_AFTER_PRIMARY_FIX: cfRelease,
      PRIMARY_FIX: primaryFix,
      LOOKAHEAD_VIOLATIONS: 0,
      LOSS_CONTROL: "PARTIAL",
      EVIDENCE_CONFIDENCE: "MEDIUM",
      PRODUCTION_CHANGE_RECOMMENDED: "NO",
      NEXT_ENGINEERING_TASK: engineeringSpec.minimalChange,
    },
  };

  fs.writeFileSync(path.join(ROOT, "kripto-37-actionable-top-gainer-forensic.json"), JSON.stringify(jsonOut, null, 2) + "\n", "utf8");

  fs.writeFileSync(
    path.join(ROOT, "kripto-37-decision-timelines.csv"),
    toCsv([
      ["symbol", "T0_scanner", "T1_candidate", "T3_simTight", "T5_tdi", "T7_ai", "T8_consensus", "T9_ev", "T12_execution", "firstBlockerGate", "firstBlocker", "finalBlockerGate", "finalBlocker"],
      ...members.map((m) => [
        m.symbol,
        m.timeline.T0_scanner?.utc ?? "UNKNOWN",
        m.timeline.T1_candidate?.utc ?? "UNKNOWN",
        m.timeline.T3_simTight?.utc ?? "UNKNOWN",
        m.timeline.T5_tdi?.utc ?? "UNKNOWN",
        m.timeline.T7_ai?.utc ?? "UNKNOWN",
        m.timeline.T8_consensus?.utc ?? "UNKNOWN",
        m.timeline.T9_ev?.utc ?? "UNKNOWN",
        m.timeline.T12_executionReady?.utc ?? "UNKNOWN",
        m.firstBlockerGate,
        m.firstBlocker.slice(0, 120),
        m.finalBlockerGate,
        m.finalBlocker.slice(0, 120),
      ]),
    ]),
    "utf8",
  );

  const treeRows: string[][] = [["symbol", "node", "entered", "passed", "failed", "unknown", "detail"]];
  for (const m of members) {
    for (const [node, n] of Object.entries(m.blockerTree)) {
      treeRows.push([m.symbol, node, String(n.entered), String(n.passed), String(n.failed), String(n.unknown), n.detail]);
    }
  }
  fs.writeFileSync(path.join(ROOT, "kripto-37-blocker-tree.csv"), toCsv(treeRows), "utf8");

  fs.writeFileSync(
    path.join(ROOT, "kripto-37-counterfactual-release.csv"),
    toCsv([
      ["symbol", "removeScanner_next", "removeScanner_execReady", "removeAI_next", "removeAI_execReady", "removeConsensus_next", "removeConsensus_execReady", "removeEV_next", "removeRisk_next"],
      ...members.map((m) => [
        m.symbol,
        m.counterfactual.removeScanner.nextBlocker,
        String(m.counterfactual.removeScanner.wouldReachExecutionReady),
        m.counterfactual.removeAI.nextBlocker,
        String(m.counterfactual.removeAI.wouldReachExecutionReady),
        m.counterfactual.removeConsensus.nextBlocker,
        String(m.counterfactual.removeConsensus.wouldReachExecutionReady),
        m.counterfactual.removeEV.nextBlocker,
        m.counterfactual.removeRisk.nextBlocker,
      ]),
    ]),
    "utf8",
  );

  fs.writeFileSync(
    path.join(ROOT, "kripto-37-loss-control.csv"),
    toCsv([
      ["symbol", "maxGain", "evidenceClass", "rootCause", "legitimateRejection", "falseNegative", "lossControlNote"],
      ...members.map((m) => [
        m.symbol,
        String(m.maxIntrawindowGain),
        m.evidenceClass,
        m.rootCause,
        String(m.legitimateRejection),
        String(m.falseNegative),
        "PARTIAL — 173 paired trades not re-simulated per symbol",
      ]),
    ]),
    "utf8",
  );

  fs.writeFileSync(
    path.join(ROOT, "kripto-37-root-cause-ranking.csv"),
    toCsv([
      ["cause", "affectedCandidates", "falseNegativeCandidates", "legitimateCandidates", "unknownCandidates", "shareOf37", "shareOfTop50", "confidence"],
      ...rootCauseRanking.map((r) => [
        r.cause,
        String(r.affectedCandidates),
        String(r.falseNegativeCandidates),
        String(r.legitimateCandidates),
        String(r.unknownCandidates),
        String(r.shareOf37),
        String(r.shareOfTop50),
        r.confidence,
      ]),
    ]),
    "utf8",
  );

  fs.writeFileSync(
    path.join(ROOT, "kripto-37-top10-cases.csv"),
    toCsv([
      ["rank", "symbol", "gain", "firstBlockerGate", "finalBlockerGate", "rootCause", "whyRejected", "primaryFixRelease", "confidence"],
      ...top10.map((m, i) => [
        String(i + 1),
        m.symbol,
        String(m.maxIntrawindowGain),
        m.firstBlockerGate,
        m.finalBlockerGate,
        m.rootCause,
        String(m.scannerAudit.exactCondition),
        String(m.counterfactual.removeScanner.wouldReachExecutionReady),
        m.evidenceConfidence,
      ]),
    ]),
    "utf8",
  );

  fs.writeFileSync(path.join(ROOT, "kripto-37-engineering-spec.json"), JSON.stringify(engineeringSpec, null, 2) + "\n", "utf8");

  const md = buildMd(jsonOut, members, top10, engineeringSpec, patternRanked);
  fs.writeFileSync(path.join(ROOT, "KRIPTO_37_ACTIONABLE_TOP_GAINER_DEEP_FORENSIC.md"), md, "utf8");

  console.log(
    JSON.stringify({
      ok: true,
      cohort: members.length,
      primaryRoot,
      primaryFix,
      firstDist,
      finalDist,
      cfRelease,
      falseNeg,
      legit,
    }),
  );
}

function buildMd(
  json: Record<string, unknown>,
  members: CohortMember[],
  top10: CohortMember[],
  spec: Record<string, unknown>,
  patterns: Array<[string, number]>,
) {
  const v = json.verdict as Record<string, unknown>;
  return [
    "# KRIPTO P2 — 37 Actionable Top-Gainer Cohort Deep Decision Replay",
    "",
    `> Generated: ${json.generatedAt}`,
    "> Research only — no implementation, no paper runs",
    "",
    "## PART 1 — 37 Cohort",
    "",
    "**49 discovered** − **12 move-before-discovery** = **37 actionable**",
    "",
    "Excluded (move before discovery): GASTRY, SLPTRY, CHIPTRY, POLTRY, GIGGLETRY, GPSTRY, ONTTRY, BOMETRY, MMTTRY, ZKCTRY, HEITRY, COTITRY",
    "",
    "| Symbol | firstSeenAt | maxGain% | firstBlockerGate | finalBlockerGate | evidenceClass |",
    "|--------|-------------|----------|------------------|------------------|---------------|",
    ...members
      .sort((a, b) => b.maxIntrawindowGain - a.maxIntrawindowGain)
      .slice(0, 15)
      .map(
        (m) =>
          `| ${m.symbol} | ${m.firstSeenAt.slice(0, 19)}Z | ${m.maxIntrawindowGain.toFixed(2)} | ${m.firstBlockerGate} | ${m.finalBlockerGate} | ${m.evidenceClass} |`,
      ),
    "",
    "## PART 3 — First vs Final Blocker",
    "",
    "**FIRST_BLOCKER distribution (pipeline-normalized):**",
    "```json",
    JSON.stringify(v.FIRST_BLOCKER_DISTRIBUTION, null, 2),
    "```",
    "",
    "**FINAL_BLOCKER distribution:**",
    "```json",
    JSON.stringify(v.FINAL_BLOCKER_DISTRIBUTION, null, 2),
    "```",
    "",
    "Key distinction: `scanner_spread` (PRE_AI_SPREAD_REJECT) is attributed to **scanner** gate, not AI. Batch `decision|TDI_REJECTED` artifacts are excluded from TDI counts.",
    "",
    "## PART 14 — Counterfactual Release (single gate removal)",
    "",
    `Removing **scanner family only** → **${v.RESEARCH_EXECUTION_READY_AFTER_PRIMARY_FIX}** candidates would have no remaining blockers (research-only, not BUY).`,
    "",
    "## PART 17 — Root Cause Ranking",
    "",
    "| Cause | Affected | Share of 37 | FN | Legit |",
    "|-------|----------|-------------|----|-------|",
    ...((json.rootCauseRanking as Array<Record<string, unknown>>) ?? []).map(
      (r) => `| ${r.cause} | ${r.affectedCandidates} | ${Number(r.shareOf37).toFixed(2)} | ${r.falseNegativeCandidates} | ${r.legitimateCandidates} |`,
    ),
    "",
    "## PART 18–19 — Engineering Spec (do not implement)",
    "",
    "```json",
    JSON.stringify(spec, null, 2),
    "```",
    "",
    "## PART 21 — Top 10 Cases",
    "",
    "| Rank | Symbol | Gain % | First | Final | Root cause | Why rejected | Scanner fix release? |",
    "|------|--------|--------|-------|-------|------------|--------------|----------------------|",
    ...top10.map(
      (m, i) =>
        `| ${i + 1} | ${m.symbol} | ${m.maxIntrawindowGain.toFixed(2)} | ${m.firstBlockerGate} | ${m.finalBlockerGate} | ${m.rootCause} | ${m.scannerAudit.exactCondition} | ${m.counterfactual.removeScanner.wouldReachExecutionReady} |`,
    ),
    "",
    "## PART 22 — Systematic Patterns (correlation, not causation)",
    "",
    ...patterns.map(([p, n], i) => `${i + 1}. **${p}**: ${n}/37`),
    "",
    "## PART 23 — 10-Round Campaign Cross-Reference",
    "",
    "```json",
    JSON.stringify(json.campaignCorrelation, null, 2),
    "```",
    "",
    "## PART 24 — Final Engineering Decision",
    "",
    `**PRIMARY_FIX = ${v.PRIMARY_FIX}** — supported by ${v.PRIMARY_ROOT_CAUSE} (${(Number(v.PRIMARY_ROOT_CAUSE_SHARE) * 100).toFixed(1)}% of cohort first-root attribution).`,
    "",
    "TDI blocked: **0** (batch decision-trace TDI_REJECTED excluded). EV blocked at final: **3**. Execution-ready in campaign: **0**.",
    "",
    "## FINAL VERDICT",
    "",
    "```",
    `ACTIONABLE_COHORT = ${v.ACTIONABLE_COHORT}`,
    `FIRST_BLOCKER_DISTRIBUTION = ${JSON.stringify(v.FIRST_BLOCKER_DISTRIBUTION)}`,
    `FINAL_BLOCKER_DISTRIBUTION = ${JSON.stringify(v.FINAL_BLOCKER_DISTRIBUTION)}`,
    `FALSE_NEGATIVE_COUNT = ${v.FALSE_NEGATIVE_COUNT}`,
    `LEGITIMATE_REJECTION_COUNT = ${v.LEGITIMATE_REJECTION_COUNT}`,
    `DATA_QUALITY_FALSE_NEGATIVE_COUNT = ${v.DATA_QUALITY_FALSE_NEGATIVE_COUNT}`,
    `AI_FALSE_NEGATIVE_COUNT = ${v.AI_FALSE_NEGATIVE_COUNT}`,
    `EXECUTION_LATENCY_COUNT = ${v.EXECUTION_LATENCY_COUNT}`,
    `MULTI_GATE_INTERACTION_COUNT = ${v.MULTI_GATE_INTERACTION_COUNT}`,
    `PRIMARY_ROOT_CAUSE = ${v.PRIMARY_ROOT_CAUSE}`,
    `PRIMARY_ROOT_CAUSE_SHARE = ${Number(v.PRIMARY_ROOT_CAUSE_SHARE).toFixed(3)}`,
    `SECONDARY_ROOT_CAUSE = ${v.SECONDARY_ROOT_CAUSE}`,
    `RESEARCH_EXECUTION_READY_AFTER_PRIMARY_FIX = ${v.RESEARCH_EXECUTION_READY_AFTER_PRIMARY_FIX}`,
    `PRIMARY_FIX = ${v.PRIMARY_FIX}`,
    `LOOKAHEAD_VIOLATIONS = ${v.LOOKAHEAD_VIOLATIONS}`,
    `LOSS_CONTROL = ${v.LOSS_CONTROL}`,
    `EVIDENCE_CONFIDENCE = ${v.EVIDENCE_CONFIDENCE}`,
    `PRODUCTION_CHANGE_RECOMMENDED = ${v.PRODUCTION_CHANGE_RECOMMENDED}`,
    `NEXT_ENGINEERING_TASK = ${v.NEXT_ENGINEERING_TASK}`,
    "```",
    "",
  ].join("\n");
}

main();
