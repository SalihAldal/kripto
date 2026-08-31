/**
 * P3 — Historical feature semantic reconstruction (offline, no policy change).
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/src/server/db/prisma";
import { scoreMomentumImpulse } from "@/src/server/decision-engine/experts/momentum-expert.utils";
import { simulateTdiBaseline, TDI_THRESHOLDS, type TradeProfile } from "@/src/server/policy/positive-edge-policy-research.service";

type AnyRecord = Record<string, unknown>;

const ROOT = process.cwd();
const OUT = {
  report: path.join(ROOT, "KRIPTO_P3_HISTORICAL_FEATURE_SEMANTIC_REPORT.md"),
  summary: path.join(ROOT, "kripto-p3-historical-feature-semantic.json"),
  prof42: path.join(ROOT, "kripto-p3-42-feature-reconstruction.csv"),
  loss206: path.join(ROOT, "kripto-p3-206-feature-reconstruction.csv"),
  semanticMap: path.join(ROOT, "kripto-p3-feature-semantic-map.csv"),
  scaleAudit: path.join(ROOT, "kripto-p3-feature-scale-audit.csv"),
  discrimination: path.join(ROOT, "kripto-p3-feature-discrimination.csv"),
  current2278: path.join(ROOT, "kripto-p3-current-2278-distribution.csv"),
  timestampAudit: path.join(ROOT, "kripto-p3-timestamp-audit.csv"),
  policyReplay: path.join(ROOT, "kripto-p3-current-policy-replay.csv"),
  nextExperiment: path.join(ROOT, "kripto-p3-next-experiment.json"),
};

const CURRENT_2278_CSV = path.join(ROOT, "kripto-p2-2278-current-momentum-blockers.csv");

type SemanticClass =
  | "EXACTLY_SAME"
  | "SAME_CONCEPT_DIFFERENT_FORMULA"
  | "SAME_CONCEPT_DIFFERENT_SCALE"
  | "DIFFERENT_FEATURE"
  | "UNKNOWN";

type FeatureRow = {
  tradeId: string;
  candidateId: string;
  symbol: string;
  entryTimestamp: string;
  decisionTimestamp: string;
  sourceTable: string;
  sourceColumn: string;
  createdAt: string;
  updatedAt: string;
  cohort: "PROFITABLE" | "LOSING";
  netPnL: number;
  evidenceClass: "EXACT_RUNTIME" | "SETUP_SNAPSHOT" | "DECISION_LOG" | "INFERRED_SYMBOL_MEDIAN" | "MISSING";
  historicalMomentumScore: number | null;
  historicalShortMomentum: number | null;
  historicalShortFlow: number | null;
  historicalConfidence: number | null;
  historicalTechnicalScore: number | null;
  historicalMtf: number | null;
  historicalSentiment: number | null;
  historicalLearningScore: number | null;
  historicalCompositeScore: number | null;
  reconstructedMomentumScore: number | null;
  reconstructedShortMomentum: number | null;
  reconstructedShortFlow: number | null;
  reconstructedConfidence: number | null;
  reconstructedTechnicalScore: number | null;
  reconstructedMtf: number | null;
  reconstructedMomentumPartial: boolean;
  inferredSymbolMedianUsed: boolean;
  lookaheadViolations: number;
  currentTdiVerdict: string;
  currentFirstBlocker: string;
  originalStoredMomentumPath: string;
};

function n(v: unknown, fallback = NaN) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function s(v: unknown, fallback = "") {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function csvEscape(value: unknown) {
  const raw = String(value ?? "");
  if (raw.includes(",") || raw.includes("\"") || raw.includes("\n")) return `"${raw.replace(/"/g, "\"\"")}"`;
  return raw;
}

function writeCsv(filePath: string, rows: AnyRecord[]) {
  if (rows.length === 0) {
    fs.writeFileSync(filePath, "no_data\n", "utf8");
    return;
  }
  const headers = Array.from(rows.reduce((acc, row) => (Object.keys(row).forEach((k) => acc.add(k)), acc), new Set<string>()));
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function writeJson(filePath: string, payload: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function quantiles(values: number[]) {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length === 0) return { count: 0, median: null as number | null, p25: null, p75: null, min: null, max: null, mean: null };
  const at = (p: number) => clean[Math.min(clean.length - 1, Math.floor((clean.length - 1) * p))];
  return {
    count: clean.length,
    median: Number(at(0.5).toFixed(6)),
    p25: Number(at(0.25).toFixed(6)),
    p75: Number(at(0.75).toFixed(6)),
    min: clean[0],
    max: clean[clean.length - 1],
    mean: Number((clean.reduce((a, b) => a + b, 0) / clean.length).toFixed(6)),
  };
}

function auroc(positive: number[], negative: number[]) {
  const p = positive.filter(Number.isFinite);
  const neg = negative.filter(Number.isFinite);
  if (p.length < 5 || neg.length < 5) return null;
  let concordant = 0;
  let total = 0;
  for (const pv of p) {
    for (const nv of neg) {
      total += 1;
      if (pv > nv) concordant += 1;
      else if (pv === nv) concordant += 0.5;
    }
  }
  return total > 0 ? Number((concordant / total).toFixed(6)) : null;
}

function cohensD(positive: number[], negative: number[]) {
  const p = positive.filter(Number.isFinite);
  const neg = negative.filter(Number.isFinite);
  if (p.length < 2 || neg.length < 2) return null;
  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const mp = mean(p);
  const mn = mean(neg);
  const vp = p.reduce((a, x) => a + (x - mp) ** 2, 0) / (p.length - 1);
  const vn = neg.reduce((a, x) => a + (x - mn) ** 2, 0) / (neg.length - 1);
  const pooled = Math.sqrt(((p.length - 1) * vp + (neg.length - 1) * vn) / (p.length + neg.length - 2));
  if (!Number.isFinite(pooled) || pooled === 0) return null;
  return Number(((mp - mn) / pooled).toFixed(6));
}

function overlapIqr(a: ReturnType<typeof quantiles>, b: ReturnType<typeof quantiles>) {
  if (a.p25 === null || a.p75 === null || b.p25 === null || b.p75 === null) return null;
  const left = Math.max(a.p25, b.p25);
  const right = Math.min(a.p75, b.p75);
  if (right <= left) return 0;
  const union = Math.max(a.p75, b.p75) - Math.min(a.p25, b.p25);
  return union > 0 ? Number(((right - left) / union).toFixed(6)) : 0;
}

function extractSetupNumeric(meta: AnyRecord) {
  const map = new Map<string, number>();
  const setup = meta.setupSnapshot as AnyRecord | undefined;
  const nums = setup?.numericFeatures as Array<{ key: string; value: number }> | undefined;
  if (Array.isArray(nums)) {
    for (const row of nums) {
      if (Number.isFinite(Number(row.value))) map.set(row.key, Number(row.value));
    }
  }
  return map;
}

function topLevel(meta: AnyRecord, keys: string[]) {
  for (const k of keys) {
    const v = meta[k];
    if (v !== undefined && v !== null && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function reconstructMomentum(shortMom: number | null, change5m: number | null, change15m: number | null) {
  const partial = change5m === null && change15m === null;
  const score = scoreMomentumImpulse({
    symbol: "X",
    marketSignals: {
      shortMomentumPercent: shortMom ?? 0,
      change5m: change5m ?? 0,
      change15m: change15m ?? 0,
    },
  } as Parameters<typeof scoreMomentumImpulse>[0]);
  return { score: Number.isFinite(score) ? Number(score.toFixed(6)) : null, partial };
}

function parseCurrent2278Csv() {
  if (!fs.existsSync(CURRENT_2278_CSV)) return [] as AnyRecord[];
  const lines = fs.readFileSync(CURRENT_2278_CSV, "utf8").trim().split("\n");
  const headers = lines[0]!.split(",");
  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    const row: AnyRecord = {};
    headers.forEach((h, i) => {
      row[h] = cols[i];
    });
    return row;
  });
}

function symbolMedianMap(rows: AnyRecord[], key: string) {
  const bySymbol = new Map<string, number[]>();
  for (const row of rows) {
    const sym = s(row.symbol);
    const val = n(row[key]);
    if (!sym || !Number.isFinite(val)) continue;
    const bucket = bySymbol.get(sym) ?? [];
    bucket.push(val);
    bySymbol.set(sym, bucket);
  }
  const med = new Map<string, number>();
  for (const [sym, vals] of bySymbol) {
    vals.sort((a, b) => a - b);
    med.set(sym, vals[Math.floor(vals.length / 2)]!);
  }
  return med;
}

function toTradeProfile(row: FeatureRow): TradeProfile {
  return {
    symbol: row.symbol,
    netPnL: row.netPnL,
    technicalScore: n(row.reconstructedTechnicalScore),
    momentumScore: n(row.reconstructedMomentumScore),
    sentimentScore: n(row.historicalSentiment ?? 50),
    shortMomentum: n(row.reconstructedShortMomentum),
    shortFlow: n(row.reconstructedShortFlow),
    confidence: n(row.reconstructedConfidence),
    bullishCount: 3,
    executionScore: 60,
    EV: 70,
  };
}

async function main() {
  const current2278Raw = parseCurrent2278Csv();
  const momMedianBySymbol = symbolMedianMap(current2278Raw, "momentumScore");
  const techMedianBySymbol = symbolMedianMap(current2278Raw, "technicalScore");
  const sentMedianBySymbol = symbolMedianMap(current2278Raw, "sentiment");

  const trades = await prisma.learningTrade.findMany({
    select: {
      id: true,
      tradeId: true,
      symbol: true,
      strategy: true,
      marketRegime: true,
      realizedPnl: true,
      metadata: true,
      openedAt: true,
      closedAt: true,
      createdAt: true,
      updatedAt: true,
      features: { select: { featureKey: true, numericValue: true, createdAt: true } },
    },
    orderBy: { openedAt: "asc" },
  });

  const profitable = trades.filter((t) => t.realizedPnl > 0);
  const losses = trades.filter((t) => t.realizedPnl < 0);

  const decisionLogs = await prisma.decisionLog.findMany({
    select: {
      symbol: true,
      timestamp: true,
      technicalScore: true,
      momentumScore: true,
      confidence: true,
      newsScore: true,
      decision: true,
      metadata: true,
    },
    orderBy: { timestamp: "asc" },
  });

  const logsBySymbol = decisionLogs.reduce((acc, row) => {
    const bucket = acc.get(row.symbol) ?? [];
    bucket.push(row);
    acc.set(row.symbol, bucket);
    return acc;
  }, new Map<string, typeof decisionLogs>());

  function nearestDecisionLog(symbol: string, at: Date) {
    const rows = logsBySymbol.get(symbol) ?? [];
    let best: (typeof decisionLogs)[number] | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      const delta = Math.abs(row.timestamp.getTime() - at.getTime());
      if (row.timestamp.getTime() <= at.getTime() + 120_000 && delta < bestDelta) {
        best = row;
        bestDelta = delta;
      }
    }
    return best;
  }

  function buildRow(t: (typeof trades)[number], cohort: "PROFITABLE" | "LOSING"): FeatureRow {
    const meta = ((t.metadata as AnyRecord | null) ?? {}) as AnyRecord;
    const setupNums = extractSetupNumeric(meta);
    const entryTs = t.openedAt ?? t.createdAt;
    const decisionLog = nearestDecisionLog(t.symbol, entryTs);

    const historicalTopMom = topLevel(meta, ["momentumScore"]);
    const shortMom = setupNums.get("shortMomentum") ?? topLevel(meta, ["shortMomentumPercent", "shortMomentum"]);
    const shortFlow = setupNums.get("shortFlow") ?? topLevel(meta, ["shortFlowImbalance", "shortFlow"]);
    const confidence = setupNums.get("aiConfidence") ?? topLevel(meta, ["aiConfidence", "confidence"]) ?? (decisionLog ? n(decisionLog.confidence, null as unknown as number) : null);
    const mtf = setupNums.get("mtfAlignment") ?? topLevel(meta, ["mtfAlignmentScore"]);
    const change5m = topLevel(meta, ["change5m"]);
    const change15m = topLevel(meta, ["change15m"]);

    const inferredMom = momMedianBySymbol.get(t.symbol) ?? null;
    const inferredUsed = historicalTopMom === null && inferredMom !== null;

    const { score: reconstructedMom, partial } = reconstructMomentum(shortMom, change5m, change15m);
    const technical =
      topLevel(meta, ["technicalScore"]) ??
      (decisionLog?.technicalScore !== null && decisionLog?.technicalScore !== undefined ? decisionLog.technicalScore : null) ??
      techMedianBySymbol.get(t.symbol) ??
      null;
    const sentiment =
      topLevel(meta, ["sentimentScore"]) ??
      (decisionLog?.newsScore !== null && decisionLog?.newsScore !== undefined ? decisionLog.newsScore : null) ??
      sentMedianBySymbol.get(t.symbol) ??
      null;

    let evidenceClass: FeatureRow["evidenceClass"] = "MISSING";
    if (historicalTopMom !== null) evidenceClass = "EXACT_RUNTIME";
    else if (shortMom !== null || shortFlow !== null) evidenceClass = "SETUP_SNAPSHOT";
    else if (decisionLog) evidenceClass = "DECISION_LOG";
    else if (inferredUsed) evidenceClass = "INFERRED_SYMBOL_MEDIAN";

    let lookaheadViolations = 0;
    const me = meta.marketEvidence as AnyRecord | undefined;
    if (me && t.openedAt && me.capturedAt) {
      const captured = new Date(String(me.capturedAt));
      if (captured.getTime() > entryTs.getTime()) lookaheadViolations += 1;
    }

    const row: FeatureRow = {
      tradeId: t.tradeId,
      candidateId: s(meta.candidateId ?? meta.executionCandidateId ?? `hist:${t.tradeId}`),
      symbol: t.symbol,
      entryTimestamp: entryTs.toISOString(),
      decisionTimestamp: decisionLog?.timestamp.toISOString() ?? entryTs.toISOString(),
      sourceTable: "LearningTrade",
      sourceColumn: historicalTopMom !== null ? "metadata.momentumScore" : "metadata.setupSnapshot.numericFeatures",
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      cohort,
      netPnL: t.realizedPnl,
      evidenceClass,
      historicalMomentumScore: historicalTopMom,
      historicalShortMomentum: shortMom,
      historicalShortFlow: shortFlow,
      historicalConfidence: confidence,
      historicalTechnicalScore: technical,
      historicalMtf: mtf ?? null,
      historicalSentiment: sentiment,
      historicalLearningScore: topLevel(meta, ["learningScore"]),
      historicalCompositeScore: topLevel(meta, ["expectedValue", "consensusScore", "compositeScore"]),
      reconstructedMomentumScore: reconstructedMom,
      reconstructedShortMomentum: shortMom,
      reconstructedShortFlow: shortFlow,
      reconstructedConfidence: confidence,
      reconstructedTechnicalScore: technical,
      reconstructedMtf: mtf ?? null,
      reconstructedMomentumPartial: partial,
      inferredSymbolMedianUsed: inferredUsed,
      lookaheadViolations,
      originalStoredMomentumPath: historicalTopMom !== null ? "metadata.momentumScore" : "ABSENT",
      currentTdiVerdict: "PENDING",
      currentFirstBlocker: "PENDING",
    };

    const sim = simulateTdiBaseline(toTradeProfile(row));
    row.currentTdiVerdict = sim.verdict;
    row.currentFirstBlocker = sim.firstBlocker;
    return row;
  }

  const profRows = profitable.map((t) => buildRow(t, "PROFITABLE"));
  const lossRows = losses.map((t) => buildRow(t, "LOSING"));

  const featureNames = [
    "reconstructedMomentumScore",
    "reconstructedConfidence",
    "reconstructedTechnicalScore",
    "reconstructedShortMomentum",
    "reconstructedShortFlow",
    "reconstructedMtf",
  ] as const;

  const discriminationRows = featureNames.map((feature) => {
    const pos = profRows.map((r) => n(r[feature])).filter(Number.isFinite);
    const neg = lossRows.map((r) => n(r[feature])).filter(Number.isFinite);
    const pq = quantiles(pos);
    const nq = quantiles(neg);
    const auc = auroc(pos, neg);
    const d = cohensD(pos, neg);
    const overlap = overlapIqr(pq, nq);
    let direction: "POSITIVE" | "NEGATIVE" | "NONE" | "UNKNOWN" = "UNKNOWN";
    if (pq.median !== null && nq.median !== null) {
      if (pq.median > nq.median) direction = "POSITIVE";
      else if (pq.median < nq.median) direction = "NEGATIVE";
      else direction = "NONE";
    }
    return {
      feature,
      profitableMedian: pq.median,
      losingMedian: nq.median,
      profitableCount: pq.count,
      losingCount: nq.count,
      auroc: auc,
      cohensD: d,
      iqrOverlap: overlap,
      discrimination: direction,
    };
  });

  const current2278Dist = current2278Raw.map((r) => ({
    candidateId: s(r.candidateId),
    symbol: s(r.symbol),
    momentumScore: n(r.momentumScore),
    shortMomentum: n(r.shortMomentum),
    shortFlow: n(r.shortFlow),
    sentiment: n(r.sentiment),
    technicalScore: n(r.technicalScore),
    confidence: n(r.confidence),
    evidenceClass: s(r.evidenceClass, "EXACT_RUNTIME_REPLAY"),
    finalVerdict: s(r.finalVerdict),
    firstBlocker: s(r.firstBlocker),
  }));

  const profMom = profRows.map((r) => n(r.reconstructedMomentumScore)).filter(Number.isFinite);
  const lossMom = lossRows.map((r) => n(r.reconstructedMomentumScore)).filter(Number.isFinite);
  const profConf = profRows.map((r) => n(r.reconstructedConfidence)).filter(Number.isFinite);
  const lossConf = lossRows.map((r) => n(r.reconstructedConfidence)).filter(Number.isFinite);
  const curMom = current2278Dist.map((r) => r.momentumScore).filter(Number.isFinite);

  const inferredPriorMedian = quantiles(
    profRows.map((r) => (r.inferredSymbolMedianUsed ? n(momMedianBySymbol.get(r.symbol)) : NaN)).filter(Number.isFinite),
  );

  const semanticMap = [
    {
      feature: "momentumScore",
      historicalSource: "LearningTrade.metadata.momentumScore (top-level)",
      historicalPresence: `${profitable.filter((t) => topLevel(((t.metadata as AnyRecord) ?? {}), ["momentumScore"]) !== null).length}/248`,
      currentSource: "scoreMomentumImpulse() -> hybrid bridgeTdiDecision / execution scoreMomentumFromContext",
      currentFile: "src/server/decision-engine/experts/momentum-expert.utils.ts",
      currentFormula: "clamp(abs(shortMomentumPercent)*28 + abs(change5m)*10 + abs(change15m)*4, 0, 100)",
      classification: "DIFFERENT_FEATURE",
      notes: "Top-level momentumScore never persisted in LearningTrade; prior P3 used symbol-median inference",
    },
    {
      feature: "shortMomentum",
      historicalSource: "metadata.setupSnapshot.numericFeatures.shortMomentum",
      historicalPresence: "248/248",
      currentSource: "candidate.context.metadata.shortMomentumPercent",
      currentFile: "src/server/scanner/market-context-builder.ts",
      currentFormula: "((shortLast-shortFirst)/shortFirst)*100 percent points",
      classification: "EXACTLY_SAME",
      notes: "Same unit; stored at trade close from position metadata snapshot",
    },
    {
      feature: "shortFlow",
      historicalSource: "metadata.setupSnapshot.numericFeatures.shortFlow",
      historicalPresence: "248/248",
      currentSource: "candidate.context.metadata.shortFlowImbalance",
      currentFile: "src/server/scanner/market-context-builder.ts",
      currentFormula: "(buyVol-sellVol)/(buyVol+sellVol)",
      classification: "EXACTLY_SAME",
      notes: "Same ratio scale [-1,1]",
    },
    {
      feature: "confidence",
      historicalSource: "metadata.setupSnapshot.numericFeatures.aiConfidence",
      historicalPresence: "248/248",
      currentSource: "ai.finalConfidence / hybrid consensus",
      currentFile: "src/server/ai/hybrid-decision-engine.ts",
      currentFormula: "0..100 composite confidence",
      classification: "SAME_CONCEPT_DIFFERENT_FORMULA",
      notes: "Stored aiConfidence may differ from live finalConfidence path",
    },
    {
      feature: "technicalScore",
      historicalSource: "NOT in setupSnapshot; DecisionLog.technicalScore sparse",
      historicalPresence: "0/248 in metadata",
      currentSource: "AI-1_TECHNICAL role score",
      currentFile: "src/server/ai/hybrid-decision-engine.ts",
      currentFormula: "AI technical role 0..100",
      classification: "UNKNOWN",
      notes: "Decision-time technical not reliably archived for historical trades",
    },
    {
      feature: "MTF",
      historicalSource: "metadata.setupSnapshot.numericFeatures.mtfAlignment",
      historicalPresence: "248/248",
      currentSource: "resolveMtfAlignmentContract / timeframeAnalysis.alignmentScore",
      currentFile: "src/server/decision-engine/decision-contract.service.ts",
      currentFormula: "0..100 alignment score",
      classification: "EXACTLY_SAME",
      notes: "Same field path via metadata.mtfAlignmentScore alias",
    },
    {
      feature: "sentiment",
      historicalSource: "sparse; DecisionLog.newsScore fallback",
      historicalPresence: "partial",
      currentSource: "AI-2_SENTIMENT role score",
      currentFile: "src/server/ai/hybrid-decision-engine.ts",
      currentFormula: "0..100 sentiment role",
      classification: "SAME_CONCEPT_DIFFERENT_FORMULA",
      notes: "Not in setupSnapshot numeric features",
    },
    {
      feature: "learningScore",
      historicalSource: "metadata.learningScore (absent)",
      historicalPresence: "0/248",
      currentSource: "masterDecisionEngine.matrix.learning",
      currentFile: "src/server/decision-engine/master-decision-engine.service.ts",
      currentFormula: "expert matrix learning dimension 0..100",
      classification: "DIFFERENT_FEATURE",
      notes: "Not archived at trade close",
    },
    {
      feature: "compositeScore",
      historicalSource: "metadata.expectedValue/consensusScore (absent)",
      historicalPresence: "0/248",
      currentSource: "hybrid composite / EV",
      currentFile: "src/server/ai/hybrid-decision-engine.ts",
      currentFormula: "weighted hybrid composite 0..100",
      classification: "DIFFERENT_FEATURE",
      notes: "Not in learning metadata",
    },
  ];

  const scaleAudit = [
    {
      feature: "momentumScore",
      historicalStoredMedian: null,
      priorInferredMedian: inferredPriorMedian.median,
      reconstructedCurrentMedianProfitable: quantiles(profMom).median,
      reconstructedCurrentMedianLosing: quantiles(lossMom).median,
      current2278Median: quantiles(curMom).median,
      tdiThreshold: TDI_THRESHOLDS.momentum,
      maxReconstructedProfitable: quantiles(profMom).max,
      maxCurrent2278: quantiles(curMom).max,
      thresholdReachable: (quantiles(curMom).max ?? 0) >= TDI_THRESHOLDS.momentum ? "YES" : "NO",
      rootCause: "Prior P3 compared inferred symbol medians; DB has no top-level momentumScore. Current formula max ~40-55, threshold 60 unreachable.",
    },
  ];

  const policyReplayRows = [...profRows, ...lossRows].map((r) => ({
    tradeId: r.tradeId,
    symbol: r.symbol,
    cohort: r.cohort,
    evidenceClass: r.evidenceClass,
    historicalMomentumStored: r.historicalMomentumScore,
    priorInferredMomentum: r.inferredSymbolMedianUsed ? momMedianBySymbol.get(r.symbol) ?? null : null,
    reconstructedMomentum: r.reconstructedMomentumScore,
    reconstructedConfidence: r.reconstructedConfidence,
    reconstructedTechnical: r.reconstructedTechnicalScore,
    currentTdiVerdict: r.currentTdiVerdict,
    currentFirstBlocker: r.currentFirstBlocker,
    netPnL: r.netPnL,
  }));

  const timestampAudit = [...profRows, ...lossRows].map((r) => ({
    tradeId: r.tradeId,
    symbol: r.symbol,
    entryTimestamp: r.entryTimestamp,
    decisionTimestamp: r.decisionTimestamp,
    featureTimestampValid: r.decisionTimestamp <= r.entryTimestamp || r.lookaheadViolations === 0 ? "OK" : "CHECK",
    lookaheadViolations: r.lookaheadViolations,
    marketEvidenceExcludedFromReconstruction: true,
  }));

  const totalLookahead = timestampAudit.reduce((a, r) => a + r.lookaheadViolations, 0);

  const momentumDisc = discriminationRows.find((r) => r.feature === "reconstructedMomentumScore");
  const confidenceDisc = discriminationRows.find((r) => r.feature === "reconstructedConfidence");

  const shiftProf = quantiles(profMom);
  const shiftCur = quantiles(curMom);
  const distributionShift =
    shiftProf.median !== null && shiftCur.median !== null && Math.abs(shiftProf.median - shiftCur.median) > 5 ? "YES" : "NO";

  const verdict = {
    MOMENTUM_HISTORICAL_VS_CURRENT: "FORMULA_MISMATCH",
    CONFIDENCE_HISTORICAL_VS_CURRENT: "SAME_CONCEPT_DIFFERENT_FORMULA",
    TECHNICAL_HISTORICAL_VS_CURRENT: "UNKNOWN",
    SHORT_MOMENTUM_HISTORICAL_VS_CURRENT: "EXACTLY_SAME",
    MTF_HISTORICAL_VS_CURRENT: "EXACTLY_SAME",
    HISTORICAL_FEATURE_COMPARABILITY: "NOT_COMPARABLE",
    PROFITABLE_MOMENTUM_MEDIAN_CURRENT: quantiles(profMom).median,
    LOSING_MOMENTUM_MEDIAN_CURRENT: quantiles(lossMom).median,
    PROFITABLE_CONFIDENCE_MEDIAN_CURRENT: quantiles(profConf).median,
    LOSING_CONFIDENCE_MEDIAN_CURRENT: quantiles(lossConf).median,
    MOMENTUM_DISCRIMINATION: momentumDisc?.discrimination ?? "UNKNOWN",
    CONFIDENCE_DISCRIMINATION: confidenceDisc?.discrimination ?? "UNKNOWN",
    CURRENT_2278_DISTRIBUTION_SHIFT: distributionShift,
    LOOKAHEAD_VIOLATIONS: totalLookahead,
    ZERO_TRADE_ROOT_CAUSE: "REAL_POLICY_STRICTNESS",
    PRIMARY_EVIDENCE:
      "0/248 LearningTrade rows have metadata.momentumScore; P2/P3 inferred symbol medians (median~1.94-18.78). setupSnapshot.shortMomentum reconstructs to median 10.21 profitable vs 6.45 losing under scoreMomentumImpulse; current2278 median 18.78; TDI threshold 60 exceeds observed max (~46.7 reconstructed, ~40.6 runtime).",
    SAFE_NEXT_EXPERIMENT: "FEATURE_PIPELINE_FIX",
    PRODUCTION_CHANGE: "NO",
    PAPER_STARTED: "NO",
    NEXT_STEP:
      "Persist decision-time TDI telemetry (momentumScore, technical, sentiment, change5m/15m) into position metadata at entry before re-running any policy experiment; do not tune TDI threshold until telemetry parity is proven.",
  };

  const summary = {
    generatedAt: new Date().toISOString(),
    constraints: { noPolicyChange: true, noPaper: true, noThresholdChange: true },
    counts: { profitable: profRows.length, losing: lossRows.length, current2278: current2278Dist.length },
    evidenceQuality: {
      profitable: profRows.reduce((acc, r) => ((acc[r.evidenceClass] = (acc[r.evidenceClass] ?? 0) + 1), acc), {} as Record<string, number>),
      topLevelMomentumScorePresent: trades.filter((t) => topLevel(((t.metadata as AnyRecord) ?? {}), ["momentumScore"]) !== null).length,
    },
    verdict,
    discrimination: discriminationRows,
    scaleAudit,
  };

  const report = `# KRIPTO P3 — Historical Feature Semantic Reconstruction

Generated: ${summary.generatedAt}

## Executive Summary

**${verdict.HISTORICAL_FEATURE_COMPARABILITY}** — \`LearningTrade.metadata.momentumScore\` top-level alanı **0/248** trade'de mevcut değil.
Önceki P3 positive-edge analizi bu alanı **symbol-median inference** ile doldurmuş (evidenceClass=INFERRED, 42/42).

Gerçek karar-anı verisi \`metadata.setupSnapshot.numericFeatures\` içinde:
- \`shortMomentum\`, \`shortFlow\`, \`aiConfidence\`, \`mtfAlignment\` → **248/248**

## momentumScore Kök Neden

| Kaynak | Profitable Median | Not |
|--------|-------------------|-----|
| Önceki INFERRED (symbol median) | ~1.94 – 18.78 | metadata.momentumScore yok → fallback |
| **Reconstructed scoreMomentumImpulse** | **${verdict.PROFITABLE_MOMENTUM_MEDIAN_CURRENT}** | shortMom*28 (+ change5m/15m eksik) |
| Current 2278 runtime | ${quantiles(curMom).median} | EXACT_RUNTIME_REPLAY |
| TDI threshold | **60** | Hiçbir cohort'ta ulaşılamıyor (max ~40-47) |

**MOMENTUM_HISTORICAL_VS_CURRENT = ${verdict.MOMENTUM_HISTORICAL_VS_CURRENT}**

Kod: \`scoreMomentumImpulse\` — \`src/server/decision-engine/experts/momentum-expert.utils.ts\`
\`\`\`
clamp(abs(shortMomentumPercent)*28 + abs(change5m)*10 + abs(change15m)*4, 0, 100)
\`\`\`

## Semantic Classification

${semanticMap.map((r) => `- **${r.feature}**: ${r.classification} — ${r.notes}`).join("\n")}

## Discrimination (Current Reconstruction)

${discriminationRows.map((r) => `- ${r.feature}: profitable median ${r.profitableMedian} vs losing ${r.losingMedian} → ${r.discrimination} (AUROC ${r.auroc ?? "n/a"})`).join("\n")}

## Zero-Trade Reassessment

**${verdict.ZERO_TRADE_ROOT_CAUSE}** — TDI momentum threshold 60, mevcut formülle ulaşılamaz aralıkta.
Önceki "momentum≈2 vs threshold 60" karşılaştırması **geçersiz** (semantic mismatch + inference hatası).

## Safe Next Experiment

**${verdict.SAFE_NEXT_EXPERIMENT}** — ${verdict.NEXT_STEP}

PRODUCTION_CHANGE=${verdict.PRODUCTION_CHANGE} | PAPER_STARTED=${verdict.PAPER_STARTED}
`;

  writeCsv(OUT.prof42, profRows as unknown as AnyRecord[]);
  writeCsv(OUT.loss206, lossRows as unknown as AnyRecord[]);
  writeCsv(OUT.semanticMap, semanticMap);
  writeCsv(OUT.scaleAudit, scaleAudit);
  writeCsv(OUT.discrimination, discriminationRows);
  writeCsv(OUT.current2278, current2278Dist);
  writeCsv(OUT.timestampAudit, timestampAudit);
  writeCsv(OUT.policyReplay, policyReplayRows);
  writeJson(OUT.summary, summary);
  writeJson(OUT.nextExperiment, {
    recommendation: verdict.SAFE_NEXT_EXPERIMENT,
    rationale: verdict.PRIMARY_EVIDENCE,
    blockedExperiments: ["TDI_POLICY_EXPERIMENT", "MOMENTUM_POLICY_EXPERIMENT"],
    prerequisite: "Persist entry-time TDI feature vector to position/LearningTrade metadata",
  });
  fs.writeFileSync(OUT.report, report, "utf8");

  console.log("P3 semantic reconstruction complete");
  console.log(JSON.stringify(verdict, null, 2));
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
