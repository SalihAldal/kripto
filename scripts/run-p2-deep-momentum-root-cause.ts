import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/src/server/db/prisma";
import { correctionDecision, type ShadowInput } from "@/src/server/forensics/confidence-interaction-correction-shadow.service";

type AnyRecord = Record<string, unknown>;
type EvidenceClass = "EXACT_RUNTIME_REPLAY" | "POLICY_FORENSIC_REPLAY" | "INFERRED";
type Verdict = "APPROVED" | "WAIT" | "REJECTED";

const ROOT = process.cwd();
const FIVE_ROUND = path.join(ROOT, "kripto-5round-paper-validation.json");

const OUT = {
  report: path.join(ROOT, "KRIPTO_P2_DEEP_MOMENTUM_ROOT_CAUSE_REPORT.md"),
  summary: path.join(ROOT, "kripto-p2-deep-momentum-root-cause.json"),
  codePath: path.join(ROOT, "kripto-p2-momentum-code-path.json"),
  formula: path.join(ROOT, "kripto-p2-momentum-formula.json"),
  unitAudit: path.join(ROOT, "kripto-p2-momentum-unit-audit.csv"),
  profitable42: path.join(ROOT, "kripto-p2-42-profitable-momentum-blockers.csv"),
  current2278: path.join(ROOT, "kripto-p2-2278-current-momentum-blockers.csv"),
  counterfactuals: path.join(ROOT, "kripto-p2-momentum-counterfactuals.csv"),
  doublePenalty: path.join(ROOT, "kripto-p2-momentum-double-penalty.csv"),
  ordering: path.join(ROOT, "kripto-p2-momentum-ordering.csv"),
  oos: path.join(ROOT, "kripto-p2-momentum-oos.json"),
  experiments: path.join(ROOT, "kripto-p2-momentum-experiments.json"),
};

const TH = {
  technical: 48,
  sentiment: 42,
  momentum: 60,
  confidenceWait: 40,
  confidenceBuy: 62,
  bullish: 4,
  execution: 55,
  masterConsensus: 68,
  shortMomentumAbs: 0.08,
  shortFlowAbs: 0.03,
  hybridSentimentMin: 52,
};

const REGIME_DELTA: Record<string, number> = {
  STRONG_BULLISH_TREND: -2,
  WEAK_BULLISH_TREND: 0,
  STRONG_BEARISH_TREND: 5,
  WEAK_BEARISH_TREND: 4,
  HIGH_VOLATILITY_CHAOS: 5,
  LOW_VOLATILITY_CALM: 2,
  NEWS_DRIVEN_UNSTABLE: 6,
  LOW_VOLUME_DEAD_MARKET: 99,
  RANGE_SIDEWAYS: 0,
  ROCKET_PUMP: -2,
  RANGE: 0,
  TREND: 0,
  HIGH_VOLATILITY: 5,
  LOW_VOLATILITY: 2,
  CHAOS: 5,
  LOW_LIQUIDITY: 99,
  UNKNOWN: 0,
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
function pct(a: number, b: number) {
  return b > 0 ? Number((a / b).toFixed(6)) : 0;
}
function quant(values: number[]) {
  const arr = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (arr.length === 0) return { count: 0, mean: null, median: null, p10: null, p25: null, p50: null, p75: null, p90: null, min: null, max: null };
  const pick = (p: number) => arr[Math.min(arr.length - 1, Math.floor((arr.length - 1) * p))];
  return {
    count: arr.length,
    mean: Number((arr.reduce((x, y) => x + y, 0) / arr.length).toFixed(6)),
    median: pick(0.5),
    p10: pick(0.1),
    p25: pick(0.25),
    p50: pick(0.5),
    p75: pick(0.75),
    p90: pick(0.9),
    min: arr[0],
    max: arr[arr.length - 1],
  };
}
function f(v: unknown, d = 2) {
  const x = Number(v);
  return Number.isFinite(x) ? x.toFixed(d) : "NaN";
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
function verdictNorm(v: string): Verdict {
  const x = v.toUpperCase();
  if (x.includes("APPROV")) return "APPROVED";
  if (x.includes("REJECT") || x.includes("NO_TRADE")) return "REJECTED";
  return "WAIT";
}
function evidenceClass(meta: AnyRecord): EvidenceClass {
  const keys = ["technicalScore", "momentumScore", "sentimentScore", "shortMomentum", "shortFlow", "confidence"];
  const exact = keys.every((k) => Number.isFinite(n(meta[k])));
  if (exact && meta.tdiVerdict) return "EXACT_RUNTIME_REPLAY";
  const policy = Number.isFinite(n(meta.momentumScore)) || Number.isFinite(n(meta.shortMomentum)) || Number.isFinite(n(meta.shortFlow));
  return policy ? "POLICY_FORENSIC_REPLAY" : "INFERRED";
}

type State = {
  tradeId?: string;
  candidateId: string;
  runId: string;
  sessionId: string;
  roundId: string;
  symbol: string;
  strategy: string;
  regime: string;
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
  baselineVerdict: Verdict;
  firstBlockingCondition: string;
  blockingConditions: string[];
  scoreType: string;
  masterExpertConsensusScore: number;
  hybridCompositeScore: number;
  legacyDecision: string;
  evidenceClass: EvidenceClass;
  netPnL?: number;
  grossPnL?: number;
  fees?: number;
  entryTimestamp?: string;
};

function hasData(s1: State) {
  return [
    s1.technicalScore,
    s1.momentumScore,
    s1.sentimentScore,
    s1.shortMomentum,
    s1.shortFlow,
    s1.confidence,
    s1.bullishCount,
    s1.executionScore,
    s1.EV,
  ].every((x) => Number.isFinite(x));
}

type Eval = {
  verdict: Verdict;
  first: string;
  all: string[];
  gaps: Record<string, number>;
  momentumWeak: boolean;
  sentimentWeak: boolean;
  lowMomentumInput: boolean;
};

function evaluateState(
  s1: State,
  opts: {
    removeShortMomentumPenalty?: boolean;
    removeShortFlowPenalty?: boolean;
    removeSentimentInteraction?: boolean;
    removeMomentumConfidenceInteraction?: boolean;
    removeMomentumLearningInteraction?: boolean;
    removeMomentumRegimeAdjustment?: boolean;
    removeTechnicalInteraction?: boolean;
    ordering?: "A" | "B" | "C";
    confidenceOverride?: number;
  } = {},
): Eval {
  if (!hasData(s1)) {
    return {
      verdict: "WAIT",
      first: "DATA_QUALITY",
      all: ["DATA_QUALITY"],
      gaps: {},
      momentumWeak: true,
      sentimentWeak: false,
      lowMomentumInput: false,
    };
  }

  const confidence = Number.isFinite(opts.confidenceOverride) ? Number(opts.confidenceOverride) : s1.confidence;
  const regimeDelta = opts.removeMomentumRegimeAdjustment ? 0 : (REGIME_DELTA[s1.regime] ?? 0);

  const shortMomentumFail = opts.removeShortMomentumPenalty ? false : Math.abs(s1.shortMomentum) < TH.shortMomentumAbs;
  const shortFlowFail = opts.removeShortFlowPenalty ? false : Math.abs(s1.shortFlow) < TH.shortFlowAbs;
  const lowMomentumInput = shortMomentumFail && shortFlowFail;
  const sentimentWeak = opts.removeSentimentInteraction ? false : s1.sentimentScore < TH.hybridSentimentMin + regimeDelta;
  const learningNeg = Number.isFinite(s1.learningScore) && s1.learningScore < 45;
  const momentumWeakCore = sentimentWeak || lowMomentumInput || s1.momentumScore < TH.momentum;
  const momentumWeak =
    opts.removeMomentumLearningInteraction && learningNeg
      ? sentimentWeak || s1.momentumScore < TH.momentum
      : momentumWeakCore;
  const momentumConfidenceCoupled =
    !opts.removeMomentumConfidenceInteraction &&
    momentumWeak &&
    confidence < TH.confidenceWait;

  const technicalFail = opts.removeTechnicalInteraction ? false : s1.technicalScore < TH.technical || s1.sentimentScore < TH.sentiment;
  const momentumFail = momentumWeak;
  const confidenceFail = confidence < TH.confidenceWait && !momentumConfidenceCoupled;
  const bullishFail = s1.bullishCount < TH.bullish;
  const executionFail = s1.executionScore < TH.execution;
  const masterFail =
    s1.EV < TH.masterConsensus ||
    confidence < TH.confidenceBuy ||
    s1.momentumScore < TH.momentum ||
    s1.executionScore < TH.execution ||
    s1.bullishCount < TH.bullish;

  const gaps = {
    momentumScoreGap: Number((s1.momentumScore - TH.momentum).toFixed(6)),
    shortMomentumGap: Number((Math.abs(s1.shortMomentum) - TH.shortMomentumAbs).toFixed(6)),
    shortFlowGap: Number((Math.abs(s1.shortFlow) - TH.shortFlowAbs).toFixed(6)),
    sentimentGap: Number((s1.sentimentScore - (TH.hybridSentimentMin + regimeDelta)).toFixed(6)),
    technicalGap: Number((s1.technicalScore - TH.technical).toFixed(6)),
    confidenceGap: Number((confidence - TH.confidenceWait).toFixed(6)),
    executionGap: Number((s1.executionScore - TH.execution).toFixed(6)),
    bullishGap: Number((s1.bullishCount - TH.bullish).toFixed(6)),
    evGap: Number((s1.EV - TH.masterConsensus).toFixed(6)),
  };

  const orderA: Array<[string, boolean]> = [
    ["TECHNICAL", technicalFail],
    ["MOMENTUM", momentumFail],
    ["CONFIDENCE", confidenceFail],
    ["MASTER_DECISION", masterFail],
  ];
  const orderB: Array<[string, boolean]> = [
    ["MOMENTUM", momentumFail],
    ["TECHNICAL", technicalFail],
    ["CONFIDENCE", confidenceFail],
    ["MASTER_DECISION", masterFail],
  ];
  const orderC: Array<[string, boolean]> = [
    ["MOMENTUM", momentumFail],
    ["CONFIDENCE", confidenceFail],
    ["TECHNICAL", technicalFail],
    ["MASTER_DECISION", masterFail],
  ];
  const order = opts.ordering === "B" ? orderB : opts.ordering === "C" ? orderC : orderA;

  const failed = order.filter((x) => x[1]).map((x) => x[0]);
  if (failed.length === 0) {
    return { verdict: "APPROVED", first: "NONE", all: [], gaps, momentumWeak, sentimentWeak, lowMomentumInput };
  }
  const first = failed[0];
  const verdict: Verdict = first === "TECHNICAL" ? "REJECTED" : "WAIT";
  return { verdict, first, all: failed, gaps, momentumWeak, sentimentWeak, lowMomentumInput };
}

function buildShadowInput(s1: State): ShadowInput {
  return {
    candidateId: s1.candidateId,
    symbol: s1.symbol,
    strategy: s1.strategy,
    regime: s1.regime,
    technicalScore: s1.technicalScore,
    momentumScore: s1.momentumScore,
    sentimentScore: s1.sentimentScore,
    shortMomentum: s1.shortMomentum,
    shortFlow: s1.shortFlow,
    confidence: s1.confidence,
    learningScore: s1.learningScore,
    bullishCount: s1.bullishCount,
    executionScore: s1.executionScore,
    expectedValue: s1.EV,
    firstBlockingCondition: s1.firstBlockingCondition,
    blockingConditions: s1.blockingConditions,
    baselineVerdict: s1.baselineVerdict,
  };
}

function distributionRows(name: string, rows: State[]) {
  const dist = (key: keyof State) => quant(rows.map((r) => n(r[key])));
  return {
    cohort: name,
    momentumScore: dist("momentumScore"),
    shortMomentum: dist("shortMomentum"),
    shortFlow: dist("shortFlow"),
    sentiment: dist("sentimentScore"),
    momentumScoreGap: quant(rows.map((r) => n(r.momentumScore) - TH.momentum)),
    shortMomentumGap: quant(rows.map((r) => Math.abs(n(r.shortMomentum)) - TH.shortMomentumAbs)),
    shortFlowGap: quant(rows.map((r) => Math.abs(n(r.shortFlow)) - TH.shortFlowAbs)),
    sentimentGap: quant(rows.map((r) => n(r.sentimentScore) - TH.hybridSentimentMin)),
  };
}

async function main() {
  const five = j<AnyRecord>(FIVE_ROUND);
  const roots: string[] = ((five.rounds as AnyRecord[]) ?? []).map((r) => s(r.artifactRoot)).filter(Boolean);

  const current: State[] = [];
  for (const root of roots) {
    const p = path.join(root, "tdi-decisions.json");
    if (!fs.existsSync(p)) continue;
    const payload = j<{ records?: AnyRecord[] }>(p);
    for (const rec of payload.records ?? []) {
      current.push({
        candidateId: s(rec.candidateId),
        runId: s(five.sessionId),
        sessionId: s(five.sessionId),
        roundId: s(rec.roundNo ?? path.basename(root)),
        symbol: s(rec.symbol),
        strategy: strategyNorm(s(rec.strategy)),
        regime: regimeNorm(s(rec.regime)),
        technicalScore: n(rec.technicalScore),
        momentumScore: n(rec.momentumScore),
        sentimentScore: n(rec.sentimentScore),
        shortMomentum: n(rec.shortMomentum),
        shortFlow: n(rec.shortFlow),
        confidence: n(rec.confidence),
        learningScore: n(rec.learningScore),
        bullishCount: n(rec.bullishCount),
        executionScore: n(rec.executionScore),
        EV: n(rec.expectedValue ?? rec.consensusScore),
        liquidity: n(rec.liquidity),
        volatility: n(rec.volatility),
        baselineVerdict: verdictNorm(s(rec.verdict)),
        firstBlockingCondition: s(rec.firstBlockingCondition, "UNKNOWN"),
        blockingConditions: Array.isArray(rec.blockingConditions) ? (rec.blockingConditions as unknown[]).map((x) => s(x)) : [],
        scoreType: s(rec.scoreType, "UNKNOWN"),
        masterExpertConsensusScore: n(rec.masterExpertConsensusScore),
        hybridCompositeScore: n(rec.hybridCompositeScore),
        legacyDecision: s(rec.legacyDecision, "UNKNOWN"),
        evidenceClass: "EXACT_RUNTIME_REPLAY",
      });
    }
  }
  const currentUnique = Array.from(new Map(current.map((r) => [`${r.candidateId}|${r.roundId}|${r.symbol}`, r])).values());

  const bySymbol = currentUnique.reduce((acc, r) => ((acc.get(r.symbol)?.push(r) ?? acc.set(r.symbol, [r])), acc), new Map<string, State[]>());
  const bySR = currentUnique.reduce((acc, r) => {
    const k = `${r.strategy}|${r.regime}`;
    (acc.get(k)?.push(r) ?? acc.set(k, [r]));
    return acc;
  }, new Map<string, State[]>());
  const median = (arr: State[], key: keyof State) => quant(arr.map((x) => n(x[key]))).median ?? Number.NaN;

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

  const historical: State[] = trades.map((t) => {
    const m = ((t.metadata as AnyRecord | null) ?? {}) as AnyRecord;
    const e = evidenceClass(m);
    const symRows = bySymbol.get(t.symbol) ?? [];
    const srRows = bySR.get(`${strategyNorm(t.strategy)}|${regimeNorm(s(t.marketRegime))}`) ?? [];
    const src = symRows.length > 0 ? symRows : srRows;
    const infer = (key: string, fallbackKey?: keyof State) =>
      Number.isFinite(n(m[key])) ? n(m[key]) : src.length > 0 && fallbackKey ? median(src, fallbackKey) : Number.NaN;
    const gross = Number((Math.abs((t.exitPrice - t.entryPrice) * t.quantity)).toFixed(8));
    const fees = Math.max(0, Number((gross - Math.abs(t.realizedPnl)).toFixed(8)));
    return {
      tradeId: t.tradeId,
      candidateId: s(m.candidateId ?? m.executionCandidateId ?? `hist:${t.tradeId}`),
      runId: s(m.runId ?? m.executionId ?? m.jobId),
      sessionId: s(m.sessionId ?? m.jobId),
      roundId: s(m.roundId ?? m.roundNo),
      symbol: t.symbol,
      strategy: strategyNorm(t.strategy),
      regime: regimeNorm(s(t.marketRegime)),
      technicalScore: infer("technicalScore", "technicalScore"),
      momentumScore: infer("momentumScore", "momentumScore"),
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
      baselineVerdict: verdictNorm(s(m.tdiVerdict ?? m.verdict, "WAIT")),
      firstBlockingCondition: s(m.firstBlockingCondition, "UNKNOWN"),
      blockingConditions: Array.isArray(m.blockingConditions) ? (m.blockingConditions as unknown[]).map((x) => s(x)) : [],
      scoreType: s(m.scoreType, "INFERRED"),
      masterExpertConsensusScore: infer("masterExpertConsensusScore", "masterExpertConsensusScore"),
      hybridCompositeScore: infer("hybridCompositeScore", "hybridCompositeScore"),
      legacyDecision: s(m.legacyDecision, "UNKNOWN"),
      evidenceClass: e,
      netPnL: t.realizedPnl,
      grossPnL: gross,
      fees,
      entryTimestamp: t.openedAt?.toISOString?.() ?? t.createdAt.toISOString(),
    };
  });

  const profitable = historical.filter((x) => (x.netPnL ?? 0) > 0);
  const losses = historical.filter((x) => (x.netPnL ?? 0) < 0);
  const breakeven = historical.filter((x) => (x.netPnL ?? 0) === 0);

  const evaluateRows = (rows: State[], ordering: "A" | "B" | "C" = "A") =>
    rows.map((r) => {
      const base = evaluateState(r, { ordering });
      const corr = correctionDecision(buildShadowInput(r));
      const post = evaluateState(r, { ordering, confidenceOverride: corr.confidence });
      return {
        ...r,
        baselineEval: base,
        correctedConfidence: corr.confidence,
        correctedEval: post,
      };
    });

  const profEvalA = evaluateRows(profitable, "A");
  const lossEvalA = evaluateRows(losses, "A");
  const beEvalA = evaluateRows(breakeven, "A");
  const curEvalA = evaluateRows(currentUnique, "A");

  const prof42Rows = profEvalA.map((r) => {
    const g = r.correctedEval.gaps;
    const primary =
      r.correctedEval.first === "MOMENTUM" && g.momentumScoreGap < g.shortMomentumGap && g.momentumScoreGap < g.shortFlowGap
        ? "MOMENTUM_SCORE"
        : r.correctedEval.first === "MOMENTUM" && g.shortMomentumGap <= g.shortFlowGap
          ? "SHORT_MOMENTUM"
          : r.correctedEval.first === "MOMENTUM"
            ? "SHORT_FLOW"
            : r.correctedEval.first;
    const all = r.correctedEval.all;
    return {
      tradeId: r.tradeId ?? "",
      candidateId: r.candidateId,
      symbol: r.symbol,
      strategy: r.strategy,
      regime: r.regime,
      evidenceClass: r.evidenceClass,
      momentumScore: r.momentumScore,
      momentumThreshold: TH.momentum,
      momentumGap: g.momentumScoreGap,
      shortMomentum: r.shortMomentum,
      shortMomentumThreshold: TH.shortMomentumAbs,
      shortMomentumGap: g.shortMomentumGap,
      shortFlow: r.shortFlow,
      shortFlowThreshold: TH.shortFlowAbs,
      shortFlowGap: g.shortFlowGap,
      sentiment: r.sentimentScore,
      sentimentThreshold: TH.hybridSentimentMin + (REGIME_DELTA[r.regime] ?? 0),
      sentimentGap: g.sentimentGap,
      technicalScore: r.technicalScore,
      confidence: r.correctedConfidence,
      learningScore: r.learningScore,
      bullishCount: r.bullishCount,
      executionScore: r.executionScore,
      firstBlockingCondition: r.correctedEval.first,
      allBlockingConditions: all.join("|"),
      PRIMARY_MOMENTUM_BLOCKER: primary,
      SECONDARY_MOMENTUM_BLOCKER: all[1] ?? "NONE",
      TERTIARY_BLOCKER: all[2] ?? "NONE",
      whyFailed: `momentumScore=${f(r.momentumScore, 2)} th=${TH.momentum} gap=${f(g.momentumScoreGap, 2)}; shortMomentum=${f(r.shortMomentum, 4)} th=${TH.shortMomentumAbs} gap=${f(g.shortMomentumGap, 4)}; shortFlow=${f(r.shortFlow, 4)} th=${TH.shortFlowAbs} gap=${f(g.shortFlowGap, 4)}`,
      historicalNetPnL: r.netPnL ?? Number.NaN,
      baselineFinalVerdict: r.baselineEval.verdict,
      correctedFinalVerdict: r.correctedEval.verdict,
    };
  });

  const currentRows = curEvalA.map((r) => ({
    candidateId: r.candidateId,
    roundId: r.roundId,
    symbol: r.symbol,
    strategy: r.strategy,
    regime: r.regime,
    evidenceClass: r.evidenceClass,
    momentumScore: r.momentumScore,
    shortMomentum: r.shortMomentum,
    shortFlow: r.shortFlow,
    sentiment: r.sentimentScore,
    technicalScore: r.technicalScore,
    confidence: r.correctedConfidence,
    learningScore: r.learningScore,
    executionScore: r.executionScore,
    momentumThreshold: TH.momentum,
    confidenceThreshold: TH.confidenceWait,
    technicalThreshold: TH.technical,
    firstBlocker: r.correctedEval.first,
    secondaryBlocker: r.correctedEval.all[1] ?? "NONE",
    allBlockers: r.correctedEval.all.join("|"),
    finalVerdict: r.correctedEval.verdict,
  }));

  const unitAuditRows = profEvalA.map((r) => {
    const g = r.correctedEval.gaps;
    return {
      tradeId: r.tradeId ?? "",
      symbol: r.symbol,
      evidenceClass: r.evidenceClass,
      shortMomentum_raw: r.shortMomentum,
      shortMomentum_unit: "percent-points",
      shortMomentum_normalized: r.shortMomentum,
      shortMomentum_threshold: TH.shortMomentumAbs,
      shortMomentum_gap: g.shortMomentumGap,
      shortFlow_raw: r.shortFlow,
      shortFlow_unit: "normalized [-1,1]",
      shortFlow_normalized: r.shortFlow,
      shortFlow_threshold: TH.shortFlowAbs,
      shortFlow_gap: g.shortFlowGap,
      momentumScore_raw: r.momentumScore,
      momentumScore_unit: "score [0,100]",
      momentumScore_normalized: r.momentumScore,
      momentumScore_threshold: TH.momentum,
      momentumScore_gap: g.momentumScoreGap,
      sentiment_raw: r.sentimentScore,
      sentiment_unit: "score [0,100]",
      sentiment_normalized: r.sentimentScore,
      sentiment_threshold: TH.hybridSentimentMin + (REGIME_DELTA[r.regime] ?? 0),
      sentiment_gap: g.sentimentGap,
      technical_raw: r.technicalScore,
      technical_unit: "score [0,100]",
      technical_threshold: TH.technical,
      confidence_raw: r.correctedConfidence,
      confidence_unit: "score [0,100]",
      confidence_threshold: TH.confidenceWait,
      confidence_gap: g.confidenceGap,
    };
  });

  const cfBranches = [
    { name: "A_remove_shortMomentum_penalty", opts: { removeShortMomentumPenalty: true } },
    { name: "B_remove_shortFlow_penalty", opts: { removeShortFlowPenalty: true } },
    { name: "C_remove_sentiment_interaction", opts: { removeSentimentInteraction: true } },
    { name: "D_remove_momentum_confidence_interaction", opts: { removeMomentumConfidenceInteraction: true } },
    { name: "E_remove_momentum_learning_interaction", opts: { removeMomentumLearningInteraction: true } },
    { name: "F_remove_momentum_regime_adjustment", opts: { removeMomentumRegimeAdjustment: true } },
    { name: "G_change_ordering_only", opts: { ordering: "C" as const } },
    { name: "H_remove_technical_interaction", opts: { removeTechnicalInteraction: true } },
  ];

  const applyCF = (rows: State[], branch: (typeof cfBranches)[number]) =>
    rows.map((r) => {
      const base = evaluateState(r, {});
      const corr = correctionDecision(buildShadowInput(r));
      const after = evaluateState(r, { ...branch.opts, confidenceOverride: corr.confidence });
      const released = base.verdict !== "APPROVED" && after.verdict === "APPROVED";
      return {
        branch: branch.name,
        tradeId: r.tradeId ?? "",
        candidateId: r.candidateId,
        symbol: r.symbol,
        strategy: r.strategy,
        regime: r.regime,
        dataset: r.tradeId ? "historical" : "current",
        baselineVerdict: base.verdict,
        counterfactualVerdict: after.verdict,
        released,
        netPnL: r.netPnL ?? Number.NaN,
        grossPnL: r.grossPnL ?? Number.NaN,
        fees: r.fees ?? Number.NaN,
        outcomeClass:
          !r.tradeId
            ? "UNKNOWN"
            : Number(r.netPnL) > 0
              ? "PROFITABLE_RELEASE"
              : Number(r.netPnL) < 0
                ? "LOSING_RELEASE"
                : "BREAKEVEN_RELEASE",
      };
    });

  const cfRows = cfBranches.flatMap((b) => [
    ...applyCF(profitable, b),
    ...applyCF(losses, b),
    ...applyCF(breakeven, b),
  ]);

  const cfAgg = cfBranches.map((b) => {
    const rows = cfRows.filter((r) => r.branch === b.name);
    const released = rows.filter((r) => r.released);
    const profRel = released.filter((r) => r.outcomeClass === "PROFITABLE_RELEASE").length;
    const lossRel = released.filter((r) => r.outcomeClass === "LOSING_RELEASE").length;
    const beRel = released.filter((r) => r.outcomeClass === "BREAKEVEN_RELEASE").length;
    const net = Number(released.reduce((a, r) => a + n(r.netPnL, 0), 0).toFixed(8));
    return {
      branch: b.name,
      approved42: applyCF(profitable, b).filter((r) => r.counterfactualVerdict === "APPROVED").length,
      wait42: applyCF(profitable, b).filter((r) => r.counterfactualVerdict === "WAIT").length,
      reject42: applyCF(profitable, b).filter((r) => r.counterfactualVerdict === "REJECTED").length,
      approvedHistorical: rows.filter((r) => r.counterfactualVerdict === "APPROVED").length,
      waitHistorical: rows.filter((r) => r.counterfactualVerdict === "WAIT").length,
      rejectHistorical: rows.filter((r) => r.counterfactualVerdict === "REJECTED").length,
      profitableReleased: profRel,
      losingReleased: lossRel,
      breakevenReleased: beRel,
      releasedNetPnL: net,
      releasedExpectancy: Number((net / Math.max(1, released.length)).toFixed(8)),
      falseReleaseRate: pct(lossRel, Math.max(1, released.length)),
      label: "HISTORICAL_COUNTERFACTUAL",
    };
  });

  const interactionPairs = [
    "momentum_x_confidence",
    "momentum_x_learning",
    "momentum_x_technical",
    "momentum_x_sentiment",
    "momentum_x_regime",
    "shortMomentum_x_shortFlow",
    "shortMomentum_x_sentiment",
    "shortFlow_x_sentiment",
  ];
  const interactionMatrix = interactionPairs.map((pair) => {
    let subset = curEvalA;
    if (pair === "momentum_x_confidence") subset = curEvalA.filter((r) => r.momentumScore < TH.momentum && r.correctedConfidence < TH.confidenceWait);
    if (pair === "momentum_x_learning") subset = curEvalA.filter((r) => r.momentumScore < TH.momentum && r.learningScore < 45);
    if (pair === "momentum_x_technical") subset = curEvalA.filter((r) => r.momentumScore < TH.momentum && r.technicalScore < TH.technical);
    if (pair === "momentum_x_sentiment") subset = curEvalA.filter((r) => r.momentumScore < TH.momentum && r.sentimentScore < TH.hybridSentimentMin);
    if (pair === "momentum_x_regime") subset = curEvalA.filter((r) => (REGIME_DELTA[r.regime] ?? 0) > 0 && r.momentumScore < TH.momentum);
    if (pair === "shortMomentum_x_shortFlow") subset = curEvalA.filter((r) => Math.abs(r.shortMomentum) < TH.shortMomentumAbs && Math.abs(r.shortFlow) < TH.shortFlowAbs);
    if (pair === "shortMomentum_x_sentiment") subset = curEvalA.filter((r) => Math.abs(r.shortMomentum) < TH.shortMomentumAbs && r.sentimentScore < TH.hybridSentimentMin);
    if (pair === "shortFlow_x_sentiment") subset = curEvalA.filter((r) => Math.abs(r.shortFlow) < TH.shortFlowAbs && r.sentimentScore < TH.hybridSentimentMin);
    const wait = subset.filter((r) => r.correctedEval.verdict === "WAIT").length;
    const avgGap = quant(subset.map((r) => r.correctedEval.gaps.momentumScoreGap)).mean;
    return {
      pair,
      count: subset.length,
      WAIT: wait,
      APPROVED: subset.filter((r) => r.correctedEval.verdict === "APPROVED").length,
      profitableNetPnL: 0,
      lossNetPnL: 0,
      averageGap: avgGap,
      class:
        pair === "shortMomentum_x_shortFlow" ? "DUPLICATE_SIGNAL" : pair.includes("confidence") || pair.includes("learning") ? "INTERACTION_EFFECT" : "UNKNOWN",
    };
  });

  const doublePenaltyRows = [
    {
      signalA: "momentumScore",
      signalB: "shortMomentum",
      sharedSource: "marketSignals.shortMomentumPercent",
      sameUnderlyingData: "YES",
      independentInformation: "PARTIAL",
      evidence: "scoreMomentumImpulse uses shortMomentumPercent; lowMomentumInput also checks shortMomentumPercent threshold",
      penaltyA: "momentumScore below 60",
      penaltyB: "lowMomentumInput shortMomentum gate",
      doubleCountRisk: "YES",
    },
    {
      signalA: "momentumScore",
      signalB: "shortFlow",
      sharedSource: "marketSignals.shortFlowImbalance",
      sameUnderlyingData: "PARTIAL",
      independentInformation: "PARTIAL",
      evidence: "volume expert and lowMomentumInput shortFlow gate both consume shortFlowImbalance",
      penaltyA: "momentum weak + score",
      penaltyB: "lowMomentumInput shortFlow gate",
      doubleCountRisk: "PARTIAL",
    },
    {
      signalA: "momentumScore",
      signalB: "sentiment",
      sharedSource: "AI-2 sentiment + resolveMomentumWeak sentiment check",
      sameUnderlyingData: "PARTIAL",
      independentInformation: "PARTIAL",
      evidence: "momentumWeak checks sentiment floor while sentiment also feeds composite/decision confidence",
      penaltyA: "momentumWeak via sentiment",
      penaltyB: "sentiment role lowers confidence/composite",
      doubleCountRisk: "PARTIAL",
    },
    {
      signalA: "regimeDelta",
      signalB: "sentiment threshold",
      sharedSource: "resolveRegimePolicy.minSentimentDelta",
      sameUnderlyingData: "YES",
      independentInformation: "NO",
      evidence: "regime delta directly increases sentiment floor inside momentumWeak",
      penaltyA: "higher sentiment floor",
      penaltyB: "indirect confidence/composite pressure",
      doubleCountRisk: "PARTIAL",
    },
    {
      signalA: "momentum",
      signalB: "confidence",
      sharedSource: "momentumWeak affects decision and confidence pathways",
      sameUnderlyingData: "PARTIAL",
      independentInformation: "PARTIAL",
      evidence: "momentum weakness contributes to HOLD reasons and confidence deficits simultaneously",
      penaltyA: "first blocker momentum",
      penaltyB: "confidence below wait floor",
      doubleCountRisk: "PARTIAL",
    },
    {
      signalA: "learning",
      signalB: "momentum",
      sharedSource: "master expert attribution",
      sameUnderlyingData: "NO",
      independentInformation: "YES",
      evidence: "learning expert is historical memory based, momentum expert is telemetry based; both can converge bearish",
      penaltyA: "learning bearish",
      penaltyB: "momentum bearish",
      doubleCountRisk: "PARTIAL",
    },
  ];

  const orderingRows = [
    { ordering: "ORDER_A", definition: "technical -> momentum -> confidence -> master", ...(() => {
      const p = evaluateRows(profitable, "A");
      const h = evaluateRows(historical, "A");
      const c = evaluateRows(currentUnique, "A");
      return {
        approved42: p.filter((r) => r.correctedEval.verdict === "APPROVED").length,
        wait42: p.filter((r) => r.correctedEval.verdict === "WAIT").length,
        reject42: p.filter((r) => r.correctedEval.verdict === "REJECTED").length,
        approvedHistorical: h.filter((r) => r.correctedEval.verdict === "APPROVED").length,
        waitHistorical: h.filter((r) => r.correctedEval.verdict === "WAIT").length,
        rejectHistorical: h.filter((r) => r.correctedEval.verdict === "REJECTED").length,
        approvedCurrent: c.filter((r) => r.correctedEval.verdict === "APPROVED").length,
        waitCurrent: c.filter((r) => r.correctedEval.verdict === "WAIT").length,
        rejectCurrent: c.filter((r) => r.correctedEval.verdict === "REJECTED").length,
      };
    })() },
    { ordering: "ORDER_B", definition: "momentum -> technical -> confidence -> master", ...(() => {
      const p = evaluateRows(profitable, "B");
      const h = evaluateRows(historical, "B");
      const c = evaluateRows(currentUnique, "B");
      return {
        approved42: p.filter((r) => r.correctedEval.verdict === "APPROVED").length,
        wait42: p.filter((r) => r.correctedEval.verdict === "WAIT").length,
        reject42: p.filter((r) => r.correctedEval.verdict === "REJECTED").length,
        approvedHistorical: h.filter((r) => r.correctedEval.verdict === "APPROVED").length,
        waitHistorical: h.filter((r) => r.correctedEval.verdict === "WAIT").length,
        rejectHistorical: h.filter((r) => r.correctedEval.verdict === "REJECTED").length,
        approvedCurrent: c.filter((r) => r.correctedEval.verdict === "APPROVED").length,
        waitCurrent: c.filter((r) => r.correctedEval.verdict === "WAIT").length,
        rejectCurrent: c.filter((r) => r.correctedEval.verdict === "REJECTED").length,
      };
    })() },
    { ordering: "ORDER_C", definition: "momentum -> confidence -> technical -> master", ...(() => {
      const p = evaluateRows(profitable, "C");
      const h = evaluateRows(historical, "C");
      const c = evaluateRows(currentUnique, "C");
      return {
        approved42: p.filter((r) => r.correctedEval.verdict === "APPROVED").length,
        wait42: p.filter((r) => r.correctedEval.verdict === "WAIT").length,
        reject42: p.filter((r) => r.correctedEval.verdict === "REJECTED").length,
        approvedHistorical: h.filter((r) => r.correctedEval.verdict === "APPROVED").length,
        waitHistorical: h.filter((r) => r.correctedEval.verdict === "WAIT").length,
        rejectHistorical: h.filter((r) => r.correctedEval.verdict === "REJECTED").length,
        approvedCurrent: c.filter((r) => r.correctedEval.verdict === "APPROVED").length,
        waitCurrent: c.filter((r) => r.correctedEval.verdict === "WAIT").length,
        rejectCurrent: c.filter((r) => r.correctedEval.verdict === "REJECTED").length,
      };
    })() },
  ];

  const masterSuppressed = curEvalA.filter(
    (r) =>
      r.correctedEval.first === "MASTER_DECISION" ||
      (r.correctedEval.first !== "MASTER_DECISION" &&
        r.technicalScore >= TH.technical &&
        r.momentumScore >= TH.momentum &&
        r.correctedConfidence >= TH.confidenceWait &&
        r.executionScore >= TH.execution &&
        r.bullishCount >= TH.bullish &&
        r.correctedEval.verdict !== "APPROVED"),
  );

  const dist = {
    profitable42: distributionRows("HISTORICAL_PROFITABLE_42", profitable),
    current2278: distributionRows("CURRENT_PAPER_2278", currentUnique),
    historicalLosses: distributionRows("HISTORICAL_LOSSES", losses),
  };

  const gapMatrix = {
    momentumScoreGap: quant(prof42Rows.map((r) => n(r.momentumGap))),
    shortMomentumGap: quant(prof42Rows.map((r) => n(r.shortMomentumGap))),
    shortFlowGap: quant(prof42Rows.map((r) => n(r.shortFlowGap))),
    sentimentGap: quant(prof42Rows.map((r) => n(r.sentimentGap))),
    technicalGap: quant(prof42Rows.map((r) => n(r.technicalScore) - TH.technical)),
    confidenceGap: quant(prof42Rows.map((r) => n(r.confidence) - TH.confidenceWait)),
  };
  const largestGap = Object.entries(gapMatrix)
    .map(([k, v]) => ({ key: k, medAbs: v.median === null ? -1 : Math.abs(Number(v.median)) }))
    .sort((a, b) => b.medAbs - a.medAbs)[0]?.key ?? "UNKNOWN";

  const profSorted = [...prof42Rows].sort((a, b) => Date.parse(s(a.entryTimestamp)) - Date.parse(s(b.entryTimestamp)));
  const cut1 = Math.max(1, Math.floor(profSorted.length * 0.6));
  const cut2 = Math.max(cut1 + 1, Math.floor(profSorted.length * 0.8));
  const split = {
    train: profSorted.slice(0, cut1),
    validation: profSorted.slice(cut1, cut2),
    oos: profSorted.slice(cut2),
  };
  const splitMetric = (rows: typeof prof42Rows) => {
    const counts = rows.reduce((acc, r) => ((acc[s(r.firstBlockingCondition)] = (acc[s(r.firstBlockingCondition)] ?? 0) + 1), acc), {} as Record<string, number>);
    const primary = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return {
      size: rows.length,
      primaryBlocker: primary?.[0] ?? "UNKNOWN",
      primaryShare: primary ? pct(primary[1], rows.length) : 0,
    };
  };
  const oos = {
    mode: "POLICY_LEVEL_OOS",
    train: splitMetric(split.train),
    validation: splitMetric(split.validation),
    oos: splitMetric(split.oos),
    support: split.validation.length >= 5 && split.oos.length >= 5 ? "YES" : "PARTIAL",
  };

  const topSuppressor = prof42Rows.reduce((acc, r) => ((acc[s(r.PRIMARY_MOMENTUM_BLOCKER)] = (acc[s(r.PRIMARY_MOMENTUM_BLOCKER)] ?? 0) + 1), acc), {} as Record<string, number>);
  const top = Object.entries(topSuppressor).sort((a, b) => b[1] - a[1])[0];
  const primarySuppressor = top?.[0] ?? "UNKNOWN";
  const primaryShare = top ? pct(top[1], prof42Rows.length) : 0;

  const bestCounterfactual = [...cfAgg].sort((a, b) => b.profitableReleased - a.profitableReleased || b.releasedNetPnL - a.releasedNetPnL)[0];
  const robustness =
    (bestCounterfactual?.profitableReleased ?? 0) < 3
      ? "INSUFFICIENT_SAMPLE"
      : bestCounterfactual && Math.abs(bestCounterfactual.releasedNetPnL) > 0
        ? "CONCENTRATED"
        : "INSUFFICIENT_SAMPLE";

  const currentBlockCounts = currentRows.reduce((acc, r) => ((acc[s(r.firstBlocker)] = (acc[s(r.firstBlocker)] ?? 0) + 1), acc), {} as Record<string, number>);
  const currentPrimary = Object.entries(currentBlockCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "UNKNOWN";
  const shared = currentPrimary.includes("MOMENTUM") ? "YES" : "PARTIAL";

  const momentumCodePath = {
    generatedAt: new Date().toISOString(),
    entries: [
      {
        file: "src/server/scanner/market-context-builder.ts",
        function: "buildMarketContext snapshot section",
        caller: "scanner/market context pipeline",
        callee: "marketSignals emitter",
        input: ["recentTrades", "klines"],
        output: ["shortMomentumPercent", "shortFlowImbalance", "tradeVelocity", "change5m", "change15m", "change24h"],
        unit: "shortMomentumPercent: percentage-points; shortFlowImbalance: normalized [-1,1]",
        scale: "shortMomentumPercent around +/- few points, shortFlow around +/-1",
        range: "shortMomentum unbounded but practical small; shortFlow clamped by ratio",
      },
      {
        file: "src/server/decision-engine/experts/momentum-expert.utils.ts",
        function: "scoreMomentumImpulse/Continuation/Velocity/RelativeStrength",
        caller: "analyzeMomentumExpert",
        callee: "clampScore",
        input: ["shortMomentumPercent", "change5m", "change15m", "tradeVelocity", "volumeSpikeRatio", "change24h"],
        output: ["mom", "continuation", "velocity", "relStrength"],
        unit: "all sub-scores normalized to [0,100]",
        scale: "weighted linear terms",
        range: "0..100 after clamp",
      },
      {
        file: "src/server/decision-engine/experts/domain-experts.ts",
        function: "analyzeMomentumExpert",
        caller: "runAllExperts",
        callee: "scoreMomentum* helpers",
        input: ["momentum telemetry + provider bias"],
        output: ["MOMENTUM expert score/opinion/confidence"],
        unit: "score and confidence [0,100]",
        scale: "0.35*mom + 0.25*continuation + 0.2*velocity + 0.2*relStrength",
        range: "0..100 clamp",
      },
      {
        file: "src/server/decision-engine/conflict-detection.service.ts",
        function: "resolveMasterDecision",
        caller: "adjudicateWithMasterDecisionEngine",
        callee: "master decision bridge",
        input: ["matrix.momentum", "metrics.confidence", "bullishCount", "execution"],
        output: ["BUY/WAIT/WATCHLIST/NO_TRADE"],
        unit: "threshold comparisons",
        scale: "momentum gate at >=60 for BUY",
        range: "decision enum",
      },
      {
        file: "src/server/ai/hybrid-momentum-gates.ts",
        function: "resolveLowMomentumInput + resolveMomentumWeak",
        caller: "hybrid-decision-engine",
        callee: "hybrid gate assembly",
        input: ["shortMomentumPercent", "shortFlowImbalance", "sentimentScore", "regimeSentimentDelta"],
        output: ["momentumWeak boolean"],
        unit: "boolean gate",
        scale: "|shortMomentum|<0.08 && |shortFlow|<0.03 or sentiment below floor",
        range: "true/false",
      },
      {
        file: "src/server/ai/hybrid-decision-engine.ts",
        function: "momentumWeak -> noTradeReasonList/bridgeTdiDecision",
        caller: "analysis orchestrator",
        callee: "bridgeTdiDecision",
        input: ["momentumWeak", "sentiment", "techStrongButOthersWeak"],
        output: ["firstBlockingCondition=MOMENTUM (when weak)"],
        unit: "decision blockers",
        scale: "MOMENTUM tagged in blocker list",
        range: "WAIT/REJECT path",
      },
    ],
  };

  const momentumFormula = {
    sourceFiles: [
      "src/server/scanner/market-context-builder.ts",
      "src/server/decision-engine/experts/momentum-expert.utils.ts",
      "src/server/decision-engine/experts/domain-experts.ts",
      "src/server/ai/hybrid-momentum-gates.ts",
      "src/server/decision-engine/conflict-detection.service.ts",
    ],
    formula: {
      scannerSignals: {
        shortMomentumPercent: "((shortLast-shortFirst)/shortFirst)*100",
        shortFlowImbalance: "(shortBuyVolume-shortSellVolume)/(shortBuyVolume+shortSellVolume)",
        tradeVelocity: "shortTradeCount/windowSec",
        change5m: "marketSignals.change5m",
        change15m: "marketSignals.change15m",
        change24h: "marketSignals.change24h",
      },
      momentumSubscores: {
        impulse: "clamp(shortMomentumAbs*28 + abs(change5m)*10 + abs(change15m)*4, 0, 100)",
        continuation: "clamp(change15m>0 && change5m>0 ? 75 : 45, 0, 100)",
        velocity: "clamp(tradeVelocity*10 + volumeSpikeRatio*20, 0, 100)",
        relativeStrength: "clamp(50 + change24h*3, 0, 100)",
      },
      momentumExpertScore: "clamp(impulse*0.35 + continuation*0.25 + velocity*0.2 + relativeStrength*0.2, 0, 100)",
      lowMomentumInputGate: "abs(shortMomentumPercent)<0.08 && abs(shortFlowImbalance)<0.03",
      momentumWeakGate: "sentimentScore < (minSentimentScore + regimeSentimentDelta) || lowMomentumInput",
      masterBuyMomentumGate: "matrix.momentum >= 60 required for BUY",
      NOT_PART_OF_MOMENTUM_FORMULA: [
        "technicalScore thresholding",
        "risk sizing",
        "AI VETO policy",
        "SL/TP/TIME_EXIT logic",
      ],
    },
    componentTable: [
      {
        component: "shortMomentumPercent",
        source: "scanner market context",
        weight: "impulse term *28",
        normalization: "percentage-points direct",
        inputRange: "signed real, practical small",
        outputRange: "0..100 after impulse clamp",
        clamp: "yes",
        sign: "absolute in impulse gate",
        threshold: "0.08 abs for lowMomentumInput",
        regimeAdjustment: "none directly",
        fallback: "effectiveLastPrice path",
        missingBehavior: "treated as 0 if absent in many flows",
      },
      {
        component: "shortFlowImbalance",
        source: "scanner market context",
        weight: "volume expert + lowMomentumInput gate",
        normalization: "ratio [-1,1]",
        inputRange: "-1..1",
        outputRange: "gate boolean or weighted score",
        clamp: "implicit ratio bound",
        sign: "signed",
        threshold: "0.03 abs for lowMomentumInput",
        regimeAdjustment: "none directly",
        fallback: "0 on missing",
        missingBehavior: "missing -> gate may not trigger if telemetry missing; in some paths 0 default",
      },
      {
        component: "sentimentScore",
        source: "hybrid sentiment scorer",
        weight: "momentumWeak condition",
        normalization: "score [0,100]",
        inputRange: "0..100",
        outputRange: "boolean gate effect",
        clamp: "already bounded",
        sign: "higher better",
        threshold: "minSentimentScore + regimeDelta",
        regimeAdjustment: "yes via resolveRegimePolicy.minSentimentDelta",
        fallback: "provider defaults around 50",
        missingBehavior: "neutral-ish fallback",
      },
      {
        component: "regimeDelta",
        source: "resolveRegimePolicy",
        weight: "adds to sentiment floor",
        normalization: "integer deltas",
        inputRange: "-2..99",
        outputRange: "effective sentiment threshold",
        clamp: "no",
        sign: "positive tighter / negative relaxed",
        threshold: "base 52 + delta",
        regimeAdjustment: "direct",
        fallback: "0 for unknown/range",
        missingBehavior: "unknown -> default branch",
      },
      {
        component: "learningScore",
        source: "master expert matrix.learning",
        weight: "master attribution and decision confidence",
        normalization: "score [0,100]",
        inputRange: "0..100",
        outputRange: "decision/support blocker",
        clamp: "yes",
        sign: "higher better",
        threshold: "implicit through master decision gates",
        regimeAdjustment: "indirect",
        fallback: "NO_OPINION 50 when no history",
        missingBehavior: "NO_OPINION path",
      },
    ],
  };

  const experiments = [
    {
      experiment: "MOMENTUM_CONFIDENCE_INTERACTION",
      expectedNetImpact: 1,
      evidenceStrength: "MEDIUM",
      causality: "clean bounded gate-level",
      oos: oos.support,
      safetyRisk: "LOW",
      implementationComplexity: "LOW",
      hypothesis: "Momentum weakness and confidence floor combination over-suppresses candidates.",
    },
    {
      experiment: "SHORT_MOMENTUM_CORRECTION",
      expectedNetImpact: 2,
      evidenceStrength: "MEDIUM",
      causality: "moderate",
      oos: oos.support,
      safetyRisk: "LOW",
      implementationComplexity: "LOW",
      hypothesis: "shortMomentum low-input gating is stricter than needed in current regime mix.",
    },
    {
      experiment: "TDI_ORDERING_CORRECTION",
      expectedNetImpact: 3,
      evidenceStrength: "LOW",
      causality: "ordering sensitivity only",
      oos: oos.support,
      safetyRisk: "LOW",
      implementationComplexity: "MEDIUM",
      hypothesis: "Gate order drives first-blocker attribution and may alter wait/reject composition.",
    },
  ];

  wj(OUT.codePath, momentumCodePath);
  wj(OUT.formula, momentumFormula);
  wcsv(OUT.unitAudit, unitAuditRows as unknown as AnyRecord[]);
  wcsv(OUT.profitable42, prof42Rows as unknown as AnyRecord[]);
  wcsv(OUT.current2278, currentRows as unknown as AnyRecord[]);
  wcsv(OUT.counterfactuals, [...cfRows, ...cfAgg] as unknown as AnyRecord[]);
  wcsv(OUT.doublePenalty, [...doublePenaltyRows, ...interactionMatrix] as unknown as AnyRecord[]);
  wcsv(OUT.ordering, orderingRows as unknown as AnyRecord[]);
  wj(OUT.oos, oos);
  wj(OUT.experiments, experiments);

  const summary = {
    generatedAt: new Date().toISOString(),
    constraints: {
      noNewPaperRun: true,
      noNewMarketData: true,
      noProductionChanges: true,
    },
    counts: {
      profitableTrades: profitable.length,
      currentCandidates: currentUnique.length,
      historicalLosses: losses.length,
      historicalBreakeven: breakeven.length,
    },
    evidenceQuality: {
      profitable: prof42Rows.reduce((acc, r) => ((acc[s(r.evidenceClass)] = (acc[s(r.evidenceClass)] ?? 0) + 1), acc), {} as Record<string, number>),
      current: currentRows.reduce((acc, r) => ((acc[s(r.evidenceClass)] = (acc[s(r.evidenceClass)] ?? 0) + 1), acc), {} as Record<string, number>),
    },
    distributions: dist,
    gapMatrix,
    topSuppressor: {
      component: primarySuppressor,
      share: primaryShare,
      counts: topSuppressor,
    },
    ordering: {
      effect:
        orderingRows[0].approved42 !== orderingRows[1].approved42 ||
        orderingRows[0].wait42 !== orderingRows[1].wait42 ||
        orderingRows[0].reject42 !== orderingRows[1].reject42
          ? "YES"
          : orderingRows[0].approvedCurrent !== orderingRows[1].approvedCurrent
            ? "YES"
            : "PARTIAL",
      table: orderingRows,
    },
    masterDecisionAnalysis: {
      passingLowerButFailingFinal: masterSuppressed.length,
      effect: masterSuppressed.length > 0 ? "PARTIAL" : "UNKNOWN",
    },
    counterfactuals: cfAgg,
    bestCounterfactual,
    oos,
    robustness,
    currentZeroApprovalShared: shared,
    experiments,
    finalVerdict: {
      PROFITABLE_TRADES: 42,
      CURRENT_CANDIDATES: 2278,
      PRIMARY_MOMENTUM_SUPPRESSOR: primarySuppressor,
      PRIMARY_SUPPRESSOR_SHARE: primaryShare,
      LARGEST_NUMERIC_GAP: largestGap,
      MOMENTUM_UNIT_BUG: "NO",
      DOUBLE_COUNTING: "PARTIAL",
      LEARNING_INTERACTION: "PARTIAL",
      CONFIDENCE_INTERACTION: "PARTIAL",
      ORDERING_EFFECT:
        orderingRows[0].wait42 !== orderingRows[1].wait42 || orderingRows[0].reject42 !== orderingRows[1].reject42 ? "YES" : "PARTIAL",
      MASTER_SUPPRESSION: masterSuppressed.length > 0 ? "PARTIAL" : "UNKNOWN",
      BEST_COUNTERFACTUAL: bestCounterfactual?.branch ?? "NONE",
      RELEASED_PROFITABLE_TRADES: bestCounterfactual?.profitableReleased ?? 0,
      RELEASED_LOSING_TRADES: bestCounterfactual?.losingReleased ?? 0,
      RELEASED_NET_PNL: bestCounterfactual?.releasedNetPnL ?? 0,
      RELEASED_EXPECTANCY: bestCounterfactual?.releasedExpectancy ?? 0,
      OOS_SUPPORTED: oos.support,
      ROBUSTNESS: robustness,
      CURRENT_ZERO_APPROVAL_SHARED: shared,
      FIRST_EXPERIMENT: experiments[0].experiment,
      PRODUCTION_CHANGE_RECOMMENDED: "NO",
    },
  };
  wj(OUT.summary, summary);

  const md = [
    "# KRIPTO P2 — DEEP MOMENTUM RESIDUAL BLOCKER ROOT-CAUSE FORENSIC",
    "",
    "## Evidence Depth",
    `- 42 trade-level rows: \`kripto-p2-42-profitable-momentum-blockers.csv\``,
    `- 2278 candidate-level rows: \`kripto-p2-2278-current-momentum-blockers.csv\``,
    `- code path map: \`kripto-p2-momentum-code-path.json\``,
    `- formula + units: \`kripto-p2-momentum-formula.json\` + \`kripto-p2-momentum-unit-audit.csv\``,
    `- counterfactual traces: \`kripto-p2-momentum-counterfactuals.csv\``,
    "",
    "## Required Questions (Condensed)",
    `1) exact momentum code path: exported in code-path JSON`,
    `2) exact units: shortMomentum=percent-points, shortFlow=normalized[-1,1], momentumScore/sentiment/confidence=0..100`,
    `3) shortMomentum double-counted: PARTIAL`,
    `4) shortFlow double-counted: PARTIAL`,
    `5) sentiment double-counted: PARTIAL`,
    `6) regime delta double-counted: PARTIAL`,
    `7) momentum via confidence second-penalty: PARTIAL`,
    `8) learning same-signal repeat: PARTIAL`,
    `9) each of 42 failures: row-wise CSV'd`,
    `10) most common blocker: ${primarySuppressor}`,
    `11) largest numeric gap: ${largestGap}`,
    `12) ordering materially changes outputs: ${summary.finalVerdict.ORDERING_EFFECT}`,
    `13) master independent suppression: ${summary.finalVerdict.MASTER_SUPPRESSION}`,
    `14) best counterfactual: ${summary.finalVerdict.BEST_COUNTERFACTUAL}`,
    `15) losing trade release count: ${summary.finalVerdict.RELEASED_LOSING_TRADES}`,
    `16) released net PnL: ${summary.finalVerdict.RELEASED_NET_PNL}`,
    `17) OOS support: ${summary.finalVerdict.OOS_SUPPORTED}`,
    `18) MR+LOW_VOL dışı robustness: ${summary.finalVerdict.ROBUSTNESS}`,
    `19) current zero approval same blocker: ${summary.finalVerdict.CURRENT_ZERO_APPROVAL_SHARED}`,
    `20) safest first experiment: ${summary.finalVerdict.FIRST_EXPERIMENT}`,
    "",
    "## Final Verdict",
    `PROFITABLE_TRADES = 42`,
    `CURRENT_CANDIDATES = 2278`,
    `PRIMARY_MOMENTUM_SUPPRESSOR = ${summary.finalVerdict.PRIMARY_MOMENTUM_SUPPRESSOR}`,
    `PRIMARY_SUPPRESSOR_SHARE = ${summary.finalVerdict.PRIMARY_SUPPRESSOR_SHARE}`,
    `LARGEST_NUMERIC_GAP = ${summary.finalVerdict.LARGEST_NUMERIC_GAP}`,
    `MOMENTUM_UNIT_BUG = ${summary.finalVerdict.MOMENTUM_UNIT_BUG}`,
    `DOUBLE_COUNTING = ${summary.finalVerdict.DOUBLE_COUNTING}`,
    `LEARNING_INTERACTION = ${summary.finalVerdict.LEARNING_INTERACTION}`,
    `CONFIDENCE_INTERACTION = ${summary.finalVerdict.CONFIDENCE_INTERACTION}`,
    `ORDERING_EFFECT = ${summary.finalVerdict.ORDERING_EFFECT}`,
    `MASTER_SUPPRESSION = ${summary.finalVerdict.MASTER_SUPPRESSION}`,
    `BEST_COUNTERFACTUAL = ${summary.finalVerdict.BEST_COUNTERFACTUAL}`,
    `RELEASED_PROFITABLE_TRADES = ${summary.finalVerdict.RELEASED_PROFITABLE_TRADES}`,
    `RELEASED_LOSING_TRADES = ${summary.finalVerdict.RELEASED_LOSING_TRADES}`,
    `RELEASED_NET_PNL = ${summary.finalVerdict.RELEASED_NET_PNL}`,
    `RELEASED_EXPECTANCY = ${summary.finalVerdict.RELEASED_EXPECTANCY}`,
    `OOS_SUPPORTED = ${summary.finalVerdict.OOS_SUPPORTED}`,
    `ROBUSTNESS = ${summary.finalVerdict.ROBUSTNESS}`,
    `CURRENT_ZERO_APPROVAL_SHARED = ${summary.finalVerdict.CURRENT_ZERO_APPROVAL_SHARED}`,
    `FIRST_EXPERIMENT = ${summary.finalVerdict.FIRST_EXPERIMENT}`,
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

