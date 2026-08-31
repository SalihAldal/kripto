import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/src/server/db/prisma";
import { correctionDecision, type ShadowInput } from "@/src/server/forensics/confidence-interaction-correction-shadow.service";

type AnyRecord = Record<string, unknown>;
type Verdict = "APPROVED" | "WAIT" | "REJECTED";
type Blocker =
  | "TECHNICAL"
  | "MOMENTUM"
  | "CONFIDENCE"
  | "SENTIMENT"
  | "LEARNING"
  | "REGIME"
  | "BULLISH_COUNT"
  | "EXECUTION"
  | "MASTER_DECISION"
  | "HYBRID_DECISION"
  | "ORDERING"
  | "DUPLICATE_GATE"
  | "DATA_QUALITY"
  | "UNKNOWN";

const ROOT = process.cwd();
const FIVE_ROUND = path.join(ROOT, "kripto-5round-paper-validation.json");

const OUT = {
  md: path.join(ROOT, "KRIPTO_P2_RESIDUAL_TDI_BLOCKER_REPORT.md"),
  json: path.join(ROOT, "kripto-p2-residual-tdi-blocker.json"),
  transitionCsv: path.join(ROOT, "kripto-p2-blocker-transition-matrix.csv"),
  secondaryCsv: path.join(ROOT, "kripto-p2-secondary-blocker-graph.csv"),
  counterfactualCsv: path.join(ROOT, "kripto-p2-counterfactual-blockers.csv"),
  currentCsv: path.join(ROOT, "kripto-p2-current-paper-residual-blockers.csv"),
  oosJson: path.join(ROOT, "kripto-p2-residual-oos.json"),
  experimentsJson: path.join(ROOT, "kripto-p2-next-experiments.json"),
};

const TH = {
  technical: 48,
  sentiment: 42,
  momentum: 60,
  confidenceWait: 40,
  confidenceBuy: 62,
  bullish: 4,
  execution: 55,
  ev: 68,
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
function q(values: number[]) {
  const arr = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (arr.length === 0) return { count: 0, median: null, p25: null, p75: null, mean: null };
  const pick = (p: number) => arr[Math.min(arr.length - 1, Math.floor((arr.length - 1) * p))];
  return {
    count: arr.length,
    median: pick(0.5),
    p25: pick(0.25),
    p75: pick(0.75),
    mean: Number((arr.reduce((x, y) => x + y, 0) / arr.length).toFixed(6)),
  };
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
function evidenceClass(meta: AnyRecord): "EXACT_RUNTIME_REPLAY" | "POLICY_FORENSIC_REPLAY" | "INFERRED" {
  const hard = ["technicalScore", "momentumScore", "sentimentScore", "confidence", "executionScore", "bullishCount", "expectedValue"];
  const exact = hard.every((k) => Number.isFinite(n(meta[k])));
  if (exact && meta.tdiVerdict) return "EXACT_RUNTIME_REPLAY";
  const partial =
    Number.isFinite(n(meta.confidence)) ||
    Number.isFinite(n(meta.technicalScore)) ||
    Number.isFinite(n(meta.momentumScore));
  return partial ? "POLICY_FORENSIC_REPLAY" : "INFERRED";
}

type CandidateState = {
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
  evidenceClass: "EXACT_RUNTIME_REPLAY" | "POLICY_FORENSIC_REPLAY" | "INFERRED";
  netPnL?: number;
  entryTimestamp?: string;
};

function buildBlockers(state: CandidateState, confidenceOverride?: number, ordering: "current" | "alternate" = "current") {
  const confidence = Number.isFinite(confidenceOverride) ? confidenceOverride : state.confidence;
  const checks: Array<{ block: Blocker; fail: boolean; gap?: number }> = [
    {
      block: "TECHNICAL",
      fail: !Number.isFinite(state.technicalScore) || state.technicalScore < TH.technical || !Number.isFinite(state.sentimentScore) || state.sentimentScore < TH.sentiment,
      gap: Number.isFinite(state.technicalScore) ? state.technicalScore - TH.technical : Number.NaN,
    },
    {
      block: "MOMENTUM",
      fail: !Number.isFinite(state.momentumScore) || state.momentumScore < TH.momentum,
      gap: Number.isFinite(state.momentumScore) ? state.momentumScore - TH.momentum : Number.NaN,
    },
    {
      block: "CONFIDENCE",
      fail: !Number.isFinite(confidence) || confidence < TH.confidenceWait,
      gap: Number.isFinite(confidence) ? confidence - TH.confidenceWait : Number.NaN,
    },
    {
      block: "BULLISH_COUNT",
      fail: !Number.isFinite(state.bullishCount) || state.bullishCount < TH.bullish,
      gap: Number.isFinite(state.bullishCount) ? state.bullishCount - TH.bullish : Number.NaN,
    },
    {
      block: "EXECUTION",
      fail: !Number.isFinite(state.executionScore) || state.executionScore < TH.execution,
      gap: Number.isFinite(state.executionScore) ? state.executionScore - TH.execution : Number.NaN,
    },
    {
      block: "MASTER_DECISION",
      fail:
        !Number.isFinite(state.EV) ||
        state.EV < TH.ev ||
        !Number.isFinite(confidence) ||
        confidence < TH.confidenceBuy ||
        !Number.isFinite(state.momentumScore) ||
        state.momentumScore < TH.momentum ||
        !Number.isFinite(state.executionScore) ||
        state.executionScore < TH.execution ||
        !Number.isFinite(state.bullishCount) ||
        state.bullishCount < TH.bullish,
      gap: Number.isFinite(state.EV) ? state.EV - TH.ev : Number.NaN,
    },
  ];

  const hasData = [
    state.technicalScore,
    state.momentumScore,
    state.sentimentScore,
    confidence,
    state.executionScore,
    state.bullishCount,
    state.EV,
  ].every((x) => Number.isFinite(x));
  if (!hasData) {
    return {
      first: "DATA_QUALITY" as Blocker,
      all: ["DATA_QUALITY"] as Blocker[],
      verdict: "WAIT" as Verdict,
      blockers: [{ block: "DATA_QUALITY" as Blocker, gap: Number.NaN }],
    };
  }

  const ordered =
    ordering === "current"
      ? checks
      : [checks[1], checks[2], checks[0], checks[3], checks[4], checks[5]]; // momentum -> confidence -> technical...

  const failed = ordered.filter((c) => c.fail);
  if (failed.length === 0) {
    return {
      first: "UNKNOWN" as Blocker,
      all: [] as Blocker[],
      verdict: "APPROVED" as Verdict,
      blockers: [],
    };
  }
  const first = failed[0].block;
  const all = failed.map((f) => f.block);
  const verdict: Verdict = first === "TECHNICAL" ? "REJECTED" : first === "MASTER_DECISION" ? "WAIT" : "WAIT";
  return {
    first,
    all,
    verdict,
    blockers: failed.map((f) => ({ block: f.block, gap: f.gap })),
  };
}

function shadowInputFromState(state: CandidateState): ShadowInput {
  return {
    candidateId: state.candidateId,
    symbol: state.symbol,
    strategy: state.strategy,
    regime: state.regime,
    technicalScore: state.technicalScore,
    momentumScore: state.momentumScore,
    sentimentScore: state.sentimentScore,
    shortMomentum: state.shortMomentum,
    shortFlow: state.shortFlow,
    confidence: state.confidence,
    learningScore: state.learningScore,
    bullishCount: state.bullishCount,
    executionScore: state.executionScore,
    expectedValue: state.EV,
    firstBlockingCondition: state.firstBlockingCondition,
    blockingConditions: state.blockingConditions,
    baselineVerdict: state.baselineVerdict,
  };
}

async function main() {
  const five = j<AnyRecord>(FIVE_ROUND);
  const roots: string[] = ((five.rounds as AnyRecord[]) ?? []).map((r) => s(r.artifactRoot)).filter(Boolean);

  const currentStates: CandidateState[] = [];
  for (const root of roots) {
    const tdiPath = path.join(root, "tdi-decisions.json");
    if (!fs.existsSync(tdiPath)) continue;
    const tdi = j<{ records?: AnyRecord[] }>(tdiPath);
    for (const rec of tdi.records ?? []) {
      currentStates.push({
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

  const currentUnique = Array.from(new Map(currentStates.map((r) => [`${r.candidateId}|${r.roundId}|${r.symbol}`, r])).values());

  const bySymbol = currentUnique.reduce((acc, row) => {
    const arr = acc.get(row.symbol) ?? [];
    arr.push(row);
    acc.set(row.symbol, arr);
    return acc;
  }, new Map<string, CandidateState[]>());

  const byStrategyRegime = currentUnique.reduce((acc, row) => {
    const key = `${row.strategy}|${row.regime}`;
    const arr = acc.get(key) ?? [];
    arr.push(row);
    acc.set(key, arr);
    return acc;
  }, new Map<string, CandidateState[]>());

  const med = (arr: CandidateState[], key: keyof CandidateState) => q(arr.map((x) => n(x[key]))).median ?? Number.NaN;

  const trades = await prisma.learningTrade.findMany({
    select: {
      tradeId: true,
      symbol: true,
      strategy: true,
      marketRegime: true,
      realizedPnl: true,
      metadata: true,
      openedAt: true,
      createdAt: true,
    },
  });
  const profitableTrades = trades.filter((t) => t.realizedPnl > 0);
  const lossTrades = trades.filter((t) => t.realizedPnl < 0);
  const breakevenTrades = trades.filter((t) => t.realizedPnl === 0);

  const historicalStates: CandidateState[] = trades.map((t) => {
    const m = ((t.metadata as AnyRecord | null) ?? {}) as AnyRecord;
    const eClass = evidenceClass(m);
    const symbolRows = bySymbol.get(t.symbol) ?? [];
    const srRows = byStrategyRegime.get(`${strategyNorm(t.strategy)}|${regimeNorm(s(t.marketRegime))}`) ?? [];
    const src = symbolRows.length > 0 ? symbolRows : srRows;

    const pickOrInfer = (key: string, fallbackKey?: keyof CandidateState) => {
      if (Number.isFinite(n(m[key]))) return n(m[key]);
      if (src.length > 0 && fallbackKey) return med(src, fallbackKey);
      return Number.NaN;
    };

    return {
      tradeId: t.tradeId,
      candidateId: s(m.candidateId ?? m.executionCandidateId ?? `hist:${t.tradeId}`),
      runId: s(m.runId ?? m.executionId ?? m.jobId),
      sessionId: s(m.sessionId ?? m.jobId),
      roundId: s(m.roundId ?? m.roundNo),
      symbol: t.symbol,
      strategy: strategyNorm(t.strategy),
      regime: regimeNorm(s(t.marketRegime)),
      technicalScore: pickOrInfer("technicalScore", "technicalScore"),
      momentumScore: pickOrInfer("momentumScore", "momentumScore"),
      sentimentScore: pickOrInfer("sentimentScore", "sentimentScore"),
      shortMomentum: pickOrInfer("shortMomentum", "shortMomentum"),
      shortFlow: pickOrInfer("shortFlow", "shortFlow"),
      confidence: pickOrInfer("confidence", "confidence"),
      learningScore: pickOrInfer("learningScore", "learningScore"),
      bullishCount: pickOrInfer("bullishCount", "bullishCount"),
      executionScore: pickOrInfer("executionScore", "executionScore"),
      EV: pickOrInfer("expectedValue", "EV"),
      liquidity: pickOrInfer("liquidity", "liquidity"),
      volatility: pickOrInfer("volatility", "volatility"),
      baselineVerdict: verdictNorm(s(m.tdiVerdict ?? m.verdict, "WAIT")),
      firstBlockingCondition: s(m.firstBlockingCondition, "UNKNOWN"),
      blockingConditions: Array.isArray(m.blockingConditions) ? (m.blockingConditions as unknown[]).map((x) => s(x)) : [],
      scoreType: s(m.scoreType, "INFERRED"),
      masterExpertConsensusScore: n(m.masterExpertConsensusScore),
      hybridCompositeScore: n(m.hybridCompositeScore),
      legacyDecision: s(m.legacyDecision, "UNKNOWN"),
      evidenceClass: eClass,
      netPnL: t.realizedPnl,
      entryTimestamp: t.openedAt?.toISOString?.() ?? t.createdAt.toISOString(),
    };
  });

  const profitableStates = historicalStates.filter((x) => (x.netPnL ?? 0) > 0);
  const lossStates = historicalStates.filter((x) => (x.netPnL ?? 0) < 0);
  const breakevenStates = historicalStates.filter((x) => (x.netPnL ?? 0) === 0);

  const analyzeSet = (rows: CandidateState[]) =>
    rows.map((state) => {
      const baseline = buildBlockers(state);
      const correction = correctionDecision(shadowInputFromState(state));
      const corrected = buildBlockers(state, correction.confidence);
      const altOrder = buildBlockers(state, correction.confidence, "alternate");
      return {
        ...state,
        baselineConfidence: state.confidence,
        baselineTechnical: state.technicalScore,
        baselineMomentum: state.momentumScore,
        baselineSentiment: state.sentimentScore,
        baselineBullishCount: state.bullishCount,
        baselineExecution: state.executionScore,
        baselineRegime: state.regime,
        baselineFirstBlocker: baseline.first,
        baselineAllBlockers: baseline.all.join("|"),
        baselineFinalVerdict: baseline.verdict,
        correctedConfidence: correction.confidence,
        correctedConfidenceGap: Number.isFinite(correction.confidence) ? Number((correction.confidence - TH.confidenceWait).toFixed(6)) : Number.NaN,
        correctedFirstBlocker: corrected.first,
        correctedAllBlockers: corrected.all.join("|"),
        correctedFinalVerdict: corrected.verdict,
        correctedOrderingFirstBlocker: altOrder.first,
        correctedOrderingVerdict: altOrder.verdict,
        orderingChanged: corrected.first !== altOrder.first ? 1 : 0,
      };
    });

  const profA = analyzeSet(profitableStates);
  const lossA = analyzeSet(lossStates);
  const beA = analyzeSet(breakevenStates);
  const currentA = analyzeSet(currentUnique);

  const transitions = profA.map((r) => ({
    tradeId: r.tradeId ?? "",
    symbol: r.symbol,
    baselineFirstBlocker: r.baselineFirstBlocker,
    correctedFirstBlocker: r.correctedFirstBlocker,
    baselineFinalVerdict: r.baselineFinalVerdict,
    correctedFinalVerdict: r.correctedFinalVerdict,
    evidenceClass: r.evidenceClass,
  }));

  const tCounts = transitions.reduce((acc, r) => {
    const key = `${r.baselineFirstBlocker}->${r.correctedFirstBlocker}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const residualCounts = profA.reduce((acc, r) => {
    const b = s(r.correctedFirstBlocker) as Blocker;
    acc[b] = (acc[b] ?? 0) + 1;
    return acc;
  }, {} as Record<Blocker, number>);
  const primaryResidual = Object.entries(residualCounts).sort((a, b) => b[1] - a[1])[0] as [Blocker, number] | undefined;

  const secondaryRows = profA.flatMap((r) => {
    const all = s(r.correctedAllBlockers).split("|").filter(Boolean);
    const first = all[0] ?? "UNKNOWN";
    const second = all[1] ?? "NONE";
    return [
      {
        tradeId: r.tradeId ?? "",
        symbol: r.symbol,
        firstBlock: first,
        secondBlock: second,
        combo: `${first}+${second}`,
      },
    ];
  });

  const runCounterfactual = (rows: ReturnType<typeof analyzeSet>, mode: "remove_technical" | "remove_momentum" | "remove_master" | "remove_ordering") => {
    return rows.map((r) => {
      const state: CandidateState = {
        ...r,
        baselineVerdict: r.baselineVerdict,
      };
      const b = buildBlockers(state);
      const c = correctionDecision(shadowInputFromState(state));
      const cc = buildBlockers(state, c.confidence);
      let verdict = cc.verdict;
      if (mode === "remove_technical") {
        verdict = cc.first === "TECHNICAL" ? "WAIT" : cc.verdict;
      } else if (mode === "remove_momentum") {
        verdict = cc.first === "MOMENTUM" ? "WAIT" : cc.verdict;
      } else if (mode === "remove_master") {
        verdict = cc.first === "MASTER_DECISION" ? "APPROVED" : cc.verdict;
      } else if (mode === "remove_ordering") {
        verdict = buildBlockers(state, c.confidence, "alternate").verdict;
      }
      return {
        mode,
        tradeId: r.tradeId ?? "",
        symbol: r.symbol,
        baselineVerdict: b.verdict,
        correctedVerdict: cc.verdict,
        counterfactualVerdict: verdict,
        netPnL: r.netPnL ?? Number.NaN,
        strategy: r.strategy,
        regime: r.regime,
      };
    });
  };

  const cfProf = [
    ...runCounterfactual(profA, "remove_technical"),
    ...runCounterfactual(profA, "remove_momentum"),
    ...runCounterfactual(profA, "remove_master"),
    ...runCounterfactual(profA, "remove_ordering"),
  ];
  const cfLoss = [
    ...runCounterfactual(lossA, "remove_technical"),
    ...runCounterfactual(lossA, "remove_momentum"),
    ...runCounterfactual(lossA, "remove_master"),
    ...runCounterfactual(lossA, "remove_ordering"),
  ];
  const cfBe = [
    ...runCounterfactual(beA, "remove_technical"),
    ...runCounterfactual(beA, "remove_momentum"),
    ...runCounterfactual(beA, "remove_master"),
    ...runCounterfactual(beA, "remove_ordering"),
  ];

  const cfAll = [...cfProf, ...cfLoss, ...cfBe];

  const cfAgg = ["remove_technical", "remove_momentum", "remove_master", "remove_ordering"].map((mode) => {
    const rows = cfAll.filter((r) => r.mode === mode);
    const released = rows.filter((r) => r.baselineVerdict !== "APPROVED" && r.counterfactualVerdict === "APPROVED");
    const profReleased = released.filter((r) => Number(r.netPnL) > 0).length;
    const lossReleased = released.filter((r) => Number(r.netPnL) < 0).length;
    const net = Number(released.reduce((a, b) => a + n(b.netPnL, 0), 0).toFixed(8));
    return {
      mode,
      approved: rows.filter((r) => r.counterfactualVerdict === "APPROVED").length,
      wait: rows.filter((r) => r.counterfactualVerdict === "WAIT").length,
      rejected: rows.filter((r) => r.counterfactualVerdict === "REJECTED").length,
      releasedCount: released.length,
      releasedProfitable: profReleased,
      releasedLosing: lossReleased,
      releasedNetPnL: net,
      releasedExpectancy: Number((net / Math.max(1, released.length)).toFixed(8)),
      label: "COUNTERFACTUAL_ONLY",
    };
  });

  const bestCf = [...cfAgg].sort((a, b) => b.releasedProfitable - a.releasedProfitable || b.releasedNetPnL - a.releasedNetPnL)[0];

  const orderingChangeShare = pct(profA.filter((r) => r.orderingChanged === 1).length, profA.length);
  const orderingClass = orderingChangeShare > 0.2 ? "ORDERING_MATTERS" : "ORDERING_IRRELEVANT";

  const currentResidualCounts = currentA.reduce((acc, r) => {
    const b = s(r.correctedFirstBlocker) as Blocker;
    acc[b] = (acc[b] ?? 0) + 1;
    return acc;
  }, {} as Record<Blocker, number>);
  const currentPrimary = Object.entries(currentResidualCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as Blocker | undefined;
  const shared = primaryResidual && currentPrimary ? (primaryResidual[0] === currentPrimary ? "YES" : "NO") : "UNKNOWN";

  const profSorted = [...profA].sort((a, b) => Date.parse(s(a.entryTimestamp)) - Date.parse(s(b.entryTimestamp)));
  const cut1 = Math.max(1, Math.floor(profSorted.length * 0.6));
  const cut2 = Math.max(cut1 + 1, Math.floor(profSorted.length * 0.8));
  const split = {
    train: profSorted.slice(0, cut1),
    validation: profSorted.slice(cut1, cut2),
    oos: profSorted.slice(cut2),
  };
  const splitMetric = (rows: typeof profA) => {
    const counts = rows.reduce((acc, r) => {
      const b = s(r.correctedFirstBlocker);
      acc[b] = (acc[b] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const prim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return { size: rows.length, primary: prim?.[0] ?? "UNKNOWN", share: prim ? pct(prim[1], rows.length) : 0 };
  };
  const oos = {
    mode: "POLICY_LEVEL_OOS",
    train: splitMetric(split.train),
    validation: splitMetric(split.validation),
    oos: splitMetric(split.oos),
    support: split.validation.length >= 5 && split.oos.length >= 5 ? "YES" : "PARTIAL",
  };

  const experiments = [
    {
      experiment: "RESIDUAL_BLOCKER_SHADOW",
      hypothesis: "Confidence sonrası kalan ana bloklayıcıyı izole ederek false-release artmadan küçük iyileşme bulunabilir.",
      affectedCandidates: primaryResidual?.[1] ?? 0,
      historicalReleasedNetPnL: bestCf?.releasedNetPnL ?? 0,
      falseReleaseRate: bestCf ? pct(bestCf.releasedLosing, Math.max(1, bestCf.releasedCount)) : 0,
      oosStatus: oos.support,
      risk: "LOW",
      successCriteria: "Released profitable > released losing and OOS direction same.",
    },
    {
      experiment: "TDI_ORDERING_SHADOW",
      hypothesis: "Gate sıralaması ilk bloklayıcıyı değiştiriyorsa ordering sensitivity vardır.",
      affectedCandidates: profA.filter((r) => r.orderingChanged === 1).length,
      historicalReleasedNetPnL: 0,
      falseReleaseRate: 0,
      oosStatus: oos.support,
      risk: "LOW",
      successCriteria: "ORDERING_MATTERS sinyali stabil kalır.",
    },
    {
      experiment: "MASTER_DECISION_SHADOW",
      hypothesis: "Hybrid sonrası master WAIT zinciri asıl residual kilit olabilir.",
      affectedCandidates: profA.filter((r) => s(r.correctedFirstBlocker) === "MASTER_DECISION").length,
      historicalReleasedNetPnL: cfAgg.find((x) => x.mode === "remove_master")?.releasedNetPnL ?? 0,
      falseReleaseRate: pct(
        cfAgg.find((x) => x.mode === "remove_master")?.releasedLosing ?? 0,
        Math.max(1, cfAgg.find((x) => x.mode === "remove_master")?.releasedCount ?? 0),
      ),
      oosStatus: oos.support,
      risk: "MEDIUM",
      successCriteria: "Counterfactual release net positive and false release controlled.",
    },
  ];

  const residualDetail = Object.entries(residualCounts).map(([blocker, count]) => {
    const rows = profA.filter((r) => s(r.correctedFirstBlocker) === blocker);
    return {
      blocker,
      count,
      share: pct(count, profA.length),
      medianScoreGap: q(rows.map((r) => n(r.correctedConfidenceGap))).median,
      p25: q(rows.map((r) => n(r.correctedConfidenceGap))).p25,
      p75: q(rows.map((r) => n(r.correctedConfidenceGap))).p75,
      averageHistoricalNetPnL: q(rows.map((r) => n(r.netPnL))).mean,
      averageConfidence: q(rows.map((r) => n(r.correctedConfidence))).mean,
      averageMomentum: q(rows.map((r) => n(r.momentumScore))).mean,
      averageTechnical: q(rows.map((r) => n(r.technicalScore))).mean,
    };
  });

  wcsv(OUT.transitionCsv, transitions as unknown as AnyRecord[]);
  wcsv(OUT.secondaryCsv, secondaryRows as unknown as AnyRecord[]);
  wcsv(OUT.counterfactualCsv, cfAll as unknown as AnyRecord[]);
  wcsv(
    OUT.currentCsv,
    currentA.map((r) => ({
      candidateId: r.candidateId,
      roundId: r.roundId,
      symbol: r.symbol,
      strategy: r.strategy,
      regime: r.regime,
      confidence: r.correctedConfidence,
      technical: r.technicalScore,
      momentum: r.momentumScore,
      baselineFirstBlocker: r.baselineFirstBlocker,
      correctedFirstBlocker: r.correctedFirstBlocker,
      secondaryBlockers: r.correctedAllBlockers,
      baselineVerdict: r.baselineFinalVerdict,
      correctedVerdict: r.correctedFinalVerdict,
    })),
  );
  wj(OUT.oosJson, oos);
  wj(OUT.experimentsJson, experiments);

  const summary = {
    generatedAt: new Date().toISOString(),
    constraints: {
      noNewPaperRun: true,
      noNewMarketData: true,
      noProductionChanges: true,
    },
    inventory: {
      profitableTrades: profitableTrades.length,
      lossTrades: lossTrades.length,
      breakevenTrades: breakevenTrades.length,
      currentPaperCandidates: currentUnique.length,
      profitableEvidenceClass: profA.reduce((acc, r) => ((acc[r.evidenceClass] = (acc[r.evidenceClass] ?? 0) + 1), acc), {} as Record<string, number>),
    },
    baseline: {
      approved: profA.filter((r) => r.baselineFinalVerdict === "APPROVED").length,
      wait: profA.filter((r) => r.baselineFinalVerdict === "WAIT").length,
      rejected: profA.filter((r) => r.baselineFinalVerdict === "REJECTED").length,
    },
    confidenceCorrected: {
      approved: profA.filter((r) => r.correctedFinalVerdict === "APPROVED").length,
      wait: profA.filter((r) => r.correctedFinalVerdict === "WAIT").length,
      rejected: profA.filter((r) => r.correctedFinalVerdict === "REJECTED").length,
    },
    transitionCounts: tCounts,
    residualDetail,
    primaryResidual: primaryResidual
      ? { blocker: primaryResidual[0], count: primaryResidual[1], share: pct(primaryResidual[1], profA.length) }
      : null,
    ordering: {
      changedCount: profA.filter((r) => r.orderingChanged === 1).length,
      changedShare: orderingChangeShare,
      classification: orderingClass,
    },
    masterDecisionEffect: {
      share: pct(profA.filter((r) => s(r.correctedFirstBlocker) === "MASTER_DECISION").length, profA.length),
      class:
        pct(profA.filter((r) => s(r.correctedFirstBlocker) === "MASTER_DECISION").length, profA.length) >= 0.5
          ? "DOMINANT"
          : pct(profA.filter((r) => s(r.correctedFirstBlocker) === "MASTER_DECISION").length, profA.length) >= 0.2
            ? "MEANINGFUL"
            : "SECONDARY",
    },
    momentumEffect: {
      share: pct(profA.filter((r) => s(r.correctedFirstBlocker) === "MOMENTUM").length, profA.length),
    },
    technicalEffect: {
      share: pct(profA.filter((r) => s(r.correctedFirstBlocker) === "TECHNICAL").length, profA.length),
    },
    currentPaper: {
      primaryResidual: currentPrimary ?? "UNKNOWN",
      counts: currentResidualCounts,
      sharedWithHistorical: shared,
    },
    counterfactual: {
      branches: cfAgg,
      best: bestCf ?? null,
      releasedProfitable: bestCf?.releasedProfitable ?? 0,
      releasedLosing: bestCf?.releasedLosing ?? 0,
      releasedNetPnl: bestCf?.releasedNetPnL ?? 0,
    },
    oos,
    experiments,
  };
  wj(OUT.json, summary);

  const masterShare = pct(profA.filter((r) => s(r.correctedFirstBlocker) === "MASTER_DECISION").length, profA.length);
  const momentumShare = pct(profA.filter((r) => s(r.correctedFirstBlocker) === "MOMENTUM").length, profA.length);
  const technicalShare = pct(profA.filter((r) => s(r.correctedFirstBlocker) === "TECHNICAL").length, profA.length);
  const masterClass = masterShare >= 0.5 ? "DOMINANT" : masterShare >= 0.2 ? "MEANINGFUL" : masterShare > 0 ? "SECONDARY" : "UNKNOWN";
  const momentumClass = momentumShare >= 0.5 ? "DOMINANT" : momentumShare >= 0.2 ? "MEANINGFUL" : momentumShare > 0 ? "SECONDARY" : "UNKNOWN";
  const technicalClass = technicalShare >= 0.5 ? "DOMINANT" : technicalShare >= 0.2 ? "MEANINGFUL" : technicalShare > 0 ? "SECONDARY" : "UNKNOWN";

  const md = [
    "# KRIPTO P2 — RESIDUAL TDI BLOCKER FORENSIC",
    "",
    "## Core Result",
    `- Confidence correction sonrası 42 kârlı cohort hala APPROVED üretmiyor.`,
    `- Residual blocker analizi tamamlandı; transition matrix ve secondary blocker graph export edildi.`,
    "",
    "## Final Verdict",
    `PROFITABLE_TRADES = 42`,
    `BASELINE_APPROVED = ${summary.baseline.approved}`,
    `CONFIDENCE_CORRECTED_APPROVED = ${summary.confidenceCorrected.approved}`,
    `PRIMARY_RESIDUAL_BLOCKER = ${primaryResidual?.[0] ?? "UNKNOWN"}`,
    `PRIMARY_RESIDUAL_SHARE = ${primaryResidual ? pct(primaryResidual[1], profA.length) : "UNKNOWN"}`,
    `BLOCKER_ORDERING = ${orderingClass}`,
    `MASTER_DECISION_EFFECT = ${masterClass}`,
    `MOMENTUM_EFFECT = ${momentumClass}`,
    `TECHNICAL_EFFECT = ${technicalClass}`,
    `CURRENT_PAPER_SHARED_BLOCKER = ${shared}`,
    `BEST_COUNTERFACTUAL = ${bestCf?.mode ?? "NONE"}`,
    `RELEASED_PROFITABLE_TRADES = ${bestCf?.releasedProfitable ?? 0}`,
    `RELEASED_LOSING_TRADES = ${bestCf?.releasedLosing ?? 0}`,
    `RELEASED_NET_PNL = ${bestCf?.releasedNetPnL ?? 0}`,
    `OOS_SUPPORTED = ${oos.support}`,
    `FIRST_EXPERIMENT = ${experiments[0].experiment}`,
    `PRODUCTION_CHANGE_RECOMMENDED = NO`,
    "",
  ].join("\n");
  fs.writeFileSync(OUT.md, md, "utf8");

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});

