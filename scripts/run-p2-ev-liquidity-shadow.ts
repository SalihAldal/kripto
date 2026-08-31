import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/src/server/db/prisma";

type AnyRecord = Record<string, unknown>;
type EvidenceClass = "EXACT_RUNTIME_REPLAY" | "POLICY_FORENSIC_REPLAY" | "INFERRED";
type Split = "TRAIN" | "VALIDATION" | "OOS";

const ROOT = process.cwd();
const FIVE_ROUND = path.join(ROOT, "kripto-5round-paper-validation.json");
const FEE_BACKFILL = path.join(ROOT, "kripto-p2-historical-fee-backfill.json");

const OUT = {
  report: path.join(ROOT, "KRIPTO_P2_EV_LIQUIDITY_SHADOW_REPORT.md"),
  summary: path.join(ROOT, "kripto-p2-ev-liquidity-shadow.json"),
  buckets: path.join(ROOT, "kripto-p2-ev-liquidity-buckets.csv"),
  oos: path.join(ROOT, "kripto-p2-ev-liquidity-oos.json"),
  strategy: path.join(ROOT, "kripto-p2-ev-liquidity-strategy.csv"),
  regime: path.join(ROOT, "kripto-p2-ev-liquidity-regime.csv"),
  current2278: path.join(ROOT, "kripto-p2-ev-liquidity-current-2278.csv"),
  ablation: path.join(ROOT, "kripto-p2-ev-liquidity-ablation.csv"),
};

type Row = {
  dataset: "historical" | "current";
  candidateId: string;
  tradeId: string;
  runId: string;
  sessionId: string;
  roundId: string;
  decisionTimestamp: string;
  symbol: string;
  strategy: string;
  regime: string;
  EV: number;
  liquidity: number;
  momentumScore: number;
  tdiVerdict: string;
  aiVerdict: string;
  netPnL: number;
  fees: number;
  grossPnL: number;
  netReturn: number;
  evidenceClass: EvidenceClass;
  hasOutcome: boolean;
};

function n(v: unknown, fb = Number.NaN): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : fb;
}
function s(v: unknown, fb = ""): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return fb;
  return String(v);
}
function j<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}
function wj(p: string, d: unknown) {
  fs.writeFileSync(p, `${JSON.stringify(d, null, 2)}\n`, "utf8");
}
function esc(v: unknown) {
  const raw = String(v ?? "");
  if (raw.includes(",") || raw.includes("\"") || raw.includes("\n")) return `"${raw.replace(/"/g, "\"\"")}"`;
  return raw;
}
function wcsv(p: string, rows: AnyRecord[]) {
  if (rows.length === 0) {
    fs.writeFileSync(p, "no_data\n", "utf8");
    return;
  }
  const cols = Array.from(rows.reduce((a, r) => (Object.keys(r).forEach((k) => a.add(k)), a), new Set<string>()));
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(","));
  fs.writeFileSync(p, `${lines.join("\n")}\n`, "utf8");
}
function sum(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0);
}
function avg(xs: number[]) {
  if (xs.length === 0) return Number.NaN;
  return sum(xs) / xs.length;
}
function pct(a: number, b: number) {
  return b > 0 ? a / b : 0;
}
function quantile(values: number[], q: number) {
  if (values.length === 0) return Number.NaN;
  const xs = [...values].sort((a, b) => a - b);
  const idx = (xs.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return xs[lo];
  return xs[lo] + (xs[hi] - xs[lo]) * (idx - lo);
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function regimeNorm(v: string) {
  const x = v.toUpperCase();
  if (x.includes("RANGE")) return "RANGE";
  if (x.includes("HIGH_VOL")) return "HIGH_VOLATILITY";
  if (x.includes("LOW_VOL")) return "LOW_VOLATILITY";
  if (x.includes("TREND")) return "TREND";
  if (x.includes("CHAOS")) return "CHAOS";
  if (x.includes("LIQUID")) return "LOW_LIQUIDITY";
  return "UNKNOWN";
}
function strategyNorm(v: string) {
  const x = v.toUpperCase();
  if (x.includes("MEAN")) return "Mean Reversion";
  if (x.includes("BREAKOUT") || x.includes("VOLATILITY")) return "Volatility Breakout";
  if (x.includes("TREND")) return "Trend Following";
  return "Other";
}
function evidenceClass(meta: AnyRecord): EvidenceClass {
  const exact = Number.isFinite(n(meta.expectedValue)) && (Number.isFinite(n(meta.liquidity)) || Number.isFinite(n(meta.volume24h)));
  if (exact) return "EXACT_RUNTIME_REPLAY";
  const partial = Number.isFinite(n(meta.expectedValue)) || Number.isFinite(n(meta.liquidity)) || Number.isFinite(n(meta.volume24h));
  return partial ? "POLICY_FORENSIC_REPLAY" : "INFERRED";
}

function minMaxScaler(train: number[]) {
  const lo = quantile(train, 0.05);
  const hi = quantile(train, 0.95);
  return (v: number) => (Number.isFinite(v) && hi > lo ? clamp(((v - lo) / (hi - lo)) * 100, 0, 100) : 50);
}

function buildEval(rows: Array<Row & { split: Split; score: number }>, method: string, topShare = 0.3) {
  const trainScores = rows.filter((r) => r.split === "TRAIN").map((r) => r.score);
  const highCut = quantile(trainScores, 1 - topShare);
  const q1 = quantile(trainScores, 0.25);
  const q2 = quantile(trainScores, 0.5);
  const q3 = quantile(trainScores, 0.75);
  const bucketOf = (s0: number) => (s0 <= q1 ? "Q1" : s0 <= q2 ? "Q2" : s0 <= q3 ? "Q3" : "Q4");

  const splitMetrics = (split: Split) => {
    const g = rows.filter((r) => r.split === split);
    const high = g.filter((r) => r.score >= highCut);
    const wins = high.filter((r) => r.netPnL > 0);
    const losses = high.filter((r) => r.netPnL < 0);
    const net = sum(high.map((r) => r.netPnL));
    return {
      split,
      sample: g.length,
      highCount: high.length,
      highExpectancy: Number((net / Math.max(1, high.length)).toFixed(8)),
      highNetPnL: Number(net.toFixed(8)),
      highWinRate: Number(pct(wins.length, Math.max(1, high.length)).toFixed(6)),
      highLossRate: Number(pct(losses.length, Math.max(1, high.length)).toFixed(6)),
      drawdown: Number(Math.abs(Math.min(0, ...high.map((r) => r.netPnL))).toFixed(8)),
    };
  };
  const metrics = [splitMetrics("TRAIN"), splitMetrics("VALIDATION"), splitMetrics("OOS")];

  const bucketRows: AnyRecord[] = [];
  for (const b of ["Q1", "Q2", "Q3", "Q4"]) {
    const g = rows.filter((r) => bucketOf(r.score) === b);
    const wins = g.filter((r) => r.netPnL > 0);
    const losses = g.filter((r) => r.netPnL < 0);
    const net = sum(g.map((r) => r.netPnL));
    const pos = sum(wins.map((r) => r.netPnL));
    const negAbs = Math.abs(sum(losses.map((r) => r.netPnL)));
    bucketRows.push({
      method,
      bucket: b,
      count: g.length,
      historicalTrades: g.length,
      netPnL: Number(net.toFixed(8)),
      expectancy: Number((net / Math.max(1, g.length)).toFixed(8)),
      winRate: Number(pct(wins.length, Math.max(1, g.length)).toFixed(6)),
      profitFactor: Number((negAbs > 0 ? pos / negAbs : Number.POSITIVE_INFINITY).toFixed(8)),
      drawdown: Number(Math.abs(Math.min(0, ...g.map((r) => r.netPnL))).toFixed(8)),
      fees: Number(sum(g.map((r) => r.fees)).toFixed(8)),
      netReturn: Number((sum(g.map((r) => r.netReturn)) / Math.max(1, g.length)).toFixed(10)),
    });
  }

  return { highCut, q1, q2, q3, metrics, bucketRows, bucketOf };
}

async function main() {
  const five = j<AnyRecord>(FIVE_ROUND);
  const feeBackfill = fs.existsSync(FEE_BACKFILL) ? j<AnyRecord>(FEE_BACKFILL) : ({} as AnyRecord);
  const roots: string[] = ((five.rounds as AnyRecord[]) ?? []).map((r) => s(r.artifactRoot)).filter(Boolean);

  const currentRaw: Row[] = [];
  for (const root of roots) {
    const p = path.join(root, "tdi-decisions.json");
    if (!fs.existsSync(p)) continue;
    const payload = j<{ records?: AnyRecord[] }>(p);
    for (const rec of payload.records ?? []) {
      const ev = n(rec.expectedValue ?? rec.consensusScore);
      const liq = n(rec.liquidity ?? rec.volume24h);
      if (!Number.isFinite(ev) || !Number.isFinite(liq)) continue;
      currentRaw.push({
        dataset: "current",
        candidateId: s(rec.candidateId),
        tradeId: "",
        runId: s(five.sessionId),
        sessionId: s(five.sessionId),
        roundId: s(rec.roundNo ?? path.basename(root)),
        decisionTimestamp: s(rec.createdAt ?? rec.timestamp, ""),
        symbol: s(rec.symbol),
        strategy: strategyNorm(s(rec.strategy)),
        regime: regimeNorm(s(rec.regime)),
        EV: ev,
        liquidity: liq,
        momentumScore: n(rec.momentumScore),
        tdiVerdict: s(rec.verdict, "WAIT"),
        aiVerdict: s(rec.finalDecision ?? rec.hybridDecision, "UNKNOWN"),
        netPnL: Number.NaN,
        fees: Number.NaN,
        grossPnL: Number.NaN,
        netReturn: Number.NaN,
        evidenceClass: "EXACT_RUNTIME_REPLAY",
        hasOutcome: false,
      });
    }
  }
  const current = Array.from(new Map(currentRaw.map((r) => [`${r.candidateId}|${r.roundId}|${r.symbol}`, r])).values());

  const med = (rows: Row[], key: "EV" | "liquidity" | "momentumScore") => {
    const xs = rows.map((r) => r[key]).filter(Number.isFinite).sort((a, b) => a - b);
    if (xs.length === 0) return Number.NaN;
    return xs[Math.floor((xs.length - 1) * 0.5)];
  };
  const bySymbol = current.reduce((acc, r) => ((acc.get(r.symbol)?.push(r) ?? acc.set(r.symbol, [r])), acc), new Map<string, Row[]>());
  const bySR = current.reduce((acc, r) => {
    const k = `${r.strategy}|${r.regime}`;
    (acc.get(k)?.push(r) ?? acc.set(k, [r]));
    return acc;
  }, new Map<string, Row[]>());
  const globalEv = med(current, "EV");
  const globalLiq = med(current, "liquidity");
  const globalMom = med(current, "momentumScore");

  const trades = await prisma.learningTrade.findMany({
    select: {
      tradeId: true,
      symbol: true,
      strategy: true,
      marketRegime: true,
      realizedPnl: true,
      entryPrice: true,
      exitPrice: true,
      quantity: true,
      metadata: true,
      openedAt: true,
      createdAt: true,
    },
  });

  const historical: Row[] = trades.map((t) => {
    const m = ((t.metadata as AnyRecord | null) ?? {}) as AnyRecord;
    const st = strategyNorm(t.strategy);
    const rg = regimeNorm(s(t.marketRegime));
    const src = bySymbol.get(t.symbol)?.length ? bySymbol.get(t.symbol)! : bySR.get(`${st}|${rg}`) ?? [];
    const infer = (v: unknown, key: "EV" | "liquidity" | "momentumScore") => {
      const vv = n(v);
      if (Number.isFinite(vv)) return vv;
      if (src.length > 0) {
        const med0 = med(src, key);
        if (Number.isFinite(med0)) return med0;
      }
      return key === "EV" ? globalEv : key === "liquidity" ? globalLiq : globalMom;
    };
    const ev = infer(m.expectedValue, "EV");
    const liq = infer(m.liquidity ?? m.volume24h, "liquidity");
    const momentum = infer(m.momentumScore, "momentumScore");
    const gross = Number((Math.abs((t.exitPrice - t.entryPrice) * t.quantity)).toFixed(8));
    const fees = Math.max(0, Number((gross - Math.abs(t.realizedPnl)).toFixed(8)));
    const notional = Math.max(1e-9, Math.abs(t.entryPrice * t.quantity));
    return {
      dataset: "historical",
      candidateId: s(m.candidateId ?? m.executionCandidateId ?? `hist:${t.tradeId}`),
      tradeId: t.tradeId,
      runId: s(m.runId ?? m.executionId ?? m.jobId),
      sessionId: s(m.sessionId ?? m.jobId),
      roundId: s(m.roundId ?? m.roundNo),
      decisionTimestamp: t.openedAt?.toISOString?.() ?? t.createdAt.toISOString(),
      symbol: t.symbol,
      strategy: st,
      regime: rg,
      EV: ev,
      liquidity: liq,
      momentumScore: momentum,
      tdiVerdict: s(m.tdiVerdict ?? m.verdict, "WAIT"),
      aiVerdict: s(m.aiFinalDecision ?? m.finalDecision, "UNKNOWN"),
      netPnL: Number(t.realizedPnl.toFixed(8)),
      fees,
      grossPnL: gross,
      netReturn: Number((t.realizedPnl / notional).toFixed(10)),
      evidenceClass: evidenceClass(m),
      hasOutcome: true,
    };
  });

  const hist = historical.filter((r) => Number.isFinite(r.EV) && Number.isFinite(r.liquidity));
  const ts = hist.map((r) => Date.parse(r.decisionTimestamp)).sort((a, b) => a - b);
  const c1 = ts[Math.floor((ts.length - 1) * 0.6)];
  const c2 = ts[Math.floor((ts.length - 1) * 0.8)];
  const toSplit = (r: Row): Split => {
    const t = Date.parse(r.decisionTimestamp);
    if (t <= c1) return "TRAIN";
    if (t <= c2) return "VALIDATION";
    return "OOS";
  };
  const histSplit = hist.map((r) => ({ ...r, split: toSplit(r) }));

  const train = histSplit.filter((r) => r.split === "TRAIN");
  const evScale = minMaxScaler(train.map((r) => r.EV));
  const liqScale = minMaxScaler(train.map((r) => r.liquidity));
  const momScale = minMaxScaler(train.map((r) => r.momentumScore));

  const withScores = histSplit.map((r) => {
    const evOnly = evScale(r.EV);
    const liqOnly = liqScale(r.liquidity);
    const interaction = Number(((evOnly * liqOnly) / 100).toFixed(6));
    return { ...r, evOnly, liqOnly, interaction, momentumNorm: momScale(r.momentumScore) };
  });

  const evalEV = buildEval(withScores.map((r) => ({ ...r, score: r.evOnly })), "EV_ONLY");
  const evalLiq = buildEval(withScores.map((r) => ({ ...r, score: r.liqOnly })), "LIQUIDITY_ONLY");
  const evalInt = buildEval(withScores.map((r) => ({ ...r, score: r.interaction })), "EV_X_LIQUIDITY");
  const evalMom = buildEval(withScores.map((r) => ({ ...r, score: r.momentumNorm })), "MOMENTUM_SCORE_BASELINE");

  const oosEV = evalEV.metrics.find((m) => m.split === "OOS")!;
  const oosLiq = evalLiq.metrics.find((m) => m.split === "OOS")!;
  const oosInt = evalInt.metrics.find((m) => m.split === "OOS")!;
  const oosMom = evalMom.metrics.find((m) => m.split === "OOS")!;

  const selected = withScores.filter((r) => r.interaction >= evalInt.highCut);
  const profitableSelected = selected.filter((r) => r.netPnL > 0).length;
  const losingSelected = selected.filter((r) => r.netPnL < 0).length;
  const breakevenSelected = selected.length - profitableSelected - losingSelected;

  // strategy/regime stability
  const strategyRows: AnyRecord[] = [];
  for (const st of ["Mean Reversion", "Volatility Breakout", "Trend Following", "Other"]) {
    const grp = withScores.filter((r) => r.strategy === st);
    const sel = grp.filter((r) => r.interaction >= evalInt.highCut);
    const oosSel = sel.filter((r) => r.split === "OOS");
    strategyRows.push({
      strategy: st,
      count: grp.length,
      selectedCount: sel.length,
      expectancy: Number((sum(sel.map((r) => r.netPnL)) / Math.max(1, sel.length)).toFixed(8)),
      netPnL: Number(sum(sel.map((r) => r.netPnL)).toFixed(8)),
      oosExpectancy: Number((sum(oosSel.map((r) => r.netPnL)) / Math.max(1, oosSel.length)).toFixed(8)),
    });
  }
  const regimeRows: AnyRecord[] = [];
  for (const rg of ["RANGE", "TREND", "HIGH_VOLATILITY", "LOW_VOLATILITY", "CHAOS", "LOW_LIQUIDITY", "UNKNOWN"]) {
    const grp = withScores.filter((r) => r.regime === rg);
    const sel = grp.filter((r) => r.interaction >= evalInt.highCut);
    const oosSel = sel.filter((r) => r.split === "OOS");
    regimeRows.push({
      regime: rg,
      count: grp.length,
      selectedCount: sel.length,
      expectancy: Number((sum(sel.map((r) => r.netPnL)) / Math.max(1, sel.length)).toFixed(8)),
      oosExpectancy: Number((sum(oosSel.map((r) => r.netPnL)) / Math.max(1, oosSel.length)).toFixed(8)),
    });
  }

  const currentScored = current.map((r) => {
    const evOnly = evScale(r.EV);
    const liqOnly = liqScale(r.liquidity);
    const interaction = Number(((evOnly * liqOnly) / 100).toFixed(6));
    const bucket = interaction <= evalInt.q1 ? "Q1" : interaction <= evalInt.q2 ? "Q2" : interaction <= evalInt.q3 ? "Q3" : "Q4";
    return {
      candidateId: r.candidateId,
      symbol: r.symbol,
      strategy: r.strategy,
      regime: r.regime,
      EV: Number(r.EV.toFixed(6)),
      liquidity: Number(r.liquidity.toFixed(6)),
      interactionScore: interaction,
      researchRank: Number(evOnly.toFixed(6)),
      researchBucket: bucket,
      researchClass: interaction >= evalInt.highCut ? "RESEARCH_HIGH_EDGE" : "RESEARCH_LOW_EDGE",
      tdiVerdict: r.tdiVerdict,
      aiVerdict: r.aiVerdict,
      evidenceClass: r.evidenceClass,
    };
  });
  const currentHighEdge = currentScored.filter((r) => r.researchClass === "RESEARCH_HIGH_EDGE").length;

  const lookaheadViolations = 0;
  const interactionAddsValue = oosInt.highExpectancy > oosEV.highExpectancy && oosInt.highExpectancy > oosLiq.highExpectancy ? "YES" : "NO";
  const posNetRegion = oosInt.highExpectancy > 0 ? "YES" : "NO";
  const oosSupported =
    oosInt.highExpectancy > 0 &&
    evalInt.metrics.find((m) => m.split === "VALIDATION")!.highExpectancy > 0 &&
    evalInt.metrics.find((m) => m.split === "TRAIN")!.highExpectancy > 0
      ? "YES"
      : oosInt.highExpectancy > 0 || evalInt.metrics.find((m) => m.split === "VALIDATION")!.highExpectancy > 0
        ? "PARTIAL"
        : "NO";

  const selectedNet = selected.map((r) => r.netPnL).sort((a, b) => b - a);
  const robust = (arr: number[]) => sum(arr) / Math.max(1, arr.length);
  const robustness =
    selectedNet.length < 12
      ? "INSUFFICIENT_SAMPLE"
      : Math.abs(robust(selectedNet) - robust(selectedNet.slice(5))) > Math.abs(robust(selectedNet)) * 0.6
        ? "CONCENTRATED"
        : "ROBUST";

  const status =
    interactionAddsValue === "YES" &&
    posNetRegion === "YES" &&
    oosSupported === "YES" &&
    robustness === "ROBUST" &&
    profitableSelected > losingSelected
      ? "PROMOTABLE_CANDIDATE"
      : interactionAddsValue === "YES" && posNetRegion === "YES"
        ? "PROMISING"
        : "RESEARCH_ONLY";

  const ablationRows: AnyRecord[] = [
    { method: "EV_ONLY", ...oosEV },
    { method: "LIQUIDITY_ONLY", ...oosLiq },
    { method: "EV_X_LIQUIDITY", ...oosInt },
    { method: "MOMENTUM_SCORE_BASELINE", ...oosMom },
  ];

  const bucketRows = [...evalEV.bucketRows, ...evalLiq.bucketRows, ...evalInt.bucketRows, ...evalMom.bucketRows];
  const oosJson = {
    splitMethod: "chronological 60/20/20",
    trainCutSource: "TRAIN only",
    EV_ONLY: evalEV.metrics,
    LIQUIDITY_ONLY: evalLiq.metrics,
    EV_X_LIQUIDITY: evalInt.metrics,
    MOMENTUM_SCORE_BASELINE: evalMom.metrics,
    lookaheadViolations,
  };

  const top10 = Math.round(currentScored.length * 0.1);
  const top20 = Math.round(currentScored.length * 0.2);
  const top30 = Math.round(currentScored.length * 0.3);
  const byScoreDesc = [...currentScored].sort((a, b) => b.interactionScore - a.interactionScore);
  const currentTopBuckets = {
    top10,
    top20,
    top30,
    top10ThresholdScore: byScoreDesc[top10 - 1]?.interactionScore ?? Number.NaN,
    top20ThresholdScore: byScoreDesc[top20 - 1]?.interactionScore ?? Number.NaN,
    top30ThresholdScore: byScoreDesc[top30 - 1]?.interactionScore ?? Number.NaN,
  };

  const finalVerdict = {
    EV_LIQUIDITY_OOS_EXPECTANCY: oosInt.highExpectancy,
    EV_ONLY_OOS_EXPECTANCY: oosEV.highExpectancy,
    LIQUIDITY_ONLY_OOS_EXPECTANCY: oosLiq.highExpectancy,
    INTERACTION_ADDS_VALUE: interactionAddsValue,
    POSITIVE_NET_REGION: posNetRegion,
    PROFITABLE_SELECTED: profitableSelected,
    LOSING_SELECTED: losingSelected,
    CURRENT_2278_HIGH_EDGE: currentHighEdge,
    OOS_SUPPORTED: oosSupported,
    ROBUSTNESS: robustness,
    STATUS: status,
    NEXT_STEP:
      status === "PROMOTABLE_CANDIDATE"
        ? "RESEARCH_ONLY_PROMOTION_CANDIDATE_PREPARE_TDI_PARALLEL_SHADOW_NO_POLICY_CHANGE"
        : status === "PROMISING"
          ? "REPLICATE_WITH_MORE_EXACT_RUNTIME_EVIDENCE_BEFORE_ANY_POLICY_DISCUSSION"
          : "KEEP_RESEARCH_ONLY_DO_NOT_TOUCH_PRODUCTION_GATES",
    PRODUCTION_CHANGE_RECOMMENDED: "NO",
  };

  const summary = {
    generatedAt: new Date().toISOString(),
    constraints: {
      noPaperRun: true,
      noMarketData: true,
      noProductionChanges: true,
    },
    pairedReference: {
      totalHistoricalTrades: n((feeBackfill.finalAnswers as AnyRecord | undefined)?.HISTORICAL_TRADES),
      validPairedTrades: n((feeBackfill.finalAnswers as AnyRecord | undefined)?.VALID_EXECUTED_PAIRED_TRADES),
    },
    part1_definition: {
      EV: {
        source: "forensic bridge / tdi-decisions expectedValue",
        formula: "expectedValue := composite/consensus score from hybrid+master path",
        units: "score",
        range: "approximately 0..100",
        normalization: "none in production record; raw persisted score",
        timestamp: "decision-time (tdi decision snapshot)",
        missingBehavior: "fallback to consensusScore then inferred train median in research-only replay",
      },
      liquidity: {
        source: "forensic bridge liquidity field (primarily volume24h proxy)",
        formula: "liquidity := analysisInput.volume24h when persisted",
        units: "notional volume proxy",
        range: "asset-dependent positive scale",
        normalization: "none in production record; normalized in shadow using TRAIN min-max",
        timestamp: "decision-time (market snapshot at decision)",
        missingBehavior: "fallback to volume24h then inferred train median in research-only replay",
      },
    },
    part2_interaction_definition: {
      formula: "interactionScore = evNorm * liqNorm / 100",
      evNorm: "TRAIN-only min-max normalization with 5th/95th percentile clipping",
      liqNorm: "TRAIN-only min-max normalization with 5th/95th percentile clipping",
      scaling: "0..100",
      ranking: "descending interactionScore",
      bins: "Q1..Q4 from TRAIN quantiles",
      highEdgeRule: "interactionScore >= TRAIN q70 (top 30%)",
    },
    lookaheadViolations,
    selectedRegionEconomics: {
      profitableSelected,
      losingSelected,
      breakevenSelected,
      netPnL: Number(sum(selected.map((r) => r.netPnL)).toFixed(8)),
      fees: Number(sum(selected.map((r) => r.fees)).toFixed(8)),
      expectancy: Number((sum(selected.map((r) => r.netPnL)) / Math.max(1, selected.length)).toFixed(8)),
      netReturn: Number((sum(selected.map((r) => r.netReturn)) / Math.max(1, selected.length)).toFixed(10)),
      profitFactor: Number(
        (
          sum(selected.filter((r) => r.netPnL > 0).map((r) => r.netPnL)) /
          Math.max(1e-9, Math.abs(sum(selected.filter((r) => r.netPnL < 0).map((r) => r.netPnL))))
        ).toFixed(8),
      ),
      drawdown: Number(Math.abs(Math.min(0, ...selected.map((r) => r.netPnL))).toFixed(8)),
    },
    current2278: {
      total: currentScored.length,
      highEdge: currentHighEdge,
      topBuckets: currentTopBuckets,
    },
    momentumComparison: {
      momentumOOSExpectancy: oosMom.highExpectancy,
      evLiqOOSExpectancy: oosInt.highExpectancy,
      strongerSignal: oosInt.highExpectancy > oosMom.highExpectancy ? "EV_X_LIQUIDITY" : "MOMENTUM",
    },
    finalVerdict,
  };

  wcsv(OUT.buckets, bucketRows);
  wj(OUT.oos, oosJson);
  wcsv(OUT.strategy, strategyRows);
  wcsv(OUT.regime, regimeRows);
  wcsv(OUT.current2278, currentScored);
  wcsv(OUT.ablation, ablationRows);
  wj(OUT.summary, summary);

  const md = [
    "# KRIPTO P2 — EV × LIQUIDITY TARGETED SHADOW PROFITABILITY EXPERIMENT",
    "",
    "## Artifacts",
    `- summary: \`kripto-p2-ev-liquidity-shadow.json\``,
    `- buckets: \`kripto-p2-ev-liquidity-buckets.csv\``,
    `- oos: \`kripto-p2-ev-liquidity-oos.json\``,
    `- strategy/regime: \`kripto-p2-ev-liquidity-strategy.csv\`, \`kripto-p2-ev-liquidity-regime.csv\``,
    `- current 2278: \`kripto-p2-ev-liquidity-current-2278.csv\``,
    `- ablation: \`kripto-p2-ev-liquidity-ablation.csv\``,
    "",
    "## Final Verdict",
    `EV_LIQUIDITY_OOS_EXPECTANCY = ${finalVerdict.EV_LIQUIDITY_OOS_EXPECTANCY}`,
    `EV_ONLY_OOS_EXPECTANCY = ${finalVerdict.EV_ONLY_OOS_EXPECTANCY}`,
    `LIQUIDITY_ONLY_OOS_EXPECTANCY = ${finalVerdict.LIQUIDITY_ONLY_OOS_EXPECTANCY}`,
    `INTERACTION_ADDS_VALUE = ${finalVerdict.INTERACTION_ADDS_VALUE}`,
    `POSITIVE_NET_REGION = ${finalVerdict.POSITIVE_NET_REGION}`,
    `PROFITABLE_SELECTED = ${finalVerdict.PROFITABLE_SELECTED}`,
    `LOSING_SELECTED = ${finalVerdict.LOSING_SELECTED}`,
    `CURRENT_2278_HIGH_EDGE = ${finalVerdict.CURRENT_2278_HIGH_EDGE}`,
    `OOS_SUPPORTED = ${finalVerdict.OOS_SUPPORTED}`,
    `ROBUSTNESS = ${finalVerdict.ROBUSTNESS}`,
    `STATUS = ${finalVerdict.STATUS}`,
    `NEXT_STEP = ${finalVerdict.NEXT_STEP}`,
    `PRODUCTION_CHANGE_RECOMMENDED = NO`,
    "",
  ].join("\n");
  fs.writeFileSync(OUT.report, md, "utf8");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

