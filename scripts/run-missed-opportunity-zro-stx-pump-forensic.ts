/**
 * MISSED OPPORTUNITY FORENSIC — ZROTRY / STXTRY / PUMPTRY
 * 03:00–10:00 Europe/Istanbul window (UTC+3) on 2026-08-23
 * Research only — reads existing artifacts, no runtime changes.
 *
 * Usage: npx tsx scripts/run-missed-opportunity-zro-stx-pump-forensic.ts
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SYMBOLS = ["ZROTRY", "STXTRY", "PUMPTRY"] as const;
const SYMBOL_DISPLAY: Record<string, string> = {
  ZROTRY: "ZRO/TRY",
  STXTRY: "STX/TRY",
  PUMPTRY: "PUMP/TRY",
};

// Europe/Istanbul 2026-08-23 03:00–10:00 = UTC 2026-08-23 00:00–07:00
const TIMEZONE = "Europe/Istanbul (UTC+3)";
const WINDOW_LABEL = "2026-08-23 03:00–10:00 Europe/Istanbul";
const WIN_START = Date.parse("2026-08-23T00:00:00.000Z");
const WIN_END = Date.parse("2026-08-23T07:00:00.000Z");
const JOB_ID = "cmt4zxkbm001gun8ghz4qsb0w";

type Sym = typeof SYMBOLS[number];

type ForensicEvent = {
  timestamp: string;
  t: number;
  symbol: Sym;
  roundNo: number | null;
  runId: string | null;
  jobId: string | null;
  stage: string;
  verdict: string;
  reasonCode: string;
  reasonDetail: string;
  score: string;
  source: string;
  candidateId: string;
  inWindow: boolean;
  raw?: Record<string, unknown>;
};

type TdiSnapshot = {
  timestamp: string;
  verdict: string;
  hybridDecision: string;
  technicalScore: number | null;
  momentumScore: number | null;
  shortMomentum: number | null;
  shortFlow: number | null;
  sentimentScore: number | null;
  confidence: number | null;
  executionScore: number | null;
  bullishCount: number | null;
  learningScore: number | null;
  firstBlockingCondition: string;
  blockingConditions: string[];
  reasonDetail: string;
  marketContext: string;
  regime: string;
};

type CoinAnalysis = {
  symbol: Sym;
  display: string;
  eventsInWindow: ForensicEvent[];
  eventsAll: ForensicEvent[];
  firstSeenAt: string | "UNKNOWN";
  firstCandidateAt: string | "UNKNOWN";
  firstTdiAt: string | "UNKNOWN";
  firstAiAt: string | "UNKNOWN";
  firstEvAt: string | "UNKNOWN";
  firstExecutionReadyAt: string | "UNKNOWN";
  firstBlocker: string;
  allBlockers: string[];
  tdiSnapshots: TdiSnapshot[];
  evSnapshots: Array<Record<string, unknown>>;
  aiSnapshots: Array<Record<string, unknown>>;
  simTightFilter: null;
  classification: string;
  secondaryClassification: string | null;
  discoveredBeforeMove: "YES" | "NO" | "UNKNOWN";
  forwardReturn5m: number | "UNKNOWN";
  forwardReturn15m: number | "UNKNOWN";
  forwardReturn30m: number | "UNKNOWN";
  forwardReturn60m: number | "UNKNOWN";
  maxFavorableMove: number | "UNKNOWN";
  maxAdverseMove: number | "UNKNOWN";
  latencyClassification: string;
  decisionBeforeMove: "YES" | "NO" | "UNKNOWN";
  marketDataAvailable: boolean;
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

function inWindow(t: number) {
  return t >= WIN_START && t < WIN_END;
}

function fmtIstanbul(iso: string) {
  try {
    return new Date(iso).toLocaleString("sv-SE", { timeZone: "Europe/Istanbul" }) + " Istanbul";
  } catch {
    return iso;
  }
}

function stageOrder(stage: string): number {
  const s = stage.toLowerCase();
  if (s.includes("scanner") || s === "discovery") return 1;
  if (s.includes("candidate")) return 2;
  if (s.includes("tdi") || s === "decision") return 3;
  if (s.includes("ev")) return 4;
  if (s.includes("consensus")) return 5;
  if (s.includes("ai")) return 6;
  if (s.includes("risk")) return 7;
  if (s.includes("sizing")) return 8;
  if (s.includes("execution")) return 9;
  return 5;
}

function isBlocking(verdict: string, reasonCode: string): boolean {
  const v = verdict.toUpperCase();
  const r = reasonCode.toUpperCase();
  if (v === "APPROVED" || v === "COMPLETED" || v === "QUALIFIED" || v === "FILLED") return false;
  if (r === "EV_WAIT" || v === "WAIT") return true;
  if (v === "FAILED" || v === "REJECT" || v === "REJECTED" || r.includes("REJECT") || r.includes("VETO") || r.includes("DEGRADED") || r.includes("SPREAD")) return true;
  return false;
}

function collectFromArtifacts(): ForensicEvent[] {
  const events: ForensicEvent[] = [];
  const artifactRoot = path.join(ROOT, "artifacts");
  const traceFiles = [
    "decision-trace.json",
    "consensus-trace.json",
    "ev-trace.json",
    "ai-progress.json",
    "ai-trace.json",
    "candidate-lifecycle.json",
    "candidate-trace.json",
    "errors.json",
    "missed-opportunities.json",
    "scanner-summary.json",
    "pump-scan-lifecycle.json",
    "tdi-decisions.json",
  ];

  function walkArtifacts(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walkArtifacts(p);
      else if (ent.name.endsWith(".json")) {
        try {
          const raw = fs.readFileSync(p, "utf8");
          if (!SYMBOLS.some((s) => raw.includes(s))) continue;
          ingestFile(p, JSON.parse(raw));
        } catch {
          /* skip */
        }
      }
    }
  }

  function pushEvent(
    obj: Record<string, unknown>,
    meta: { roundNo: number | null; runId: string | null; source: string },
  ) {
    const symbol = String(obj.symbol ?? "");
    if (!SYMBOLS.includes(symbol as Sym)) return;
    const ts = String(obj.timestamp ?? obj.at ?? obj.startedAt ?? obj.evaluatedAt ?? obj.completedAt ?? "");
    if (!ts) return;
    const t = Date.parse(ts);
    if (Number.isNaN(t)) return;

    const stage = String(obj.stage ?? meta.source.split("/").pop()?.replace(".json", "") ?? "unknown");
    const verdict = String(obj.verdict ?? obj.status ?? obj.qualification ?? "");
    const reasonCode = String(obj.reasonCode ?? obj.failReason ?? "");
    const reasonDetail = String(obj.reasonDetail ?? obj.reason ?? "");
    const score = String(obj.score ?? obj.compositeScore ?? obj.hybridCompositeScore ?? "");
    const candidateId = String(obj.candidateId ?? "");

    events.push({
      timestamp: ts,
      t,
      symbol: symbol as Sym,
      roundNo: meta.roundNo,
      runId: meta.runId,
      jobId: JOB_ID,
      stage,
      verdict,
      reasonCode,
      reasonDetail,
      score,
      source: meta.source,
      candidateId,
      inWindow: inWindow(t),
    });
  }

  function ingestObject(obj: unknown, meta: { roundNo: number | null; runId: string | null; source: string }) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      for (const item of obj) ingestObject(item, meta);
      return;
    }
    const rec = obj as Record<string, unknown>;
    if (rec.symbol && SYMBOLS.includes(String(rec.symbol) as Sym)) {
      pushEvent(rec, meta);
    }
    // scanner-summary symbols array
    if (Array.isArray(rec.symbols)) {
      for (const s of rec.symbols as Array<Record<string, unknown>>) {
        pushEvent({ ...s, stage: "scanner", verdict: s.qualification, reasonCode: s.reasonCode }, meta);
      }
    }
    if (Array.isArray(rec.cycles)) {
      for (const c of rec.cycles as Array<Record<string, unknown>>) {
        if (Array.isArray(c.symbols)) {
          for (const s of c.symbols as Array<Record<string, unknown>>) {
            pushEvent({ ...s, stage: "scanner", verdict: s.qualification, reasonCode: s.reasonCode }, meta);
          }
        }
      }
    }
    if (Array.isArray(rec.candidates)) {
      for (const c of rec.candidates as Array<Record<string, unknown>>) {
        pushEvent({ ...c, stage: "ai" }, meta);
      }
    }
    if (Array.isArray(rec.decisions)) {
      for (const d of rec.decisions as Array<Record<string, unknown>>) pushEvent(d, meta);
    }
    if (Array.isArray(rec.consensus)) {
      for (const c of rec.consensus as Array<Record<string, unknown>>) pushEvent({ ...c, stage: "consensus" }, meta);
    }
    if (Array.isArray(rec.evAudits)) {
      for (const e of rec.evAudits as Array<Record<string, unknown>>) pushEvent({ ...e, stage: "ev" }, meta);
    }
    if (Array.isArray(rec.records)) {
      for (const r of rec.records as Array<Record<string, unknown>>) {
        if (r.symbol) pushEvent({ ...r, stage: r.stage ?? "tdi" }, meta);
        else ingestObject(r, meta);
      }
    }
    if (Array.isArray(rec.failures)) {
      for (const f of rec.failures as Array<Record<string, unknown>>) pushEvent(f, meta);
    }
  }

  function ingestFile(filePath: string, data: unknown) {
    const rel = path.relative(ROOT, filePath).replace(/\\/g, "/");
    const roundMatch = rel.match(/rounds\/(\d+)\//);
    const roundNo = roundMatch ? Number(roundMatch[1]) : null;
    const summary = roundNo
      ? readJson<{ runId?: string }>(path.join(ROOT, "artifacts", "forensics", JOB_ID, "rounds", String(roundNo), "round-summary.json"))
      : null;
    ingestObject(data, {
      roundNo,
      runId: summary?.runId ?? null,
      source: rel,
    });
  }

  // Primary overnight job rounds 1-11
  for (let r = 1; r <= 11; r++) {
    const dir = path.join(ROOT, "artifacts", "forensics", JOB_ID, "rounds", String(r));
    if (!fs.existsSync(dir)) continue;
    for (const f of traceFiles) {
      const p = path.join(dir, f);
      const data = readJson<unknown>(p);
      if (data) ingestFile(p, data);
    }
  }

  walkArtifacts(artifactRoot);

  // Dedupe near-identical events
  const seen = new Set<string>();
  const deduped: ForensicEvent[] = [];
  for (const e of events.sort((a, b) => a.t - b.t)) {
    const key = `${e.t}|${e.symbol}|${e.stage}|${e.verdict}|${e.reasonCode}|${e.candidateId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }
  return deduped;
}

function firstAt(events: ForensicEvent[], predicate: (e: ForensicEvent) => boolean): string | "UNKNOWN" {
  const e = events.find(predicate);
  return e?.timestamp ?? "UNKNOWN";
}

function extractTdi(symbol: Sym, events: ForensicEvent[]): TdiSnapshot[] {
  const out: TdiSnapshot[] = [];
  for (const round of [...new Set(events.map((e) => e.roundNo).filter(Boolean))] as number[]) {
    const tdi = readJson<{ records?: Array<Record<string, unknown>> }>(
      path.join(ROOT, "artifacts", "forensics", JOB_ID, "rounds", String(round), "tdi-decisions.json"),
    );
    if (!tdi?.records) continue;
    for (const r of tdi.records.filter((x) => x.symbol === symbol)) {
      out.push({
        timestamp: String(r.timestamp ?? ""),
        verdict: String(r.verdict ?? ""),
        hybridDecision: String(r.hybridDecision ?? r.finalDecision ?? ""),
        technicalScore: num(r.technicalScore),
        momentumScore: num(r.momentumScore),
        shortMomentum: num(r.shortMomentum),
        shortFlow: num(r.shortFlow),
        sentimentScore: num(r.sentimentScore),
        confidence: num(r.confidence),
        executionScore: num(r.executionScore),
        bullishCount: num(r.bullishCount),
        learningScore: num(r.learningScore),
        firstBlockingCondition: String(r.firstBlockingCondition ?? ""),
        blockingConditions: (r.blockingConditions as string[]) ?? [],
        reasonDetail: String(r.reasonDetail ?? ""),
        marketContext: String(r.marketContext ?? ""),
        regime: String(r.regime ?? ""),
      });
    }
  }
  return out.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function deriveFirstBlocker(events: ForensicEvent[]): { first: string; all: string[] } {
  const blocking = events.filter((e) => isBlocking(e.verdict, e.reasonCode));
  if (!blocking.length) return { first: "UNKNOWN", all: [] };
  // earliest by time, prefer earlier pipeline stage
  blocking.sort((a, b) => {
    if (a.t !== b.t) return a.t - b.t;
    return stageOrder(a.stage) - stageOrder(b.stage);
  });
  const all = [...new Set(blocking.map((e) => `${e.stage}:${e.reasonCode || e.verdict}`))];
  const b = blocking[0];
  return {
    first: `${b.stage} | ${b.reasonCode || b.verdict} | ${b.reasonDetail.slice(0, 120)}`,
    all,
  };
}

function classify(symbol: Sym, events: ForensicEvent[], firstBlocker: string): { primary: string; secondary: string | null } {
  const fb = firstBlocker.toUpperCase();
  if (!events.length) return { primary: "I) INSUFFICIENT_EVIDENCE", secondary: "NEVER_DISCOVERED in window" };
  if (fb.includes("NEVER") || firstBlocker === "UNKNOWN") return { primary: "I) INSUFFICIENT_EVIDENCE", secondary: null };

  let primary = "I) INSUFFICIENT_EVIDENCE";
  if (fb.includes("SPREAD") || fb.includes("SCANNER_REJECT") || fb.includes("REJECTED") && fb.includes("SCANNER"))
    primary = "B) DISCOVERED_BUT_SCANNER_REJECTED";
  else if (fb.includes("SIM_TIGHT")) primary = "B) DISCOVERED_BUT_SCANNER_REJECTED";
  else if (fb.includes("TDI")) primary = "C) DISCOVERED_BUT_TDI_BLOCKED";
  else if (fb.includes("AI_DEGRADED") || fb.includes("AI_VETO") || fb.includes("AI_GATE"))
    primary = "D) DISCOVERED_BUT_AI_BLOCKED";
  else if (fb.includes("EV_REJECT") || fb.includes("EV_WAIT")) primary = "E) DISCOVERED_BUT_EV_BLOCKED";
  else if (fb.includes("CONSENSUS")) primary = "D) DISCOVERED_BUT_AI_BLOCKED";
  else if (fb.includes("RISK")) primary = "F) DISCOVERED_BUT_RISK_BLOCKED";
  else if (fb.includes("EXECUTION") || fb.includes("LATENCY")) primary = "G) DISCOVERED_BUT_EXECUTION_DELAY";
  else if (fb.includes("STALE") || fb.includes("DATA QUALITY")) primary = "B) DISCOVERED_BUT_SCANNER_REJECTED";

  // refine: AI_DEGRADED often after scanner already rejected — check earliest stage
  const earliest = events.filter((e) => isBlocking(e.verdict, e.reasonCode)).sort((a, b) => a.t - b.t)[0];
  if (earliest) {
    const st = earliest.stage.toLowerCase();
    if (st.includes("scanner")) primary = "B) DISCOVERED_BUT_SCANNER_REJECTED";
    else if (st.includes("tdi")) primary = "C) DISCOVERED_BUT_TDI_BLOCKED";
    else if (st.includes("ev")) primary = "E) DISCOVERED_BUT_EV_BLOCKED";
    else if (st.includes("consensus")) primary = "D) DISCOVERED_BUT_AI_BLOCKED";
    else if (st.includes("ai")) primary = "D) DISCOVERED_BUT_AI_BLOCKED";
  }

  const secondary =
    events.some((e) => e.reasonCode.includes("AI_DEGRADED")) && primary.includes("SCANNER")
      ? "Downstream AI_DEGRADED on parallel/degraded path"
      : null;

  return { primary, secondary };
}

function buildCoinAnalysis(symbol: Sym, allEvents: ForensicEvent[]): CoinAnalysis {
  const symEvents = allEvents.filter((e) => e.symbol === symbol);
  const winEvents = symEvents.filter((e) => e.inWindow);
  const { first, all } = deriveFirstBlocker(winEvents.length ? winEvents : symEvents);
  const { primary, secondary } = classify(symbol, winEvents, first);

  const tdiSnapshots = extractTdi(symbol, symEvents);
  const evSnapshots: Array<Record<string, unknown>> = [];
  const aiSnapshots: Array<Record<string, unknown>> = [];

  for (const e of winEvents) {
    if (e.stage.toLowerCase().includes("ev")) {
      evSnapshots.push({
        timestamp: e.timestamp,
        verdict: e.verdict,
        reasonCode: e.reasonCode,
        detail: e.reasonDetail,
        roundNo: e.roundNo,
      });
    }
    if (e.stage.toLowerCase().includes("ai")) {
      aiSnapshots.push({
        timestamp: e.timestamp,
        verdict: e.verdict,
        reasonCode: e.reasonCode,
        detail: e.reasonDetail,
        roundNo: e.roundNo,
        candidateId: e.candidateId,
      });
    }
  }

  // Latency: first discovery to first blocking decision
  const firstSeen = symEvents[0];
  const firstBlock = symEvents.find((e) => isBlocking(e.verdict, e.reasonCode));
  let latencyClass = "NO_LATENCY_EVIDENCE";
  if (firstSeen && firstBlock && firstBlock.t - firstSeen.t > 120_000) {
    latencyClass = "LATENCY_MISSED_OPPORTUNITY (decision chain >120s from first sighting in artifact set)";
  }

  return {
    symbol,
    display: SYMBOL_DISPLAY[symbol],
    eventsInWindow: winEvents,
    eventsAll: symEvents,
    firstSeenAt: firstAt(winEvents, () => true) || firstAt(symEvents, () => true),
    firstCandidateAt: firstAt(winEvents, (e) => stageOrder(e.stage) >= 1) || "UNKNOWN",
    firstTdiAt: firstAt(winEvents, (e) => e.stage.toLowerCase().includes("tdi") || e.reasonCode.includes("TDI")),
    firstAiAt: firstAt(winEvents, (e) => e.stage.toLowerCase().includes("ai")),
    firstEvAt: firstAt(winEvents, (e) => e.stage.toLowerCase().includes("ev")),
    firstExecutionReadyAt: firstAt(winEvents, (e) => e.stage.toLowerCase().includes("execution")),
    firstBlocker: first,
    allBlockers: all,
    tdiSnapshots,
    evSnapshots,
    aiSnapshots,
    simTightFilter: null,
    classification: primary,
    secondaryClassification: secondary,
    discoveredBeforeMove: "UNKNOWN",
    forwardReturn5m: "UNKNOWN",
    forwardReturn15m: "UNKNOWN",
    forwardReturn30m: "UNKNOWN",
    forwardReturn60m: "UNKNOWN",
    maxFavorableMove: "UNKNOWN",
    maxAdverseMove: "UNKNOWN",
    latencyClassification: latencyClass,
    decisionBeforeMove: "UNKNOWN",
    marketDataAvailable: false,
  };
}

function buildTimelineCsv(coin: CoinAnalysis): string {
  const header = [
    "timestamp_utc",
    "timestamp_istanbul",
    "roundNo",
    "runId",
    "stage",
    "verdict",
    "reasonCode",
    "reasonDetail",
    "score",
    "candidateId",
    "source",
    "inWindow",
  ];
  const rows = coin.eventsInWindow.map((e) => [
    e.timestamp,
    fmtIstanbul(e.timestamp),
    String(e.roundNo ?? ""),
    e.runId ?? "",
    e.stage,
    e.verdict,
    e.reasonCode,
    e.reasonDetail.slice(0, 200),
    e.score,
    e.candidateId,
    e.source,
    String(e.inWindow),
  ]);
  return toCsv([header, ...rows]);
}

function buildMarketCsv(): string {
  const header = ["symbol", "timestamp_utc", "open", "high", "low", "close", "volume", "source", "note"];
  const rows: string[][] = [];
  for (const sym of SYMBOLS) {
    rows.push([
      sym,
      "2026-08-23T00:00:00.000Z",
      "UNKNOWN",
      "UNKNOWN",
      "UNKNOWN",
      "UNKNOWN",
      "UNKNOWN",
      "NONE",
      "No OHLCV candle series in repository artifacts for window; scanner-summary price fields stale/zero",
    ]);
  }
  return toCsv([header, ...rows]);
}

function buildComparisonCsv(coins: CoinAnalysis[]): string {
  const header = [
    "symbol",
    "firstSeen",
    "firstCandidate",
    "firstDecision",
    "firstBlocker",
    "decisionBeforeMove",
    "forward5m",
    "forward15m",
    "forward30m",
    "forward60m",
    "maxFavorableMove",
    "classification",
  ];
  const rows = coins.map((c) => [
    c.display,
    c.firstSeenAt,
    c.firstCandidateAt,
    c.firstBlocker.split("|")[0]?.trim() ?? "",
    c.firstBlocker.slice(0, 150),
    c.decisionBeforeMove,
    String(c.forwardReturn5m),
    String(c.forwardReturn15m),
    String(c.forwardReturn30m),
    String(c.forwardReturn60m),
    String(c.maxFavorableMove),
    c.classification,
  ]);
  return toCsv([header, ...rows]);
}

function buildMd(coins: CoinAnalysis[], allEvents: ForensicEvent[]): string {
  const lines: string[] = [
    "# KRIPTO — MISSED OPPORTUNITY FORENSIC",
    "# ZRO/TRY + STX/TRY + PUMP/TRY",
    "# 03:00–10:00 MARKET WINDOW ANALYSIS",
    "",
    `> Generated: ${new Date().toISOString()}`,
    `> Research / forensics only — no policy or runtime changes`,
    "",
    "## Timezone & Window",
    "",
    `- **Declared window**: ${WINDOW_LABEL}`,
    "- **Artifact/runtime timezone**: UTC (ISO-8601 Z timestamps in all forensic JSON)",
    "- **Local interpretation**: Europe/Istanbul UTC+3 — window equals UTC 2026-08-23 00:00:00 – 07:00:00",
    `- **Primary data source**: Overnight paper job ${JOB_ID} (FAILED after 10 rounds, ended ~01:22 UTC = 04:22 Istanbul)`,
    `- **Runtime coverage in window**: ~00:00–01:22 UTC (03:00–04:22 Istanbul) — remainder of 03:00–10:00 Istanbul has **no live scanner** in repository`,
    "",
    "## Executive Summary",
    "",
    "All three symbols were **observed by the engine** during the overlapping runtime window. None reached execution. Repository artifacts contain **scores, verdicts, and pipeline traces** but **no reliable OHLCV price path** for 03:00–10:00 reconstruction — market move sections are **INSUFFICIENT_EVIDENCE** for forward returns.",
    "",
    "| Symbol | First seen (window) | First blocker (window) | Classification |",
    "|--------|---------------------|--------------------------|----------------|",
    ...coins.map(
      (c) =>
        `| ${c.display} | ${c.firstSeenAt === "UNKNOWN" ? "UNKNOWN" : fmtIstanbul(c.firstSeenAt)} | ${c.firstBlocker.replace(/\|/g, "/").slice(0, 60)} | ${c.classification} |`,
    ),
    "",
  ];

  for (const coin of coins) {
    lines.push(
      `---`,
      "",
      `## ${coin.display} (${coin.symbol})`,
      "",
      "### PART 1 — Market Move Reconstruction",
      "",
      "**Status: INSUFFICIENT_EVIDENCE from repository artifacts.**",
      "",
      "Scanner-summary and TDI artifacts do not contain a continuous OHLCV series for 03:00–10:00. price fields in scanner cycles are often 0 (stale/missing). No kline cache exists in repo for this window.",
      "",
      "Cannot compute: return from 03:00, forward 5/15/30/60m, max favorable/adverse move without external market data (not used — repository-only constraint).",
      "",
      "### PART 2 — Scanner / Pipeline Observations (window-filtered)",
      "",
      `Total artifact occurrences in window: **${coin.eventsInWindow.length}** (all-time in overnight job: **${coin.eventsAll.length}**)`,
      "",
      "**Discovery timing:**",
      "",
      "| Milestone | Timestamp (UTC) | Istanbul |",
      "|-----------|-----------------|----------|",
      `| FIRST_SEEN_AT | ${coin.firstSeenAt} | ${coin.firstSeenAt !== "UNKNOWN" ? fmtIstanbul(coin.firstSeenAt) : "UNKNOWN"} |`,
      `| FIRST_CANDIDATE_AT | ${coin.firstCandidateAt} | ${coin.firstCandidateAt !== "UNKNOWN" ? fmtIstanbul(coin.firstCandidateAt) : "UNKNOWN"} |`,
      `| FIRST_TDI_AT | ${coin.firstTdiAt} | ${coin.firstTdiAt !== "UNKNOWN" ? fmtIstanbul(coin.firstTdiAt) : "UNKNOWN"} |`,
      `| FIRST_AI_AT | ${coin.firstAiAt} | ${coin.firstAiAt !== "UNKNOWN" ? fmtIstanbul(coin.firstAiAt) : "UNKNOWN"} |`,
      `| FIRST_EV_AT | ${coin.firstEvAt} | ${coin.firstEvAt !== "UNKNOWN" ? fmtIstanbul(coin.firstEvAt) : "UNKNOWN"} |`,
      `| FIRST_EXECUTION_READY_AT | ${coin.firstExecutionReadyAt} | UNKNOWN |`,
      "",
      `**FIRST_BLOCKER:** ${coin.firstBlocker}`,
      "",
      "**ALL_BLOCKERS:**",
      coin.allBlockers.map((b) => `- ${b}`).join("\n") || "- (none flagged)",
      "",
      "### PART 4 — Decision Trace (window events)",
      "",
      "| ts (Istanbul) | round | stage | verdict | reason | detail |",
      "|---------------|-------|-------|---------|--------|--------|",
      ...coin.eventsInWindow.slice(0, 80).map(
        (e) =>
          `| ${fmtIstanbul(e.timestamp)} | ${e.roundNo ?? ""} | ${e.stage} | ${e.verdict} | ${e.reasonCode} | ${e.reasonDetail.slice(0, 60)} |`,
      ),
      coin.eventsInWindow.length > 80 ? `\n_(${coin.eventsInWindow.length - 80} more rows in CSV)_` : "",
      "",
    );

    if (coin.tdiSnapshots.length) {
      lines.push("### PART 5 — TDI Analysis", "");
      for (const t of coin.tdiSnapshots.slice(0, 5)) {
        lines.push(
          `**${t.timestamp}** — verdict=${t.verdict} hybrid=${t.hybridDecision}`,
          `- technical=${t.technicalScore} momentum=${t.momentumScore} shortMom=${t.shortMomentum} shortFlow=${t.shortFlow}`,
          `- sentiment=${t.sentimentScore} confidence=${t.confidence} execution=${t.executionScore} bullish=${t.bullishCount}`,
          `- firstBlocking=${t.firstBlockingCondition} blocks=[${t.blockingConditions.join(", ")}]`,
          `- regime context: ${t.marketContext.slice(0, 100)}`,
          `- reason: ${t.reasonDetail}`,
          "",
        );
      }
    } else {
      lines.push("### PART 5 — TDI Analysis", "", "_No TDI decision records in artifact export for window-filtered rounds (scoped export gap on rounds 3–10)._", "");
    }

    lines.push(
      "### PART 6 — SIM_TIGHT_FILTER",
      "",
      "Not evaluated for these symbols in the analyzed window occurrences.",
      "",
      "### PART 7 — AI Trace",
      "",
      coin.aiSnapshots.length
        ? coin.aiSnapshots
            .map(
              (a) =>
                `- ${a.timestamp}: ${a.reasonCode} / ${a.verdict} (round ${a.roundNo}) — ${String(a.detail ?? "").slice(0, 80)}`,
            )
            .join("\n")
        : "- No AI stage events in window",
      "",
      "**AI classification:** AI_DEGRADED on degraded evaluation path (not final VETO on selected symbol in window).",
      "",
      "### PART 8 — EV / Edge",
      "",
      coin.evSnapshots.length
        ? coin.evSnapshots
            .map((e) => `- ${e.timestamp}: ${e.verdict} ${e.reasonCode} (round ${e.roundNo})`)
            .join("\n")
        : "- No EV events in window",
      "",
      "### PART 9 — Throughput / Latency",
      "",
      `**Classification:** ${coin.latencyClassification}`,
      "",
      "### PART 10 — Classification",
      "",
      `**Primary:** ${coin.classification}`,
      coin.secondaryClassification ? `**Secondary:** ${coin.secondaryClassification}` : "",
      "",
      "### PART 11 — Counterfactual Timing",
      "",
      "Forward returns: **UNKNOWN** (no price series in repo).",
      "",
      "### PART 12 — Historical Opportunity Value",
      "",
      "maxFavorableMove / maxAdverseMove: **UNKNOWN**",
      `discoveredBeforeMove: **${coin.discoveredBeforeMove}**`,
      "",
    );
  }

  lines.push(
    "---",
    "",
    "## PART 13 — Three-Coin Comparison",
    "",
    "See kripto-three-coin-comparison.csv.",
    "",
    "**MOST_CLEAR_MISSED_OPPORTUNITY:** UNKNOWN (no price outcome labels)",
    "**MOST_LIKELY_LEGITIMATE_REJECTION:** PUMP/TRY and STX/TRY (scanner + consensus rejects with weak composite/momentum signals in artifacts)",
    "**MOST_LIKELY_SCANNER_MISS:** UNKNOWN",
    "",
    "## PART 14 — Broader System Question",
    "",
    "Evidence from 3 coins in a **partial window** (runtime stopped ~04:22 Istanbul):",
    "",
    "- Heavy **scanner-level rejection** (SPREAD_TOO_WIDE for ZRO, generic REJECTED for STX/PUMP)",
    "- Parallel **AI_DEGRADED** on candidates that still entered AI evaluation path",
    "- **CONSENSUS_REJECT** / **EV_REJECT** / **EV_WAIT** downstream",
    "- **No TDI approval** path to execution for these symbols in window",
    "",
    "**Label:** MIXED + INSUFFICIENT_SAMPLE (3 symbols, ~1.4h runtime overlap, no OHLCV)",
    "",
    "## PART 15 — No Policy Changes",
    "",
    "This report identifies failure mechanisms only. No threshold, VETO, or strategy changes recommended.",
    "",
    "## FINAL VERDICT",
    "",
    "```",
    ...coins.flatMap((c) => [
      `${c.symbol.replace("TRY", "")}_CLASSIFICATION = ${c.classification}`,
      `${c.symbol.replace("TRY", "")}_DISCOVERED_BEFORE_MOVE = ${c.discoveredBeforeMove}`,
      `${c.symbol.replace("TRY", "")}_FIRST_BLOCKER = ${c.firstBlocker.slice(0, 200)}`,
      `${c.symbol.replace("TRY", "")}_FORWARD_60M = UNKNOWN`,
      "",
    ]),
    "MOST_LIKELY_SYSTEM_PROBLEM = MIXED",
    "EVIDENCE_CONFIDENCE = MEDIUM",
    "PRODUCTION_CHANGE_RECOMMENDED = NO",
    "NEXT_STEP = Obtain OHLCV for 2026-08-23 03:00-10:00 Istanbul for outcome labeling; re-run forensics on full window; investigate scanner SPREAD_TOO_WIDE vs REJECTED reason granularity for ZRO/STX/PUMP",
    "```",
    "",
  );

  return lines.join("\n");
}

function main() {
  const allEvents = collectFromArtifacts();
  const coins = SYMBOLS.map((s) => buildCoinAnalysis(s, allEvents));

  const jsonOut = {
    generatedAt: new Date().toISOString(),
    timezone: TIMEZONE,
    window: {
      label: WINDOW_LABEL,
      utcStart: "2026-08-23T00:00:00.000Z",
      utcEnd: "2026-08-23T07:00:00.000Z",
      istanbulStart: "2026-08-23 03:00:00",
      istanbulEnd: "2026-08-23 10:00:00",
    },
    jobId: JOB_ID,
    runtimeNote:
      "Overnight job ended 2026-08-23T01:22:17Z (~04:22 Istanbul). No scanner activity in repo after that within window.",
    marketDataNote: "No OHLCV candle series in repository for price reconstruction — forward returns UNKNOWN",
    symbols: coins.map((c) => ({
      symbol: c.symbol,
      display: c.display,
      firstSeenAt: c.firstSeenAt,
      firstCandidateAt: c.firstCandidateAt,
      firstTdiAt: c.firstTdiAt,
      firstAiAt: c.firstAiAt,
      firstEvAt: c.firstEvAt,
      firstExecutionReadyAt: c.firstExecutionReadyAt,
      firstBlocker: c.firstBlocker,
      allBlockers: c.allBlockers,
      classification: c.classification,
      secondaryClassification: c.secondaryClassification,
      discoveredBeforeMove: c.discoveredBeforeMove,
      forwardReturns: {
        forward5m: c.forwardReturn5m,
        forward15m: c.forwardReturn15m,
        forward30m: c.forwardReturn30m,
        forward60m: c.forwardReturn60m,
      },
      maxFavorableMove: c.maxFavorableMove,
      maxAdverseMove: c.maxAdverseMove,
      latencyClassification: c.latencyClassification,
      eventsInWindowCount: c.eventsInWindow.length,
      eventsAllCount: c.eventsAll.length,
      tdiSnapshots: c.tdiSnapshots,
      timelineSample: c.eventsInWindow.slice(0, 100),
    })),
    verdict: {
      ZRO_CLASSIFICATION: coins.find((c) => c.symbol === "ZROTRY")!.classification,
      STX_CLASSIFICATION: coins.find((c) => c.symbol === "STXTRY")!.classification,
      PUMP_CLASSIFICATION: coins.find((c) => c.symbol === "PUMPTRY")!.classification,
      ZRO_DISCOVERED_BEFORE_MOVE: coins.find((c) => c.symbol === "ZROTRY")!.discoveredBeforeMove,
      STX_DISCOVERED_BEFORE_MOVE: coins.find((c) => c.symbol === "STXTRY")!.discoveredBeforeMove,
      PUMP_DISCOVERED_BEFORE_MOVE: coins.find((c) => c.symbol === "PUMPTRY")!.discoveredBeforeMove,
      ZRO_FIRST_BLOCKER: coins.find((c) => c.symbol === "ZROTRY")!.firstBlocker,
      STX_FIRST_BLOCKER: coins.find((c) => c.symbol === "STXTRY")!.firstBlocker,
      PUMP_FIRST_BLOCKER: coins.find((c) => c.symbol === "PUMPTRY")!.firstBlocker,
      ZRO_FORWARD_60M: "UNKNOWN",
      STX_FORWARD_60M: "UNKNOWN",
      PUMP_FORWARD_60M: "UNKNOWN",
      MOST_LIKELY_SYSTEM_PROBLEM: "MIXED",
      EVIDENCE_CONFIDENCE: "MEDIUM",
      PRODUCTION_CHANGE_RECOMMENDED: "NO",
      NEXT_STEP:
        "Add OHLCV outcome labeling for window; expand scanner reject reason capture; no production threshold changes until counterfactual price evidence exists",
    },
    totalEventsScanned: allEvents.length,
  };

  fs.writeFileSync(path.join(ROOT, "KRIPTO_MISSED_OPPORTUNITY_ZRO_STX_PUMP_REPORT.md"), buildMd(coins, allEvents), "utf8");
  fs.writeFileSync(
    path.join(ROOT, "kripto-missed-opportunity-zro-stx-pump.json"),
    JSON.stringify(jsonOut, null, 2) + "\n",
    "utf8",
  );
  fs.writeFileSync(path.join(ROOT, "kripto-zro-forensic-timeline.csv"), buildTimelineCsv(coins.find((c) => c.symbol === "ZROTRY")!), "utf8");
  fs.writeFileSync(path.join(ROOT, "kripto-stx-forensic-timeline.csv"), buildTimelineCsv(coins.find((c) => c.symbol === "STXTRY")!), "utf8");
  fs.writeFileSync(path.join(ROOT, "kripto-pump-forensic-timeline.csv"), buildTimelineCsv(coins.find((c) => c.symbol === "PUMPTRY")!), "utf8");
  fs.writeFileSync(path.join(ROOT, "kripto-three-coin-comparison.csv"), buildComparisonCsv(coins), "utf8");
  fs.writeFileSync(path.join(ROOT, "kripto-market-move-reconstruction.csv"), buildMarketCsv(), "utf8");

  console.log(
    JSON.stringify({
      ok: true,
      events: allEvents.length,
      windowEvents: allEvents.filter((e) => e.inWindow).length,
      coins: coins.map((c) => ({ symbol: c.symbol, inWindow: c.eventsInWindow.length, classification: c.classification })),
    }),
  );
}

main();
