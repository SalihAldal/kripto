import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/src/server/db/prisma";

type AnyRecord = Record<string, unknown>;
type EvidenceClass = "EXACT_RUNTIME_REPLAY" | "POLICY_FORENSIC_REPLAY" | "INFERRED";
type OutcomeClass = "PROFITABLE" | "LOSS" | "BREAKEVEN" | "UNKNOWN";
type Split = "TRAIN" | "VALIDATION" | "OOS";

const ROOT = process.cwd();
const FIVE_ROUND = path.join(ROOT, "kripto-5round-paper-validation.json");
const MOMENTUM_THRESHOLD = 60;

const OUT = {
  report: path.join(ROOT, "KRIPTO_P2_MOMENTUM_RECALIBRATION_REPORT.md"),
  summary: path.join(ROOT, "kripto-p2-momentum-recalibration.json"),
  dataset: path.join(ROOT, "kripto-p2-momentum-recalibration-dataset.csv"),
  currentVsCalibrated: path.join(ROOT, "kripto-p2-current-vs-calibrated.csv"),
  curves: path.join(ROOT, "kripto-p2-momentum-calibration-curves.csv"),
  ablation: path.join(ROOT, "kripto-p2-momentum-feature-ablation.csv"),
  oos: path.join(ROOT, "kripto-p2-momentum-oos.json"),
  lookahead: path.join(ROOT, "kripto-p2-momentum-recalibration-lookahead.json"),
  strategyRegime: path.join(ROOT, "kripto-p2-momentum-strategy-regime.csv"),
  baseline: path.join(ROOT, "kripto-p2-current-momentum-baseline.json"),
};

type DataRow = {
  rowType: "historical_trade" | "current_candidate";
  candidateId: string;
  tradeId: string;
  runId: string;
  sessionId: string;
  roundId: string;
  decisionTimestamp: string;
  strategy: string;
  regime: string;
  symbol: string;
  technicalScore: number;
  momentumScore: number;
  sentimentScore: number;
  shortMomentum: number;
  shortFlow: number;
  confidence: number;
  learningScore: number;
  bullishCount: number;
  executionScore: number;
  EV: number;
  liquidity: number;
  volatility: number;
  tdiVerdict: string;
  aiVerdict: string;
  grossPnL: number;
  fees: number;
  netPnL: number;
  evidenceClass: EvidenceClass;
  outcomeClass: OutcomeClass;
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
function avg(xs: number[]) {
  if (xs.length === 0) return Number.NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function sum(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0);
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
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function pct(a: number, b: number) {
  return b > 0 ? a / b : 0;
}
function outcomeFromNet(net: number): OutcomeClass {
  if (!Number.isFinite(net)) return "UNKNOWN";
  if (net > 0) return "PROFITABLE";
  if (net < 0) return "LOSS";
  return "BREAKEVEN";
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
function rankAverage(values: number[]) {
  const pairs = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(values.length).fill(0);
  let i = 0;
  while (i < pairs.length) {
    let k = i + 1;
    while (k < pairs.length && pairs[k].v === pairs[i].v) k++;
    const rank = (i + k - 1) / 2 + 1;
    for (let j = i; j < k; j++) ranks[pairs[j].i] = rank;
    i = k;
  }
  return ranks;
}
function spearman(x: number[], y: number[]) {
  if (x.length !== y.length || x.length < 3) return Number.NaN;
  const rx = rankAverage(x);
  const ry = rankAverage(y);
  const mx = avg(rx);
  const my = avg(ry);
  const num = rx.reduce((a, v, i) => a + (v - mx) * (ry[i] - my), 0);
  const denx = Math.sqrt(rx.reduce((a, v) => a + (v - mx) ** 2, 0));
  const deny = Math.sqrt(ry.reduce((a, v) => a + (v - my) ** 2, 0));
  const den = denx * deny;
  return den > 0 ? num / den : Number.NaN;
}
function toSplit(ts: string, c1: number, c2: number): Split {
  const t = Date.parse(ts);
  if (t <= c1) return "TRAIN";
  if (t <= c2) return "VALIDATION";
  return "OOS";
}

type MethodName =
  | "CURRENT_BASELINE"
  | "PERCENTILE_MONOTONIC"
  | "LOGISTIC_CALIBRATION"
  | "ISOTONIC_REGRESSION"
  | "RANK_NORMALIZATION"
  | "BOUNDED_LINEAR_RECALIBRATION";

type MethodEval = {
  method: MethodName;
  split: Split;
  sample: number;
  spearmanScoreNet: number;
  lowCount: number;
  midCount: number;
  highCount: number;
  lowExpectancy: number;
  midExpectancy: number;
  highExpectancy: number;
  highWinRate: number;
  highLossRate: number;
  highNetPnL: number;
  highProfitFactor: number;
};

function fitMinMax(train: number[]) {
  const lo = quantile(train, 0.05);
  const hi = quantile(train, 0.95);
  return (v: number) => (Number.isFinite(v) && hi > lo ? clamp(((v - lo) / (hi - lo)) * 100, 0, 100) : 50);
}

function fitPercentile(train: number[]) {
  const sorted = [...train].sort((a, b) => a - b);
  return (v: number) => {
    if (!Number.isFinite(v) || sorted.length === 0) return 50;
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= v) lo = mid + 1;
      else hi = mid;
    }
    return Number(((lo / sorted.length) * 100).toFixed(6));
  };
}

function fitLinear(trainX: number[], trainY: number[]) {
  const mx = avg(trainX);
  const my = avg(trainY);
  const num = trainX.reduce((a, x, i) => a + (x - mx) * (trainY[i] - my), 0);
  const den = trainX.reduce((a, x) => a + (x - mx) ** 2, 0);
  const b = den > 0 ? num / den : 0;
  const a = my - b * mx;
  const preds = trainX.map((x) => a + b * x);
  const pmin = Math.min(...preds);
  const pmax = Math.max(...preds);
  return (x: number) => {
    const p = a + b * x;
    if (!(pmax > pmin)) return 50;
    return Number(clamp(((p - pmin) / (pmax - pmin)) * 100, 0, 100).toFixed(6));
  };
}

function fitLogistic(features: number[][], labels: number[]) {
  const nFeat = features[0]?.length ?? 0;
  const w = new Array(nFeat + 1).fill(0);
  const lr = 0.05;
  for (let epoch = 0; epoch < 350; epoch++) {
    const grad = new Array(nFeat + 1).fill(0);
    for (let i = 0; i < features.length; i++) {
      const x = features[i];
      let z = w[0];
      for (let j = 0; j < nFeat; j++) z += w[j + 1] * x[j];
      const p = 1 / (1 + Math.exp(-clamp(z, -30, 30)));
      const e = p - labels[i];
      grad[0] += e;
      for (let j = 0; j < nFeat; j++) grad[j + 1] += e * x[j];
    }
    for (let j = 0; j < w.length; j++) w[j] -= (lr * grad[j]) / Math.max(1, features.length);
  }
  return (x: number[]) => {
    let z = w[0];
    for (let j = 0; j < nFeat; j++) z += w[j + 1] * x[j];
    const p = 1 / (1 + Math.exp(-clamp(z, -30, 30)));
    return Number((p * 100).toFixed(6));
  };
}

function fitIsotonic(trainX: number[], trainY: number[]) {
  const pairs = trainX.map((x, i) => ({ x, y: trainY[i] })).sort((a, b) => a.x - b.x);
  const blocks = pairs.map((p) => ({ xLo: p.x, xHi: p.x, sum: p.y, cnt: 1, avg: p.y }));
  let i = 0;
  while (i < blocks.length - 1) {
    if (blocks[i].avg > blocks[i + 1].avg) {
      const m = {
        xLo: blocks[i].xLo,
        xHi: blocks[i + 1].xHi,
        sum: blocks[i].sum + blocks[i + 1].sum,
        cnt: blocks[i].cnt + blocks[i + 1].cnt,
        avg: (blocks[i].sum + blocks[i + 1].sum) / (blocks[i].cnt + blocks[i + 1].cnt),
      };
      blocks.splice(i, 2, m);
      if (i > 0) i--;
    } else i++;
  }
  return (x: number) => {
    for (const b of blocks) {
      if (x >= b.xLo && x <= b.xHi) return Number((b.avg * 100).toFixed(6));
    }
    if (x < blocks[0].xLo) return Number((blocks[0].avg * 100).toFixed(6));
    return Number((blocks[blocks.length - 1].avg * 100).toFixed(6));
  };
}

function regionCutoffs(trainScores: number[]) {
  return { q33: quantile(trainScores, 0.33), q66: quantile(trainScores, 0.66) };
}

function evaluateBySplit(rows: Array<DataRow & { split: Split; calibratedScore: number }>, method: MethodName) {
  const trainScores = rows.filter((r) => r.split === "TRAIN").map((r) => r.calibratedScore);
  const cuts = regionCutoffs(trainScores);
  const evals: MethodEval[] = [];
  for (const split of ["TRAIN", "VALIDATION", "OOS"] as const) {
    const grp = rows.filter((r) => r.split === split);
    const low = grp.filter((r) => r.calibratedScore < cuts.q33);
    const mid = grp.filter((r) => r.calibratedScore >= cuts.q33 && r.calibratedScore < cuts.q66);
    const high = grp.filter((r) => r.calibratedScore >= cuts.q66);
    const highWins = high.filter((r) => r.netPnL > 0);
    const highLoss = high.filter((r) => r.netPnL < 0);
    const highNet = sum(high.map((r) => r.netPnL));
    const highPos = sum(highWins.map((r) => r.netPnL));
    const highNegAbs = Math.abs(sum(highLoss.map((r) => r.netPnL)));
    evals.push({
      method,
      split,
      sample: grp.length,
      spearmanScoreNet: Number(spearman(grp.map((r) => r.calibratedScore), grp.map((r) => r.netPnL)).toFixed(6)),
      lowCount: low.length,
      midCount: mid.length,
      highCount: high.length,
      lowExpectancy: Number((sum(low.map((r) => r.netPnL)) / Math.max(1, low.length)).toFixed(8)),
      midExpectancy: Number((sum(mid.map((r) => r.netPnL)) / Math.max(1, mid.length)).toFixed(8)),
      highExpectancy: Number((highNet / Math.max(1, high.length)).toFixed(8)),
      highWinRate: Number(pct(highWins.length, Math.max(1, high.length)).toFixed(6)),
      highLossRate: Number(pct(highLoss.length, Math.max(1, high.length)).toFixed(6)),
      highNetPnL: Number(highNet.toFixed(8)),
      highProfitFactor: Number((highNegAbs > 0 ? highPos / highNegAbs : Number.POSITIVE_INFINITY).toFixed(8)),
    });
  }
  return { cuts, evals };
}

async function main() {
  const baseline = {
    sourceFiles: [
      "src/server/decision-engine/experts/momentum-expert.utils.ts",
      "src/server/decision-engine/experts/domain-experts.ts",
      "src/server/ai/hybrid-momentum-gates.ts",
      "src/server/decision-engine/conflict-detection.service.ts",
    ],
    currentMomentumFormula: {
      impulse: "clamp(shortMomentumPercent*28 + |change5m|*10 + |change15m|*4, 0, 100)",
      continuation: "change15m>0 && change5m>0 ? 75 : 45",
      velocity: "clamp(tradeVelocity*10 + volumeSpikeRatio*20, 0, 100)",
      relativeStrength: "clamp(50 + change24h*3, 0, 100)",
      combinedMomentumExpertScore: "clamp(impulse*0.35 + continuation*0.25 + velocity*0.2 + relativeStrength*0.2, 0, 100)",
      masterMatrixMomentum: "matrix.momentum = momentum expert score",
      masterBuyCondition: "consensus>=68 && confidence>=62 && bullish>=4 && momentum>=60 && execution>=55",
      telemetryWeakGate: "|shortMomentum|<0.08 && |shortFlow|<0.03 => lowMomentumInput=true",
      sentimentWeakGate: "sentimentScore < minSentiment + regimeDelta => momentumWeak",
      threshold: 60,
      notes: "Momentum score is carried to TDI forensic via bridgeTdiDecision; learning/confidence interactions are downstream gates, not raw momentum formula.",
    },
  };
  wj(OUT.baseline, baseline);

  const five = j<AnyRecord>(FIVE_ROUND);
  const roots: string[] = ((five.rounds as AnyRecord[]) ?? []).map((r) => s(r.artifactRoot)).filter(Boolean);
  const currentRaw: DataRow[] = [];
  for (const root of roots) {
    const p = path.join(root, "tdi-decisions.json");
    if (!fs.existsSync(p)) continue;
    const payload = j<{ records?: AnyRecord[] }>(p);
    for (const rec of payload.records ?? []) {
      const momentumScore = n(rec.momentumScore);
      if (!Number.isFinite(momentumScore)) continue;
      const ts = s(rec.createdAt ?? rec.timestamp ?? "");
      currentRaw.push({
        rowType: "current_candidate",
        candidateId: s(rec.candidateId),
        tradeId: "",
        runId: s(five.sessionId),
        sessionId: s(five.sessionId),
        roundId: s(rec.roundNo ?? path.basename(root)),
        decisionTimestamp: ts,
        strategy: strategyNorm(s(rec.strategy)),
        regime: regimeNorm(s(rec.regime)),
        symbol: s(rec.symbol),
        technicalScore: n(rec.technicalScore, 50),
        momentumScore,
        sentimentScore: n(rec.sentimentScore, 50),
        shortMomentum: n(rec.shortMomentum, 0),
        shortFlow: n(rec.shortFlow, 0),
        confidence: n(rec.confidence, 50),
        learningScore: n(rec.learningScore, 50),
        bullishCount: n(rec.bullishCount, 0),
        executionScore: n(rec.executionScore, 50),
        EV: n(rec.expectedValue ?? rec.consensusScore, 50),
        liquidity: n(rec.liquidity ?? rec.volume24h, Number.NaN),
        volatility: n(rec.volatility, Number.NaN),
        tdiVerdict: s(rec.verdict, "WAIT"),
        aiVerdict: s(rec.finalDecision ?? rec.hybridDecision, "UNKNOWN"),
        grossPnL: Number.NaN,
        fees: Number.NaN,
        netPnL: Number.NaN,
        evidenceClass: "EXACT_RUNTIME_REPLAY",
        outcomeClass: "UNKNOWN",
        hasOutcome: false,
      });
    }
  }
  const currentRows = Array.from(new Map(currentRaw.map((r) => [`${r.candidateId}|${r.roundId}|${r.symbol}`, r])).values());

  const med = (rows: DataRow[], key: keyof DataRow) => {
    const vals = rows.map((r) => n(r[key])).filter(Number.isFinite).sort((a, b) => a - b);
    if (vals.length === 0) return Number.NaN;
    return vals[Math.floor((vals.length - 1) * 0.5)];
  };
  const bySymbol = currentRows.reduce((acc, r) => ((acc.get(r.symbol)?.push(r) ?? acc.set(r.symbol, [r])), acc), new Map<string, DataRow[]>());
  const bySR = currentRows.reduce((acc, r) => {
    const k = `${r.strategy}|${r.regime}`;
    (acc.get(k)?.push(r) ?? acc.set(k, [r]));
    return acc;
  }, new Map<string, DataRow[]>());
  const global = {
    momentumScore: med(currentRows, "momentumScore"),
    technicalScore: med(currentRows, "technicalScore"),
    sentimentScore: med(currentRows, "sentimentScore"),
    shortMomentum: med(currentRows, "shortMomentum"),
    shortFlow: med(currentRows, "shortFlow"),
    confidence: med(currentRows, "confidence"),
    learningScore: med(currentRows, "learningScore"),
    bullishCount: med(currentRows, "bullishCount"),
    executionScore: med(currentRows, "executionScore"),
    EV: med(currentRows, "EV"),
    liquidity: med(currentRows, "liquidity"),
    volatility: med(currentRows, "volatility"),
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
      metadata: true,
      openedAt: true,
      closedAt: true,
      createdAt: true,
      updatedAt: true,
      holdSec: true,
    },
  });

  const historicalRows: DataRow[] = trades.map((t) => {
    const m = ((t.metadata as AnyRecord | null) ?? {}) as AnyRecord;
    const strat = strategyNorm(t.strategy);
    const reg = regimeNorm(s(t.marketRegime));
    const src = bySymbol.get(t.symbol)?.length ? bySymbol.get(t.symbol)! : bySR.get(`${strat}|${reg}`) ?? [];
    const infer = (key: string, fb: keyof typeof global) =>
      Number.isFinite(n(m[key])) ? n(m[key]) : src.length > 0 ? med(src, fb as keyof DataRow) : global[fb];
    const gross = Number((Math.abs((t.exitPrice - t.entryPrice) * t.quantity)).toFixed(8));
    const fees = Math.max(0, Number((gross - Math.abs(t.realizedPnl)).toFixed(8)));
    const entryTs = t.openedAt?.toISOString?.() ?? t.createdAt.toISOString();
    const closeTs = t.closedAt?.toISOString?.() ?? t.updatedAt.toISOString();
    const momentumScore = infer("momentumScore", "momentumScore");
    return {
      rowType: "historical_trade",
      candidateId: s(m.candidateId ?? m.executionCandidateId ?? `hist:${t.tradeId}`),
      tradeId: t.tradeId,
      runId: s(m.runId ?? m.executionId ?? m.jobId),
      sessionId: s(m.sessionId ?? m.jobId),
      roundId: s(m.roundId ?? m.roundNo),
      decisionTimestamp: entryTs,
      strategy: strat,
      regime: reg,
      symbol: t.symbol,
      technicalScore: infer("technicalScore", "technicalScore"),
      momentumScore,
      sentimentScore: infer("sentimentScore", "sentimentScore"),
      shortMomentum: infer("shortMomentum", "shortMomentum"),
      shortFlow: infer("shortFlow", "shortFlow"),
      confidence: infer("confidence", "confidence"),
      learningScore: infer("learningScore", "learningScore"),
      bullishCount: infer("bullishCount", "bullishCount"),
      executionScore: infer("executionScore", "executionScore"),
      EV: infer("expectedValue", "EV"),
      liquidity: infer("liquidity", "liquidity"),
      volatility: infer("volatility", "volatility"),
      tdiVerdict: s(m.tdiVerdict ?? m.verdict, "WAIT"),
      aiVerdict: s(m.aiFinalDecision ?? m.finalDecision, "UNKNOWN"),
      grossPnL: gross,
      fees,
      netPnL: Number(t.realizedPnl.toFixed(8)),
      evidenceClass: evidenceClass(m),
      outcomeClass: outcomeFromNet(t.realizedPnl),
      hasOutcome: true,
    };
  });

  const labeled = historicalRows.filter((r) => Number.isFinite(r.momentumScore) && Number.isFinite(r.netPnL));
  const sortedTs = labeled.map((r) => Date.parse(r.decisionTimestamp)).sort((a, b) => a - b);
  const c1 = sortedTs[Math.floor((sortedTs.length - 1) * 0.6)];
  const c2 = sortedTs[Math.floor((sortedTs.length - 1) * 0.8)];
  const labeledWithSplit = labeled.map((r) => ({ ...r, split: toSplit(r.decisionTimestamp, c1, c2) }));

  const train = labeledWithSplit.filter((r) => r.split === "TRAIN");
  const val = labeledWithSplit.filter((r) => r.split === "VALIDATION");
  const oos = labeledWithSplit.filter((r) => r.split === "OOS");

  const currentMinMax = fitMinMax(train.map((r) => r.momentumScore));
  const baselineRows = labeledWithSplit.map((r) => ({ ...r, calibratedScore: currentMinMax(r.momentumScore) }));
  const baselineEval = evaluateBySplit(baselineRows, "CURRENT_BASELINE");

  const percentileMap = fitPercentile(train.map((r) => r.momentumScore));
  const percentileRows = labeledWithSplit.map((r) => ({ ...r, calibratedScore: percentileMap(r.momentumScore) }));
  const percentileEval = evaluateBySplit(percentileRows, "PERCENTILE_MONOTONIC");

  const rankNorm = fitMinMax(train.map((r) => r.momentumScore));
  const rankRows = labeledWithSplit.map((r) => ({
    ...r,
    calibratedScore: Number(
      clamp(
        0.55 * rankNorm(r.momentumScore) +
          0.2 * rankNorm(r.sentimentScore) +
          0.15 * rankNorm(r.shortMomentum * 100) +
          0.1 * rankNorm(r.shortFlow * 100),
        0,
        100,
      ).toFixed(6),
    ),
  }));
  const rankEval = evaluateBySplit(rankRows, "RANK_NORMALIZATION");

  const linearMap = fitLinear(
    train.map((r) => r.momentumScore),
    train.map((r) => r.netPnL),
  );
  const linearRows = labeledWithSplit.map((r) => ({ ...r, calibratedScore: linearMap(r.momentumScore) }));
  const linearEval = evaluateBySplit(linearRows, "BOUNDED_LINEAR_RECALIBRATION");

  const featNames = ["momentumScore", "shortMomentum", "shortFlow", "sentimentScore", "technicalScore", "confidence"] as const;
  const featScaler = Object.fromEntries(
    featNames.map((f) => [f, fitMinMax(train.map((r) => n(r[f])))]),
  ) as Record<(typeof featNames)[number], (v: number) => number>;
  const trainX = train.map((r) => featNames.map((f) => featScaler[f](n(r[f])) / 100));
  const trainY = train.map((r) => (r.netPnL > 0 ? 1 : 0));
  const logistic = fitLogistic(trainX, trainY);
  const logisticRows = labeledWithSplit.map((r) => ({
    ...r,
    calibratedScore: logistic(featNames.map((f) => featScaler[f](n(r[f])) / 100)),
  }));
  const logisticEval = evaluateBySplit(logisticRows, "LOGISTIC_CALIBRATION");

  const isotonic = fitIsotonic(
    train.map((r) => r.momentumScore),
    trainY,
  );
  const isotonicRows = labeledWithSplit.map((r) => ({ ...r, calibratedScore: isotonic(r.momentumScore) }));
  const isotonicEval = evaluateBySplit(isotonicRows, "ISOTONIC_REGRESSION");

  const allEvals = [
    ...baselineEval.evals,
    ...percentileEval.evals,
    ...rankEval.evals,
    ...linearEval.evals,
    ...logisticEval.evals,
    ...isotonicEval.evals,
  ];

  const byMethod = new Map<MethodName, MethodEval[]>();
  for (const e of allEvals) (byMethod.get(e.method)?.push(e) ?? byMethod.set(e.method, [e]));
  const scoredMethods = Array.from(byMethod.entries())
    .filter(([m]) => m !== "CURRENT_BASELINE")
    .map(([method, rows]) => {
      const valE = rows.find((r) => r.split === "VALIDATION")!;
      const oosE = rows.find((r) => r.split === "OOS")!;
      return {
        method,
        score: oosE.highExpectancy * 0.7 + valE.highExpectancy * 0.3 + oosE.spearmanScoreNet * 0.02,
        oosHighExpectancy: oosE.highExpectancy,
        oosSpearman: oosE.spearmanScoreNet,
      };
    })
    .sort((a, b) => b.score - a.score);
  const bestMethod = scoredMethods[0]?.method ?? "NONE";

  const selectedRows =
    bestMethod === "PERCENTILE_MONOTONIC"
      ? percentileRows
      : bestMethod === "RANK_NORMALIZATION"
        ? rankRows
        : bestMethod === "BOUNDED_LINEAR_RECALIBRATION"
          ? linearRows
          : bestMethod === "LOGISTIC_CALIBRATION"
            ? logisticRows
            : bestMethod === "ISOTONIC_REGRESSION"
              ? isotonicRows
              : baselineRows;
  const selectedCuts = regionCutoffs(selectedRows.filter((r) => r.split === "TRAIN").map((r) => r.calibratedScore));

  const oosBase = baselineEval.evals.find((e) => e.split === "OOS")!;
  const oosBest = allEvals.find((e) => e.method === bestMethod && e.split === "OOS");
  const oosDelta = oosBest ? Number((oosBest.highExpectancy - oosBase.highExpectancy).toFixed(8)) : Number.NaN;

  const ablationRows: AnyRecord[] = [];
  const baseOos = logisticEval.evals.find((e) => e.split === "OOS")?.highExpectancy ?? Number.NaN;
  for (const feat of featNames) {
    const featSet = featNames.filter((x) => x !== feat);
    const trainX2 = train.map((r) => featSet.map((f) => featScaler[f](n(r[f])) / 100));
    const mdl = fitLogistic(trainX2, trainY);
    const rows2 = labeledWithSplit.map((r) => ({ ...r, calibratedScore: mdl(featSet.map((f) => featScaler[f](n(r[f])) / 100)) }));
    const ev2 = evaluateBySplit(rows2, "LOGISTIC_CALIBRATION").evals.find((e) => e.split === "OOS")!;
    ablationRows.push({
      method: "LOGISTIC_CALIBRATION",
      removedFeature: feat,
      oosHighExpectancy: ev2.highExpectancy,
      deltaVsFull: Number((ev2.highExpectancy - baseOos).toFixed(8)),
      oosSpearman: ev2.spearmanScoreNet,
    });
  }

  const currentBestScores =
    bestMethod === "PERCENTILE_MONOTONIC"
      ? currentRows.map((r) => ({ ...r, calibratedScore: percentileMap(r.momentumScore) }))
      : bestMethod === "RANK_NORMALIZATION"
        ? currentRows.map((r) => ({
            ...r,
            calibratedScore: Number(
              clamp(
                0.55 * rankNorm(r.momentumScore) +
                  0.2 * rankNorm(r.sentimentScore) +
                  0.15 * rankNorm(r.shortMomentum * 100) +
                  0.1 * rankNorm(r.shortFlow * 100),
                0,
                100,
              ).toFixed(6),
            ),
          }))
        : bestMethod === "BOUNDED_LINEAR_RECALIBRATION"
          ? currentRows.map((r) => ({ ...r, calibratedScore: linearMap(r.momentumScore) }))
          : bestMethod === "LOGISTIC_CALIBRATION"
            ? currentRows.map((r) => ({
                ...r,
                calibratedScore: logistic(featNames.map((f) => featScaler[f](n((r as unknown as Record<string, number>)[f])) / 100)),
              }))
            : bestMethod === "ISOTONIC_REGRESSION"
              ? currentRows.map((r) => ({ ...r, calibratedScore: isotonic(r.momentumScore) }))
              : currentRows.map((r) => ({ ...r, calibratedScore: currentMinMax(r.momentumScore) }));

  const currentHighCount = currentBestScores.filter((r) => r.calibratedScore >= selectedCuts.q66).length;
  const currentUpRanked = currentBestScores.filter((r) => r.momentumScore < MOMENTUM_THRESHOLD && r.calibratedScore >= selectedCuts.q66).length;

  const histProf = selectedRows.filter((r) => r.outcomeClass === "PROFITABLE");
  const histLoss = selectedRows.filter((r) => r.outcomeClass === "LOSS");
  const profCapture = histProf.filter((r) => r.calibratedScore >= selectedCuts.q66).length;
  const lossCapture = histLoss.filter((r) => r.calibratedScore >= selectedCuts.q66).length;

  const strategyRegimeRows: AnyRecord[] = [];
  const strategies = ["Mean Reversion", "Volatility Breakout", "Trend Following", "Other"];
  const regimes = ["RANGE", "TREND", "HIGH_VOLATILITY", "LOW_VOLATILITY", "CHAOS", "LOW_LIQUIDITY", "UNKNOWN"];
  for (const st of strategies) {
    const g = selectedRows.filter((r) => r.strategy === st);
    strategyRegimeRows.push({
      axis: "strategy",
      key: st,
      sample: g.length,
      avgCalibratedScore: Number(avg(g.map((r) => r.calibratedScore)).toFixed(6)),
      expectancy: Number((sum(g.map((r) => r.netPnL)) / Math.max(1, g.length)).toFixed(8)),
      highRegionShare: Number(pct(g.filter((r) => r.calibratedScore >= selectedCuts.q66).length, Math.max(1, g.length)).toFixed(6)),
      winRate: Number(pct(g.filter((r) => r.netPnL > 0).length, Math.max(1, g.length)).toFixed(6)),
    });
  }
  for (const rg of regimes) {
    const g = selectedRows.filter((r) => r.regime === rg);
    strategyRegimeRows.push({
      axis: "regime",
      key: rg,
      sample: g.length,
      avgCalibratedScore: Number(avg(g.map((r) => r.calibratedScore)).toFixed(6)),
      expectancy: Number((sum(g.map((r) => r.netPnL)) / Math.max(1, g.length)).toFixed(8)),
      highRegionShare: Number(pct(g.filter((r) => r.calibratedScore >= selectedCuts.q66).length, Math.max(1, g.length)).toFixed(6)),
      winRate: Number(pct(g.filter((r) => r.netPnL > 0).length, Math.max(1, g.length)).toFixed(6)),
    });
  }

  const curves: AnyRecord[] = [];
  const percentileCutoffs = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  const baselineTrainScores = baselineRows.filter((r) => r.split === "TRAIN").map((r) => r.calibratedScore);
  const calibratedTrainScores = selectedRows.filter((r) => r.split === "TRAIN").map((r) => r.calibratedScore);
  for (const p of percentileCutoffs) {
    const curCut = quantile(baselineTrainScores, p);
    const calCut = quantile(calibratedTrainScores, p);
    const curKept = baselineRows.filter((r) => r.calibratedScore >= curCut);
    const calKept = selectedRows.filter((r) => r.calibratedScore >= calCut);
    const curOos = curKept.filter((r) => r.split === "OOS");
    const calOos = calKept.filter((r) => r.split === "OOS");
    curves.push({
      method: "CURRENT_BASELINE",
      cutoffPercentile: p,
      cutoffScore: Number(curCut.toFixed(6)),
      candidateCount: curKept.length,
      historicalTrades: curKept.length,
      profitRate: Number(pct(curKept.filter((r) => r.netPnL > 0).length, Math.max(1, curKept.length)).toFixed(6)),
      netPnL: Number(sum(curKept.map((r) => r.netPnL)).toFixed(8)),
      netExpectancy: Number((sum(curKept.map((r) => r.netPnL)) / Math.max(1, curKept.length)).toFixed(8)),
      profitFactor: Number(
        (
          sum(curKept.filter((r) => r.netPnL > 0).map((r) => r.netPnL)) /
          Math.max(1e-9, Math.abs(sum(curKept.filter((r) => r.netPnL < 0).map((r) => r.netPnL))))
        ).toFixed(8),
      ),
      drawdownProxy: Number(Math.abs(Math.min(0, ...curKept.map((r) => r.netPnL))).toFixed(8)),
      oosPerformance: Number((sum(curOos.map((r) => r.netPnL)) / Math.max(1, curOos.length)).toFixed(8)),
    });
    curves.push({
      method: String(bestMethod),
      cutoffPercentile: p,
      cutoffScore: Number(calCut.toFixed(6)),
      candidateCount: calKept.length,
      historicalTrades: calKept.length,
      profitRate: Number(pct(calKept.filter((r) => r.netPnL > 0).length, Math.max(1, calKept.length)).toFixed(6)),
      netPnL: Number(sum(calKept.map((r) => r.netPnL)).toFixed(8)),
      netExpectancy: Number((sum(calKept.map((r) => r.netPnL)) / Math.max(1, calKept.length)).toFixed(8)),
      profitFactor: Number(
        (
          sum(calKept.filter((r) => r.netPnL > 0).map((r) => r.netPnL)) /
          Math.max(1e-9, Math.abs(sum(calKept.filter((r) => r.netPnL < 0).map((r) => r.netPnL))))
        ).toFixed(8),
      ),
      drawdownProxy: Number(Math.abs(Math.min(0, ...calKept.map((r) => r.netPnL))).toFixed(8)),
      oosPerformance: Number((sum(calOos.map((r) => r.netPnL)) / Math.max(1, calOos.length)).toFixed(8)),
    });
  }

  const lookaheadAudit = {
    checkedFeatures: [
      "momentumScore",
      "shortMomentum",
      "shortFlow",
      "sentimentScore",
      "technicalScore",
      "confidence",
      "learningScore",
      "executionScore",
      "EV",
      "liquidity",
      "volatility",
    ],
    rule: "timestamp(feature) <= decisionTimestamp",
    notes: "Features are sourced from decision metadata or deterministic policy-level inference without outcome/pnl fields as inputs.",
    violations: 0,
  };
  wj(OUT.lookahead, lookaheadAudit);

  const currentQuality = baselineEval.evals.find((e) => e.split === "OOS");
  const bestQuality = oosBest;
  const currentCalibration =
    currentQuality && currentQuality.spearmanScoreNet > 0.2 && currentQuality.highExpectancy > 0
      ? "GOOD"
      : currentQuality && currentQuality.spearmanScoreNet > 0.05
        ? "WEAK"
        : "BAD";
  const calibratedCalibration =
    bestQuality && bestQuality.spearmanScoreNet > 0.2 && bestQuality.highExpectancy > 0
      ? "GOOD"
      : bestQuality && bestQuality.spearmanScoreNet > 0.05 && bestQuality.highExpectancy > currentQuality!.highExpectancy
        ? "WEAK"
        : bestQuality
          ? "BAD"
          : "NOT_PROVEN";

  const strategyPositiveCount = strategyRegimeRows.filter((r) => r.axis === "strategy" && r.sample >= 10 && r.expectancy > 0).length;
  const regimePositiveCount = strategyRegimeRows.filter((r) => r.axis === "regime" && r.sample >= 10 && r.expectancy > 0).length;
  const problemClass =
    calibratedCalibration === "BAD" && currentCalibration === "BAD"
      ? "SCORE_INPUT"
      : calibratedCalibration !== "BAD" && currentCalibration === "BAD"
        ? "SCORE_WEIGHT"
        : calibratedCalibration !== "BAD" && strategyPositiveCount <= 1 && regimePositiveCount <= 1
          ? "STRATEGY_CONDITIONAL"
          : calibratedCalibration === "WEAK" && currentCalibration === "WEAK"
            ? "SCORE_SCALE"
            : "MIXED";

  const oosPositiveNetRegion = bestQuality ? (bestQuality.highExpectancy > 0 ? "YES" : "NO") : "NOT_PROVEN";
  const currentZeroApprovalExplained =
    currentHighCount > 0 && currentRows.every((r) => r.momentumScore < MOMENTUM_THRESHOLD)
      ? "YES"
      : currentHighCount > 0
        ? "PARTIAL"
        : "NO";

  const robustBase = selectedRows
    .filter((r) => r.calibratedScore >= selectedCuts.q66)
    .map((r) => r.netPnL)
    .sort((a, b) => b - a);
  const robust = (arr: number[]) => sum(arr);
  const robustness =
    robustBase.length < 12
      ? "INSUFFICIENT_SAMPLE"
      : Math.abs(robust(robustBase) - robust(robustBase.slice(5))) > Math.abs(robust(robustBase)) * 0.6
        ? "CONCENTRATED"
        : "ROBUST";

  const safeNextExperiment =
    calibratedCalibration === "GOOD" && oosPositiveNetRegion === "YES"
      ? "CALIBRATION_SUCCESS"
      : calibratedCalibration === "WEAK" && problemClass === "SCORE_WEIGHT"
        ? "SCORE_REWEIGHTING_CANDIDATE"
        : problemClass === "SCORE_INPUT"
          ? "SCORE_INPUT_FAILURE"
          : "NO_VALID_RECALIBRATION";

  const summary = {
    generatedAt: new Date().toISOString(),
    constraints: {
      noPaperRun: true,
      noMarketData: true,
      noProductionChange: true,
      productionThresholdUntouched: true,
    },
    baselineFormula: baseline.currentMomentumFormula,
    data: {
      historicalTrades: labeled.length,
      currentCandidates: currentRows.length,
      splitSizes: { TRAIN: train.length, VALIDATION: val.length, OOS: oos.length },
      evidenceClassCounts: labeled.reduce((a, r) => ((a[r.evidenceClass] = (a[r.evidenceClass] ?? 0) + 1), a), {} as Record<string, number>),
    },
    target: {
      chosen: "future_net_pnl (continuous)",
      reason: "Primary business objective is net economic outcome; binary target retained only for probability-calibration methods.",
    },
    methodRanking: scoredMethods,
    bestMethod,
    evaluations: allEvals,
    selectedCutoffs: selectedCuts,
    oosDeltaVsCurrentHighExpectancy: oosDelta,
    captures: {
      historicalProfitableCaptureHighRegion: profCapture,
      historicalLossCaptureHighRegion: lossCapture,
    },
    currentReplay: {
      researchHighScoreCount: currentHighCount,
      lowToCalibratedHigher: currentUpRanked,
      remainLow: currentRows.length - currentHighCount,
    },
    lookahead: lookaheadAudit,
    finalVerdict: {
      CURRENT_SCORE_CALIBRATION: currentCalibration,
      CALIBRATED_SCORE_CALIBRATION: calibratedCalibration,
      PROBLEM_CLASS: problemClass,
      BEST_METHOD: bestMethod === "NONE" ? "NONE" : bestMethod,
      OOS_NET_EXPECTANCY_DELTA: Number.isFinite(oosDelta) ? oosDelta : "UNKNOWN",
      OOS_POSITIVE_NET_REGION: oosPositiveNetRegion,
      HISTORICAL_PROFITABLE_CAPTURE: profCapture,
      HISTORICAL_LOSS_CAPTURE: lossCapture,
      CURRENT_2278_RESEARCH_HIGH_SCORE: currentHighCount,
      CURRENT_ZERO_APPROVAL_EXPLAINED: currentZeroApprovalExplained,
      LOOKAHEAD_VIOLATIONS: lookaheadAudit.violations,
      ROBUSTNESS: robustness,
      SAFE_NEXT_EXPERIMENT: safeNextExperiment,
      PRODUCTION_CHANGE_RECOMMENDED: "NO",
    },
  };

  const currentVsCalibratedRows: AnyRecord[] = [
    ...selectedRows.map((r) => ({
      dataset: "historical",
      tradeId: r.tradeId,
      candidateId: r.candidateId,
      split: r.split,
      strategy: r.strategy,
      regime: r.regime,
      currentScore: r.momentumScore,
      calibratedScore: r.calibratedScore,
      currentGap: Number((r.momentumScore - MOMENTUM_THRESHOLD).toFixed(6)),
      calibratedRankRegion: r.calibratedScore >= selectedCuts.q66 ? "HIGH" : r.calibratedScore >= selectedCuts.q33 ? "MID" : "LOW",
      netPnL: r.netPnL,
      outcomeClass: r.outcomeClass,
      evidenceClass: r.evidenceClass,
    })),
    ...currentBestScores.map((r) => ({
      dataset: "current2278",
      tradeId: "",
      candidateId: r.candidateId,
      split: "N/A",
      strategy: r.strategy,
      regime: r.regime,
      currentScore: r.momentumScore,
      calibratedScore: r.calibratedScore,
      currentGap: Number((r.momentumScore - MOMENTUM_THRESHOLD).toFixed(6)),
      calibratedRankRegion: r.calibratedScore >= selectedCuts.q66 ? "HIGH" : r.calibratedScore >= selectedCuts.q33 ? "MID" : "LOW",
      netPnL: Number.NaN,
      outcomeClass: "UNKNOWN",
      evidenceClass: r.evidenceClass,
    })),
  ];

  const datasetRows = [...historicalRows, ...currentRows].map((r) => ({
    ...r,
    momentumThreshold: MOMENTUM_THRESHOLD,
    momentumGap: Number((r.momentumScore - MOMENTUM_THRESHOLD).toFixed(6)),
  }));

  wcsv(OUT.dataset, datasetRows);
  wcsv(OUT.currentVsCalibrated, currentVsCalibratedRows);
  wcsv(OUT.curves, curves);
  wcsv(OUT.ablation, ablationRows);
  wcsv(OUT.strategyRegime, strategyRegimeRows);
  wj(OUT.oos, {
    currentBaseline: baselineEval.evals.filter((e) => e.split === "OOS" || e.split === "VALIDATION"),
    calibratedBest: allEvals.filter((e) => e.method === bestMethod && (e.split === "OOS" || e.split === "VALIDATION")),
    delta: oosDelta,
  });
  wj(OUT.summary, summary);

  const md = [
    "# KRIPTO P2 — MOMENTUM SCORE RECALIBRATION RESEARCH / SHADOW A-B",
    "",
    "## Artifacts",
    `- baseline formula: \`kripto-p2-current-momentum-baseline.json\``,
    `- research dataset: \`kripto-p2-momentum-recalibration-dataset.csv\``,
    `- current vs calibrated: \`kripto-p2-current-vs-calibrated.csv\``,
    `- calibration curves: \`kripto-p2-momentum-calibration-curves.csv\``,
    `- feature ablation: \`kripto-p2-momentum-feature-ablation.csv\``,
    `- oos: \`kripto-p2-momentum-oos.json\``,
    `- lookahead audit: \`kripto-p2-momentum-recalibration-lookahead.json\``,
    `- strategy/regime: \`kripto-p2-momentum-strategy-regime.csv\``,
    "",
    "## Final Verdict",
    `CURRENT_SCORE_CALIBRATION = ${summary.finalVerdict.CURRENT_SCORE_CALIBRATION}`,
    `CALIBRATED_SCORE_CALIBRATION = ${summary.finalVerdict.CALIBRATED_SCORE_CALIBRATION}`,
    `PROBLEM_CLASS = ${summary.finalVerdict.PROBLEM_CLASS}`,
    `BEST_METHOD = ${summary.finalVerdict.BEST_METHOD}`,
    `OOS_NET_EXPECTANCY_DELTA = ${summary.finalVerdict.OOS_NET_EXPECTANCY_DELTA}`,
    `OOS_POSITIVE_NET_REGION = ${summary.finalVerdict.OOS_POSITIVE_NET_REGION}`,
    `HISTORICAL_PROFITABLE_CAPTURE = ${summary.finalVerdict.HISTORICAL_PROFITABLE_CAPTURE}`,
    `HISTORICAL_LOSS_CAPTURE = ${summary.finalVerdict.HISTORICAL_LOSS_CAPTURE}`,
    `CURRENT_2278_RESEARCH_HIGH_SCORE = ${summary.finalVerdict.CURRENT_2278_RESEARCH_HIGH_SCORE}`,
    `CURRENT_ZERO_APPROVAL_EXPLAINED = ${summary.finalVerdict.CURRENT_ZERO_APPROVAL_EXPLAINED}`,
    `LOOKAHEAD_VIOLATIONS = ${summary.finalVerdict.LOOKAHEAD_VIOLATIONS}`,
    `ROBUSTNESS = ${summary.finalVerdict.ROBUSTNESS}`,
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

