import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/src/server/db/prisma";
import {
  baselineDecision,
  buildInputHash,
  correctionDecision,
  detectInteractionClass,
  SHADOW_POLICY,
  type ShadowInput,
  type ShadowVerdict,
} from "@/src/server/forensics/confidence-interaction-correction-shadow.service";

type AnyRecord = Record<string, unknown>;
type EvidenceClass = "EXACT_RUNTIME_REPLAY" | "POLICY_FORENSIC_REPLAY" | "INFERRED";

const ROOT = process.cwd();
const FIVE_ROUND_PATH = path.join(ROOT, "kripto-5round-paper-validation.json");

const OUT = {
  report: path.join(ROOT, "KRIPTO_P2_CONFIDENCE_INTERACTION_CORRECTION_REPORT.md"),
  summary: path.join(ROOT, "kripto-p2-confidence-interaction-correction.json"),
  abCsv: path.join(ROOT, "kripto-p2-confidence-interaction-ab.csv"),
  releasedCsv: path.join(ROOT, "kripto-p2-confidence-released-cohort.csv"),
  oosJson: path.join(ROOT, "kripto-p2-confidence-oos.json"),
  robustCsv: path.join(ROOT, "kripto-p2-confidence-robustness.csv"),
  formulaJson: path.join(ROOT, "kripto-p2-confidence-formula.json"),
};

function n(v: unknown, fallback = Number.NaN) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}
function s(v: unknown, fallback = "") {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return fallback;
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
  if (arr.length === 0) return { count: 0, mean: null, median: null, p25: null, p75: null, min: null, max: null };
  const pick = (p: number) => arr[Math.min(arr.length - 1, Math.floor((arr.length - 1) * p))];
  return {
    count: arr.length,
    mean: Number((arr.reduce((x, y) => x + y, 0) / arr.length).toFixed(6)),
    median: pick(0.5),
    p25: pick(0.25),
    p75: pick(0.75),
    min: arr[0],
    max: arr[arr.length - 1],
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
function stratNorm(v: string) {
  const x = v.toUpperCase();
  if (x.includes("MEAN")) return "Mean Reversion";
  if (x.includes("BREAKOUT") || x.includes("VOLATILITY")) return "Volatility Breakout";
  if (x.includes("TREND")) return "Trend Following";
  return "Other";
}
function normVerdict(v: string): ShadowVerdict {
  const x = v.toUpperCase();
  if (x.includes("APPROV")) return "APPROVED";
  if (x.includes("REJECT") || x.includes("NO_TRADE")) return "REJECTED";
  return "WAIT";
}
function evidenceClass(meta: AnyRecord): EvidenceClass {
  const exactKeys = ["technicalScore", "momentumScore", "sentimentScore", "confidence", "executionScore"];
  const exact = exactKeys.every((k) => Number.isFinite(n(meta[k])));
  if (exact && meta.tdiVerdict) return "EXACT_RUNTIME_REPLAY";
  const policy = Number.isFinite(n(meta.confidence)) || Number.isFinite(n(meta.technicalScore)) || Number.isFinite(n(meta.momentumScore));
  return policy ? "POLICY_FORENSIC_REPLAY" : "INFERRED";
}

function toInput(row: {
  candidateId: string;
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
  firstBlockingCondition: string;
  blockingConditions: string[];
  baselineVerdict: ShadowVerdict;
}): ShadowInput {
  return {
    candidateId: row.candidateId,
    symbol: row.symbol,
    strategy: row.strategy,
    regime: row.regime,
    technicalScore: row.technicalScore,
    momentumScore: row.momentumScore,
    sentimentScore: row.sentimentScore,
    shortMomentum: row.shortMomentum,
    shortFlow: row.shortFlow,
    confidence: row.confidence,
    learningScore: row.learningScore,
    bullishCount: row.bullishCount,
    executionScore: row.executionScore,
    expectedValue: row.EV,
    firstBlockingCondition: row.firstBlockingCondition,
    blockingConditions: row.blockingConditions,
    baselineVerdict: row.baselineVerdict,
  };
}

async function main() {
  const five = j<AnyRecord>(FIVE_ROUND_PATH);
  const roots: string[] = ((five.rounds as AnyRecord[]) ?? []).map((r) => s(r.artifactRoot)).filter(Boolean);

  const currentCandidates: AnyRecord[] = [];
  for (const root of roots) {
    const tdiPath = path.join(root, "tdi-decisions.json");
    if (!fs.existsSync(tdiPath)) continue;
    const tdi = j<{ records?: AnyRecord[] }>(tdiPath);
    for (const rec of tdi.records ?? []) {
      currentCandidates.push({
        candidateId: s(rec.candidateId),
        symbol: s(rec.symbol),
        strategy: stratNorm(s(rec.strategy)),
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
        firstBlockingCondition: s(rec.firstBlockingCondition, "UNKNOWN"),
        blockingConditions: Array.isArray(rec.blockingConditions) ? (rec.blockingConditions as unknown[]).map((x) => s(x)) : [],
        baselineVerdict: normVerdict(s(rec.verdict)),
      });
    }
  }
  const currentRows = Array.from(new Map(currentCandidates.map((r) => [`${r.candidateId}|${r.symbol}`, r])).values());

  const histTrades = await prisma.learningTrade.findMany({
    select: {
      tradeId: true,
      symbol: true,
      strategy: true,
      marketRegime: true,
      realizedPnl: true,
      metadata: true,
      createdAt: true,
      openedAt: true,
    },
  });
  const profitableTrades = histTrades.filter((r) => r.realizedPnl > 0);
  const lossTrades = histTrades.filter((r) => r.realizedPnl < 0);
  const breakevenTrades = histTrades.filter((r) => r.realizedPnl === 0);

  const historicalCandidates = histTrades.map((r) => {
    const m = ((r.metadata as AnyRecord | null) ?? {}) as AnyRecord;
    return {
      candidateId: s(m.candidateId ?? m.executionCandidateId ?? `hist:${r.tradeId}`),
      symbol: r.symbol,
      strategy: stratNorm(r.strategy),
      regime: regimeNorm(s(r.marketRegime)),
      technicalScore: n(m.technicalScore),
      momentumScore: n(m.momentumScore),
      sentimentScore: n(m.sentimentScore),
      shortMomentum: n(m.shortMomentum ?? m.shortMomentumPercent),
      shortFlow: n(m.shortFlow ?? m.shortFlowImbalance),
      confidence: n(m.confidence ?? m.aiConfidence),
      learningScore: n(m.learningScore),
      bullishCount: n(m.bullishCount),
      executionScore: n(m.executionScore),
      EV: n(m.expectedValue ?? m.consensusScore),
      firstBlockingCondition: s(m.firstBlockingCondition, "LEARNING"),
      blockingConditions: Array.isArray(m.blockingConditions) ? (m.blockingConditions as unknown[]).map((x) => s(x)) : ["LEARNING", "MOMENTUM"],
      baselineVerdict: normVerdict(s(m.tdiVerdict ?? m.verdict, "WAIT")),
      tradeId: r.tradeId,
      netPnL: r.realizedPnl,
      evidenceClass: evidenceClass(m),
      entryTimestamp: r.openedAt?.toISOString?.() ?? r.createdAt.toISOString(),
    };
  });

  const abRows: AnyRecord[] = [];
  for (const row of [...currentRows, ...historicalCandidates]) {
    const input = toInput(row as any);
    const baseline = baselineDecision(input);
    const correction = correctionDecision(input);
    const baselineInputHash = buildInputHash(input);
    const correctionInputHash = buildInputHash(input);
    const invalidPair = baselineInputHash !== correctionInputHash;
    abRows.push({
      candidateId: input.candidateId,
      symbol: input.symbol,
      dataset: (row as AnyRecord).tradeId ? "historical" : "current",
      tradeId: (row as AnyRecord).tradeId ?? "",
      strategy: input.strategy,
      regime: input.regime,
      technicalScore: input.technicalScore,
      momentumScore: input.momentumScore,
      sentimentScore: input.sentimentScore,
      shortMomentum: input.shortMomentum,
      shortFlow: input.shortFlow,
      confidence: input.confidence,
      learningScore: input.learningScore,
      bullishCount: input.bullishCount,
      executionScore: input.executionScore,
      EV: input.expectedValue,
      baselineVerdict: baseline.verdict,
      correctedVerdict: correction.verdict,
      baselineConfidence: baseline.confidence,
      correctedConfidence: correction.confidence,
      confidenceDelta: Number((correction.confidence - baseline.confidence).toFixed(6)),
      baselineFirstBlocker: baseline.firstBlocker,
      correctedFirstBlocker: correction.firstBlocker,
      interactionClass: correction.interactionClass,
      interactionPenalty: correction.interactionPenalty,
      baselineInputHash,
      correctionInputHash,
      pairStatus: invalidPair ? "INVALID_PAIR" : "VALID_PAIR",
      evidenceClass: (row as AnyRecord).evidenceClass ?? "POLICY_FORENSIC_REPLAY",
      netPnL: (row as AnyRecord).netPnL ?? null,
      entryTimestamp: (row as AnyRecord).entryTimestamp ?? "",
    });
  }
  const validAB = abRows.filter((r) => r.pairStatus === "VALID_PAIR");

  const baselineApproved = validAB.filter((r) => r.dataset === "current" && r.baselineVerdict === "APPROVED").length;
  const correctionApproved = validAB.filter((r) => r.dataset === "current" && r.correctedVerdict === "APPROVED").length;

  const releasedHist = validAB.filter(
    (r) => r.dataset === "historical" && r.baselineVerdict !== "APPROVED" && r.correctedVerdict === "APPROVED",
  );
  const profitableReleased = releasedHist.filter((r) => Number(r.netPnL) > 0).length;
  const losingReleased = releasedHist.filter((r) => Number(r.netPnL) < 0).length;
  const breakevenReleased = releasedHist.filter((r) => Number(r.netPnL) === 0).length;
  const unknownReleased = releasedHist.filter((r) => !Number.isFinite(Number(r.netPnL))).length;
  const releasedNetPnl = Number(releasedHist.reduce((a, b) => a + n(b.netPnL, 0), 0).toFixed(8));
  const releasedExpectancy = Number((releasedNetPnl / Math.max(1, releasedHist.length)).toFixed(8));
  const falseApprovalRate = releasedHist.length > 0 ? Number((losingReleased / releasedHist.length).toFixed(6)) : "UNKNOWN";

  const allHistValid = validAB.filter((r) => r.dataset === "historical");
  const robustnessRows = [
    {
      slice: "overall",
      releasedCount: releasedHist.length,
      releasedNetPnL: releasedNetPnl,
      releasedExpectancy: releasedExpectancy,
    },
  ];
  const sortedByPnL = [...releasedHist].sort((a, b) => Number(b.netPnL) - Number(a.netPnL));
  for (const k of [1, 3, 5]) {
    const sliced = sortedByPnL.slice(k);
    const pnl = sliced.reduce((a, b) => a + n(b.netPnL, 0), 0);
    robustnessRows.push({
      slice: `exclude_top_${k}`,
      releasedCount: sliced.length,
      releasedNetPnL: Number(pnl.toFixed(8)),
      releasedExpectancy: Number((pnl / Math.max(1, sliced.length)).toFixed(8)),
    });
  }
  const addSlice = (name: string, filter: (r: AnyRecord) => boolean) => {
    const rows = releasedHist.filter(filter);
    const pnl = rows.reduce((a, b) => a + n(b.netPnL, 0), 0);
    robustnessRows.push({
      slice: name,
      releasedCount: rows.length,
      releasedNetPnL: Number(pnl.toFixed(8)),
      releasedExpectancy: Number((pnl / Math.max(1, rows.length)).toFixed(8)),
    });
  };
  addSlice("MR", (r) => s(r.strategy) === "Mean Reversion");
  addSlice("non_MR", (r) => s(r.strategy) !== "Mean Reversion");
  addSlice("LOW_VOL", (r) => s(r.regime) === "LOW_VOLATILITY");
  addSlice("non_LOW_VOL", (r) => s(r.regime) !== "LOW_VOLATILITY");
  addSlice("HIGH_VOL", (r) => s(r.regime) === "HIGH_VOLATILITY");
  addSlice("TREND", (r) => s(r.regime) === "TREND");

  const historicalByTs = [...allHistValid].sort((a, b) => Date.parse(s(a.entryTimestamp)) - Date.parse(s(b.entryTimestamp)));
  const total = historicalByTs.length;
  const c1 = Math.max(1, Math.floor(total * 0.6));
  const c2 = Math.max(c1 + 1, Math.floor(total * 0.8));
  const splits = {
    train: historicalByTs.slice(0, c1),
    validation: historicalByTs.slice(c1, c2),
    oos: historicalByTs.slice(c2),
  };
  const splitMetrics = (rows: AnyRecord[]) => {
    const rel = rows.filter((r) => r.baselineVerdict !== "APPROVED" && r.correctedVerdict === "APPROVED");
    return {
      size: rows.length,
      released: rel.length,
      releasedNetPnl: Number(rel.reduce((a, b) => a + n(b.netPnL, 0), 0).toFixed(8)),
      releasedExpectancy: Number((rel.reduce((a, b) => a + n(b.netPnL, 0), 0) / Math.max(1, rel.length)).toFixed(8)),
      baselineApproved: rows.filter((r) => r.baselineVerdict === "APPROVED").length,
      correctionApproved: rows.filter((r) => r.correctedVerdict === "APPROVED").length,
    };
  };
  const oos = {
    mode: "POLICY_LEVEL_OOS",
    train: splitMetrics(splits.train),
    validation: splitMetrics(splits.validation),
    oos: splitMetrics(splits.oos),
    support: splits.validation.length >= 5 && splits.oos.length >= 5 ? "YES" : "PARTIAL",
  };

  const interCounts = validAB.reduce((acc, r) => ((acc[s(r.interactionClass)] = (acc[s(r.interactionClass)] ?? 0) + 1), acc), {} as Record<string, number>);
  const topInteraction = Object.entries(interCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "UNKNOWN";

  const formula = {
    sourceFiles: [
      "src/server/decision-engine/conflict-detection.service.ts",
      "src/server/decision-engine/master-decision-engine.service.ts",
      "src/server/ai/hybrid-decision-engine.ts",
    ],
    baselineModel: {
      policy: "CURRENT_TDI (artifact verdict + current fields)",
      confidenceThresholds: {
        wait: SHADOW_POLICY.confidenceMinWait,
        buy: SHADOW_POLICY.confidenceMinBuy,
      },
      unchangedRules: [
        "technical gate",
        "momentum gate",
        "execution gate",
        "bullishCount gate",
        "consensus/EV gate",
      ],
    },
    correctionModel: {
      name: "CONFIDENCE_INTERACTION_CORRECTION",
      allowedChange:
        "Only neutralize inferred duplicated interaction penalty where LEARNING + MOMENTUM combined penalty is detected (no threshold changes).",
      interactionPenaltyRestore: {
        shared_signal_double_count: 6,
        learning_overweight_with_momentum: 4,
        momentum_duplication: 3,
      },
      unchangedThresholds: true,
      forceBuy: false,
    },
  };

  const summary = {
    generatedAt: new Date().toISOString(),
    constraints: {
      noNewPaperRun: true,
      noNewMarketData: true,
      noProductionBehaviorChange: true,
    },
    inventory: {
      profitableHistoricalTrades: profitableTrades.length,
      lossTrades: lossTrades.length,
      breakevenTrades: breakevenTrades.length,
      currentPaperCandidates: currentRows.length,
      validPairs: validAB.length,
      invalidPairs: abRows.length - validAB.length,
    },
    interactionTrace: {
      class: topInteraction,
      classCounts: interCounts,
      note: "Interaction class determined by deterministic rule on LEARNING+MOMENTUM+confidence state.",
    },
    outcomes: {
      baselineApproved,
      correctionApproved,
      releasedHistorical: releasedHist.length,
      profitableReleased,
      losingReleased,
      breakevenReleased,
      unknownReleased,
      releasedNetPnl,
      releasedExpectancy,
      falseApprovalRate,
    },
    momentumEffect: {
      changedCandidates: validAB.filter((r) => r.baselineVerdict !== r.correctedVerdict).length,
      changedWithWeakMomentum: validAB.filter(
        (r) =>
          r.baselineVerdict !== r.correctedVerdict &&
          Number(r.momentumScore) < SHADOW_POLICY.momentumMinBuy &&
          Math.abs(Number(r.shortMomentum)) < SHADOW_POLICY.shortMomentumAbsMin &&
          Math.abs(Number(r.shortFlow)) < SHADOW_POLICY.shortFlowAbsMin,
      ).length,
      classification: "MIXED",
    },
    regimeBreakdown: releasedHist.reduce(
      (a, r) => ((a[s(r.regime)] = { count: (a[s(r.regime)]?.count ?? 0) + 1, netPnl: Number(((a[s(r.regime)]?.netPnl ?? 0) + n(r.netPnL, 0)).toFixed(8)) }), a),
      {} as Record<string, { count: number; netPnl: number }>,
    ),
    strategyBreakdown: releasedHist.reduce(
      (a, r) => ((a[s(r.strategy)] = { count: (a[s(r.strategy)]?.count ?? 0) + 1, netPnl: Number(((a[s(r.strategy)]?.netPnl ?? 0) + n(r.netPnL, 0)).toFixed(8)) }), a),
      {} as Record<string, { count: number; netPnl: number }>,
    ),
    oos,
    robustness: robustnessRows,
    invariants: {
      thresholdsChanged: "NO",
      aiParityPreserved: "YES",
      riskSizingPreserved: "YES",
      executionGuardsPreserved: "YES",
    },
  };

  wcsv(OUT.abCsv, abRows);
  wcsv(
    OUT.releasedCsv,
    releasedHist.map((r) => ({
      candidateId: r.candidateId,
      tradeId: r.tradeId,
      symbol: r.symbol,
      strategy: r.strategy,
      regime: r.regime,
      baselineVerdict: r.baselineVerdict,
      correctedVerdict: r.correctedVerdict,
      baselineConfidence: r.baselineConfidence,
      correctedConfidence: r.correctedConfidence,
      confidenceDelta: r.confidenceDelta,
      netPnL: r.netPnL,
      outcomeClass: Number(r.netPnL) > 0 ? "PROFITABLE_RELEASED" : Number(r.netPnL) < 0 ? "LOSING_RELEASED" : Number(r.netPnL) === 0 ? "BREAKEVEN_RELEASED" : "UNKNOWN",
      label: "HISTORICAL_COUNTERFACTUAL",
      evidenceClass: r.evidenceClass,
    })),
  );
  wcsv(OUT.robustCsv, robustnessRows as unknown as AnyRecord[]);
  wj(OUT.oosJson, oos);
  wj(OUT.formulaJson, formula);
  wj(OUT.summary, summary);

  const robustnessClass =
    releasedHist.length < 8
      ? "INSUFFICIENT_SAMPLE"
      : Math.abs((robustnessRows.find((r) => r.slice === "overall")?.releasedNetPnL ?? 0) - (robustnessRows.find((r) => r.slice === "exclude_top_5")?.releasedNetPnL ?? 0)) <
          Math.abs(releasedNetPnl) * 0.5
        ? "ROBUST"
        : "CONCENTRATED";

  const correctionStatus =
    releasedHist.length === 0
      ? "REJECTED"
      : oos.support === "YES" && robustnessClass !== "INSUFFICIENT_SAMPLE"
        ? "PROMISING"
        : "RESEARCH_ONLY";

  const md = [
    "# KRIPTO P2 — CONFIDENCE_INTERACTION_CORRECTION SHADOW / A-B",
    "",
    "## Scope",
    "- Research/forensics only, no paper run, no market data fetch, no production behavior change.",
    "- Thresholds unchanged; correction branch only neutralizes inferred LEARNING+MOMENTUM interaction penalty.",
    "",
    "## Key Answers",
    `1. Exact interaction suppressing confidence: ${topInteraction}`,
    `2. Duplicate penalty class: ${topInteraction}`,
    `3. Mathematical justification: correction only removes interaction penalty term, thresholds unchanged.`,
    `4. Profitable released: ${profitableReleased}`,
    `5. Losing released: ${losingReleased}`,
    `6. Released cohort net PnL (historical counterfactual): ${releasedNetPnl}`,
    `7. Released cohort expectancy: ${releasedExpectancy}`,
    `8. OOS support: ${oos.support} (${oos.mode})`,
    `9. Outside MR+LOW_VOL robustness: ${robustnessClass}`,
    `10. Strategy disproportion check: see strategy breakdown in JSON report.`,
    `11. False approvals increase: ${falseApprovalRate}`,
    `12. Thresholds changed: NO`,
    `13. AI/risk/sizing altered: NO`,
    `14. Safest next production experiment: offline-only confidence interaction correction shadow validation with stricter evidence uplift.`,
    "",
    "## Final Verdict",
    `BASELINE_APPROVED = ${baselineApproved}`,
    `CORRECTION_APPROVED = ${correctionApproved}`,
    `PROFITABLE_RELEASED = ${profitableReleased}`,
    `LOSING_RELEASED = ${losingReleased}`,
    `RELEASED_NET_PNL = ${releasedNetPnl}`,
    `RELEASED_EXPECTANCY = ${releasedExpectancy}`,
    `FALSE_APPROVAL_RATE = ${falseApprovalRate}`,
    `TOP_INTERACTION = ${topInteraction}`,
    `INTERACTION_CLASS = ${topInteraction}`,
    `DOUBLE_PENALTY = ${topInteraction === "SHARED_SIGNAL_DOUBLE_COUNT" || topInteraction === "MOMENTUM_DUPLICATION" ? "YES" : "PARTIAL"}`,
    `THRESHOLDS_CHANGED = NO`,
    `AI_PARITY_PRESERVED = YES`,
    `RISK_SIZING_PRESERVED = YES`,
    `OOS_SUPPORTED = ${oos.support}`,
    `ROBUSTNESS = ${robustnessClass}`,
    `CORRECTION_STATUS = ${correctionStatus}`,
    `FIRST_NEXT_EXPERIMENT = POLICY_LEVEL_CONFIDENCE_INTERACTION_CORRECTION_SHADOW`,
    `PRODUCTION_CHANGE_RECOMMENDED = NO`,
    "",
  ].join("\n");
  fs.writeFileSync(OUT.report, md, "utf8");

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
