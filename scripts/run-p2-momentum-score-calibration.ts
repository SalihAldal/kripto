import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/src/server/db/prisma";

type AnyRecord = Record<string, unknown>;
type EvidenceClass = "EXACT_RUNTIME_REPLAY" | "POLICY_FORENSIC_REPLAY" | "INFERRED";
type OutcomeClass = "PROFITABLE" | "LOSS" | "BREAKEVEN";

const ROOT = process.cwd();
const FIVE_ROUND = path.join(ROOT, "kripto-5round-paper-validation.json");
const MOMENTUM_THRESHOLD = 60;

const OUT = {
  report: path.join(ROOT, "KRIPTO_P2_MOMENTUM_SCORE_CALIBRATION_REPORT.md"),
  summary: path.join(ROOT, "kripto-p2-momentum-score-calibration.json"),
  outcomeCsv: path.join(ROOT, "kripto-p2-momentum-score-outcome.csv"),
  thresholdCurveCsv: path.join(ROOT, "kripto-p2-momentum-threshold-curve.csv"),
  currentVsHistoricalCsv: path.join(ROOT, "kripto-p2-momentum-current-vs-historical.csv"),
  oos: path.join(ROOT, "kripto-p2-momentum-oos.json"),
};

type Row = {
  dataset: "historical" | "current";
  tradeId: string;
  candidateId: string;
  runId: string;
  roundId: string;
  symbol: string;
  strategy: string;
  regime: string;
  momentumScore: number;
  momentumThreshold: number;
  momentumGap: number;
  shortMomentum: number;
  shortFlow: number;
  sentiment: number;
  technicalScore: number;
  confidence: number;
  learningScore: number;
  executionScore: number;
  tdiVerdict: string;
  aiDecision: string;
  grossPnL: number;
  fees: number;
  netPnL: number;
  entryTimestamp: string;
  exitTimestamp: string;
  holdDuration: number;
  evidenceClass: EvidenceClass;
  outcomeClass: OutcomeClass;
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
function wj(p: string, data: unknown) {
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
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
function avg(values: number[]) {
  if (values.length === 0) return Number.NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
function sum(values: number[]) {
  return values.reduce((a, b) => a + b, 0);
}
function quantile(values: number[], q: number) {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function pct(a: number, b: number) {
  return b > 0 ? a / b : 0;
}
function rankAverage(values: number[]) {
  const pairs = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(values.length).fill(0);
  let i = 0;
  while (i < pairs.length) {
    let j = i + 1;
    while (j < pairs.length && pairs[j].v === pairs[i].v) j++;
    const rank = (i + j - 1) / 2 + 1;
    for (let k = i; k < j; k++) ranks[pairs[k].i] = rank;
    i = j;
  }
  return ranks;
}
function spearman(x: number[], y: number[]) {
  if (x.length !== y.length || x.length < 3) return Number.NaN;
  const rx = rankAverage(x);
  const ry = rankAverage(y);
  const mx = avg(rx);
  const my = avg(ry);
  const num = rx.reduce((acc, v, i) => acc + (v - mx) * (ry[i] - my), 0);
  const denx = Math.sqrt(rx.reduce((acc, v) => acc + (v - mx) ** 2, 0));
  const deny = Math.sqrt(ry.reduce((acc, v) => acc + (v - my) ** 2, 0));
  const den = denx * deny;
  return den > 0 ? num / den : Number.NaN;
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
  const exactKeys = ["technicalScore", "momentumScore", "sentimentScore", "shortMomentum", "shortFlow", "confidence"];
  const exact = exactKeys.every((k) => Number.isFinite(n(meta[k])));
  if (exact && meta.tdiVerdict) return "EXACT_RUNTIME_REPLAY";
  const partial = Number.isFinite(n(meta.momentumScore)) || Number.isFinite(n(meta.shortMomentum)) || Number.isFinite(n(meta.confidence));
  return partial ? "POLICY_FORENSIC_REPLAY" : "INFERRED";
}
function outcomeFromNet(net: number): OutcomeClass {
  if (net > 0) return "PROFITABLE";
  if (net < 0) return "LOSS";
  return "BREAKEVEN";
}

function distStats(values: number[]) {
  const xs = values.filter((v) => Number.isFinite(v));
  return {
    count: xs.length,
    mean: Number(avg(xs).toFixed(6)),
    median: Number(quantile(xs, 0.5).toFixed(6)),
    p10: Number(quantile(xs, 0.1).toFixed(6)),
    p25: Number(quantile(xs, 0.25).toFixed(6)),
    p50: Number(quantile(xs, 0.5).toFixed(6)),
    p75: Number(quantile(xs, 0.75).toFixed(6)),
    p90: Number(quantile(xs, 0.9).toFixed(6)),
    min: Number(Math.min(...xs).toFixed(6)),
    max: Number(Math.max(...xs).toFixed(6)),
  };
}

function bucketize(rows: Row[], bucketCount = 5) {
  const scores = rows.map((r) => r.momentumScore).filter(Number.isFinite);
  const cuts: number[] = [];
  for (let i = 1; i < bucketCount; i++) cuts.push(quantile(scores, i / bucketCount));
  const byBucket: Row[][] = Array.from({ length: bucketCount }, () => []);
  for (const r of rows) {
    let idx = cuts.findIndex((c) => r.momentumScore <= c);
    if (idx === -1) idx = bucketCount - 1;
    byBucket[idx].push(r);
  }
  const totalProfitable = rows.filter((r) => r.outcomeClass === "PROFITABLE").length;
  const out = byBucket.map((g, i) => {
    const wins = g.filter((r) => r.outcomeClass === "PROFITABLE");
    const losses = g.filter((r) => r.outcomeClass === "LOSS");
    const gross = sum(g.map((r) => r.grossPnL));
    const fee = sum(g.map((r) => r.fees));
    const net = sum(g.map((r) => r.netPnL));
    const pos = sum(wins.map((r) => r.netPnL));
    const negAbs = Math.abs(sum(losses.map((r) => r.netPnL)));
    return {
      bucket: `Q${i + 1}`,
      lowerBound: i === 0 ? Number(Math.min(...scores).toFixed(6)) : Number(cuts[i - 1].toFixed(6)),
      upperBound: i < cuts.length ? Number(cuts[i].toFixed(6)) : Number(Math.max(...scores).toFixed(6)),
      tradeCount: g.length,
      wins: wins.length,
      losses: losses.length,
      winRate: Number(pct(wins.length, Math.max(1, g.length)).toFixed(6)),
      grossPnL: Number(gross.toFixed(8)),
      fees: Number(fee.toFixed(8)),
      netPnL: Number(net.toFixed(8)),
      expectancy: Number((net / Math.max(1, g.length)).toFixed(8)),
      profitFactor: Number((negAbs > 0 ? pos / negAbs : Number.POSITIVE_INFINITY).toFixed(8)),
      avgHold: Number(avg(g.map((r) => r.holdDuration)).toFixed(6)),
      profitableTradeShare: Number(pct(wins.length, Math.max(1, totalProfitable)).toFixed(6)),
    };
  });
  return { buckets: out, cuts };
}

async function main() {
  const five = j<AnyRecord>(FIVE_ROUND);
  const roots: string[] = ((five.rounds as AnyRecord[]) ?? []).map((r) => s(r.artifactRoot)).filter(Boolean);
  const currentRowsRaw: Row[] = [];

  for (const root of roots) {
    const p = path.join(root, "tdi-decisions.json");
    if (!fs.existsSync(p)) continue;
    const payload = j<{ records?: AnyRecord[] }>(p);
    for (const rec of payload.records ?? []) {
      const score = n(rec.momentumScore);
      if (!Number.isFinite(score)) continue;
      const createdAt = s(rec.createdAt ?? rec.timestamp, "");
      currentRowsRaw.push({
        dataset: "current",
        tradeId: "",
        candidateId: s(rec.candidateId),
        runId: s(five.sessionId),
        roundId: s(rec.roundNo ?? path.basename(root)),
        symbol: s(rec.symbol),
        strategy: strategyNorm(s(rec.strategy)),
        regime: regimeNorm(s(rec.regime)),
        momentumScore: score,
        momentumThreshold: MOMENTUM_THRESHOLD,
        momentumGap: Number((score - MOMENTUM_THRESHOLD).toFixed(6)),
        shortMomentum: n(rec.shortMomentum),
        shortFlow: n(rec.shortFlow),
        sentiment: n(rec.sentimentScore),
        technicalScore: n(rec.technicalScore),
        confidence: n(rec.confidence),
        learningScore: n(rec.learningScore),
        executionScore: n(rec.executionScore),
        tdiVerdict: s(rec.verdict, "WAIT"),
        aiDecision: s(rec.finalDecision ?? rec.hybridDecision, "UNKNOWN"),
        grossPnL: 0,
        fees: 0,
        netPnL: 0,
        entryTimestamp: createdAt,
        exitTimestamp: "",
        holdDuration: n(rec.holdSec, 0),
        evidenceClass: "EXACT_RUNTIME_REPLAY",
        outcomeClass: "BREAKEVEN",
      });
    }
  }
  const currentRows = Array.from(new Map(currentRowsRaw.map((r) => [`${r.candidateId}|${r.roundId}|${r.symbol}`, r])).values());

  const bySymbol = currentRows.reduce((acc, r) => ((acc.get(r.symbol)?.push(r) ?? acc.set(r.symbol, [r])), acc), new Map<string, Row[]>());
  const bySR = currentRows.reduce((acc, r) => {
    const key = `${r.strategy}|${r.regime}`;
    (acc.get(key)?.push(r) ?? acc.set(key, [r]));
    return acc;
  }, new Map<string, Row[]>());
  const med = (arr: Row[], key: keyof Row) => {
    const vals = arr.map((r) => n(r[key])).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (vals.length === 0) return Number.NaN;
    return vals[Math.floor((vals.length - 1) * 0.5)];
  };
  const globalMed = {
    momentumScore: med(currentRows, "momentumScore"),
    shortMomentum: med(currentRows, "shortMomentum"),
    shortFlow: med(currentRows, "shortFlow"),
    sentiment: med(currentRows, "sentiment"),
    technicalScore: med(currentRows, "technicalScore"),
    confidence: med(currentRows, "confidence"),
    learningScore: med(currentRows, "learningScore"),
    executionScore: med(currentRows, "executionScore"),
  };

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
      holdSec: true,
      metadata: true,
      openedAt: true,
      closedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const historicalAll = trades
    .map((t) => {
      const m = ((t.metadata as AnyRecord | null) ?? {}) as AnyRecord;
      const eClass = evidenceClass(m);
      const strategy = strategyNorm(t.strategy);
      const regime = regimeNorm(s(t.marketRegime));
      const src = bySymbol.get(t.symbol)?.length ? bySymbol.get(t.symbol)! : bySR.get(`${strategy}|${regime}`) ?? [];
      const infer = (key: string, fb: keyof typeof globalMed) =>
        Number.isFinite(n(m[key])) ? n(m[key]) : src.length > 0 ? med(src, fb) : globalMed[fb];
      const momentumScore = infer("momentumScore", "momentumScore");
      if (!Number.isFinite(momentumScore)) return null;
      const gross = Number((Math.abs((t.exitPrice - t.entryPrice) * t.quantity)).toFixed(8));
      const fees = Math.max(0, Number((gross - Math.abs(t.realizedPnl)).toFixed(8)));
      const entryTs = t.openedAt?.toISOString?.() ?? t.createdAt.toISOString();
      const exitTs = t.closedAt?.toISOString?.() ?? t.updatedAt.toISOString();
      return {
        dataset: "historical" as const,
        tradeId: t.tradeId,
        candidateId: s(m.candidateId ?? m.executionCandidateId ?? `hist:${t.tradeId}`),
        runId: s(m.runId ?? m.executionId ?? m.jobId),
        roundId: s(m.roundId ?? m.roundNo),
        symbol: t.symbol,
        strategy,
        regime,
        momentumScore: Number(momentumScore.toFixed(6)),
        momentumThreshold: MOMENTUM_THRESHOLD,
        momentumGap: Number((momentumScore - MOMENTUM_THRESHOLD).toFixed(6)),
        shortMomentum: infer("shortMomentum", "shortMomentum"),
        shortFlow: infer("shortFlow", "shortFlow"),
        sentiment: infer("sentimentScore", "sentiment"),
        technicalScore: infer("technicalScore", "technicalScore"),
        confidence: infer("confidence", "confidence"),
        learningScore: infer("learningScore", "learningScore"),
        executionScore: infer("executionScore", "executionScore"),
        tdiVerdict: s(m.tdiVerdict ?? m.verdict, "WAIT"),
        aiDecision: s(m.aiFinalDecision ?? m.finalDecision, "UNKNOWN"),
        grossPnL: gross,
        fees,
        netPnL: Number(t.realizedPnl.toFixed(8)),
        entryTimestamp: entryTs,
        exitTimestamp: exitTs,
        holdDuration: Number((n(t.holdSec, (Date.parse(exitTs) - Date.parse(entryTs)) / 1000)).toFixed(6)),
        evidenceClass: eClass,
        outcomeClass: outcomeFromNet(t.realizedPnl),
      } satisfies Row;
    })
    .filter((x): x is Row => !!x);

  const profitable42 = historicalAll.filter((r) => r.outcomeClass === "PROFITABLE");
  const losses = historicalAll.filter((r) => r.outcomeClass === "LOSS");
  const breakeven = historicalAll.filter((r) => r.outcomeClass === "BREAKEVEN");

  // PART 2 distribution
  const dist = {
    PROFITABLE: {
      momentumScore: distStats(profitable42.map((r) => r.momentumScore)),
      momentumGap: distStats(profitable42.map((r) => r.momentumGap)),
    },
    LOSS: {
      momentumScore: distStats(losses.map((r) => r.momentumScore)),
      momentumGap: distStats(losses.map((r) => r.momentumGap)),
    },
    BREAKEVEN: {
      momentumScore: distStats(breakeven.map((r) => r.momentumScore)),
      momentumGap: distStats(breakeven.map((r) => r.momentumGap)),
    },
  };

  // PART 3 score buckets
  const bucketRes = bucketize(historicalAll, 5);
  const nonEmptyBuckets = bucketRes.buckets.filter((b) => b.tradeCount > 0);
  const bestScoreRegion = [...nonEmptyBuckets].sort((a, b) => b.expectancy - a.expectancy)[0]?.bucket ?? "UNKNOWN";
  const worstScoreRegion = [...nonEmptyBuckets].sort((a, b) => a.expectancy - b.expectancy)[0]?.bucket ?? "UNKNOWN";

  // PART 4 monotonicity
  const spear = spearman(
    historicalAll.map((r) => r.momentumScore),
    historicalAll.map((r) => r.netPnL),
  );
  const bucketExpectancies = bucketRes.buckets.map((b) => b.expectancy);
  let inc = 0;
  let dec = 0;
  for (let i = 1; i < bucketExpectancies.length; i++) {
    if (bucketExpectancies[i] > bucketExpectancies[i - 1]) inc++;
    if (bucketExpectancies[i] < bucketExpectancies[i - 1]) dec++;
  }
  const monotonicClass =
    !Number.isFinite(spear) ? "UNKNOWN" : spear >= 0.35 && inc >= 3 ? "MONOTONIC_POSITIVE" : spear >= 0.1 ? "WEAK_POSITIVE" : spear <= -0.1 ? "INVERSE" : "NO_RELATIONSHIP";

  // PART 5 threshold calibration curve
  const thresholdCandidates = Array.from(
    new Set([
      Number((MOMENTUM_THRESHOLD - 8).toFixed(4)),
      Number((MOMENTUM_THRESHOLD - 4).toFixed(4)),
      MOMENTUM_THRESHOLD,
      Number((MOMENTUM_THRESHOLD + 4).toFixed(4)),
      Number((MOMENTUM_THRESHOLD + 8).toFixed(4)),
      Number(quantile(historicalAll.map((r) => r.momentumScore), 0.7).toFixed(4)),
      Number(quantile(historicalAll.map((r) => r.momentumScore), 0.8).toFixed(4)),
    ]),
  ).sort((a, b) => a - b);
  const thresholdCurve = thresholdCandidates.map((th) => {
    const kept = historicalAll.filter((r) => r.momentumScore >= th);
    const wins = kept.filter((r) => r.outcomeClass === "PROFITABLE");
    const los = kept.filter((r) => r.outcomeClass === "LOSS");
    const net = sum(kept.map((r) => r.netPnL));
    const pos = sum(wins.map((r) => r.netPnL));
    const negAbs = Math.abs(sum(los.map((r) => r.netPnL)));
    return {
      threshold: th,
      historicalProfitableRetained: wins.length,
      historicalLossRetained: los.length,
      historicalBreakevenRetained: kept.filter((r) => r.outcomeClass === "BREAKEVEN").length,
      netPnL: Number(net.toFixed(8)),
      expectancy: Number((net / Math.max(1, kept.length)).toFixed(8)),
      winRate: Number(pct(wins.length, Math.max(1, kept.length)).toFixed(6)),
      profitFactor: Number((negAbs > 0 ? pos / negAbs : Number.POSITIVE_INFINITY).toFixed(8)),
      keptCount: kept.length,
      keptShare: Number(pct(kept.length, historicalAll.length).toFixed(6)),
    };
  });

  // PART 6 42 profitable classification
  const allScores = historicalAll.map((r) => r.momentumScore);
  const p25 = quantile(allScores, 0.25);
  const p50 = quantile(allScores, 0.5);
  const prof42Classified = profitable42.map((r) => {
    let cls = "NEAR_THRESHOLD";
    if (r.momentumScore > MOMENTUM_THRESHOLD) cls = "ABOVE_THRESHOLD";
    else if (r.momentumScore <= p25) cls = "VERY_LOW_SCORE";
    else if (r.momentumScore <= p50) cls = "LOW_SCORE";
    else cls = "NEAR_THRESHOLD";
    return {
      tradeId: r.tradeId,
      symbol: r.symbol,
      strategy: r.strategy,
      regime: r.regime,
      momentumScore: r.momentumScore,
      threshold: MOMENTUM_THRESHOLD,
      gap: r.momentumGap,
      shortMomentum: r.shortMomentum,
      shortFlow: r.shortFlow,
      sentiment: r.sentiment,
      netPnL: r.netPnL,
      scoreClass: cls,
      evidenceClass: r.evidenceClass,
    };
  });

  // PART 7 false negatives
  const profitableBelow = profitable42.filter((r) => r.momentumScore < MOMENTUM_THRESHOLD);
  const lossBelow = losses.filter((r) => r.momentumScore < MOMENTUM_THRESHOLD);
  const lowScoreRegion = historicalAll.filter((r) => r.momentumScore < MOMENTUM_THRESHOLD);
  const lowScoreExpectancy = Number((sum(lowScoreRegion.map((r) => r.netPnL)) / Math.max(1, lowScoreRegion.length)).toFixed(8));

  // PART 8 component calibration
  const componentCorrelations = {
    momentumScore_vs_netPnL: Number(spearman(historicalAll.map((r) => r.momentumScore), historicalAll.map((r) => r.netPnL)).toFixed(6)),
    shortMomentum_vs_netPnL: Number(spearman(historicalAll.map((r) => r.shortMomentum), historicalAll.map((r) => r.netPnL)).toFixed(6)),
    shortFlow_vs_netPnL: Number(spearman(historicalAll.map((r) => r.shortFlow), historicalAll.map((r) => r.netPnL)).toFixed(6)),
    sentiment_vs_netPnL: Number(spearman(historicalAll.map((r) => r.sentiment), historicalAll.map((r) => r.netPnL)).toFixed(6)),
  };

  // PART 9 strategy x score
  const strategies = ["Mean Reversion", "Volatility Breakout", "Trend Following", "Other"];
  const strategyStats = strategies.map((st) => {
    const g = historicalAll.filter((r) => r.strategy === st);
    return {
      strategy: st,
      count: g.length,
      scoreMean: Number(avg(g.map((r) => r.momentumScore)).toFixed(6)),
      expectancy: Number((sum(g.map((r) => r.netPnL)) / Math.max(1, g.length)).toFixed(8)),
      spearmanScoreNet: Number(spearman(g.map((r) => r.momentumScore), g.map((r) => r.netPnL)).toFixed(6)),
      belowThresholdShare: Number(pct(g.filter((r) => r.momentumScore < MOMENTUM_THRESHOLD).length, Math.max(1, g.length)).toFixed(6)),
    };
  });

  // PART 10 regime x score
  const regimes = ["RANGE", "TREND", "HIGH_VOLATILITY", "LOW_VOLATILITY", "CHAOS", "LOW_LIQUIDITY", "UNKNOWN"];
  const regimeStats = regimes.map((rg) => {
    const g = historicalAll.filter((r) => r.regime === rg);
    return {
      regime: rg,
      count: g.length,
      scoreMean: Number(avg(g.map((r) => r.momentumScore)).toFixed(6)),
      scoreMedian: Number(quantile(g.map((r) => r.momentumScore), 0.5).toFixed(6)),
      expectancy: Number((sum(g.map((r) => r.netPnL)) / Math.max(1, g.length)).toFixed(8)),
      belowThresholdShare: Number(pct(g.filter((r) => r.momentumScore < MOMENTUM_THRESHOLD).length, Math.max(1, g.length)).toFixed(6)),
    };
  });

  // PART 11 current vs historical
  const currentLowShare = Number(
    pct(
      currentRows.filter((r) => r.momentumScore < MOMENTUM_THRESHOLD).length,
      Math.max(1, currentRows.length),
    ).toFixed(6),
  );
  const histProfLowShare = Number(
    pct(
      profitable42.filter((r) => r.momentumScore < MOMENTUM_THRESHOLD).length,
      Math.max(1, profitable42.length),
    ).toFixed(6),
  );
  const histLossLowShare = Number(pct(lossBelow.length, Math.max(1, losses.length)).toFixed(6));

  // PART 12 temporal OOS
  const sorted = [...historicalAll].sort((a, b) => Date.parse(a.entryTimestamp) - Date.parse(b.entryTimestamp));
  const c1 = Math.max(1, Math.floor(sorted.length * 0.6));
  const c2 = Math.max(c1 + 1, Math.floor(sorted.length * 0.8));
  const split = { TRAIN: sorted.slice(0, c1), VALIDATION: sorted.slice(c1, c2), OOS: sorted.slice(c2) };
  const splitStats = Object.fromEntries(
    Object.entries(split).map(([k, rows]) => [
      k,
      {
        count: rows.length,
        scoreMean: Number(avg(rows.map((r) => r.momentumScore)).toFixed(6)),
        winRate: Number(pct(rows.filter((r) => r.outcomeClass === "PROFITABLE").length, Math.max(1, rows.length)).toFixed(6)),
        expectancy: Number((sum(rows.map((r) => r.netPnL)) / Math.max(1, rows.length)).toFixed(8)),
        spearmanScoreNet: Number(spearman(rows.map((r) => r.momentumScore), rows.map((r) => r.netPnL)).toFixed(6)),
      },
    ]),
  ) as Record<string, AnyRecord>;

  const oosSupport =
    n(splitStats.TRAIN.spearmanScoreNet) > 0 && n(splitStats.VALIDATION.spearmanScoreNet) > 0 && n(splitStats.OOS.spearmanScoreNet) > 0
      ? "YES"
      : n(splitStats.OOS.spearmanScoreNet) > 0
        ? "PARTIAL"
        : "NO";

  // PART 13 calibration quality
  const separable = dist.PROFITABLE.momentumScore.median - dist.LOSS.momentumScore.median;
  const stabilityPenalty = strategyStats.filter((x) => Number.isFinite(x.spearmanScoreNet) && x.spearmanScoreNet < 0).length;
  const calibrationQuality =
    monotonicClass === "MONOTONIC_POSITIVE" && separable > 5 && oosSupport === "YES" && stabilityPenalty <= 1
      ? "GOOD_CALIBRATION"
      : monotonicClass === "WEAK_POSITIVE" && oosSupport !== "NO"
        ? "WEAK_CALIBRATION"
        : monotonicClass === "INVERSE" || monotonicClass === "NO_RELATIONSHIP"
          ? "BAD_CALIBRATION"
          : "UNKNOWN";

  // PART 14 safe next experiment
  const curveAtCurrent = thresholdCurve.find((x) => x.threshold === MOMENTUM_THRESHOLD) ?? thresholdCurve[0];
  const betterLower = thresholdCurve
    .filter((x) => x.threshold < MOMENTUM_THRESHOLD)
    .some((x) => x.expectancy > curveAtCurrent.expectancy && x.historicalProfitableRetained > curveAtCurrent.historicalProfitableRetained);
  const safeNextExperiment =
    (calibrationQuality === "GOOD_CALIBRATION" || calibrationQuality === "WEAK_CALIBRATION") && betterLower
      ? "MOMENTUM_THRESHOLD_SHADOW_EXPERIMENT"
      : calibrationQuality === "BAD_CALIBRATION"
        ? "MOMENTUM_SCORE_RECALIBRATION"
        : "NO_TDI_CHANGE_JUSTIFIED";

  const currentZeroApprovalCause =
    currentLowShare > 0.9 && calibrationQuality !== "BAD_CALIBRATION"
      ? "LOW_MOMENTUM_REALITY"
      : calibrationQuality === "BAD_CALIBRATION"
        ? "SCORE_MISCalibration"
        : betterLower
          ? "THRESHOLD_SUPPRESSION"
          : calibrationQuality === "WEAK_CALIBRATION"
            ? "MIXED"
            : "UNKNOWN";

  const summary = {
    generatedAt: new Date().toISOString(),
    constraints: {
      noPaperRun: true,
      noMarketData: true,
      noProductionChanges: true,
      noThresholdChangeImplemented: true,
    },
    canonicalDataset: {
      historicalCount: historicalAll.length,
      currentCount: currentRows.length,
      evidenceClassCounts: historicalAll.reduce(
        (a, r) => ((a[r.evidenceClass] = (a[r.evidenceClass] ?? 0) + 1), a),
        {} as Record<string, number>,
      ),
    },
    distributionsByOutcome: dist,
    scoreBuckets: bucketRes.buckets,
    bestScoreRegion,
    worstScoreRegion,
    monotonicity: {
      spearmanScoreVsNetPnl: Number(spear.toFixed(6)),
      increasingBucketSteps: inc,
      decreasingBucketSteps: dec,
      class: monotonicClass,
    },
    thresholdCurve,
    profitable42Analysis: {
      count: profitable42.length,
      belowThresholdCount: profitableBelow.length,
      belowThresholdShare: Number(pct(profitableBelow.length, Math.max(1, profitable42.length)).toFixed(6)),
      classes: prof42Classified.reduce((a, r) => ((a[r.scoreClass] = (a[r.scoreClass] ?? 0) + 1), a), {} as Record<string, number>),
    },
    falseNegativeAnalysis: {
      historicalMomentumFalseNegatives: profitableBelow.length,
      falseNegativeNetPnl: Number(sum(profitableBelow.map((r) => r.netPnL)).toFixed(8)),
      falseNegativeAvgNetPnl: Number((sum(profitableBelow.map((r) => r.netPnL)) / Math.max(1, profitableBelow.length)).toFixed(8)),
      falseNegativeShareOfProfitable: Number(pct(profitableBelow.length, Math.max(1, profitable42.length)).toFixed(6)),
      historicalLossBelowThreshold: lossBelow.length,
      lowScoreExpectancy,
    },
    componentCalibration: componentCorrelations,
    strategyCalibration: strategyStats,
    regimeCalibration: regimeStats,
    currentVsHistorical: {
      currentLowScoreShare: currentLowShare,
      historicalProfitableLowScoreShare: histProfLowShare,
      historicalLossLowScoreShare: histLossLowShare,
    },
    temporalOos: {
      split: splitStats,
      support: oosSupport,
    },
    calibrationQuality,
    safeNextExperiment,
    finalVerdict: {
      MOMENTUM_SCORE_RELATIONSHIP: monotonicClass,
      MOMENTUM_CALIBRATION:
        calibrationQuality === "GOOD_CALIBRATION"
          ? "GOOD"
          : calibrationQuality === "WEAK_CALIBRATION"
            ? "WEAK"
            : calibrationQuality === "BAD_CALIBRATION"
              ? "BAD"
              : "UNKNOWN",
      HISTORICAL_PROFITABLE_BELOW_THRESHOLD: profitableBelow.length,
      HISTORICAL_LOSS_BELOW_THRESHOLD: lossBelow.length,
      PROFITABLE_LOW_SCORE_NET_PNL: Number(sum(profitableBelow.map((r) => r.netPnL)).toFixed(8)),
      LOW_SCORE_EXPECTANCY: lowScoreExpectancy,
      CURRENT_2278_LOW_SCORE_SHARE: currentLowShare,
      CURRENT_ZERO_APPROVAL_CAUSE: currentZeroApprovalCause,
      SAFE_NEXT_EXPERIMENT: safeNextExperiment,
      PRODUCTION_CHANGE_RECOMMENDED: "NO",
    },
  };

  const outcomeCsvRows = historicalAll.map((r) => ({
    tradeId: r.tradeId,
    candidateId: r.candidateId,
    runId: r.runId,
    roundId: r.roundId,
    symbol: r.symbol,
    strategy: r.strategy,
    regime: r.regime,
    momentumScore: r.momentumScore,
    momentumThreshold: r.momentumThreshold,
    momentumGap: r.momentumGap,
    shortMomentum: r.shortMomentum,
    shortFlow: r.shortFlow,
    sentiment: r.sentiment,
    technicalScore: r.technicalScore,
    confidence: r.confidence,
    learningScore: r.learningScore,
    executionScore: r.executionScore,
    tdiVerdict: r.tdiVerdict,
    aiDecision: r.aiDecision,
    grossPnL: r.grossPnL,
    fees: r.fees,
    netPnL: r.netPnL,
    entryTimestamp: r.entryTimestamp,
    exitTimestamp: r.exitTimestamp,
    holdDuration: r.holdDuration,
    evidenceClass: r.evidenceClass,
    outcomeClass: r.outcomeClass,
  }));

  const currentVsHistRows: AnyRecord[] = [
    ...currentRows.map((r) => ({
      dataset: "CURRENT_2278",
      id: r.candidateId,
      symbol: r.symbol,
      strategy: r.strategy,
      regime: r.regime,
      momentumScore: r.momentumScore,
      momentumGap: r.momentumGap,
      class: r.tdiVerdict,
      evidenceClass: r.evidenceClass,
    })),
    ...profitable42.map((r) => ({
      dataset: "HISTORICAL_PROFITABLE_42",
      id: r.tradeId,
      symbol: r.symbol,
      strategy: r.strategy,
      regime: r.regime,
      momentumScore: r.momentumScore,
      momentumGap: r.momentumGap,
      class: r.outcomeClass,
      evidenceClass: r.evidenceClass,
    })),
    ...losses.map((r) => ({
      dataset: "HISTORICAL_LOSS",
      id: r.tradeId,
      symbol: r.symbol,
      strategy: r.strategy,
      regime: r.regime,
      momentumScore: r.momentumScore,
      momentumGap: r.momentumGap,
      class: r.outcomeClass,
      evidenceClass: r.evidenceClass,
    })),
  ];

  wcsv(OUT.outcomeCsv, outcomeCsvRows);
  wcsv(OUT.thresholdCurveCsv, thresholdCurve);
  wcsv(OUT.currentVsHistoricalCsv, currentVsHistRows);
  wj(OUT.oos, summary.temporalOos);
  wj(OUT.summary, summary);

  const md = [
    "# KRIPTO P2 — MOMENTUM SCORE CALIBRATION + PROFITABILITY RELATIONSHIP FORENSIC",
    "",
    "## Artifacts",
    `- canonical score/outcome: \`kripto-p2-momentum-score-outcome.csv\``,
    `- threshold calibration curve: \`kripto-p2-momentum-threshold-curve.csv\``,
    `- current vs historical: \`kripto-p2-momentum-current-vs-historical.csv\``,
    `- oos: \`kripto-p2-momentum-oos.json\``,
    "",
    "## Final Verdict",
    `MOMENTUM_SCORE_RELATIONSHIP = ${summary.finalVerdict.MOMENTUM_SCORE_RELATIONSHIP}`,
    `MOMENTUM_CALIBRATION = ${summary.finalVerdict.MOMENTUM_CALIBRATION}`,
    `HISTORICAL_PROFITABLE_BELOW_THRESHOLD = ${summary.finalVerdict.HISTORICAL_PROFITABLE_BELOW_THRESHOLD}`,
    `HISTORICAL_LOSS_BELOW_THRESHOLD = ${summary.finalVerdict.HISTORICAL_LOSS_BELOW_THRESHOLD}`,
    `PROFITABLE_LOW_SCORE_NET_PNL = ${summary.finalVerdict.PROFITABLE_LOW_SCORE_NET_PNL}`,
    `LOW_SCORE_EXPECTANCY = ${summary.finalVerdict.LOW_SCORE_EXPECTANCY}`,
    `CURRENT_2278_LOW_SCORE_SHARE = ${summary.finalVerdict.CURRENT_2278_LOW_SCORE_SHARE}`,
    `CURRENT_ZERO_APPROVAL_CAUSE = ${summary.finalVerdict.CURRENT_ZERO_APPROVAL_CAUSE}`,
    `SAFE_NEXT_EXPERIMENT = ${summary.finalVerdict.SAFE_NEXT_EXPERIMENT}`,
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

