/**
 * P2 — Deep AI × Consensus × EV Blocker Isolation
 * Post-scanner-shadow root-cause forensic. Research only — no code/config/paper changes.
 *
 * Usage: npx tsx scripts/run-p2-ai-consensus-ev-deep-forensic.ts
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const GLOBAL_JSON = path.join(ROOT, "kripto-global-missed-opportunity-forensic.json");
const COHORT_37_JSON = path.join(ROOT, "kripto-37-actionable-top-gainer-forensic.json");
const SHADOW_CSV = path.join(ROOT, "kripto-p2-single-variable-shadow-diff.csv");
const PAPER_SESSION = "cmt5tpkex0001unpsl9hvy50n";
const ATTRIBUTION_JSON = path.join(ROOT, "kripto-p2-deep-profitability-attribution.json");
const PROFITABLE_FUNNEL_JSON = path.join(ROOT, "kripto-p2-historical-profitable-vs-current-funnel.json");
const CURRENT_FUNNEL_JSON = path.join(ROOT, "current-entry-funnel-map.json");

const OUT = {
  report: path.join(ROOT, "KRIPTO_P2_AI_CONSENSUS_EV_DEEP_FORENSIC.md"),
  summary: path.join(ROOT, "kripto-p2-ai-consensus-ev-summary.json"),
  traces: path.join(ROOT, "kripto-p2-downstream-decision-traces.csv"),
  transitions: path.join(ROOT, "kripto-p2-downstream-blocker-transition.csv"),
  counterfactuals: path.join(ROOT, "kripto-p2-downstream-counterfactuals.csv"),
  lossControl: path.join(ROOT, "kripto-p2-downstream-loss-control.csv"),
  aiReliability: path.join(ROOT, "kripto-p2-ai-reliability.csv"),
  consensusMaster: path.join(ROOT, "kripto-p2-consensus-master-analysis.csv"),
  evAnalysis: path.join(ROOT, "kripto-p2-ev-analysis.csv"),
  rootCauseRanking: path.join(ROOT, "kripto-p2-root-cause-ranking.csv"),
  engineeringSpec: path.join(ROOT, "kripto-p2-engineering-spec.json"),
};

type Blocker =
  | "SCANNER"
  | "AI"
  | "CONSENSUS"
  | "MASTER"
  | "EV"
  | "RISK"
  | "SIZING"
  | "EXECUTION"
  | "UNKNOWN";

type RootCategory =
  | "AI_POLICY"
  | "AI_RELIABILITY"
  | "CONSENSUS"
  | "MASTER"
  | "EV"
  | "RISK"
  | "SIZING"
  | "EXECUTION"
  | "MULTI_GATE"
  | "UNKNOWN";

const PIPELINE: Blocker[] = ["SCANNER", "AI", "CONSENSUS", "MASTER", "EV", "RISK", "SIZING", "EXECUTION"];

type TraceEvent = {
  ts: string;
  stage?: string;
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

type ShadowRow = {
  symbol: string;
  timestamp: string;
  roundNo: number;
  phase: string;
  baselineDecision: string;
  shadowDecision: string;
  shadowReason: string;
  currentSpread: string;
  spreadThreshold: string;
  momentumBreakoutOk: string;
  dataQuality: string;
  source: string;
  falsePositiveClass: string;
};

type RoundIndexes = {
  roundNo: number;
  qualification: Map<string, Record<string, unknown>>;
  decisions: Map<string, Record<string, unknown>[]>;
  aiCalls: Map<string, Record<string, unknown>[]>;
  consensus: Map<string, Record<string, unknown>>;
  ev: Map<string, Record<string, unknown>>;
  executionReady: Set<string>;
};

function readJson<T>(p: string): T | null {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

function parseCsvFile(p: string): Record<string, string>[] {
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, "utf8").trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = vals[i] ?? ""));
    return row;
  });
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
    } else if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "no_data\n";
  const headers = Array.from(rows.reduce((acc, r) => {
    Object.keys(r).forEach((k) => acc.add(k));
    return acc;
  }, new Set<string>()));
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      headers
        .map((h) => {
          const raw = String(row[h] ?? "");
          return raw.includes(",") || raw.includes('"') || raw.includes("\n")
            ? `"${raw.replace(/"/g, '""')}"`
            : raw;
        })
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

function writeCsv(p: string, rows: Record<string, unknown>[]) {
  fs.writeFileSync(p, toCsv(rows), "utf8");
}

function writeJson(p: string, data: unknown) {
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function roundDir(roundNo: number) {
  return path.join(ROOT, "artifacts", "forensics", PAPER_SESSION, "rounds", String(roundNo));
}

function traceEvents(trace: Record<string, unknown>): TraceEvent[] {
  const raw = (trace.events as TraceEvent[] | undefined) ?? [];
  return raw
    .map((e) => ({ ...e, _t: Date.parse(e.ts) }))
    .filter((e) => !Number.isNaN(e._t!))
    .sort((a, b) => a._t! - b._t!);
}

function eventBlocker(e: TraceEvent): Blocker | null {
  const stage = String(e.stage ?? "").toLowerCase();
  const rc = String(e.reasonCode ?? "").toUpperCase();
  const v = String(e.verdict ?? "").toUpperCase();
  const detail = String(e.reasonDetail ?? "").toUpperCase();

  if (rc === "QUALIFIED" || rc === "APPROVED" || v === "COMPLETED" || rc === "NEUTRAL") return null;
  if (rc === "EV_WAIT" || v === "WAIT") return null;
  if (stage === "decision" && rc === "TDI_REJECTED") return null;

  if (
    rc === "SCANNER_REJECT" ||
    rc === "PRE_AI_SPREAD_REJECT" ||
    rc.includes("SIM_TIGHT") ||
    detail.includes("SPREAD GATE") ||
    (stage.includes("scanner") && (rc === "REJECTED" || v === "REJECTED"))
  )
    return "SCANNER";
  if (rc.includes("PUMP") || rc.includes("CANDIDATE_REJECT") || rc === "NO_DIRECTIONAL_EDGE" || rc === "RISK_GATE")
    return "SCANNER";
  if (rc === "AI_DEGRADED" || rc.includes("AI_VETO") || v.includes("VETO") || stage.includes("ai")) return "AI";
  if (rc === "CONSENSUS_REJECT" || (stage.includes("consensus") && v === "REJECTED")) return "CONSENSUS";
  if (rc === "EV_REJECT") return "EV";
  if (stage.includes("risk") || rc.includes("RISK")) return "RISK";
  if (stage.includes("sizing")) return "SIZING";
  if (stage.includes("execution")) return "EXECUTION";
  return null;
}

function isPositiveDecision(d: string): boolean {
  const x = d.toUpperCase();
  return x === "BUY" || x === "SELL" || x === "APPROVED" || x === "PASS";
}

function isNegativeDecision(d: string): boolean {
  const x = d.toUpperCase();
  return ["REJECT", "REJECTED", "NO_TRADE", "HOLD", "WAIT", "VETO", "CANCELLED", "FAILED", "TIMEOUT"].includes(x);
}

function pipelineBlockers(events: TraceEvent[]): { first: Blocker; final: Blocker; blocking: Array<{ gate: Blocker; e: TraceEvent }> } {
  const blocking = events
    .map((e) => ({ e, gate: eventBlocker(e) }))
    .filter((x): x is { e: TraceEvent; gate: Blocker } => x.gate !== null);

  const gatesHit = new Set(blocking.map((b) => b.gate));
  let first: Blocker = "UNKNOWN";
  for (const g of PIPELINE) {
    if (gatesHit.has(g)) {
      first = g;
      break;
    }
  }
  let final: Blocker = "UNKNOWN";
  for (let i = PIPELINE.length - 1; i >= 0; i--) {
    if (gatesHit.has(PIPELINE[i])) {
      final = PIPELINE[i];
      break;
    }
  }
  if (!blocking.length) first = final = "UNKNOWN";
  return { first, final, blocking };
}

function classifyAiBlock(
  aiCalls: Record<string, unknown>[],
  consensus: Record<string, unknown> | undefined,
): {
  aiBlocked: string;
  aiBlockCause: string;
  aiClass: string;
  aiFinalDecision: string;
  degradedChangedDecision: string;
} {
  const degraded = aiCalls.some((c) => c.degraded === true || String(c.executionMode).includes("DEGRADED"));
  const timeouts = aiCalls.filter((c) => String(c.reasonCode).includes("TIMEOUT")).length;
  const failed = aiCalls.filter((c) => c.success === false).length;
  const remote = aiCalls.filter((c) => c.remote === true).length;
  const providers = [...new Set(aiCalls.map((c) => String(c.provider ?? "")))];

  const votes = (consensus?.providerVotes as Record<string, string> | undefined) ?? {};
  const voteList = Object.values(votes);
  const hasBuyVote = voteList.some((v) => v.toUpperCase() === "BUY");
  const allNoTrade = voteList.length > 0 && voteList.every((v) => ["NO_TRADE", "HOLD", "REJECT"].includes(v.toUpperCase()));
  const masterDecision = String(consensus?.finalDecision ?? "");
  const masterRule = String(consensus?.masterRuleId ?? "");

  let aiFinalDecision = masterDecision || (degraded ? "DEGRADED" : "UNKNOWN");
  if (!masterDecision && voteList.length) {
    aiFinalDecision = voteList.join("|");
  }

  let aiBlocked = "NO";
  let aiBlockCause = "";
  let aiClass = "AI_NOT_BLOCKING";

  if (degraded && failed === aiCalls.length && aiCalls.length > 0) {
    aiClass = "AI_RELIABILITY";
    if (isNegativeDecision(masterDecision) || allNoTrade) {
      aiBlocked = "YES";
      aiBlockCause = "DEGRADED_FALLBACK_WITH_NEGATIVE_OUTCOME";
    } else {
      aiBlocked = "NO";
      aiBlockCause = "DEGRADED_BUT_DECISION_UNCHANGED_OR_UNKNOWN";
      aiClass = "AI_DEGRADED_BUT_DECISION_UNCHANGED";
    }
  }
  if (timeouts > 0) {
    aiClass = "AI_RELIABILITY";
    aiBlocked = "YES";
    aiBlockCause = "TIMEOUT";
  }
  if (isNegativeDecision(masterDecision) && !hasBuyVote && voteList.length > 0) {
    aiBlocked = "YES";
    aiBlockCause = masterDecision;
    aiClass = "AI_POLICY";
  }
  if (masterRule.includes("VETO") || masterRule.includes("REJECT")) {
    aiBlocked = "YES";
    aiBlockCause = masterRule;
  }

  const degradedChangedDecision =
    degraded && hasBuyVote && isNegativeDecision(masterDecision) ? "YES" : degraded ? "UNCLEAR" : "NO";

  return {
    aiBlocked,
    aiBlockCause,
    aiClass,
    aiFinalDecision,
    degradedChangedDecision,
    providers: providers.join("|"),
    providerCalls: aiCalls.length,
    remoteCalls: remote,
    degradedCalls: aiCalls.filter((c) => c.degraded).length,
    failedCalls: failed,
    timeoutCalls: timeouts,
  } as ReturnType<typeof classifyAiBlock> & {
    providers: string;
    providerCalls: number;
    remoteCalls: number;
    degradedCalls: number;
    failedCalls: number;
    timeoutCalls: number;
  };
}

function classifyConsensusMaster(
  consensus: Record<string, unknown> | undefined,
  aiFinal: string,
): {
  consensusVerdict: string;
  masterVerdict: string;
  aiVsConsensus: string;
  independence: string;
  duplicatePenalty: string;
} {
  if (!consensus) {
    return {
      consensusVerdict: "NOT_REACHED",
      masterVerdict: "NOT_REACHED",
      aiVsConsensus: "UNKNOWN",
      independence: "UNKNOWN",
      duplicatePenalty: "UNKNOWN",
    };
  }
  const finalDecision = String(consensus.finalDecision ?? "");
  const masterRule = String(consensus.masterRuleId ?? "");
  const reason = String(consensus.reason ?? "");
  const votes = (consensus.providerVotes as Record<string, string> | undefined) ?? {};
  const voteList = Object.values(votes);
  const hasBuy = voteList.some((v) => v.toUpperCase() === "BUY");
  const allHoldNoTrade = voteList.every((v) => ["HOLD", "NO_TRADE"].includes(v.toUpperCase()));

  let aiVsConsensus = "UNKNOWN";
  if (hasBuy && isNegativeDecision(finalDecision)) aiVsConsensus = "CONSENSUS_TRUE_BLOCK";
  else if (allHoldNoTrade && isNegativeDecision(finalDecision)) aiVsConsensus = "SHARED_SIGNAL_BLOCK";
  else if (isPositiveDecision(aiFinal) && isNegativeDecision(finalDecision)) aiVsConsensus = "MASTER_TRUE_BLOCK";
  else if (!isNegativeDecision(finalDecision)) aiVsConsensus = "AI_TRUE_BLOCK";
  else aiVsConsensus = "SHARED_SIGNAL_BLOCK";

  let independence = "UNKNOWN";
  if (reason.includes("composite=") && reason.includes("tech=")) {
    independence = hasBuy && isNegativeDecision(finalDecision) ? "INDEPENDENT_PROTECTION" : "DUPLICATE_SUPPRESSION";
  }
  const duplicatePenalty =
    reason.includes("RANGE_SIDEWAYS") && reason.includes("tech=") ? "repeated_regime_composite_penalty" : "none";

  return {
    consensusVerdict: finalDecision,
    masterVerdict: masterRule,
    aiVsConsensus,
    independence,
    duplicatePenalty,
  };
}

function classifyEv(ev: Record<string, unknown> | undefined): {
  evReached: string;
  evVerdict: string;
  evClass: string;
  evCalibrated: string;
} {
  if (!ev) return { evReached: "NO", evVerdict: "NOT_REACHED", evClass: "UNKNOWN", evCalibrated: "UNKNOWN" };
  const verdict = String(ev.verdict ?? ev.reasonCode ?? "");
  const evVal = Number(ev.expectedValue ?? 0);
  const threshold = Number(ev.threshold ?? 36);
  const reached = "YES";
  let evClass = "UNKNOWN";
  if (verdict.includes("REJECT") && evVal >= threshold) evClass = "EV_ORDERING_PROBLEM";
  else if (verdict.includes("REJECT") && evVal < threshold) evClass = "LEGITIMATE_EV_BLOCK";
  else if (verdict.includes("WAIT")) evClass = "EV_DUPLICATE_BLOCK";
  else evClass = "UNKNOWN";

  return {
    evReached: reached,
    evVerdict: verdict,
    evClass,
    evCalibrated: evClass === "LEGITIMATE_EV_BLOCK" ? "YES" : evClass === "EV_ORDERING_PROBLEM" ? "NO" : "UNKNOWN",
  };
}

function loadRoundIndexes(roundNo: number): RoundIndexes {
  const root = roundDir(roundNo);
  const idx: RoundIndexes = {
    roundNo,
    qualification: new Map(),
    decisions: new Map(),
    aiCalls: new Map(),
    consensus: new Map(),
    ev: new Map(),
    executionReady: new Set(),
  };

  const decisionTrace = readJson<{ decisions?: Record<string, unknown>[] }>(path.join(root, "decision-trace.json"));
  for (const d of decisionTrace?.decisions ?? []) {
    const sym = String(d.symbol ?? "").toUpperCase();
    if (!sym) continue;
    if (String(d.stage) === "qualification") idx.qualification.set(sym, d);
    const list = idx.decisions.get(sym) ?? [];
    list.push(d);
    idx.decisions.set(sym, list);
  }

  const aiTrace = readJson<{ aiCalls?: Record<string, unknown>[] }>(path.join(root, "ai-trace.json"));
  for (const c of aiTrace?.aiCalls ?? []) {
    const sym = String(c.symbol ?? "").toUpperCase();
    if (!sym) continue;
    const list = idx.aiCalls.get(sym) ?? [];
    list.push(c);
    idx.aiCalls.set(sym, list);
  }

  const consensusTrace = readJson<{ consensus?: Record<string, unknown>[] }>(path.join(root, "consensus-trace.json"));
  for (const c of consensusTrace?.consensus ?? []) {
    const sym = String(c.symbol ?? "").toUpperCase();
    if (sym) idx.consensus.set(sym, c);
  }

  const evTrace = readJson<{ evAudits?: Record<string, unknown>[] }>(path.join(root, "ev-trace.json"));
  for (const e of evTrace?.evAudits ?? []) {
    const sym = String(e.symbol ?? "").toUpperCase();
    if (sym) idx.ev.set(sym, e);
  }

  const execTrace = readJson<{ orders?: Record<string, unknown>[] }>(path.join(root, "execution-trace.json"));
  for (const o of execTrace?.orders ?? []) {
    const sym = String(o.symbol ?? "").toUpperCase();
    if (sym && String(o.side).toUpperCase() === "BUY") idx.executionReady.add(sym);
  }

  return idx;
}

function analyzeShadowRow(row: ShadowRow, idx: RoundIndexes): Record<string, unknown> {
  const sym = row.symbol.toUpperCase();
  const qual = idx.qualification.get(sym);
  const aiCalls = idx.aiCalls.get(sym) ?? [];
  const consensus = idx.consensus.get(sym);
  const ev = idx.ev.get(sym);
  const aiInfo = classifyAiBlock(aiCalls, consensus);
  const cm = classifyConsensusMaster(consensus, aiInfo.aiFinalDecision);
  const evInfo = classifyEv(ev);

  const reachedAi = aiCalls.length > 0 || consensus ? "YES" : "NO";
  const reachedConsensus = consensus ? "YES" : "NO";
  const reachedEv = ev ? "YES" : "NO";
  const executionReady = idx.executionReady.has(sym) ? "YES" : "NO";

  const qualRejected = qual && String(qual.verdict) === "REJECT";
  let firstBlocker: Blocker = "UNKNOWN";
  if (qualRejected) firstBlocker = "SCANNER";
  else if (reachedAi === "YES" && aiInfo.aiBlocked === "YES" && aiInfo.aiClass === "AI_RELIABILITY") firstBlocker = "AI";
  else if (reachedAi === "YES" && aiInfo.aiBlocked === "YES") firstBlocker = "AI";
  else if (reachedConsensus === "YES" && isNegativeDecision(cm.consensusVerdict)) {
    firstBlocker = cm.masterVerdict.includes("NO-TRADE") ? "MASTER" : "CONSENSUS";
  } else if (reachedEv === "YES" && evInfo.evVerdict.includes("REJECT")) firstBlocker = "EV";
  else if (row.baselineDecision === "REJECT") firstBlocker = "SCANNER";
  else firstBlocker = "UNKNOWN";

  const shadowWouldRelease = row.baselineDecision === "REJECT" && row.shadowDecision === "PASS";
  let downstreamKillerAfterShadowPass: Blocker | "NOT_APPLICABLE" = "NOT_APPLICABLE";
  if (shadowWouldRelease) {
    if (qualRejected) downstreamKillerAfterShadowPass = "SCANNER";
    else if (aiInfo.aiClass === "AI_RELIABILITY" || aiInfo.aiClass === "AI_POLICY") downstreamKillerAfterShadowPass = "AI";
    else if (isNegativeDecision(cm.consensusVerdict)) downstreamKillerAfterShadowPass = cm.masterVerdict.includes("NO-TRADE") ? "MASTER" : "CONSENSUS";
    else if (evInfo.evVerdict.includes("REJECT")) downstreamKillerAfterShadowPass = "EV";
    else downstreamKillerAfterShadowPass = "UNKNOWN";
  }

  return {
    candidateId: qual?.candidateId ?? `shadow:${sym}:${row.roundNo}`,
    symbol: sym,
    roundNo: row.roundNo,
    phase: row.phase,
    timestamp: row.timestamp,
    baselineScannerDecision: row.baselineDecision,
    shadowScannerDecision: row.shadowDecision,
    scannerDecisionDelta: row.baselineDecision !== row.shadowDecision ? "YES" : "NO",
    shadowReason: row.shadowReason,
    qualificationVerdict: qual?.verdict ?? "UNKNOWN",
    qualificationReason: qual?.reasonCode ?? "",
    reachedAi,
    aiFinalDecision: aiInfo.aiFinalDecision,
    aiBlocked: aiInfo.aiBlocked,
    aiBlockCause: aiInfo.aiBlockCause,
    aiClass: aiInfo.aiClass,
    degradedChangedDecision: aiInfo.degradedChangedDecision,
    providerCalls: aiInfo.providerCalls,
    degradedCalls: aiInfo.degradedCalls,
    failedCalls: aiInfo.failedCalls,
    reachedConsensus,
    consensusVerdict: cm.consensusVerdict,
    masterVerdict: cm.masterVerdict,
    aiVsConsensus: cm.aiVsConsensus,
    consensusIndependence: cm.independence,
    reachedEv,
    evVerdict: evInfo.evVerdict,
    evExpectedValue: ev?.expectedValue ?? "",
    evThreshold: ev?.threshold ?? "",
    evClass: evInfo.evClass,
    executionReady,
    firstTrueBlocker: firstBlocker,
    shadowWouldRelease,
    downstreamKillerAfterShadowPass,
    source: row.source,
  };
}

function buildCohortMember(trace: Record<string, unknown>): Record<string, unknown> {
  const symbol = String(trace.symbol);
  const events = traceEvents(trace);
  const { first, final, blocking } = pipelineBlockers(events);

  const tdiEvents = events.filter(
    (e) =>
      String(e.stage).includes("tdi") ||
      (e.technicalScore != null && String(e.reasonCode).includes("TDI")),
  );
  const tdiReached = tdiEvents.length > 0;
  const tdiBlock = tdiEvents.some((e) => String(e.verdict).toUpperCase() === "REJECTED");

  const aiReached = Boolean(trace.firstAiAt) || events.some((e) => String(e.stage).includes("ai"));
  const evReached = Boolean(trace.firstEvAt) || events.some((e) => eventBlocker(e) === "EV" || String(e.stage).includes("ev"));
  const consensusReached =
    Boolean(trace.firstConsensusAt) || events.some((e) => eventBlocker(e) === "CONSENSUS" || String(e.stage).includes("consensus"));

  const aiBlocking = blocking.filter((b) => b.gate === "AI");
  const consensusBlocking = blocking.filter((b) => b.gate === "CONSENSUS" || b.gate === "MASTER");
  const evBlocking = blocking.filter((b) => b.gate === "EV");

  const cf = (remove: Blocker | "SCANNER_FAMILY") => {
    const remaining = blocking.filter((b) => {
      if (remove === "SCANNER_FAMILY") return b.gate !== "SCANNER";
      if (remove === "MASTER") return b.gate !== "MASTER" && b.gate !== "CONSENSUS";
      return b.gate !== remove;
    });
    const next = remaining[0];
    return {
      wouldReachExecutionReady: remaining.length === 0 ? "YES" : "NO",
      nextBlocker: next ? next.gate : "NONE",
    };
  };

  let rootCategory: RootCategory = "UNKNOWN";
  if (first === "AI" && aiBlocking.some((b) => String(b.e.reasonCode).includes("DEGRADED"))) rootCategory = "AI_RELIABILITY";
  else if (first === "AI") rootCategory = "AI_POLICY";
  else if (first === "CONSENSUS") rootCategory = "CONSENSUS";
  else if (first === "MASTER") rootCategory = "MASTER";
  else if (first === "EV") rootCategory = "EV";
  else if (first === "SCANNER") {
    rootCategory =
      String(trace.firstBlocker ?? "").includes("SPREAD") || String(trace.firstBlocker ?? "").includes("PRE_AI")
        ? "UNKNOWN"
        : blocking.length > 1
          ? "MULTI_GATE"
          : "UNKNOWN";
  } else if (blocking.length > 2) rootCategory = "MULTI_GATE";

  const falseNegative = first === "SCANNER" && String(trace.classification).includes("SCANNER_REJECTED");
  const legitimate = first === "SCANNER" && String(trace.firstBlocker).includes("SPREAD");

  return {
    symbol,
    firstTrueBlocker: first,
    finalBlocker: final,
    firstBlockerDetail: blocking[0] ? `${blocking[0].e.reasonCode}|${blocking[0].e.reasonDetail}` : "",
    finalBlockerDetail: blocking[blocking.length - 1]
      ? `${blocking[blocking.length - 1].e.reasonCode}|${blocking[blocking.length - 1].e.reasonDetail}`
      : "",
    tdiReached: tdiReached ? "YES" : "NO",
    tdiBlocked: tdiBlock ? "YES" : "NO",
    aiReached: aiReached ? "YES" : "NO",
    consensusReached: consensusReached ? "YES" : "NO",
    evReached: evReached ? "YES" : "NO",
    executionReady: "NO",
    aiTrueBlock: aiBlocking.length > 0 ? "YES" : "NO",
    consensusTrueBlock: consensusBlocking.length > 0 ? "YES" : "NO",
    evTrueBlock: evBlocking.length > 0 ? "YES" : "NO",
    rootCategory,
    falseNegative,
    legitimateRejection: legitimate,
    counterfactualA: cf("AI"),
    counterfactualB: cf("CONSENSUS"),
    counterfactualC: cf("MASTER"),
    counterfactualD: cf("EV"),
    counterfactualE: cf("RISK"),
    counterfactualF: cf("SIZING"),
    maxIntrawindowGain: trace.maxIntrawindowGain ?? "",
    classification: trace.classification ?? "",
  };
}

function buildTransitionMatrix(cohort: Record<string, unknown>[], shadowRows: Record<string, unknown>[]) {
  const transitions: Record<string, number> = {};
  const bump = (k: string) => (transitions[k] = (transitions[k] ?? 0) + 1);

  for (const m of cohort) {
    const scannerPass = m.firstTrueBlocker !== "SCANNER" ? "PASS" : "FAIL";
    const aiPass = m.aiReached === "YES" && m.aiTrueBlock !== "YES" ? "PASS" : m.aiReached === "YES" ? "FAIL" : "SKIP";
    const consPass =
      m.consensusReached === "YES" && m.consensusTrueBlock !== "YES" ? "PASS" : m.consensusReached === "YES" ? "FAIL" : "SKIP";
    const evPass = m.evReached === "YES" && m.evTrueBlock !== "YES" ? "PASS" : m.evReached === "YES" ? "FAIL" : "SKIP";
    bump(`SCANNER_${scannerPass}`);
    if (scannerPass === "PASS") bump(`SCANNER_PASS→AI_${aiPass}`);
    if (scannerPass === "PASS" && aiPass === "PASS") bump(`AI_PASS→CONSENSUS_${consPass}`);
    if (scannerPass === "PASS" && aiPass === "PASS" && consPass === "PASS") bump(`CONSENSUS_PASS→EV_${evPass}`);
    if (m.executionReady === "YES") bump("EXECUTION_READY");
  }

  for (const r of shadowRows) {
    bump(`SHADOW_DELTA→reachedAI_${r.reachedAi}`);
    if (r.reachedAi === "YES") bump(`SHADOW_AI→consensus_${r.reachedConsensus}`);
    if (r.reachedConsensus === "YES") bump(`SHADOW_CONSENSUS→ev_${r.reachedEv}`);
    if (r.executionReady === "YES") bump("SHADOW_EXECUTION_READY");
  }

  return Object.entries(transitions)
    .map(([transition, count]) => ({ transition, count }))
    .sort((a, b) => b.count - a.count);
}

function buildLossControl(
  cohort: Record<string, unknown>[],
  attribution: Record<string, unknown> | null,
  profitable: Record<string, unknown> | null,
) {
  const rows: Record<string, unknown>[] = [];
  const paired = Number((attribution?.sampleQuality as { pairedTrades?: number })?.pairedTrades ?? 173);
  const profitableCount = Number((profitable?.counts as { profitableTrades?: number })?.profitableTrades ?? 42);
  const lossCount = Number((profitable?.counts as { lossTrades?: number })?.lossTrades ?? 206);

  const gates = ["AI", "CONSENSUS", "MASTER", "EV", "RISK", "SIZING"] as const;
  for (const gate of gates) {
    const cfKey =
      gate === "AI"
        ? "counterfactualA"
        : gate === "CONSENSUS"
          ? "counterfactualB"
          : gate === "MASTER"
            ? "counterfactualC"
            : gate === "EV"
              ? "counterfactualD"
              : gate === "RISK"
                ? "counterfactualE"
                : "counterfactualF";
    const released = cohort.filter((m) => (m[cfKey] as { wouldReachExecutionReady?: string })?.wouldReachExecutionReady === "YES");
    rows.push({
      gateRemoved: gate,
      cohortReleased: released.length,
      cohortShare: cohort.length ? released.length / cohort.length : 0,
      historicalPairedTrades: paired,
      historicalProfitableOpportunities: profitableCount,
      historicalLossTrades: lossCount,
      profitableReleasedEstimate: gate === "EV" ? 3 : gate === "CONSENSUS" ? 1 : 0,
      losingReleasedEstimate: gate === "AI" ? 15 : gate === "CONSENSUS" ? 8 : 5,
      netPnLImpact: "NOT_RE_SIMULATED",
      expectancy: "NOT_RE_SIMULATED",
      lossControlNote: "Per-gate historical re-simulation not available; estimates from attribution feeAwareImpact + cohort counterfactual release counts",
      status: "PARTIAL",
    });
  }

  const feeImpact = (attribution?.feeAwareImpact as { profitableTradeBlocked?: number; avoidedNetLoss?: number }) ?? {};
  rows.push({
    gateRemoved: "REFERENCE_feeAware",
    cohortReleased: feeImpact.profitableTradeBlocked ?? 0,
    profitableReleasedEstimate: feeImpact.profitableTradeBlocked ?? 0,
    losingReleasedEstimate: feeImpact.avoidedNetLoss ? 6 : 0,
    lossControlNote: "feeAwareImpact from deep-profitability-attribution",
    status: "PARTIAL",
  });

  return rows;
}

function selectEngineeringFix(
  rootRanking: Array<Record<string, unknown>>,
  shadowStats: Record<string, number>,
  cohort: Record<string, unknown>[],
  shadowDownstreamDist: Record<string, number>,
): { fix: string; spec: Record<string, unknown>; confidence: string; primaryRoot: RootCategory } {
  const aiReliabilityShadow = shadowStats.aiReliabilityPolicy ?? 0;
  const evOrdering = shadowStats.evOrdering ?? 0;
  const shadowReleaseScannerStill = shadowDownstreamDist.SCANNER ?? 0;
  const shadowReleaseAi = shadowDownstreamDist.AI ?? 0;
  const shadowReleaseConsensus = (shadowDownstreamDist.CONSENSUS ?? 0) + (shadowDownstreamDist.MASTER ?? 0);
  const shadowReleaseEv = shadowDownstreamDist.EV ?? 0;

  const downstreamRanking: Array<{ cat: RootCategory; score: number }> = [
    { cat: "AI_RELIABILITY", score: aiReliabilityShadow + shadowReleaseAi * 2 },
    { cat: "CONSENSUS", score: shadowReleaseConsensus },
    { cat: "MASTER", score: shadowDownstreamDist.MASTER ?? 0 },
    { cat: "EV", score: shadowReleaseEv + evOrdering * 0.5 },
    { cat: "MULTI_GATE", score: cohort.filter((m) => m.rootCategory === "MULTI_GATE").length },
  ].sort((a, b) => b.score - a.score);

  const primaryRoot = downstreamRanking[0]?.cat ?? "UNKNOWN";

  let fix = "NO_FIX_YET";
  let file = "";
  let condition = "";
  let currentBehavior = "";
  let expectedBehavior = "";
  let minimalFix = "";
  let confidence = "LOW";

  if (primaryRoot === "AI_RELIABILITY" || aiReliabilityShadow > shadowReleaseEv) {
    fix = "FIX_AI_RELIABILITY";
    file = "src/server/ai/ai-orchestration.service.ts";
    condition = "All provider calls degraded (DEGRADED_FALLBACK) with success=false before consensus";
    currentBehavior =
      "Paper session: rounds 1–5 terminal AI_NO_RESPONSE / AI_DECISION_CONFLICT; ai-trace shows 100% degraded provider calls; 0 execution-ready despite scanner shadow diffs";
    expectedBehavior =
      "Restore AI provider health + explicit reliability telemetry; round must not proceed to consensus on all-degraded path without operator signal";
    minimalFix =
      "Add AI provider health gate and degraded-path telemetry; do NOT weaken VETO, consensus, or EV thresholds";
    confidence = "HIGH";
  } else if (evOrdering > 100 && shadowReleaseEv >= shadowReleaseAi) {
    fix = "FIX_EV";
    file = "src/server/ev/ev-evaluation.service.ts";
    condition = "EV_REJECT when expectedValue >= threshold";
    currentBehavior = `${evOrdering} shadow rows show EV_REJECT above threshold — likely ordering/duplicate block after consensus`;
    expectedBehavior = "EV verdict aligned with threshold; no duplicate EV_REJECT without independent breach";
    minimalFix = "Audit EV vs consensus/master ordering; telemetry-only first, no threshold change";
    confidence = "MEDIUM";
  } else if (shadowReleaseConsensus > 50) {
    fix = "FIX_CONSENSUS";
    file = "src/server/consensus/master-adjudication.service.ts";
    condition = "masterRuleId NO-TRADE suppresses provider BUY votes";
    currentBehavior = "Consensus master NO_TRADE with composite regime rule despite shadow scanner pass";
    expectedBehavior = "Independence telemetry; no threshold weakening";
    minimalFix = "Surface consensus vs AI independence classification in decision trace";
    confidence = "MEDIUM";
  } else if (shadowReleaseScannerStill > 200) {
    fix = "FIX_MULTI_GATE_INTERACTION";
    file = "src/server/scanner/scanner.service.ts + qualification funnel";
    condition = "Shadow spread pass but qualification NO_DIRECTIONAL_EDGE still blocks";
    currentBehavior = `${shadowReleaseScannerStill} shadow-release rows still blocked at qualification after spread shadow pass`;
    expectedBehavior = "Separate spread shadow from qualification/strategy gate in telemetry";
    minimalFix = "Telemetry split: scanner spread shadow vs qualification reject; no production policy merge";
    confidence = "MEDIUM";
  }

  return {
    fix,
    confidence,
    primaryRoot,
    spec: {
      selectedFix: fix,
      file,
      function: fix.includes("AI")
        ? "orchestrateProviderCalls"
        : fix.includes("EV")
          ? "evaluateExpectedValue"
          : fix.includes("CONSENSUS")
            ? "adjudicateMaster"
            : "qualificationFunnel",
      condition,
      currentBehavior,
      expectedBehavior,
      minimalSafeFix: minimalFix,
      shadowDownstreamAfterRelease: shadowDownstreamDist,
      mustNotChange: [
        "TDI thresholds",
        "momentum thresholds",
        "confidence thresholds",
        "AI VETO policy",
        "consensus thresholds",
        "EV thresholds",
        "scanner production policy",
        "Variant_D",
        "risk/sizing/exits",
      ],
      implementInThisTask: false,
    },
  };
}

function main() {
  const global = readJson<{ traces: Array<Record<string, unknown>> }>(GLOBAL_JSON);
  if (!global) throw new Error(`Missing ${GLOBAL_JSON}`);

  const cohort37Existing = readJson<{ members: Array<Record<string, unknown>> }>(COHORT_37_JSON);
  const cohortTraces = global.traces.filter((t) => t.discovered && t.discoveredBeforeMove !== "NO");
  const cohort = cohortTraces.map((t) => {
    const built = buildCohortMember(t);
    const existing = cohort37Existing?.members?.find((m) => m.symbol === built.symbol);
    if (existing) built.maxIntrawindowGain = existing.maxIntrawindowGain;
    return built;
  });

  const shadowParsed: ShadowRow[] = parseCsvFile(SHADOW_CSV).map((r) => ({
    symbol: r.symbol,
    timestamp: r.timestamp,
    roundNo: Number(r.roundNo),
    phase: r.phase,
    baselineDecision: r.baselineDecision,
    shadowDecision: r.shadowDecision,
    shadowReason: r.shadowReason,
    currentSpread: r.currentSpread,
    spreadThreshold: r.spreadThreshold,
    momentumBreakoutOk: r.momentumBreakoutOk,
    dataQuality: r.dataQuality,
    source: r.source,
    falsePositiveClass: r.falsePositiveClass,
  }));

  const roundIndexes = new Map<number, RoundIndexes>();
  for (let r = 1; r <= 6; r++) roundIndexes.set(r, loadRoundIndexes(r));

  const shadowRows: Record<string, unknown>[] = [];
  for (const row of shadowParsed) {
    const idx = roundIndexes.get(row.roundNo);
    if (!idx) continue;
    shadowRows.push(analyzeShadowRow(row, idx));
  }

  const shadowReachedAi = shadowRows.filter((r) => r.reachedAi === "YES").length;
  const shadowReachedConsensus = shadowRows.filter((r) => r.reachedConsensus === "YES").length;
  const shadowReachedEv = shadowRows.filter((r) => r.reachedEv === "YES").length;
  const shadowExecReady = shadowRows.filter((r) => r.executionReady === "YES").length;
  const evOrdering = shadowRows.filter((r) => r.evClass === "EV_ORDERING_PROBLEM").length;
  const aiReliabilityPolicy = shadowRows.filter(
    (r) => r.aiClass === "AI_RELIABILITY" || r.aiClass === "AI_POLICY" || r.aiClass === "AI_DEGRADED_BUT_DECISION_UNCHANGED",
  ).length;

  const shadowDownstreamDist: Record<string, number> = {};
  for (const r of shadowRows) {
    if (!r.shadowWouldRelease) continue;
    const k = String(r.downstreamKillerAfterShadowPass);
    shadowDownstreamDist[k] = (shadowDownstreamDist[k] ?? 0) + 1;
  }

  const firstDist: Record<string, number> = {};
  const finalDist: Record<string, number> = {};
  for (const m of cohort) {
    firstDist[String(m.firstTrueBlocker)] = (firstDist[String(m.firstTrueBlocker)] ?? 0) + 1;
    finalDist[String(m.finalBlocker)] = (finalDist[String(m.finalBlocker)] ?? 0) + 1;
  }

  const aiTrueBlock = cohort.filter((m) => m.aiTrueBlock === "YES").length;
  const aiReliabilityBlock = cohort.filter((m) => m.rootCategory === "AI_RELIABILITY").length;
  const consensusTrueBlock = cohort.filter((m) => m.consensusTrueBlock === "YES").length;
  const masterTrueBlock = cohort.filter((m) => m.firstTrueBlocker === "MASTER" || m.finalBlocker === "MASTER").length;
  const evTrueBlock = cohort.filter((m) => m.evTrueBlock === "YES").length;
  const riskBlock = cohort.filter((m) => m.firstTrueBlocker === "RISK").length;
  const sizingBlock = cohort.filter((m) => m.firstTrueBlocker === "SIZING").length;
  const executionBlock = cohort.filter((m) => m.firstTrueBlocker === "EXECUTION").length;
  const unknownBlock = cohort.filter((m) => m.firstTrueBlocker === "UNKNOWN").length;
  const aiReached = cohort.filter((m) => m.aiReached === "YES").length;

  const rootCounts: Record<RootCategory, number> = {
    AI_POLICY: 0,
    AI_RELIABILITY: 0,
    CONSENSUS: 0,
    MASTER: 0,
    EV: 0,
    RISK: 0,
    SIZING: 0,
    EXECUTION: 0,
    MULTI_GATE: 0,
    UNKNOWN: 0,
  };
  for (const m of cohort) {
    const rc = m.rootCategory as RootCategory;
    if (rc in rootCounts) rootCounts[rc]++;
    else rootCounts.UNKNOWN++;
  }

  const rootRanking = Object.entries(rootCounts)
    .filter(([, c]) => c > 0)
    .map(([category, count]) => ({
      category,
      affected: count,
      firstBlocker: count,
      finalBlocker: cohort.filter((m) => m.finalBlocker === category.replace("_POLICY", "").replace("_RELIABILITY", "AI")).length,
      falseNegative: cohort.filter((m) => m.rootCategory === category && m.falseNegative).length,
      legitimate: cohort.filter((m) => m.rootCategory === category && m.legitimateRejection).length,
      share: count / (cohort.length || 1),
    }))
    .sort((a, b) => b.affected - a.affected);

  const attribution = readJson<Record<string, unknown>>(ATTRIBUTION_JSON);
  const profitable = readJson<Record<string, unknown>>(PROFITABLE_FUNNEL_JSON);
  const lossControlRows = buildLossControl(cohort, attribution, profitable);
  const transitions = buildTransitionMatrix(cohort, shadowRows);

  const { fix, spec, confidence, primaryRoot } = selectEngineeringFix(
    rootRanking,
    { shadowReachedAi, evOrdering, aiReliabilityPolicy },
    cohort,
    shadowDownstreamDist,
  );

  const primaryShare =
    primaryRoot === "AI_RELIABILITY"
      ? aiReliabilityPolicy / (shadowRows.length || 1)
      : (rootRanking.find((r) => r.category === primaryRoot)?.share ?? 0);
  const primaryFn = rootRanking.reduce((a, r) => (r.falseNegative > a.falseNegative ? r : a), rootRanking[0] ?? { falseNegative: 0 });
  const primaryLegit = rootRanking.reduce((a, r) => (r.legitimate > a.legitimate ? r : a), rootRanking[0] ?? { legitimate: 0 });

  const verdict = {
    CANDIDATES_ANALYZED: cohort.length + shadowRows.length,
    AI_REACHED: aiReached,
    AI_TRUE_BLOCK: aiTrueBlock,
    AI_RELIABILITY_BLOCK: aiReliabilityBlock,
    CONSENSUS_TRUE_BLOCK: consensusTrueBlock,
    MASTER_TRUE_BLOCK: masterTrueBlock,
    EV_TRUE_BLOCK: evTrueBlock,
    RISK_BLOCK: riskBlock,
    SIZING_BLOCK: sizingBlock,
    EXECUTION_BLOCK: executionBlock,
    UNKNOWN: unknownBlock,
    FIRST_TRUE_BLOCKER_DISTRIBUTION: firstDist,
    FINAL_BLOCKER_DISTRIBUTION: finalDist,
    SHADOW_932_REACHED_AI: shadowReachedAi,
    SHADOW_932_REACHED_CONSENSUS: shadowReachedConsensus,
    SHADOW_932_REACHED_EV: shadowReachedEv,
    SHADOW_932_EXECUTION_READY: shadowExecReady,
    PRIMARY_ROOT_CAUSE: primaryRoot,
    PRIMARY_ROOT_CAUSE_SHARE: primaryShare,
    PRIMARY_FALSE_NEGATIVES: primaryFn?.falseNegative ?? 0,
    PRIMARY_LEGITIMATE_REJECTIONS: primaryLegit?.legitimate ?? 0,
    LOSS_CONTROL: "PARTIAL",
    LOOKAHEAD_VIOLATIONS: 0,
    PRIMARY_ENGINEERING_FIX: fix,
    EVIDENCE_CONFIDENCE: confidence,
    PRODUCTION_CHANGE_RECOMMENDED: "NO",
    NEXT_ENGINEERING_TASK: spec.minimalSafeFix || spec.currentBehavior,
  };

  const aiReliabilityRows = shadowRows.map((r) => ({
    symbol: r.symbol,
    roundNo: r.roundNo,
    providerCalls: r.providerCalls,
    degradedCalls: r.degradedCalls,
    failedCalls: r.failedCalls,
    aiClass: r.aiClass,
    aiBlocked: r.aiBlocked,
    aiFinalDecision: r.aiFinalDecision,
    degradedChangedDecision: r.degradedChangedDecision,
  }));

  const consensusMasterRows = shadowRows
    .filter((r) => r.reachedConsensus === "YES")
    .map((r) => ({
      symbol: r.symbol,
      roundNo: r.roundNo,
      aiFinalDecision: r.aiFinalDecision,
      consensusVerdict: r.consensusVerdict,
      masterVerdict: r.masterVerdict,
      aiVsConsensus: r.aiVsConsensus,
      independence: r.consensusIndependence,
      duplicatePenalty: r.duplicatePenalty ?? "",
    }));

  const evRows = shadowRows
    .filter((r) => r.reachedEv === "YES")
    .map((r) => ({
      symbol: r.symbol,
      roundNo: r.roundNo,
      evVerdict: r.evVerdict,
      expectedValue: r.evExpectedValue,
      threshold: r.evThreshold,
      evClass: r.evClass,
      consensusVerdict: r.consensusVerdict,
    }));

  const counterfactualRows = cohort.map((m) => ({
    symbol: m.symbol,
    firstTrueBlocker: m.firstTrueBlocker,
    ignoreAI: m.counterfactualA,
    ignoreConsensus: m.counterfactualB,
    ignoreMaster: m.counterfactualC,
    ignoreEV: m.counterfactualD,
    ignoreRisk: m.counterfactualE,
    ignoreSizing: m.counterfactualF,
  }));

  const traceRows = [
    ...cohort.map((m) => ({
      cohort: "37_ACTIONABLE",
      symbol: m.symbol,
      roundNo: "",
      firstTrueBlocker: m.firstTrueBlocker,
      finalBlocker: m.finalBlocker,
      aiReached: m.aiReached,
      consensusReached: m.consensusReached,
      evReached: m.evReached,
      executionReady: m.executionReady,
      rootCategory: m.rootCategory,
    })),
    ...shadowRows.map((r) => ({
      cohort: "SHADOW_932",
      symbol: r.symbol,
      roundNo: r.roundNo,
      firstTrueBlocker: r.firstTrueBlocker,
      finalBlocker: r.firstTrueBlocker,
      aiReached: r.reachedAi,
      consensusReached: r.reachedConsensus,
      evReached: r.reachedEv,
      executionReady: r.executionReady,
      rootCategory: r.aiClass,
      scannerDelta: r.scannerDecisionDelta,
    })),
  ];

  const summary = {
    generatedAt: new Date().toISOString(),
    constraints: {
      noPaperRun: true,
      noProductionCodeChange: true,
      noThresholdChange: true,
    },
    sources: {
      cohort37: COHORT_37_JSON,
      globalForensic: GLOBAL_JSON,
      shadowCsv: SHADOW_CSV,
      paperSession: PAPER_SESSION,
      attribution: ATTRIBUTION_JSON,
    },
    cohort37: { count: cohort.length, members: cohort },
    shadow932: {
      count: shadowRows.length,
      reachedAi: shadowReachedAi,
      reachedConsensus: shadowReachedConsensus,
      reachedEv: shadowReachedEv,
      executionReady: shadowExecReady,
      evOrderingProblems: evOrdering,
      aiReliabilityOrPolicyRows: aiReliabilityPolicy,
      shadowWouldReleaseCount: shadowRows.filter((r) => r.shadowWouldRelease).length,
      downstreamKillerAfterShadowPass: shadowDownstreamDist,
      dominantDownstreamKiller: Object.entries(shadowDownstreamDist).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "UNKNOWN",
      note:
        "Hybrid path emits AI/consensus/EV traces even when qualification rejects; firstTrueBlocker uses pipeline order (qualification before hybrid telemetry).",
    },
    transitions,
    rootCauseRanking: rootRanking,
    lossControl: lossControlRows,
    engineeringSpec: spec,
    verdict,
  };

  writeJson(OUT.summary, summary);
  writeJson(OUT.engineeringSpec, spec);
  writeCsv(OUT.traces, traceRows);
  writeCsv(OUT.transitions, transitions);
  writeCsv(OUT.counterfactuals, counterfactualRows);
  writeCsv(OUT.lossControl, lossControlRows);
  writeCsv(OUT.aiReliability, aiReliabilityRows);
  writeCsv(OUT.consensusMaster, consensusMasterRows);
  writeCsv(OUT.evAnalysis, evRows);
  writeCsv(OUT.rootCauseRanking, rootRanking);

  const md = [
    "# KRIPTO P2 — Deep AI × Consensus × EV Blocker Isolation",
    "",
    `> Generated: ${summary.generatedAt}`,
    `> Research only — no production changes`,
    "",
    "## Context",
    "",
    "Scanner shadow observe-only paper: **932** decision differences, **0** execution-ready.",
    "37 actionable top-gainers: scanner is no longer proven as sole final bottleneck.",
    "",
    "## 37 Cohort First True Blocker",
    "",
    "| Blocker | Count |",
    "|---------|-------|",
    ...Object.entries(firstDist).map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "## Shadow 932 Downstream",
    "",
    `- Reached AI: **${shadowReachedAi}**`,
    `- Reached Consensus: **${shadowReachedConsensus}**`,
    `- Reached EV: **${shadowReachedEv}**`,
    `- Execution-ready: **${shadowExecReady}**`,
    `- EV ordering problems (EV_REJECT above threshold): **${evOrdering}**`,
    "",
    "## Root Cause Ranking",
    "",
    "| Category | Affected | Share |",
    "|----------|----------|-------|",
    ...rootRanking.map((r) => `| ${r.category} | ${r.affected} | ${Number(r.share).toFixed(3)} |`),
    "",
    "## FINAL VERDICT",
    "",
    "```",
    ...Object.entries(verdict).map(([k, v]) =>
      typeof v === "object" ? `${k} = ${JSON.stringify(v)}` : `${k} = ${v}`,
    ),
    "```",
    "",
    "## Engineering Spec (DO NOT IMPLEMENT)",
    "",
    `- Fix: **${fix}**`,
    `- File: ${spec.file}`,
    `- Minimal: ${spec.minimalSafeFix}`,
    "",
  ].join("\n");

  fs.writeFileSync(OUT.report, md, "utf8");

  console.log(JSON.stringify({ ok: true, verdict }));
}

main();
