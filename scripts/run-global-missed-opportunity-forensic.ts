/**
 * GLOBAL MISSED-OPPORTUNITY FORENSIC
 * Runtime windows × Binance TR top gainers × engine decision trace
 * Research only — no production changes.
 *
 * Usage: npx tsx scripts/run-global-missed-opportunity-forensic.ts
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const ROOT = process.cwd();
const PRIMARY_JOB = "cmt4zxkbm001gun8ghz4qsb0w";
const KLINE_INTERVAL = "1m";
const BINANCE_BASES = ["https://api.binance.me", "https://www.binance.tr"];
const TOP_CAP = 50;
const MEANINGFUL_MOVE_PCT = 0.5; // transparent threshold for FIRST_MEANINGFUL_MOVE

type Interval = { start: number; end: number; roundIds: string[]; roundNos: number[]; jobId: string };
type Kline = { openTime: number; open: number; high: number; low: number; close: number; volume: number };
type GainerRow = {
  symbol: string;
  windowId: string;
  windowOpenPrice: number;
  windowClosePrice: number;
  windowHigh: number;
  windowLow: number;
  windowReturnPct: number;
  maxIntrawindowGainPct: number;
  maxIntrawindowDrawdownPct: number;
  volume: number;
  quoteVolume: number;
  rankCloseToClose: number;
  rankMaxGain: number;
  rankOpenToHigh: number;
  klineCount: number;
  dataStatus: string;
};

type SymbolTrace = {
  symbol: string;
  discovered: boolean;
  firstScannerAt: string | null;
  firstCandidateAt: string | null;
  firstTdiAt: string | null;
  firstAiAt: string | null;
  firstEvAt: string | null;
  firstConsensusAt: string | null;
  firstBlocker: string;
  allBlockers: string[];
  classification: string;
  discoveredBeforeMove: "YES" | "NO" | "UNKNOWN";
  firstMeaningfulMoveAt: string | null;
  latencyMs: number | null;
  latencyClass: string;
  missedOpportunityScore: number;
  tdi: Record<string, unknown> | null;
  ai: Record<string, unknown> | null;
  ev: Record<string, unknown> | null;
  events: Array<Record<string, unknown>>;
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

function fmtIstanbul(ms: number) {
  return new Date(ms).toLocaleString("sv-SE", { timeZone: "Europe/Istanbul" }) + " Istanbul";
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const cur of sorted) {
    if (!out.length) {
      out.push({ ...cur, roundIds: [...cur.roundIds], roundNos: [...cur.roundNos] });
      continue;
    }
    const last = out[out.length - 1];
    if (cur.start <= last.end + 5000) {
      last.end = Math.max(last.end, cur.end);
      last.roundIds.push(...cur.roundIds);
      last.roundNos.push(...cur.roundNos);
    } else {
      out.push({ ...cur, roundIds: [...cur.roundIds], roundNos: [...cur.roundNos] });
    }
  }
  return out;
}

async function fetchKlines(symbol: string, startMs: number, endMs: number): Promise<Kline[]> {
  const all: Kline[] = [];
  let start = startMs;
  const limit = 1000;
  while (start < endMs) {
    for (const base of BINANCE_BASES) {
      try {
        const url = `${base}/api/v3/klines?symbol=${symbol}&interval=${KLINE_INTERVAL}&startTime=${start}&endTime=${endMs}&limit=${limit}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) continue;
        const rows = (await res.json()) as unknown[];
        if (!Array.isArray(rows) || rows.length === 0) continue;
        for (const row of rows) {
          if (!Array.isArray(row) || row.length < 6) continue;
          all.push({
            openTime: Number(row[0]),
            open: Number(row[1]),
            high: Number(row[2]),
            low: Number(row[3]),
            close: Number(row[4]),
            volume: Number(row[5]),
          });
        }
        const lastOpen = all.at(-1)?.openTime ?? start;
        start = lastOpen + 60_000;
        if (rows.length < limit) return all;
        break;
      } catch {
        /* try next base */
      }
    }
    await sleep(120);
    if (all.length === 0) break;
    const lastOpen = all.at(-1)?.openTime ?? start;
    start = lastOpen + 60_000;
  }
  return all.filter((k) => k.openTime >= startMs && k.openTime < endMs);
}

function computeMetrics(klines: Kline[]) {
  if (!klines.length) return null;
  const open = klines[0].open;
  const close = klines.at(-1)!.close;
  const high = Math.max(...klines.map((k) => k.high));
  const low = Math.min(...klines.map((k) => k.low));
  const volume = klines.reduce((a, k) => a + k.volume, 0);
  const windowReturnPct = open > 0 ? ((close - open) / open) * 100 : 0;
  const maxIntrawindowGainPct = open > 0 ? ((high - open) / open) * 100 : 0;
  const maxIntrawindowDrawdownPct = open > 0 ? ((low - open) / open) * 100 : 0;
  return { open, close, high, low, volume, windowReturnPct, maxIntrawindowGainPct, maxIntrawindowDrawdownPct };
}

function firstMeaningfulMove(klines: Kline[], thresholdPct: number) {
  if (!klines.length) return null;
  const base = klines[0].open;
  if (base <= 0) return null;
  for (const k of klines) {
    const gain = ((k.close - base) / base) * 100;
    if (gain >= thresholdPct) return k.openTime;
  }
  return null;
}

function loadTrySymbols(): string[] {
  const raw = readJson<{ data?: { symbols?: Array<{ symbol: string; quoteAsset: string; status: string }> } }>(
    path.join(ROOT, "data", "exchange-info-tr.json"),
  );
  return (raw?.data?.symbols ?? [])
    .filter((s) => s.quoteAsset === "TRY" && s.status === "TRADING")
    .map((s) => s.symbol);
}

function isBlocking(verdict: string, reason: string) {
  const v = verdict.toUpperCase();
  const r = reason.toUpperCase();
  if (v === "APPROVED" || v === "COMPLETED" || v === "QUALIFIED" || v === "FILLED") return false;
  if (r === "EV_WAIT" || v === "WAIT") return true;
  return v === "FAILED" || v === "REJECT" || v === "REJECTED" || r.includes("REJECT") || r.includes("VETO") || r.includes("DEGRADED") || r.includes("SPREAD");
}

function collectSymbolEvents(symbol: string, jobIds: string[]): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  const files = [
    "decision-trace.json",
    "consensus-trace.json",
    "ev-trace.json",
    "ai-progress.json",
    "candidate-lifecycle.json",
    "candidate-trace.json",
    "errors.json",
    "missed-opportunities.json",
    "scanner-summary.json",
  ];

  for (const jobId of jobIds) {
    const roundsDir = path.join(ROOT, "artifacts", "forensics", jobId, "rounds");
    if (!fs.existsSync(roundsDir)) continue;
    for (const roundName of fs.readdirSync(roundsDir)) {
      const dir = path.join(roundsDir, roundName);
      for (const f of files) {
        const data = readJson<unknown>(path.join(dir, f));
        if (!data) continue;
        const walk = (obj: unknown, stageHint: string) => {
          if (!obj || typeof obj !== "object") return;
          if (Array.isArray(obj)) {
            obj.forEach((x) => walk(x, stageHint));
            return;
          }
          const rec = obj as Record<string, unknown>;
          if (rec.symbol === symbol) {
            events.push({
              ...rec,
              stage: rec.stage ?? stageHint,
              sourceFile: f,
              roundNo: Number(roundName),
              jobId,
            });
          }
          if (Array.isArray(rec.symbols)) {
            for (const s of rec.symbols as Array<Record<string, unknown>>) {
              if (s.symbol === symbol) walk({ ...s, stage: "scanner" }, "scanner");
            }
          }
          if (Array.isArray(rec.cycles)) {
            for (const c of rec.cycles as Array<Record<string, unknown>>) {
              if (Array.isArray(c.symbols)) {
                for (const s of c.symbols as Array<Record<string, unknown>>) {
                  if (s.symbol === symbol) walk({ ...s, stage: "scanner" }, "scanner");
                }
              }
            }
          }
          if (Array.isArray(rec.candidates)) {
            for (const c of rec.candidates as Array<Record<string, unknown>>) {
              if (c.symbol === symbol) walk({ ...c, stage: "ai" }, "ai");
            }
          }
          if (Array.isArray(rec.decisions)) rec.decisions.forEach((d) => walk(d, "decision"));
          if (Array.isArray(rec.consensus)) rec.consensus.forEach((c) => walk({ ...c, stage: "consensus" }, "consensus"));
          if (Array.isArray(rec.evAudits)) rec.evAudits.forEach((e) => walk({ ...e, stage: "ev" }, "ev"));
          if (Array.isArray(rec.records)) rec.records.forEach((r) => walk(r, "tdi"));
          if (Array.isArray(rec.failures)) rec.failures.forEach((f) => walk(f, "error"));
        };
        walk(data, f.replace(".json", ""));
      }
    }
  }

  return events
    .map((e) => {
      const ts = String(e.timestamp ?? e.at ?? e.startedAt ?? e.evaluatedAt ?? "");
      return { ...e, _t: Date.parse(ts), _ts: ts };
    })
    .filter((e) => e._t && !Number.isNaN(e._t))
    .sort((a, b) => (a._t as number) - (b._t as number));
}

function buildTrace(symbol: string, jobIds: string[], windowStart: number, windowEnd: number, moveAt: number | null): SymbolTrace {
  const events = collectSymbolEvents(symbol, jobIds);
  const inWindow = events.filter((e) => (e._t as number) >= windowStart && (e._t as number) < windowEnd);
  const pool = inWindow.length ? inWindow : events;

  const firstOf = (pred: (e: Record<string, unknown>) => boolean) => {
    const e = pool.find(pred);
    return e ? String(e._ts) : null;
  };

  const blocking = pool.filter((e) => isBlocking(String(e.verdict ?? e.status ?? ""), String(e.reasonCode ?? "")));
  blocking.sort((a, b) => (a._t as number) - (b._t as number));
  const firstBlocker = blocking.length
    ? `${blocking[0].stage}|${blocking[0].reasonCode ?? blocking[0].verdict}|${String(blocking[0].reasonDetail ?? "").slice(0, 100)}`
    : pool.length
      ? "NO_BLOCKING_EVENT_IN_ARTIFACTS"
      : "NEVER_DISCOVERED";

  const allBlockers = [...new Set(blocking.map((e) => `${e.stage}:${e.reasonCode ?? e.verdict}`))];

  let classification = "L) INSUFFICIENT_EVIDENCE";
  if (!pool.length) classification = "A) NEVER_DISCOVERED";
  else if (firstBlocker.startsWith("scanner") || String(firstBlocker).includes("SPREAD") || String(firstBlocker).includes("SIM_TIGHT"))
    classification = String(firstBlocker).includes("DATA") ? "C) DISCOVERED_BUT_DATA_QUALITY_REJECTED" : "B) DISCOVERED_BUT_SCANNER_REJECTED";
  else if (String(firstBlocker).includes("TDI")) classification = "D) DISCOVERED_BUT_TDI_BLOCKED";
  else if (String(firstBlocker).includes("AI") || String(firstBlocker).includes("CONSENSUS")) classification = "E) DISCOVERED_BUT_AI_BLOCKED";
  else if (String(firstBlocker).includes("EV")) classification = "F) DISCOVERED_BUT_EV_BLOCKED";
  else if (String(firstBlocker).includes("risk")) classification = "G) DISCOVERED_BUT_RISK_BLOCKED";
  else if (String(firstBlocker).includes("execution")) classification = "I) DISCOVERED_BUT_EXECUTION_DELAY";

  const firstSeen = pool[0]?._t as number | undefined;
  let discoveredBeforeMove: "YES" | "NO" | "UNKNOWN" = "UNKNOWN";
  if (moveAt && firstSeen) {
    discoveredBeforeMove = firstSeen <= moveAt ? "YES" : "NO";
    if (discoveredBeforeMove === "NO") classification = "K) MARKET_MOVE_STARTED_BEFORE_DISCOVERY";
  }

  const firstScanner = firstOf((e) => String(e.stage).toLowerCase().includes("scanner"));
  const latencyMs = firstScanner && blocking[0] ? (blocking[0]._t as number) - Date.parse(firstScanner) : null;
  let latencyClass = "NO_LATENCY_EVIDENCE";
  if (latencyMs && latencyMs > 120_000 && moveAt && firstSeen && firstSeen < moveAt) latencyClass = "POSSIBLE_LATENCY_MISS";
  if (latencyMs && moveAt && (blocking[0]._t as number) > moveAt && firstSeen < moveAt) latencyClass = "CLEAR_LATENCY_MISS";

  const tdiRec = pool.find((e) => String(e.stage).includes("tdi") || e.technicalScore != null);
  const aiRec = pool.find((e) => String(e.stage).includes("ai"));
  const evRec = pool.find((e) => String(e.stage).includes("ev"));

  const windowReturn = 0; // filled later
  const missedOpportunityScore =
    pool.length && blocking.length
      ? Math.max(0, windowReturn) * (discoveredBeforeMove === "YES" ? 1.5 : 0.5) + (latencyMs ?? 0) / 1000
      : 0;

  return {
    symbol,
    discovered: pool.length > 0,
    firstScannerAt: firstScanner,
    firstCandidateAt: firstOf((e) => String(e.stage).toLowerCase().includes("candidate") || String(e.stage).includes("scanner")),
    firstTdiAt: firstOf((e) => String(e.stage).toLowerCase().includes("tdi") || String(e.reasonCode).includes("TDI")),
    firstAiAt: firstOf((e) => String(e.stage).toLowerCase().includes("ai")),
    firstEvAt: firstOf((e) => String(e.stage).toLowerCase().includes("ev")),
    firstConsensusAt: firstOf((e) => String(e.stage).toLowerCase().includes("consensus")),
    firstBlocker,
    allBlockers,
    classification,
    discoveredBeforeMove,
    firstMeaningfulMoveAt: moveAt ? new Date(moveAt).toISOString() : null,
    latencyMs,
    latencyClass,
    missedOpportunityScore,
    tdi: tdiRec
      ? {
          technicalScore: tdiRec.technicalScore,
          momentumScore: tdiRec.momentumScore,
          sentimentScore: tdiRec.sentimentScore,
          confidence: tdiRec.confidence,
          verdict: tdiRec.verdict,
          firstBlockingCondition: tdiRec.firstBlockingCondition,
          blockingConditions: tdiRec.blockingConditions,
        }
      : null,
    ai: aiRec ? { status: aiRec.status, reasonCode: aiRec.reasonCode, verdict: aiRec.verdict } : null,
    ev: evRec ? { verdict: evRec.verdict, expectedValue: evRec.expectedValue, reasonCode: evRec.reasonCode } : null,
    events: pool.slice(0, 30).map((e) => ({
      ts: e._ts,
      stage: e.stage,
      verdict: e.verdict ?? e.status,
      reasonCode: e.reasonCode,
      reasonDetail: String(e.reasonDetail ?? "").slice(0, 120),
      roundNo: e.roundNo,
    })),
  };
}

async function main() {
  const prisma = new PrismaClient();
  const forensicJobs = fs
    .readdirSync(path.join(ROOT, "artifacts", "forensics"))
    .filter((id) => fs.existsSync(path.join(ROOT, "artifacts", "forensics", id, "rounds")));

  const jobs = await prisma.autoRoundJob.findMany({
    where: { id: { in: forensicJobs.filter((id) => id.startsWith("cmt")) } },
    orderBy: { startedAt: "asc" },
  });

  const primaryJob = jobs.find((j) => j.id === PRIMARY_JOB) ?? (await prisma.autoRoundJob.findUnique({ where: { id: PRIMARY_JOB } }));
  const analysisJobs = primaryJob ? [primaryJob] : jobs.slice(-5);
  const jobIds = analysisJobs.map((j) => j.id);

  const intervals: Interval[] = [];
  const roundRows: Array<Record<string, unknown>> = [];

  for (const job of analysisJobs) {
    const runs = await prisma.autoRoundRun.findMany({ where: { jobId: job.id }, orderBy: { roundNo: "asc" } });
    for (const run of runs) {
      const start = run.startedAt.getTime();
      let end = run.endedAt?.getTime() ?? job.finishedAt?.getTime() ?? start + 60_000;
      if (!run.endedAt && run.roundNo === 11) end = job.finishedAt?.getTime() ?? Date.parse("2026-08-23T01:22:17.709Z");
      intervals.push({
        start,
        end,
        roundIds: [run.id],
        roundNos: [run.roundNo],
        jobId: job.id,
      });
      roundRows.push({
        jobId: job.id,
        runId: run.id,
        roundNo: run.roundNo,
        symbol: run.symbol,
        state: run.state,
        startedAt: run.startedAt.toISOString(),
        endedAt: run.endedAt?.toISOString() ?? null,
        durationMs: end - start,
      });
    }
  }

  const merged = mergeIntervals(intervals.filter((i) => i.jobId === PRIMARY_JOB));
  const windows = merged.map((w, idx) => ({ ...w, windowId: `W${idx + 1}` }));

  const runtimeCsvRows: string[][] = [
    ["windowId", "jobId", "roundIds", "roundNos", "startUTC", "endUTC", "startIstanbul", "endIstanbul", "durationMs", "sourceEvidence"],
  ];
  for (const w of windows) {
    runtimeCsvRows.push([
      w.windowId,
      w.jobId,
      w.roundIds.join(";"),
      w.roundNos.join(";"),
      new Date(w.start).toISOString(),
      new Date(w.end).toISOString(),
      fmtIstanbul(w.start),
      fmtIstanbul(w.end),
      String(w.end - w.start),
      "AutoRoundRun.startedAt/endedAt + job.finishedAt for zombie round",
    ]);
  }

  const symbols = loadTrySymbols();
  const byWindow: GainerRow[] = [];
  const klineCache = new Map<string, Kline[]>();

  for (const w of windows) {
    console.log(JSON.stringify({ phase: "MARKET_DATA", windowId: w.windowId, symbols: symbols.length }));
    const windowGainRows: Omit<GainerRow, "rankCloseToClose" | "rankMaxGain" | "rankOpenToHigh">[] = [];

    for (let i = 0; i < symbols.length; i++) {
      const sym = symbols[i];
      const key = `${sym}|${w.start}|${w.end}`;
      let klines = klineCache.get(key);
      if (!klines) {
        klines = await fetchKlines(sym, w.start, w.end);
        klineCache.set(key, klines);
      }
      const m = computeMetrics(klines);
      if (!m || m.open <= 0) {
        windowGainRows.push({
          symbol: sym,
          windowId: w.windowId,
          windowOpenPrice: 0,
          windowClosePrice: 0,
          windowHigh: 0,
          windowLow: 0,
          windowReturnPct: 0,
          maxIntrawindowGainPct: 0,
          maxIntrawindowDrawdownPct: 0,
          volume: 0,
          quoteVolume: 0,
          klineCount: klines.length,
          dataStatus: klines.length ? "ZERO_OPEN" : "NO_DATA",
        });
        continue;
      }
      windowGainRows.push({
        symbol: sym,
        windowId: w.windowId,
        windowOpenPrice: m.open,
        windowClosePrice: m.close,
        windowHigh: m.high,
        windowLow: m.low,
        windowReturnPct: m.windowReturnPct,
        maxIntrawindowGainPct: m.maxIntrawindowGainPct,
        maxIntrawindowDrawdownPct: m.maxIntrawindowDrawdownPct,
        volume: m.volume,
        quoteVolume: 0,
        klineCount: klines.length,
        dataStatus: "OK",
      });
      if (i % 20 === 19) await sleep(200);
    }

    const valid = windowGainRows.filter((r) => r.dataStatus === "OK");
    const rankC = [...valid].sort((a, b) => b.windowReturnPct - a.windowReturnPct);
    const rankM = [...valid].sort((a, b) => b.maxIntrawindowGainPct - a.maxIntrawindowGainPct);
    const rankH = [...valid].sort((a, b) => b.maxIntrawindowGainPct - a.maxIntrawindowGainPct);

    for (const row of windowGainRows) {
      byWindow.push({
        ...row,
        rankCloseToClose: rankC.findIndex((r) => r.symbol === row.symbol) + 1,
        rankMaxGain: rankM.findIndex((r) => r.symbol === row.symbol) + 1,
        rankOpenToHigh: rankH.findIndex((r) => r.symbol === row.symbol) + 1,
      });
    }
  }

  const globalMap = new Map<string, { symbol: string; windowsSeen: number; bestWindowReturn: number; bestMaxGain: number; avgReturn: number; totalVolume: number }>();
  for (const row of byWindow.filter((r) => r.dataStatus === "OK")) {
    const g = globalMap.get(row.symbol) ?? { symbol: row.symbol, windowsSeen: 0, bestWindowReturn: -999, bestMaxGain: -999, avgReturn: 0, totalVolume: 0 };
    g.windowsSeen += 1;
    g.bestWindowReturn = Math.max(g.bestWindowReturn, row.windowReturnPct);
    g.bestMaxGain = Math.max(g.bestMaxGain, row.maxIntrawindowGainPct);
    g.avgReturn += row.windowReturnPct;
    g.totalVolume += row.volume;
    globalMap.set(row.symbol, g);
  }

  const globalRanked = [...globalMap.values()]
    .map((g) => ({ ...g, avgReturn: g.windowsSeen ? g.avgReturn / g.windowsSeen : 0 }))
    .sort((a, b) => b.bestMaxGain - a.bestMaxGain);

  const top50 = globalRanked.slice(0, Math.min(TOP_CAP, globalRanked.length));
  const primaryWindow = windows[0];
  const traces: SymbolTrace[] = [];

  for (const g of top50) {
    const key = `${g.symbol}|${primaryWindow.start}|${primaryWindow.end}`;
    const klines = klineCache.get(key) ?? [];
    const moveAt = firstMeaningfulMove(klines, MEANINGFUL_MOVE_PCT);
    const trace = buildTrace(g.symbol, jobIds, primaryWindow.start, primaryWindow.end, moveAt);
    trace.missedOpportunityScore =
      g.bestMaxGain * (trace.discoveredBeforeMove === "YES" ? 2 : trace.discovered ? 0.5 : 0) +
      (trace.latencyMs ?? 0) / 5000;
    traces.push(trace);
  }

  traces.sort((a, b) => b.missedOpportunityScore - a.missedOpportunityScore);

  const blockerCounts: Record<string, number> = {};
  for (const t of traces) {
    const key = t.classification.split(")")[0] + ")";
    blockerCounts[key] = (blockerCounts[key] ?? 0) + 1;
  }

  const totalRuntimeMs = windows.reduce((a, w) => a + (w.end - w.start), 0);
  const discovered = traces.filter((t) => t.discovered).length;
  const neverDisc = traces.filter((t) => !t.discovered).length;
  const scannerBlocked = traces.filter((t) => t.classification.startsWith("B)")).length;
  const tdiBlocked = traces.filter((t) => t.classification.startsWith("D)")).length;
  const aiBlocked = traces.filter((t) => t.classification.startsWith("E)")).length;
  const evBlocked = traces.filter((t) => t.classification.startsWith("F)")).length;
  const moveBefore = traces.filter((t) => t.classification.startsWith("K)")).length;
  const clearLatency = traces.filter((t) => t.latencyClass === "CLEAR_LATENCY_MISS").length;
  const dataQuality = traces.filter((t) => t.classification.startsWith("C)")).length;

  const rootCauseCounts: Record<string, number> = {
    SCANNER_DISCOVERY: neverDisc,
    SCANNER_QUALITY_FILTER: scannerBlocked,
    DATA_QUALITY: dataQuality,
    TDI_OVERFILTER: tdiBlocked,
    AI_OVERFILTER: aiBlocked,
    EV_OVERFILTER: evBlocked,
    MARKET_TIMING: moveBefore,
    MIXED: traces.filter((t) => t.discovered && !t.classification.startsWith("A")).length - scannerBlocked - tdiBlocked - aiBlocked,
  };
  const rootSorted = Object.entries(rootCauseCounts).sort((a, b) => b[1] - a[1]);
  const topRoot = rootSorted[0]?.[0] ?? "UNKNOWN";
  const topRootShare = traces.length ? (rootSorted[0]?.[1] ?? 0) / traces.length : 0;

  // Campaign correlation
  const campaignRuns = await prisma.autoRoundRun.findMany({ where: { jobId: PRIMARY_JOB, roundNo: { lte: 10 } } });
  const campaignSymbols = new Set(top50.map((t) => t.symbol));

  const jsonOut = {
    generatedAt: new Date().toISOString(),
    timezone: "Europe/Istanbul (exchange-info + UTC artifacts)",
    primaryJob: PRIMARY_JOB,
    runtimeWindows: windows.map((w) => ({
      windowId: w.windowId,
      jobId: w.jobId,
      startUTC: new Date(w.start).toISOString(),
      endUTC: new Date(w.end).toISOString(),
      durationMs: w.end - w.start,
      roundNos: w.roundNos,
    })),
    marketDataInterval: KLINE_INTERVAL,
    validTryPairs: symbols.length,
    topGainersAnalyzed: top50.length,
    meaningfulMoveThresholdPct: MEANINGFUL_MOVE_PCT,
    traces,
    blockerDistribution: blockerCounts,
    systemicRootCauses: rootCauseCounts,
    campaignCorrelation: {
      roundsTerminal: campaignRuns.length,
      trades: 0,
      top50InRuntime: top50.filter((g) => traces.find((t) => t.symbol === g.symbol)?.discovered).length,
      top50Seen: discovered,
      top50Blocked: traces.filter((t) => t.discovered && t.firstBlocker !== "NEVER_DISCOVERED").length,
      top50ReachedAi: traces.filter((t) => t.firstAiAt).length,
      top50ReachedEv: traces.filter((t) => t.firstEvAt).length,
      executionReady: 0,
    },
    verdict: {
      RUNTIME_WINDOWS: windows.length,
      TOTAL_RUNTIME_MINUTES: Math.round(totalRuntimeMs / 60000),
      TOP_GAINERS_ANALYZED: top50.length,
      VALID_BINANCE_TR_PAIRS: symbols.length,
      TOP_GAINER_DISCOVERED: discovered,
      TOP_GAINER_NEVER_DISCOVERED: neverDisc,
      TOP_GAINER_SCANNER_BLOCKED: scannerBlocked,
      TOP_GAINER_TDI_BLOCKED: tdiBlocked,
      TOP_GAINER_AI_BLOCKED: aiBlocked,
      TOP_GAINER_EV_BLOCKED: evBlocked,
      TOP_GAINER_MOVE_BEFORE_DISCOVERY: moveBefore,
      CLEAR_LATENCY_MISSES: clearLatency,
      TOP_SYSTEMIC_ROOT_CAUSE: topRoot,
      TOP_SYSTEMIC_ROOT_CAUSE_SHARE: topRootShare,
      EVIDENCE_CONFIDENCE: discovered > 10 ? "MEDIUM" : "LOW",
      PRODUCTION_CHANGE_RECOMMENDED: "NO",
    },
  };

  fs.writeFileSync(path.join(ROOT, "kripto-runtime-windows.csv"), toCsv(runtimeCsvRows), "utf8");
  fs.writeFileSync(
    path.join(ROOT, "kripto-top-gainers-by-window.csv"),
    toCsv([
      ["windowId", "symbol", "open", "close", "high", "low", "returnPct", "maxGainPct", "maxDrawdownPct", "volume", "klineCount", "rankClose", "rankMaxGain", "dataStatus"],
      ...byWindow.map((r) => [
        r.windowId,
        r.symbol,
        String(r.windowOpenPrice),
        String(r.windowClosePrice),
        String(r.windowHigh),
        String(r.windowLow),
        String(r.windowReturnPct),
        String(r.maxIntrawindowGainPct),
        String(r.maxIntrawindowDrawdownPct),
        String(r.volume),
        String(r.klineCount),
        String(r.rankCloseToClose),
        String(r.rankMaxGain),
        r.dataStatus,
      ]),
    ]),
    "utf8",
  );
  fs.writeFileSync(
    path.join(ROOT, "kripto-top-gainers-global.csv"),
    toCsv([
      ["symbol", "windowsSeen", "bestWindowReturn", "bestMaxGain", "avgReturn", "totalVolume"],
      ...globalRanked.map((g) => [g.symbol, String(g.windowsSeen), String(g.bestWindowReturn), String(g.bestMaxGain), String(g.avgReturn), String(g.totalVolume)]),
    ]),
    "utf8",
  );
  fs.writeFileSync(
    path.join(ROOT, "kripto-top50-decision-traces.csv"),
    toCsv([
      ["symbol", "discovered", "firstScanner", "firstTdi", "firstAi", "firstEv", "firstBlocker", "classification", "discoveredBeforeMove", "latencyClass", "missedScore"],
      ...traces.map((t) => [
        t.symbol,
        String(t.discovered),
        t.firstScannerAt ?? "",
        t.firstTdiAt ?? "",
        t.firstAiAt ?? "",
        t.firstEvAt ?? "",
        t.firstBlocker.slice(0, 150),
        t.classification,
        t.discoveredBeforeMove,
        t.latencyClass,
        String(t.missedOpportunityScore),
      ]),
    ]),
    "utf8",
  );
  fs.writeFileSync(
    path.join(ROOT, "kripto-top50-missed-opportunities.csv"),
    toCsv([
      ["rank", "symbol", "bestMaxGain", "classification", "firstBlocker", "discoveredBeforeMove", "missedScore"],
      ...traces.map((t, i) => [
        String(i + 1),
        t.symbol,
        String(globalMap.get(t.symbol)?.bestMaxGain ?? ""),
        t.classification,
        t.firstBlocker.slice(0, 120),
        t.discoveredBeforeMove,
        String(t.missedOpportunityScore),
      ]),
    ]),
    "utf8",
  );
  fs.writeFileSync(
    path.join(ROOT, "kripto-blocker-distribution.csv"),
    toCsv([
      ["blocker", "count", "pct"],
      ...Object.entries(blockerCounts).map(([k, v]) => [k, String(v), String((v / traces.length) * 100)]),
    ]),
    "utf8",
  );
  fs.writeFileSync(
    path.join(ROOT, "kripto-latency-analysis.csv"),
    toCsv([
      ["symbol", "latencyMs", "latencyClass", "firstScanner", "firstBlocker"],
      ...traces.map((t) => [t.symbol, String(t.latencyMs ?? ""), t.latencyClass, t.firstScannerAt ?? "", t.firstBlocker.slice(0, 80)]),
    ]),
    "utf8",
  );
  fs.writeFileSync(
    path.join(ROOT, "kripto-top10-missed-opportunities.csv"),
    toCsv([
      ["rank", "symbol", "maxGain", "firstSeen", "firstBlocker", "classification", "whyMissed", "confidence"],
      ...traces.slice(0, 10).map((t, i) => [
        String(i + 1),
        t.symbol,
        String(globalMap.get(t.symbol)?.bestMaxGain ?? ""),
        t.firstScannerAt ?? "NEVER",
        t.firstBlocker.slice(0, 100),
        t.classification,
        t.discovered ? `Blocked at ${t.firstBlocker.split("|")[0]}` : "Not in forensic artifacts",
        "MEDIUM",
      ]),
    ]),
    "utf8",
  );
  fs.writeFileSync(path.join(ROOT, "kripto-systemic-root-causes.json"), JSON.stringify(rootCauseCounts, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(ROOT, "kripto-global-missed-opportunity-forensic.json"), JSON.stringify(jsonOut, null, 2) + "\n", "utf8");

  const md = buildMd(jsonOut, traces, windows, top50, globalRanked.slice(0, 10));
  fs.writeFileSync(path.join(ROOT, "KRIPTO_GLOBAL_MISSED_OPPORTUNITY_FORENSIC.md"), md, "utf8");

  console.log(JSON.stringify({ ok: true, windows: windows.length, top50: top50.length, discovered, topRoot }));
  await prisma.$disconnect();
}

function buildMd(
  json: Record<string, unknown>,
  traces: SymbolTrace[],
  windows: Array<{ windowId: string; start: number; end: number; roundNos: number[] }>,
  top50: Array<{ symbol: string; bestMaxGain: number; bestWindowReturn: number }>,
  top10Global: Array<{ symbol: string; bestMaxGain: number }>,
) {
  const v = json.verdict as Record<string, unknown>;
  return [
    "# KRIPTO — GLOBAL MISSED-OPPORTUNITY FORENSIC",
    "",
    `> Generated: ${json.generatedAt}`,
    "> Research only — no policy/runtime changes",
    "",
    "## PART 1–2 — Runtime Windows",
    "",
    `- **Primary job**: ${PRIMARY_JOB}`,
    `- **Timezone**: Europe/Istanbul (exchange-info); artifacts UTC`,
    `- **Merged windows**: ${windows.length}`,
    `- **Total runtime**: ${v.TOTAL_RUNTIME_MINUTES} minutes`,
    "",
    windows.map((w) => `- **${w.windowId}**: ${fmtIstanbul(w.start)} → ${fmtIstanbul(w.end)} (rounds ${w.roundNos.join(",")})`).join("\n"),
    "",
    "## PART 4–6 — Binance TR Market Data",
    "",
    `- **Interval**: ${KLINE_INTERVAL} klines via api.binance.me / www.binance.tr`,
    `- **Valid TRY pairs**: ${v.VALID_BINANCE_TR_PAIRS}`,
    `- **Top gainers analyzed**: ${v.TOP_GAINERS_ANALYZED}`,
    "",
    "### Global top 10 by max intrawindow gain",
    "",
    "| Rank | Symbol | Best max gain % | Best close-to-close % |",
    "|------|--------|-----------------|----------------------|",
    ...top10Global.map((g, i) => `| ${i + 1} | ${g.symbol} | ${g.bestMaxGain.toFixed(2)} | ${top50.find((t) => t.symbol === g.symbol)?.bestWindowReturn?.toFixed(2) ?? "—"} |`),
    "",
    "## PART 7–16 — Decision Trace Summary (Top 50)",
    "",
    `- **Discovered by engine**: ${v.TOP_GAINER_DISCOVERED}`,
    `- **Never discovered**: ${v.TOP_GAINER_NEVER_DISCOVERED}`,
    `- **Scanner blocked**: ${v.TOP_GAINER_SCANNER_BLOCKED}`,
    `- **TDI blocked**: ${v.TOP_GAINER_TDI_BLOCKED}`,
    `- **AI blocked**: ${v.TOP_GAINER_AI_BLOCKED}`,
    `- **EV blocked**: ${v.TOP_GAINER_EV_BLOCKED}`,
    `- **Move before discovery**: ${v.TOP_GAINER_MOVE_BEFORE_DISCOVERY}`,
    "",
    "### Top 10 missed-opportunity ranking",
    "",
    "| Rank | Symbol | Max gain % | Classification | First blocker |",
    "|------|--------|------------|----------------|---------------|",
    ...traces.slice(0, 10).map((t, i) => `| ${i + 1} | ${t.symbol} | ${top50.find((g) => g.symbol === t.symbol)?.bestMaxGain?.toFixed(2) ?? "—"} | ${t.classification} | ${t.firstBlocker.slice(0, 60)} |`),
    "",
    "## PART 24 — 10-Round Campaign Correlation",
    "",
    JSON.stringify(json.campaignCorrelation, null, 2),
    "",
    "## FINAL VERDICT",
    "",
    "```",
    `RUNTIME_WINDOWS = ${v.RUNTIME_WINDOWS}`,
    `TOTAL_RUNTIME_MINUTES = ${v.TOTAL_RUNTIME_MINUTES}`,
    `TOTAL_RUNTIME_COVERAGE = ${windows.length} merged window(s) covering overnight paper job active intervals`,
    `TOP_GAINERS_ANALYZED = ${v.TOP_GAINERS_ANALYZED}`,
    `VALID_BINANCE_TR_PAIRS = ${v.VALID_BINANCE_TR_PAIRS}`,
    `TOP_GAINER_COUNT_CAP = ${TOP_CAP}`,
    `TOP_GAINER_MARKET_DATA_INTERVAL = ${KLINE_INTERVAL}`,
    `TOP_GAINER_DISCOVERED = ${v.TOP_GAINER_DISCOVERED}`,
    `TOP_GAINER_NEVER_DISCOVERED = ${v.TOP_GAINER_NEVER_DISCOVERED}`,
    `TOP_GAINER_SCANNER_BLOCKED = ${v.TOP_GAINER_SCANNER_BLOCKED}`,
    `TOP_GAINER_TDI_BLOCKED = ${v.TOP_GAINER_TDI_BLOCKED}`,
    `TOP_GAINER_AI_BLOCKED = ${v.TOP_GAINER_AI_BLOCKED}`,
    `TOP_GAINER_EV_BLOCKED = ${v.TOP_GAINER_EV_BLOCKED}`,
    `TOP_GAINER_MOVE_BEFORE_DISCOVERY = ${v.TOP_GAINER_MOVE_BEFORE_DISCOVERY}`,
    `CLEAR_LATENCY_MISSES = ${v.CLEAR_LATENCY_MISSES}`,
    `TOP_SYSTEMIC_ROOT_CAUSE = ${v.TOP_SYSTEMIC_ROOT_CAUSE}`,
    `TOP_SYSTEMIC_ROOT_CAUSE_SHARE = ${Number(v.TOP_SYSTEMIC_ROOT_CAUSE_SHARE).toFixed(2)}`,
    `EVIDENCE_CONFIDENCE = ${v.EVIDENCE_CONFIDENCE}`,
    `PRODUCTION_CHANGE_RECOMMENDED = ${v.PRODUCTION_CHANGE_RECOMMENDED}`,
    `NEXT_ENGINEERING_TASK = Scanner discovery coverage + reject reason forensics on top gainers; no threshold changes until outcome labeling validated`,
    "```",
    "",
  ].join("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
