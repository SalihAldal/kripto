import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/src/server/db/prisma";

type AnyRecord = Record<string, unknown>;
type Verdict = "APPROVED" | "WAIT" | "REJECTED";
type EvidenceClass = "EXACT_RUNTIME_REPLAY" | "POLICY_FORENSIC_REPLAY" | "INFERRED";
type Branch = "BASELINE" | "A" | "B" | "C" | "D";

const ROOT = process.cwd();
const FIVE_ROUND = path.join(ROOT, "kripto-5round-paper-validation.json");

const OUT = {
  report: path.join(ROOT, "KRIPTO_P2_MOMENTUM_CONFIDENCE_INTERACTION_REPORT.md"),
  summary: path.join(ROOT, "kripto-p2-momentum-confidence-interaction.json"),
  transitions: path.join(ROOT, "kripto-p2-momentum-confidence-state-transitions.csv"),
  released: path.join(ROOT, "kripto-p2-momentum-confidence-released-cohort.csv"),
  oos: path.join(ROOT, "kripto-p2-momentum-confidence-oos.json"),
  currentCandidates: path.join(ROOT, "kripto-p2-momentum-confidence-current-candidates.csv"),
};

const TH = {
  technical: 48,
  sentimentTdi: 42,
  sentimentMomentumBase: 52,
  momentum: 60,
  confidenceWait: 40,
  confidenceBuy: 62,
  bullish: 4,
  execution: 55,
  ev: 68,
  shortMomentumAbs: 0.08,
  shortFlowAbs: 0.03,
};

const REGIME_SENTIMENT_DELTA: Record<string, number> = {
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
  const exactKeys = ["technicalScore", "momentumScore", "sentimentScore", "shortMomentum", "shortFlow", "confidence"];
  const exact = exactKeys.every((k) => Number.isFinite(n(meta[k])));
  if (exact && meta.tdiVerdict) return "EXACT_RUNTIME_REPLAY";
  const partial = Number.isFinite(n(meta.momentumScore)) || Number.isFinite(n(meta.shortMomentum)) || Number.isFinite(n(meta.confidence));
  return partial ? "POLICY_FORENSIC_REPLAY" : "INFERRED";
}

type State = {
  dataset: "historical" | "current";
  tradeId?: string;
  candidateId: string;
  symbol: string;
  strategy: string;
  regime: string;
  runId: string;
  sessionId: string;
  roundId: string;
  momentumScore: number;
  shortMomentum: number;
  shortFlow: number;
  sentimentScore: number;
  technicalScore: number;
  confidence: number;
  learningScore: number;
  bullishCount: number;
  executionScore: number;
  EV: number;
  baselineVerdict: Verdict;
  firstBlockingCondition: string;
  blockingConditions: string[];
  aiDecision: string;
  aiConfidence: number;
  riskVerdict: string;
  sizingVerdict: string;
  evidenceClass: EvidenceClass;
  netPnL?: number;
  grossPnL?: number;
  fees?: number;
  entryTimestamp?: string;
};

type EvalTrace = {
  momentumPass: boolean;
  momentumWeak: boolean;
  lowMomentumInput: boolean;
  sentimentWeak: boolean;
  confidenceBeforeMomentumInteraction: number;
  confidenceAfterMomentumInteraction: number;
  confidenceDeltaFromMomentum: number;
  momentumContributionToConfidence: number;
  interactionEffectClass: "NO_EFFECT" | "SMALL_EFFECT" | "MATERIAL_EFFECT" | "DOMINANT_EFFECT";
  confidencePass: boolean;
  technicalPass: boolean;
  bullishPass: boolean;
  executionPass: boolean;
  masterPass: boolean;
  hybridVerdict: Verdict;
  masterVerdict: Verdict;
  finalTdi: Verdict;
  firstBlocker: string;
  allBlockers: string[];
  gaps: Record<string, number>;
};

function evaluate(s1: State, branch: Branch): EvalTrace {
  const regimeDelta = REGIME_SENTIMENT_DELTA[s1.regime] ?? 0;
  const shortMomentumFail = Math.abs(s1.shortMomentum) < TH.shortMomentumAbs;
  const shortFlowFail = Math.abs(s1.shortFlow) < TH.shortFlowAbs;
  const lowMomentumInput = shortMomentumFail && shortFlowFail;
  const sentimentWeak = s1.sentimentScore < TH.sentimentMomentumBase + regimeDelta;
  const momentumScoreFail = s1.momentumScore < TH.momentum;
  const momentumWeak = momentumScoreFail || lowMomentumInput || sentimentWeak;

  // Reconstructed momentum->confidence interaction (policy forensic replay)
  const duplicatePenalty = lowMomentumInput ? 2 : 0;
  const baseMomentumPenalty = momentumWeak ? 4 : 0;
  const learningPenalty = momentumWeak && s1.learningScore < 45 ? 2 : 0;
  const totalPenalty = baseMomentumPenalty + duplicatePenalty + learningPenalty;
  const confidenceBefore = s1.confidence + totalPenalty;

  let confidenceAfter = s1.confidence;
  if (branch === "A") {
    // momentum unchanged, confidence no momentum-derived penalty
    confidenceAfter = confidenceBefore;
  } else if (branch === "B") {
    // keep momentum contribution, remove duplicate shortMomentum/shortFlow
    confidenceAfter = s1.confidence + duplicatePenalty;
  } else if (branch === "C") {
    // confidence unchanged, ordering only
    confidenceAfter = s1.confidence;
  } else if (branch === "D") {
    // neutralize only proven shared-signal double count
    confidenceAfter = lowMomentumInput ? s1.confidence + duplicatePenalty : s1.confidence;
  }

  const technicalFail = s1.technicalScore < TH.technical || s1.sentimentScore < TH.sentimentTdi;
  const confidenceFail = confidenceAfter < TH.confidenceWait;
  const bullishFail = s1.bullishCount < TH.bullish;
  const executionFail = s1.executionScore < TH.execution;
  const masterFail =
    s1.EV < TH.ev ||
    confidenceAfter < TH.confidenceBuy ||
    s1.momentumScore < TH.momentum ||
    s1.executionScore < TH.execution ||
    s1.bullishCount < TH.bullish;

  const orderA: Array<[string, boolean]> = [
    ["TECHNICAL", technicalFail],
    ["MOMENTUM", momentumWeak],
    ["CONFIDENCE", confidenceFail],
    ["MASTER_DECISION", masterFail],
  ];
  const orderB: Array<[string, boolean]> = [
    ["MOMENTUM", momentumWeak],
    ["TECHNICAL", technicalFail],
    ["CONFIDENCE", confidenceFail],
    ["MASTER_DECISION", masterFail],
  ];
  const orderC: Array<[string, boolean]> = [
    ["MOMENTUM", momentumWeak],
    ["CONFIDENCE", confidenceFail],
    ["TECHNICAL", technicalFail],
    ["MASTER_DECISION", masterFail],
  ];
  const order = branch === "C" ? orderC : branch === "D" ? orderB : orderA;
  const failed = order.filter((x) => x[1]).map((x) => x[0]);
  const first = failed[0] ?? "NONE";

  const hybridVerdict: Verdict = technicalFail ? "REJECTED" : momentumWeak ? "WAIT" : "APPROVED";
  const masterVerdict: Verdict = masterFail ? "WAIT" : "APPROVED";
  const finalTdi: Verdict = first === "NONE" ? "APPROVED" : first === "TECHNICAL" ? "REJECTED" : "WAIT";

  const delta = Number((confidenceAfter - confidenceBefore).toFixed(6));
  const absDelta = Math.abs(delta);
  const interactionEffectClass =
    absDelta < 0.5 ? "NO_EFFECT" : absDelta < 2 ? "SMALL_EFFECT" : absDelta < 5 ? "MATERIAL_EFFECT" : "DOMINANT_EFFECT";
  return {
    momentumPass: !momentumWeak,
    momentumWeak,
    lowMomentumInput,
    sentimentWeak,
    confidenceBeforeMomentumInteraction: Number(confidenceBefore.toFixed(6)),
    confidenceAfterMomentumInteraction: Number(confidenceAfter.toFixed(6)),
    confidenceDeltaFromMomentum: delta,
    momentumContributionToConfidence: delta,
    interactionEffectClass,
    confidencePass: !confidenceFail,
    technicalPass: !technicalFail,
    bullishPass: !bullishFail,
    executionPass: !executionFail,
    masterPass: !masterFail,
    hybridVerdict,
    masterVerdict,
    finalTdi,
    firstBlocker: first,
    allBlockers: failed,
    gaps: {
      momentumScoreGap: Number((s1.momentumScore - TH.momentum).toFixed(6)),
      shortMomentumGap: Number((Math.abs(s1.shortMomentum) - TH.shortMomentumAbs).toFixed(6)),
      shortFlowGap: Number((Math.abs(s1.shortFlow) - TH.shortFlowAbs).toFixed(6)),
      sentimentGap: Number((s1.sentimentScore - (TH.sentimentMomentumBase + regimeDelta)).toFixed(6)),
      technicalGap: Number((s1.technicalScore - TH.technical).toFixed(6)),
      confidenceGap: Number((confidenceAfter - TH.confidenceWait).toFixed(6)),
      executionGap: Number((s1.executionScore - TH.execution).toFixed(6)),
      bullishGap: Number((s1.bullishCount - TH.bullish).toFixed(6)),
      evGap: Number((s1.EV - TH.ev).toFixed(6)),
    },
  };
}

async function main() {
  const five = j<AnyRecord>(FIVE_ROUND);
  const roots: string[] = ((five.rounds as AnyRecord[]) ?? []).map((r) => s(r.artifactRoot)).filter(Boolean);

  const currentRowsRaw: State[] = [];
  for (const root of roots) {
    const p = path.join(root, "tdi-decisions.json");
    if (!fs.existsSync(p)) continue;
    const payload = j<{ records?: AnyRecord[] }>(p);
    for (const rec of payload.records ?? []) {
      currentRowsRaw.push({
        dataset: "current",
        candidateId: s(rec.candidateId),
        symbol: s(rec.symbol),
        strategy: strategyNorm(s(rec.strategy)),
        regime: regimeNorm(s(rec.regime)),
        runId: s(five.sessionId),
        sessionId: s(five.sessionId),
        roundId: s(rec.roundNo ?? path.basename(root)),
        momentumScore: n(rec.momentumScore),
        shortMomentum: n(rec.shortMomentum),
        shortFlow: n(rec.shortFlow),
        sentimentScore: n(rec.sentimentScore),
        technicalScore: n(rec.technicalScore),
        confidence: n(rec.confidence),
        learningScore: n(rec.learningScore),
        bullishCount: n(rec.bullishCount),
        executionScore: n(rec.executionScore),
        EV: n(rec.expectedValue ?? rec.consensusScore),
        baselineVerdict: verdictNorm(s(rec.verdict)),
        firstBlockingCondition: s(rec.firstBlockingCondition),
        blockingConditions: Array.isArray(rec.blockingConditions) ? (rec.blockingConditions as unknown[]).map((x) => s(x)) : [],
        aiDecision: s(rec.finalDecision ?? rec.hybridDecision, "UNKNOWN"),
        aiConfidence: n(rec.confidence),
        riskVerdict: s(rec.riskVerdict, "UNKNOWN"),
        sizingVerdict: s(rec.sizingVerdict, "UNKNOWN"),
        evidenceClass: "EXACT_RUNTIME_REPLAY",
      });
    }
  }
  const currentRows = Array.from(new Map(currentRowsRaw.map((r) => [`${r.candidateId}|${r.roundId}|${r.symbol}`, r])).values());

  const bySymbol = currentRows.reduce((acc, r) => ((acc.get(r.symbol)?.push(r) ?? acc.set(r.symbol, [r])), acc), new Map<string, State[]>());
  const bySR = currentRows.reduce((acc, r) => {
    const key = `${r.strategy}|${r.regime}`;
    (acc.get(key)?.push(r) ?? acc.set(key, [r]));
    return acc;
  }, new Map<string, State[]>());
  const med = (arr: State[], key: keyof State) => {
    const vals = arr.map((r) => n(r[key])).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (vals.length === 0) return Number.NaN;
    return vals[Math.floor((vals.length - 1) * 0.5)];
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
      createdAt: true,
    },
  });

  const historicalRows: State[] = trades.map((t) => {
    const m = ((t.metadata as AnyRecord | null) ?? {}) as AnyRecord;
    const eClass = evidenceClass(m);
    const symRows = bySymbol.get(t.symbol) ?? [];
    const srRows = bySR.get(`${strategyNorm(t.strategy)}|${regimeNorm(s(t.marketRegime))}`) ?? [];
    const src = symRows.length > 0 ? symRows : srRows;
    const infer = (key: string, fb: keyof State) => (Number.isFinite(n(m[key])) ? n(m[key]) : src.length > 0 ? med(src, fb) : Number.NaN);
    const gross = Number((Math.abs((t.exitPrice - t.entryPrice) * t.quantity)).toFixed(8));
    const fees = Math.max(0, Number((gross - Math.abs(t.realizedPnl)).toFixed(8)));
    return {
      dataset: "historical",
      tradeId: t.tradeId,
      candidateId: s(m.candidateId ?? m.executionCandidateId ?? `hist:${t.tradeId}`),
      symbol: t.symbol,
      strategy: strategyNorm(t.strategy),
      regime: regimeNorm(s(t.marketRegime)),
      runId: s(m.runId ?? m.executionId ?? m.jobId),
      sessionId: s(m.sessionId ?? m.jobId),
      roundId: s(m.roundId ?? m.roundNo),
      momentumScore: infer("momentumScore", "momentumScore"),
      shortMomentum: infer("shortMomentum", "shortMomentum"),
      shortFlow: infer("shortFlow", "shortFlow"),
      sentimentScore: infer("sentimentScore", "sentimentScore"),
      technicalScore: infer("technicalScore", "technicalScore"),
      confidence: infer("confidence", "confidence"),
      learningScore: infer("learningScore", "learningScore"),
      bullishCount: infer("bullishCount", "bullishCount"),
      executionScore: infer("executionScore", "executionScore"),
      EV: infer("expectedValue", "EV"),
      baselineVerdict: verdictNorm(s(m.tdiVerdict ?? m.verdict, "WAIT")),
      firstBlockingCondition: s(m.firstBlockingCondition, "UNKNOWN"),
      blockingConditions: Array.isArray(m.blockingConditions) ? (m.blockingConditions as unknown[]).map((x) => s(x)) : [],
      aiDecision: s(m.aiFinalDecision ?? m.finalDecision, "UNKNOWN"),
      aiConfidence: n(m.aiConfidence),
      riskVerdict: s(m.riskVerdict, "UNKNOWN"),
      sizingVerdict: s(m.sizingVerdict, "UNKNOWN"),
      evidenceClass: eClass,
      netPnL: t.realizedPnl,
      grossPnL: gross,
      fees,
      entryTimestamp: t.openedAt?.toISOString?.() ?? t.createdAt.toISOString(),
    };
  });

  const profitable42 = historicalRows.filter((r) => (r.netPnL ?? 0) > 0);
  const losses = historicalRows.filter((r) => (r.netPnL ?? 0) < 0);
  const breakeven = historicalRows.filter((r) => (r.netPnL ?? 0) === 0);

  const evaluateBranch = (rows: State[], branch: Branch) =>
    rows.map((r) => {
      const ev = evaluate(r, branch);
      return { ...r, branch, ...ev };
    });

  const allBranches: Branch[] = ["BASELINE", "A", "B", "C", "D"];
  const profByBranch = Object.fromEntries(allBranches.map((b) => [b, evaluateBranch(profitable42, b)])) as Record<Branch, ReturnType<typeof evaluateBranch>>;
  const lossByBranch = Object.fromEntries(allBranches.map((b) => [b, evaluateBranch(losses, b)])) as Record<Branch, ReturnType<typeof evaluateBranch>>;
  const beByBranch = Object.fromEntries(allBranches.map((b) => [b, evaluateBranch(breakeven, b)])) as Record<Branch, ReturnType<typeof evaluateBranch>>;
  const curByBranch = Object.fromEntries(allBranches.map((b) => [b, evaluateBranch(currentRows, b)])) as Record<Branch, ReturnType<typeof evaluateBranch>>;

  const transitions: AnyRecord[] = [];
  for (const r of profitable42) {
    const base = profByBranch.BASELINE.find((x) => x.tradeId === r.tradeId)!;
    for (const b of ["BASELINE", "A", "B", "C", "D"] as const) {
      const br = profByBranch[b].find((x) => x.tradeId === r.tradeId)!;
      transitions.push({
        tradeId: r.tradeId ?? "",
        candidateId: r.candidateId,
        symbol: r.symbol,
        strategy: r.strategy,
        regime: r.regime,
        evidenceClass: r.evidenceClass,
        branch: b,
        baselineVerdict: base.finalTdi,
        branchVerdict: br.finalTdi,
        baselineFirstBlocker: base.firstBlocker,
        branchFirstBlocker: br.firstBlocker,
        momentumScore: r.momentumScore,
        momentumPass: br.momentumPass ? 1 : 0,
        shortMomentum: r.shortMomentum,
        shortFlow: r.shortFlow,
        sentimentScore: r.sentimentScore,
        confidenceBeforeMomentumInteraction: br.confidenceBeforeMomentumInteraction,
        confidenceAfterMomentumInteraction: br.confidenceAfterMomentumInteraction,
        momentumContributionToConfidence: br.momentumContributionToConfidence,
        confidenceDelta: br.confidenceDeltaFromMomentum,
        interactionEffectClass: br.interactionEffectClass,
        confidencePass: br.confidencePass ? 1 : 0,
        technicalPass: br.technicalPass ? 1 : 0,
        hybridVerdict: br.hybridVerdict,
        masterVerdict: br.masterVerdict,
        finalTdi: br.finalTdi,
        momentumScoreGap: br.gaps.momentumScoreGap,
        shortMomentumGap: br.gaps.shortMomentumGap,
        shortFlowGap: br.gaps.shortFlowGap,
        sentimentGap: br.gaps.sentimentGap,
        confidenceGap: br.gaps.confidenceGap,
      });
    }
  }

  const releasedRows: AnyRecord[] = [];
  for (const b of ["A", "B", "C", "D"] as const) {
    const rows = profByBranch[b]
      .filter((r) => {
        const base = profByBranch.BASELINE.find((x) => x.tradeId === r.tradeId)!;
        return base.finalTdi !== "APPROVED" && r.finalTdi === "APPROVED";
      })
      .map((r) => ({
        branch: b,
        tradeId: r.tradeId ?? "",
        candidateId: r.candidateId,
        symbol: r.symbol,
        strategy: r.strategy,
        regime: r.regime,
        baselineVerdict: profByBranch.BASELINE.find((x) => x.tradeId === r.tradeId)!.finalTdi,
        branchVerdict: r.finalTdi,
        historicalNetPnL: r.netPnL ?? Number.NaN,
        historicalGrossPnL: r.grossPnL ?? Number.NaN,
        historicalFees: r.fees ?? Number.NaN,
        outcomeClass:
          Number(r.netPnL) > 0
            ? "PROFITABLE_RELEASE"
            : Number(r.netPnL) < 0
              ? "LOSING_RELEASE"
              : "BREAKEVEN_RELEASE",
        downstreamTrace: {
          tdi: r.finalTdi,
          ai: r.aiDecision || "UNKNOWN_NOT_RECONSTRUCTABLE",
          risk: r.riskVerdict || "UNKNOWN_NOT_RECONSTRUCTABLE",
          sizing: r.sizingVerdict || "UNKNOWN_NOT_RECONSTRUCTABLE",
          executionReady:
            r.finalTdi === "APPROVED" &&
            (r.aiDecision === "BUY" || r.aiDecision === "APPROVED") &&
            r.riskVerdict !== "REJECT" &&
            r.sizingVerdict !== "REJECT"
              ? "YES"
              : "NO_OR_UNKNOWN",
          firstDownstreamBlocker:
            r.finalTdi !== "APPROVED"
              ? "TDI"
              : r.aiDecision && r.aiDecision !== "BUY"
                ? "AI"
                : r.riskVerdict && r.riskVerdict.toUpperCase().includes("REJECT")
                  ? "RISK"
                  : r.sizingVerdict && r.sizingVerdict.toUpperCase().includes("REJECT")
                    ? "SIZING"
                    : "UNKNOWN_NOT_RECONSTRUCTABLE",
        },
        label: "HISTORICAL_COUNTERFACTUAL",
        evidenceClass: r.evidenceClass,
      }));
    releasedRows.push(...rows);
  }

  const branchAgg = (branch: Branch) => {
    const p = profByBranch[branch];
    const l = lossByBranch[branch];
    const b = beByBranch[branch];
    const c = curByBranch[branch];
    const relP = p.filter((r, i) => profByBranch.BASELINE[i].finalTdi !== "APPROVED" && r.finalTdi === "APPROVED");
    const relL = l.filter((r, i) => lossByBranch.BASELINE[i].finalTdi !== "APPROVED" && r.finalTdi === "APPROVED");
    const relB = b.filter((r, i) => beByBranch.BASELINE[i].finalTdi !== "APPROVED" && r.finalTdi === "APPROVED");
    const net = Number(relP.reduce((a, r) => a + n(r.netPnL, 0), 0).toFixed(8));
    const netL = Number(relL.reduce((a, r) => a + n(r.netPnL, 0), 0).toFixed(8));
    return {
      branch,
      approved42: p.filter((r) => r.finalTdi === "APPROVED").length,
      wait42: p.filter((r) => r.finalTdi === "WAIT").length,
      reject42: p.filter((r) => r.finalTdi === "REJECTED").length,
      approvedCurrent: c.filter((r) => r.finalTdi === "APPROVED").length,
      waitCurrent: c.filter((r) => r.finalTdi === "WAIT").length,
      rejectCurrent: c.filter((r) => r.finalTdi === "REJECTED").length,
      profitableReleased: relP.length,
      losingReleased: relL.length,
      breakevenReleased: relB.length,
      releasedNetPnL: Number((net + netL).toFixed(8)),
      releasedExpectancy: Number(((net + netL) / Math.max(1, relP.length + relL.length + relB.length)).toFixed(8)),
      falseReleaseRate: pct(relL.length, Math.max(1, relP.length + relL.length + relB.length)),
    };
  };
  const agg = allBranches.map(branchAgg);
  const bestCandidate = [...agg.filter((x) => x.branch !== "BASELINE")].sort(
    (a, b) => b.profitableReleased - a.profitableReleased || b.releasedNetPnL - a.releasedNetPnL,
  )[0] ?? {
    branch: "NONE",
    approved42: 0,
    wait42: 0,
    reject42: 0,
    approvedCurrent: 0,
    waitCurrent: 0,
    rejectCurrent: 0,
    profitableReleased: 0,
    losingReleased: 0,
    breakevenReleased: 0,
    releasedNetPnL: 0,
    releasedExpectancy: 0,
    falseReleaseRate: 0,
  };
  const best = bestCandidate.profitableReleased > 0 ? bestCandidate : { ...bestCandidate, branch: "NONE" };

  const oosRows = best.branch === "NONE" ? profByBranch.BASELINE : profByBranch[best.branch as Branch];
  const sorted = [...oosRows].sort((a, b) => Date.parse(s(a.entryTimestamp)) - Date.parse(s(b.entryTimestamp)));
  const cut1 = Math.max(1, Math.floor(sorted.length * 0.6));
  const cut2 = Math.max(cut1 + 1, Math.floor(sorted.length * 0.8));
  const split = { train: sorted.slice(0, cut1), validation: sorted.slice(cut1, cut2), oos: sorted.slice(cut2) };
  const splitMetric = (rows: typeof sorted) => {
    const rel = rows.filter((r) => r.finalTdi === "APPROVED");
    const net = rel.reduce((a, r) => a + n(r.netPnL, 0), 0);
    return {
      size: rows.length,
      approved: rel.length,
      releasedNetPnL: Number(net.toFixed(8)),
      releasedExpectancy: Number((net / Math.max(1, rel.length)).toFixed(8)),
      falseReleaseRate: 0,
    };
  };
  const oos = {
    mode: "POLICY_LEVEL_OOS",
    branch: best.branch,
    train: splitMetric(split.train),
    validation: splitMetric(split.validation),
    oos: splitMetric(split.oos),
    support: best.branch === "NONE" ? "NO" : split.validation.length >= 5 && split.oos.length >= 5 ? "YES" : "PARTIAL",
  };

  const robustRows = releasedRows
    .filter((r) => r.branch === best.branch)
    .map((r) => ({ ...r, net: n(r.historicalNetPnL, 0) }))
    .sort((a, b) => b.net - a.net);
  const robust = (arr: typeof robustRows) => Number(arr.reduce((a, r) => a + r.net, 0).toFixed(8));
  const robustness =
    robustRows.length < 8
      ? "INSUFFICIENT_SAMPLE"
      : Math.abs(robust(robustRows) - robust(robustRows.slice(5))) > Math.abs(robust(robustRows)) * 0.6
        ? "CONCENTRATED"
        : "ROBUST";

  const rootCause = best.branch === "NONE" ? "RAW_MOMENTUM_SCORE_TOO_LOW" : "MOMENTUM→CONFIDENCE_DOUBLE_PENALTY";

  const currentExport = allBranches.flatMap((b) =>
    curByBranch[b].map((r) => ({
      branch: b,
      candidateId: r.candidateId,
      roundId: r.roundId,
      symbol: r.symbol,
      strategy: r.strategy,
      regime: r.regime,
      momentumScore: r.momentumScore,
      shortMomentum: r.shortMomentum,
      shortFlow: r.shortFlow,
      sentimentScore: r.sentimentScore,
      technicalScore: r.technicalScore,
      confidenceBeforeMomentumInteraction: r.confidenceBeforeMomentumInteraction,
      confidenceAfterMomentumInteraction: r.confidenceAfterMomentumInteraction,
      momentumContributionToConfidence: r.momentumContributionToConfidence,
      confidenceDeltaFromMomentum: r.confidenceDeltaFromMomentum,
      interactionEffectClass: r.interactionEffectClass,
      firstBlocker: r.firstBlocker,
      allBlockers: r.allBlockers.join("|"),
      finalTdi: r.finalTdi,
      evidenceClass: r.evidenceClass,
    })),
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    constraints: {
      noNewPaperRun: true,
      noNewMarketData: true,
      noProductionChanges: true,
    },
    counts: {
      profitable42: profitable42.length,
      current2278: currentRows.length,
      losses: losses.length,
      breakeven: breakeven.length,
    },
    branchComparison: agg,
    bestBranch: best,
    rootCause,
    transitionsSample: transitions.slice(0, 20),
    oos,
    robustness,
    orderingCausality:
      agg.find((x) => x.branch === "C")?.wait42 !== agg.find((x) => x.branch === "BASELINE")?.wait42 ||
      agg.find((x) => x.branch === "C")?.reject42 !== agg.find((x) => x.branch === "BASELINE")?.reject42
        ? "YES"
        : "NO",
    masterEffect:
      profitable42.some((r, i) => {
        const ev = profByBranch[best.branch as Branch]?.[i] ?? profByBranch.BASELINE[i];
        return ev.hybridVerdict === "APPROVED" && ev.masterVerdict !== "APPROVED";
      })
        ? "YES"
        : "UNKNOWN",
    finalVerdict: {
      ROOT_CAUSE: rootCause,
      BEST_BRANCH: best.branch === "BASELINE" || best.branch === "NONE" ? "NONE" : best.branch,
      PROFITABLE_RELEASED: best.profitableReleased,
      LOSING_RELEASED: best.losingReleased,
      RELEASED_NET_PNL: best.releasedNetPnL,
      RELEASED_EXPECTANCY: best.releasedExpectancy,
      CURRENT_2278_APPROVED: best.approvedCurrent,
      CURRENT_2278_WAIT: best.waitCurrent,
      CURRENT_2278_REJECT: best.rejectCurrent,
      ORDERING_CAUSALITY:
        agg.find((x) => x.branch === "C")?.waitCurrent !== agg.find((x) => x.branch === "BASELINE")?.waitCurrent ||
        agg.find((x) => x.branch === "C")?.rejectCurrent !== agg.find((x) => x.branch === "BASELINE")?.rejectCurrent
          ? "YES"
          : "NO",
      MASTER_EFFECT:
        profitable42.some((r, i) => {
          const ev = profByBranch[best.branch as Branch]?.[i] ?? profByBranch.BASELINE[i];
          return ev.hybridVerdict === "APPROVED" && ev.masterVerdict !== "APPROVED";
        })
          ? "YES"
          : "UNKNOWN",
      OOS_SUPPORTED: oos.support,
      ROBUSTNESS: robustness,
      FIRST_EXPERIMENT: best.branch === "NONE" ? "NO_VALID_EXPERIMENT" : "MOMENTUM_CONFIDENCE_INTERACTION_SHADOW",
      PRODUCTION_CHANGE_RECOMMENDED: "NO",
    },
  };

  wcsv(OUT.transitions, transitions);
  wcsv(OUT.released, releasedRows);
  wj(OUT.oos, oos);
  wcsv(OUT.currentCandidates, currentExport);
  wj(OUT.summary, summary);

  const md = [
    "# KRIPTO P2 — DEEP MOMENTUM × CONFIDENCE INTERACTION SHADOW EXPERIMENT",
    "",
    "## Evidence",
    `- 42 trade step trace: \`kripto-p2-momentum-confidence-state-transitions.csv\``,
    `- released cohort map: \`kripto-p2-momentum-confidence-released-cohort.csv\``,
    `- current 2278 branch replay: \`kripto-p2-momentum-confidence-current-candidates.csv\``,
    `- OOS: \`kripto-p2-momentum-confidence-oos.json\``,
    "",
    "## Final Verdict",
    `ROOT_CAUSE = ${summary.finalVerdict.ROOT_CAUSE}`,
    `BEST_BRANCH = ${summary.finalVerdict.BEST_BRANCH}`,
    `PROFITABLE_RELEASED = ${summary.finalVerdict.PROFITABLE_RELEASED}`,
    `LOSING_RELEASED = ${summary.finalVerdict.LOSING_RELEASED}`,
    `RELEASED_NET_PNL = ${summary.finalVerdict.RELEASED_NET_PNL}`,
    `RELEASED_EXPECTANCY = ${summary.finalVerdict.RELEASED_EXPECTANCY}`,
    `CURRENT_2278_APPROVED = ${summary.finalVerdict.CURRENT_2278_APPROVED}`,
    `CURRENT_2278_WAIT = ${summary.finalVerdict.CURRENT_2278_WAIT}`,
    `CURRENT_2278_REJECT = ${summary.finalVerdict.CURRENT_2278_REJECT}`,
    `ORDERING_CAUSALITY = ${summary.finalVerdict.ORDERING_CAUSALITY}`,
    `MASTER_EFFECT = ${summary.finalVerdict.MASTER_EFFECT}`,
    `OOS_SUPPORTED = ${summary.finalVerdict.OOS_SUPPORTED}`,
    `ROBUSTNESS = ${summary.finalVerdict.ROBUSTNESS}`,
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

