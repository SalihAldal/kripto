import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/src/server/db/prisma";

type AnyRecord = Record<string, unknown>;

const ROOT = process.cwd();
const HISTORICAL_PATH = "DATABASE.learningTrade";
const CURRENT_5R_PATH = path.join(ROOT, "kripto-5round-paper-validation.json");

const OUTPUT = {
  reportMd: path.join(ROOT, "KRIPTO_P2_HISTORICAL_PROFITABLE_VS_CURRENT_FUNNEL.md"),
  summaryJson: path.join(ROOT, "kripto-p2-historical-profitable-vs-current-funnel.json"),
  profitableProfileCsv: path.join(ROOT, "kripto-p2-profitable-trade-profile.csv"),
  currentCandidateCsv: path.join(ROOT, "kripto-p2-current-paper-candidate-profile.csv"),
  tdiSuppressionCsv: path.join(ROOT, "kripto-p2-tdi-suppression-analysis.csv"),
  shiftJson: path.join(ROOT, "kripto-p2-distribution-shift.json"),
  profitableGapCsv: path.join(ROOT, "kripto-p2-profitable-funnel-gap.csv"),
  topBottlenecksJson: path.join(ROOT, "kripto-p2-top-bottlenecks.json"),
  experimentsJson: path.join(ROOT, "kripto-p2-research-experiments.json"),
};

const TDI = {
  technical: 48,
  momentum: 60,
  confidence: 40,
  bullish: 4,
  execution: 55,
  sentiment: 42,
  composite: 68,
  shortMomentumAbs: 0.08,
  shortFlowAbs: 0.03,
};

type TradeProfile = {
  tradeId: string;
  candidateId: string;
  runId: string;
  sessionId: string;
  roundId: string;
  symbol: string;
  strategy: string;
  regime: string;
  candidateTimestamp: string;
  decisionTimestamp: string;
  entryTimestamp: string;
  exitTimestamp: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  notional: number;
  holdDuration: number;
  grossPnL: number;
  fees: number;
  netPnL: number;
  technicalScore: number;
  momentumScore: number;
  sentimentScore: number;
  shortMomentum: number;
  shortFlow: number;
  confidence: number;
  bullishCount: number;
  executionScore: number;
  EV: number;
  liquidity: number;
  volatility: number;
  tdiVerdict: string;
  aiFinalDecision: string;
  aiConfidence: number;
  riskVerdict: string;
  sizingVerdict: string;
  expectedGrossEdge: number;
  expectedNetEdge: number;
  feeToGrossRatio: number;
  feeClassification: string;
  entryQuality: string;
  exitReason: string;
  exitModel: string;
};

type DecisionSnapshot = {
  symbol: string;
  timestamp: Date;
  technicalScore: number | null;
  momentumScore: number | null;
  confidence: number | null;
  decision: string;
  strategyUsed: string | null;
  executionAllowed: boolean;
  metadata: unknown;
};

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, payload: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function csvEscape(value: unknown) {
  const raw = String(value ?? "");
  if (raw.includes(",") || raw.includes("\"") || raw.includes("\n")) {
    return `"${raw.replace(/"/g, "\"\"")}"`;
  }
  return raw;
}

function writeCsv(filePath: string, rows: AnyRecord[]) {
  if (rows.length === 0) {
    fs.writeFileSync(filePath, "no_data\n", "utf8");
    return;
  }
  const headers = Array.from(
    rows.reduce((acc, row) => {
      Object.keys(row).forEach((key) => acc.add(key));
      return acc;
    }, new Set<string>()),
  );
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function n(value: unknown, fallback = NaN) {
  const x = Number(value);
  return Number.isFinite(x) ? x : fallback;
}

function s(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function pick(record: AnyRecord | null | undefined, keys: string[]) {
  if (!record) return undefined;
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function normalizeVerdict(value: unknown): "APPROVED" | "WAIT" | "REJECTED" | "UNKNOWN" {
  const raw = s(value).toUpperCase();
  if (raw.includes("APPROV")) return "APPROVED";
  if (raw === "WAIT" || raw.includes("NEUTRAL")) return "WAIT";
  if (raw.includes("REJECT") || raw.includes("NO_TRADE") || raw.includes("FAIL")) return "REJECTED";
  return "UNKNOWN";
}

function parseRegime(value: unknown): string {
  const raw = s(value, "UNKNOWN").toUpperCase();
  if (raw.includes("LOW_VOL")) return "LOW_VOLATILITY";
  if (raw.includes("HIGH_VOL")) return "HIGH_VOLATILITY";
  if (raw.includes("RANGE")) return "RANGE";
  if (raw.includes("TREND")) return "TREND";
  if (raw.includes("CHAOS")) return "CHAOS";
  if (raw.includes("LIQUID")) return "LOW_LIQUIDITY";
  return raw || "UNKNOWN";
}

function parseStrategy(value: unknown): string {
  const raw = s(value, "OTHER").toUpperCase();
  if (raw.includes("MEAN") || raw.includes("MR")) return "MEAN_REVERSION";
  if (raw.includes("BREAKOUT") || raw.includes("VOLATILITY")) return "VOLATILITY_BREAKOUT";
  if (raw.includes("TREND")) return "TREND_FOLLOWING";
  return raw || "OTHER";
}

function uniqueBy<T>(rows: T[], keyFn: (row: T) => string) {
  const map = new Map<string, T>();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, row);
  }
  return Array.from(map.values());
}

function quantiles(values: number[]) {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length === 0) return { count: 0, median: null, p25: null, p75: null, min: null, max: null };
  const at = (p: number) => clean[Math.min(clean.length - 1, Math.floor((clean.length - 1) * p))];
  return { count: clean.length, median: at(0.5), p25: at(0.25), p75: at(0.75), min: clean[0], max: clean[clean.length - 1] };
}

function overlapRatio(a: ReturnType<typeof quantiles>, b: ReturnType<typeof quantiles>) {
  if (a.p25 === null || a.p75 === null || b.p25 === null || b.p75 === null) return null;
  const left = Math.max(a.p25, b.p25);
  const right = Math.min(a.p75, b.p75);
  if (right <= left) return 0;
  const union = Math.max(a.p75, b.p75) - Math.min(a.p25, b.p25);
  if (union <= 0) return 0;
  return Number(((right - left) / union).toFixed(6));
}

function sepClass(score: number | null): "HIGH_SEPARATION" | "MEDIUM_SEPARATION" | "LOW_SEPARATION" | "NO_EVIDENCE" {
  if (score === null || !Number.isFinite(score)) return "NO_EVIDENCE";
  if (score >= 1) return "HIGH_SEPARATION";
  if (score >= 0.4) return "MEDIUM_SEPARATION";
  if (score >= 0.15) return "LOW_SEPARATION";
  return "NO_EVIDENCE";
}

type SimResult = {
  verdict: "APPROVED" | "WAIT" | "REJECT";
  firstBlocker: "TECHNICAL" | "MOMENTUM" | "CONFIDENCE" | "RISK" | "REGIME" | "EXECUTION" | "OTHER" | "UPSTREAM" | "UNKNOWN";
  gaps: {
    technicalGap: number;
    momentumGap: number;
    confidenceGap: number;
    bullishCountGap: number;
    executionGap: number;
  };
  nearClass: "FAR_BELOW" | "MODERATELY_BELOW" | "NEAR_THRESHOLD" | "PASS";
};

function simulateCurrentTdi(row: TradeProfile): SimResult {
  const technicalGap = Number((row.technicalScore - TDI.technical).toFixed(6));
  const momentumGap = Number((row.momentumScore - TDI.momentum).toFixed(6));
  const confidenceGap = Number((row.confidence - TDI.confidence).toFixed(6));
  const bullishCountGap = Number((row.bullishCount - TDI.bullish).toFixed(6));
  const executionGap = Number((row.executionScore - TDI.execution).toFixed(6));
  const nearMin = Math.min(technicalGap, momentumGap, confidenceGap, bullishCountGap, executionGap);
  let nearClass: SimResult["nearClass"] = "PASS";
  if (nearMin < -12) nearClass = "FAR_BELOW";
  else if (nearMin < -5) nearClass = "MODERATELY_BELOW";
  else if (nearMin < 0) nearClass = "NEAR_THRESHOLD";

  const momentumWeak =
    row.momentumScore < TDI.momentum ||
    (Math.abs(row.shortMomentum) < TDI.shortMomentumAbs && Math.abs(row.shortFlow) < TDI.shortFlowAbs);

  if (!Number.isFinite(row.technicalScore) || !Number.isFinite(row.momentumScore) || !Number.isFinite(row.confidence)) {
    return { verdict: "WAIT", firstBlocker: "UNKNOWN", gaps: { technicalGap, momentumGap, confidenceGap, bullishCountGap, executionGap }, nearClass };
  }
  if (row.technicalScore < TDI.technical || row.sentimentScore < TDI.sentiment) {
    return { verdict: "REJECT", firstBlocker: "TECHNICAL", gaps: { technicalGap, momentumGap, confidenceGap, bullishCountGap, executionGap }, nearClass };
  }
  if (momentumWeak) {
    return { verdict: "WAIT", firstBlocker: "MOMENTUM", gaps: { technicalGap, momentumGap, confidenceGap, bullishCountGap, executionGap }, nearClass };
  }
  if (row.confidence < TDI.confidence) {
    return { verdict: "REJECT", firstBlocker: "CONFIDENCE", gaps: { technicalGap, momentumGap, confidenceGap, bullishCountGap, executionGap }, nearClass };
  }
  if (row.executionScore < TDI.execution) {
    return { verdict: "WAIT", firstBlocker: "EXECUTION", gaps: { technicalGap, momentumGap, confidenceGap, bullishCountGap, executionGap }, nearClass };
  }
  if (row.bullishCount < TDI.bullish) {
    return { verdict: "WAIT", firstBlocker: "CONFIDENCE", gaps: { technicalGap, momentumGap, confidenceGap, bullishCountGap, executionGap }, nearClass };
  }
  if (row.EV < TDI.composite) {
    return { verdict: "WAIT", firstBlocker: "UPSTREAM", gaps: { technicalGap, momentumGap, confidenceGap, bullishCountGap, executionGap }, nearClass };
  }
  return { verdict: "APPROVED", firstBlocker: "OTHER", gaps: { technicalGap, momentumGap, confidenceGap, bullishCountGap, executionGap }, nearClass: "PASS" };
}

function mapLearningTradeToProfile(row: {
  id: string;
  tradeId: string;
  symbol: string;
  strategy: string;
  marketRegime: string | null;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  realizedPnl: number;
  holdSec: number | null;
  closeReason: string | null;
  openedAt: Date | null;
  closedAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): TradeProfile {
  const meta = ((row.metadata as AnyRecord | null) ?? {}) as AnyRecord;
  const gross = n(pick(meta, ["grossPnl", "grossPnL"]), row.realizedPnl);
  const fees = n(pick(meta, ["feeTotal", "totalFee"]), 0);
  const feeToGrossRatio = Number.isFinite(gross) && Math.abs(gross) > 1e-9 ? Math.abs(fees / gross) : 0;
  return {
    tradeId: row.tradeId,
    candidateId: s(pick(meta, ["candidateId", "executionCandidateId", "linkedCandidateId"]), ""),
    runId: s(pick(meta, ["runId", "executionId", "jobId"]), ""),
    sessionId: s(pick(meta, ["sessionId", "jobId"]), ""),
    roundId: s(pick(meta, ["roundId", "roundNo"]), ""),
    symbol: row.symbol,
    strategy: parseStrategy(row.strategy),
    regime: parseRegime(row.marketRegime),
    candidateTimestamp: s(pick(meta, ["candidateTimestamp", "timestamp", "createdAt"]), ""),
    decisionTimestamp: s(pick(meta, ["decisionTimestamp", "timestamp", "updatedAt"]), ""),
    entryTimestamp: row.openedAt?.toISOString?.() ?? row.createdAt.toISOString(),
    exitTimestamp: row.closedAt?.toISOString?.() ?? row.updatedAt.toISOString(),
    entryPrice: row.entryPrice,
    exitPrice: row.exitPrice,
    quantity: row.quantity,
    notional: Number((row.entryPrice * row.quantity).toFixed(8)),
    holdDuration: n(row.holdSec, 0),
    grossPnL: gross,
    fees,
    netPnL: row.realizedPnl,
    technicalScore: n(pick(meta, ["technicalScore"])),
    momentumScore: n(pick(meta, ["momentumScore"])),
    sentimentScore: n(pick(meta, ["sentimentScore"])),
    shortMomentum: n(pick(meta, ["shortMomentumPercent", "shortMomentum"])),
    shortFlow: n(pick(meta, ["shortFlowImbalance", "shortFlow"])),
    confidence: n(pick(meta, ["aiConfidence", "confidence"])),
    bullishCount: n(pick(meta, ["bullishCount"])),
    executionScore: n(pick(meta, ["executionScore"])),
    EV: n(pick(meta, ["expectedValue", "consensusScore", "EV"])),
    liquidity: n(pick(meta, ["liquidity", "volume24h"])),
    volatility: n(pick(meta, ["volatilityPercent", "volatility"])),
    tdiVerdict: s(pick(meta, ["tdiVerdict", "verdict"]), "UNKNOWN"),
    aiFinalDecision: s(pick(meta, ["aiFinalDecision", "finalDecision"]), "UNKNOWN"),
    aiConfidence: n(pick(meta, ["aiConfidence", "confidence"])),
    riskVerdict: s(pick(meta, ["riskVerdict"]), "UNKNOWN"),
    sizingVerdict: s(pick(meta, ["sizingVerdict"]), "UNKNOWN"),
    expectedGrossEdge: n(pick(meta, ["expectedGrossEdge", "expectedValue"])),
    expectedNetEdge: n(pick(meta, ["expectedNetEdge", "expectedValue"])),
    feeToGrossRatio: Number(feeToGrossRatio.toFixed(6)),
    feeClassification: feeToGrossRatio >= 0.75 ? "FEE_HEAVY" : feeToGrossRatio >= 0.4 ? "FEE_MEDIUM" : "FEE_LIGHT",
    entryQuality: s(pick(meta, ["qualityDecision", "qualityTier"]), "UNKNOWN"),
    exitReason: s(row.closeReason, "UNKNOWN"),
    exitModel: s(pick(meta, ["exitModel"]), "UNKNOWN"),
  };
}

function normalizeBlocker(raw: string): "TECHNICAL" | "MOMENTUM" | "CONFIDENCE" | "RISK" | "REGIME" | "EXECUTION" | "UPSTREAM" | "UNKNOWN" {
  const v = raw.toUpperCase();
  if (v.includes("MOMENTUM")) return "MOMENTUM";
  if (v.includes("TECHNICAL") || v.includes("MTF")) return "TECHNICAL";
  if (v.includes("CONFIDENCE") || v.includes("LEARNING")) return "CONFIDENCE";
  if (v.includes("RISK")) return "RISK";
  if (v.includes("REGIME")) return "REGIME";
  if (v.includes("EXECUTION")) return "EXECUTION";
  if (v.includes("UPSTREAM")) return "UPSTREAM";
  return "UNKNOWN";
}

function attachDecisionFallback(profile: TradeProfile, decision: DecisionSnapshot | null): TradeProfile {
  if (!decision) return profile;
  const meta = ((decision.metadata as AnyRecord | null) ?? {}) as AnyRecord;
  const sentimentScore = n(pick(meta, ["sentimentScore", "newsScore"]), profile.sentimentScore);
  const executionScore = n(pick(meta, ["executionScore", "scannerScore"]), profile.executionScore);
  const bullishCount = n(pick(meta, ["bullishCount"]), profile.bullishCount);
  const shortMomentum = n(pick(meta, ["shortMomentumPercent", "shortMomentum"]), profile.shortMomentum);
  const shortFlow = n(pick(meta, ["shortFlowImbalance", "shortFlow"]), profile.shortFlow);
  const expectedValue = n(pick(meta, ["expectedValue", "consensusScore", "compositeScore"]), profile.EV);
  return {
    ...profile,
    strategy: profile.strategy === "OTHER" ? parseStrategy(decision.strategyUsed) : profile.strategy,
    technicalScore: Number.isFinite(profile.technicalScore) ? profile.technicalScore : n(decision.technicalScore),
    momentumScore: Number.isFinite(profile.momentumScore) ? profile.momentumScore : n(decision.momentumScore),
    sentimentScore: Number.isFinite(profile.sentimentScore) ? profile.sentimentScore : sentimentScore,
    shortMomentum: Number.isFinite(profile.shortMomentum) ? profile.shortMomentum : shortMomentum,
    shortFlow: Number.isFinite(profile.shortFlow) ? profile.shortFlow : shortFlow,
    confidence: Number.isFinite(profile.confidence) ? profile.confidence : n(decision.confidence),
    bullishCount: Number.isFinite(profile.bullishCount) ? profile.bullishCount : bullishCount,
    executionScore: Number.isFinite(profile.executionScore) ? profile.executionScore : executionScore,
    EV: Number.isFinite(profile.EV) ? profile.EV : expectedValue,
    tdiVerdict:
      profile.tdiVerdict !== "UNKNOWN"
        ? profile.tdiVerdict
        : decision.executionAllowed
          ? "APPROVED"
          : decision.decision.toUpperCase().includes("WAIT")
            ? "WAIT"
            : "REJECTED",
    aiFinalDecision: profile.aiFinalDecision !== "UNKNOWN" ? profile.aiFinalDecision : decision.decision,
  };
}

async function main() {
  const current5R = readJson<AnyRecord>(CURRENT_5R_PATH);
  const learningTrades = await prisma.learningTrade.findMany({
    select: {
      id: true,
      tradeId: true,
      symbol: true,
      strategy: true,
      marketRegime: true,
      entryPrice: true,
      exitPrice: true,
      quantity: true,
      realizedPnl: true,
      holdSec: true,
      closeReason: true,
      openedAt: true,
      closedAt: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const symbols = Array.from(new Set(learningTrades.map((r) => r.symbol).filter(Boolean)));
  const minOpened = learningTrades
    .map((r) => r.openedAt?.getTime() ?? Number.POSITIVE_INFINITY)
    .reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);
  const maxClosed = learningTrades
    .map((r) => r.closedAt?.getTime() ?? Number.NEGATIVE_INFINITY)
    .reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY);

  const decisionLogs: DecisionSnapshot[] = await prisma.decisionLog.findMany({
    where: {
      symbol: { in: symbols },
      timestamp:
        Number.isFinite(minOpened) && Number.isFinite(maxClosed)
          ? {
              gte: new Date(minOpened - 1000 * 60 * 60 * 24),
              lte: new Date(maxClosed + 1000 * 60 * 60 * 24),
            }
          : undefined,
    },
    select: {
      symbol: true,
      timestamp: true,
      technicalScore: true,
      momentumScore: true,
      confidence: true,
      decision: true,
      strategyUsed: true,
      executionAllowed: true,
      metadata: true,
    },
    orderBy: [{ symbol: "asc" }, { timestamp: "asc" }],
  });

  const logsBySymbol = new Map<string, DecisionSnapshot[]>();
  for (const log of decisionLogs) {
    const arr = logsBySymbol.get(log.symbol) ?? [];
    arr.push(log);
    logsBySymbol.set(log.symbol, arr);
  }

  const pickNearestDecision = (symbol: string, entryTimestamp: string): DecisionSnapshot | null => {
    const logs = logsBySymbol.get(symbol) ?? [];
    if (logs.length === 0 || !entryTimestamp) return null;
    const entryMs = Date.parse(entryTimestamp);
    if (!Number.isFinite(entryMs)) return null;
    let best: DecisionSnapshot | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const log of logs) {
      const dist = Math.abs(entryMs - log.timestamp.getTime());
      if (dist < bestDist && dist <= 1000 * 60 * 60 * 24 * 3) {
        bestDist = dist;
        best = log;
      }
    }
    return best;
  };

  const historicalTrades = uniqueBy(
    learningTrades
      .map(mapLearningTradeToProfile)
      .map((profile) => attachDecisionFallback(profile, pickNearestDecision(profile.symbol, profile.entryTimestamp))),
    (row) => [row.tradeId, row.symbol, row.entryTimestamp, row.exitTimestamp].join("|"),
  );
  const profitable = historicalTrades.filter((r) => r.netPnL > 0);
  const loss = historicalTrades.filter((r) => r.netPnL < 0);
  const breakeven = historicalTrades.filter((r) => r.netPnL === 0);

  const roundRoots: string[] = ((current5R.rounds as AnyRecord[]) ?? []).map((r) => s(r.artifactRoot)).filter(Boolean);
  const currentCandidates: AnyRecord[] = [];
  const stageTraceRows: AnyRecord[] = [];

  for (const root of roundRoots) {
    const tdiPath = path.join(root, "tdi-decisions.json");
    const lifecyclePath = path.join(root, "candidate-lifecycle.json");
    const decisionTracePath = path.join(root, "decision-trace.json");
    if (fs.existsSync(tdiPath)) {
      const tdi = readJson<{ records?: AnyRecord[] }>(tdiPath);
      for (const rec of tdi.records ?? []) {
        currentCandidates.push({
          candidateId: s(rec.candidateId),
          roundId: s((rec.roundNo as unknown) ?? path.basename(root)),
          symbol: s(rec.symbol),
          strategy: parseStrategy(rec.strategy),
          regime: parseRegime(rec.regime),
          technicalScore: n(rec.technicalScore),
          momentumScore: n(rec.momentumScore),
          sentimentScore: n(rec.sentimentScore),
          shortMomentum: n(rec.shortMomentum),
          shortFlow: n(rec.shortFlow),
          confidence: n(rec.confidence),
          bullishCount: n(rec.bullishCount),
          executionScore: n(rec.executionScore),
          EV: n(pick(rec, ["expectedValue", "consensusScore"])),
          liquidity: n(rec.liquidity),
          volatility: n(rec.volatility),
          tdiVerdict: normalizeVerdict(rec.verdict),
          firstBlockingCondition: s(rec.firstBlockingCondition, "UNKNOWN"),
          blockingConditions: Array.isArray(rec.blockingConditions)
            ? (rec.blockingConditions as unknown[]).map((v) => s(v)).join("|")
            : "",
          aiDecision: s(pick(rec, ["finalDecision", "hybridDecision", "masterDecision"]), "UNKNOWN"),
          risk: s(rec.riskVerdict, "UNKNOWN"),
          sizing: s(rec.sizingVerdict, "UNKNOWN"),
          executionReady: normalizeVerdict(rec.verdict) === "APPROVED" ? "YES" : "NO",
          timestamp: s(rec.timestamp),
        });
      }
    }
    if (fs.existsSync(lifecyclePath)) {
      stageTraceRows.push(...(readJson<AnyRecord[]>(lifecyclePath) ?? []));
    }
    if (fs.existsSync(decisionTracePath)) {
      stageTraceRows.push(...(readJson<{ decisions?: AnyRecord[] }>(decisionTracePath)?.decisions ?? []));
    }
  }

  const currentRows = uniqueBy(currentCandidates, (r) => `${s(r.candidateId)}|${s(r.timestamp)}|${s(r.roundId)}`);
  const simulated = profitable.map((row) => ({ ...row, ...simulateCurrentTdi(row) }));

  const pass = simulated.filter((r) => r.verdict === "APPROVED").length;
  const wait = simulated.filter((r) => r.verdict === "WAIT").length;
  const reject = simulated.filter((r) => r.verdict === "REJECT").length;

  const blockers = new Map<string, { count: number; gaps: number[] }>();
  for (const row of simulated.filter((r) => r.verdict !== "APPROVED")) {
    const prev = blockers.get(row.firstBlocker) ?? { count: 0, gaps: [] };
    prev.count += 1;
    const minGap = Math.min(row.gaps.technicalGap, row.gaps.momentumGap, row.gaps.confidenceGap, row.gaps.bullishCountGap, row.gaps.executionGap);
    prev.gaps.push(minGap);
    blockers.set(row.firstBlocker, prev);
  }
  const blockerRank = Array.from(blockers.entries())
    .map(([blocker, stats]) => ({
      blocker,
      count: stats.count,
      share: simulated.length > 0 ? Number((stats.count / simulated.length).toFixed(6)) : 0,
      medianScoreGap: quantiles(stats.gaps).median,
      avgScoreGap: stats.gaps.length > 0 ? Number((stats.gaps.reduce((a, b) => a + b, 0) / stats.gaps.length).toFixed(6)) : null,
    }))
    .sort((a, b) => b.count - a.count);
  const historicalPrimary = blockerRank.find((b) => b.blocker !== "UNKNOWN") ?? blockerRank[0] ?? null;

  const numericFields = [
    "technicalScore",
    "momentumScore",
    "sentimentScore",
    "shortMomentum",
    "shortFlow",
    "confidence",
    "bullishCount",
    "executionScore",
    "EV",
  ] as const;
  const distributionCompare = numericFields.map((field) => {
    const p = quantiles(profitable.map((r) => r[field]));
    const l = quantiles(loss.map((r) => r[field]));
    const c = quantiles(currentRows.map((r) => n(r[field])));
    const medianDiff = p.median !== null && c.median !== null ? p.median - c.median : null;
    const score =
      p.median !== null && c.median !== null && p.p25 !== null && p.p75 !== null && c.p25 !== null && c.p75 !== null
        ? Math.abs(p.median - c.median) / ((Math.abs(p.p75 - p.p25) + Math.abs(c.p75 - c.p25)) / 2 + 1e-9)
        : null;
    return {
      field,
      profitable: p,
      loss: l,
      currentPaper: c,
      medianDiff,
      overlap: overlapRatio(p, c),
      separationScore: score,
      separationClass: sepClass(score),
    };
  });

  const avgSep = distributionCompare.reduce((acc, row) => acc + (row.separationScore ?? 0), 0) / Math.max(1, distributionCompare.length);
  const distributionShift =
    avgSep >= 1 ? "SEVERE_SHIFT" : avgSep >= 0.5 ? "MATERIAL_SHIFT" : avgSep >= 0.25 ? "MILD_SHIFT" : "NO_SHIFT";

  const stageReach = {
    scanner: 0,
    marketContext: 0,
    strategy: 0,
    EV: 0,
    TDI: 0,
    AI: 0,
    risk: 0,
    sizing: 0,
    execution: 0,
  };
  for (const row of stageTraceRows) {
    const stage = s(row.stage).toLowerCase();
    if (stage.includes("scanner")) stageReach.scanner += 1;
    if (stage.includes("candidate") || stage.includes("context")) stageReach.marketContext += 1;
    if (stage.includes("strategy") || stage.includes("decision")) stageReach.strategy += 1;
    if (stage.includes("ev")) stageReach.EV += 1;
    if (s(row.reasonCode).toUpperCase().includes("TDI") || s(row.candidateId).startsWith("tdi:") || s(row.candidateId).startsWith("hybrid:"))
      stageReach.TDI += 1;
    if (stage.includes("ai")) stageReach.AI += 1;
    if (stage.includes("risk")) stageReach.risk += 1;
    if (stage.includes("sizing")) stageReach.sizing += 1;
    if (stage.includes("execution")) stageReach.execution += 1;
  }

  const currentBlockerCounts = currentRows.reduce((acc, row) => {
    const normalized = normalizeBlocker(s(row.firstBlockingCondition, "UNKNOWN"));
    acc[normalized] = (acc[normalized] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const currentPrimaryEntry = Object.entries(currentBlockerCounts).sort((a, b) => b[1] - a[1])[0] ?? ["UNKNOWN", 0];
  const currentPrimary = {
    blocker: currentPrimaryEntry[0],
    count: currentPrimaryEntry[1],
    share: currentRows.length > 0 ? Number((currentPrimaryEntry[1] / currentRows.length).toFixed(6)) : 0,
  };

  const primary =
    historicalPrimary && historicalPrimary.blocker !== "UNKNOWN"
      ? historicalPrimary
      : {
          blocker: currentPrimary.blocker,
          count: currentPrimary.count,
          share: currentPrimary.share,
          medianScoreGap: null,
          avgScoreGap: null,
        };

  const strategySuppression = ["MEAN_REVERSION", "VOLATILITY_BREAKOUT", "TREND_FOLLOWING", "OTHER"].map((strategy) => {
    const rows = simulated.filter((r) => r.strategy === strategy);
    const total = rows.length;
    return {
      strategy,
      historicalProfitableTrades: total,
      currentTdiPassRate: total > 0 ? Number((rows.filter((r) => r.verdict === "APPROVED").length / total).toFixed(6)) : 0,
      currentTdiWaitRate: total > 0 ? Number((rows.filter((r) => r.verdict === "WAIT").length / total).toFixed(6)) : 0,
      currentTdiRejectRate: total > 0 ? Number((rows.filter((r) => r.verdict === "REJECT").length / total).toFixed(6)) : 0,
      firstBlockerDistribution: Array.from(
        rows.reduce((acc, row) => {
          if (row.verdict === "APPROVED") return acc;
          acc.set(row.firstBlocker, (acc.get(row.firstBlocker) ?? 0) + 1);
          return acc;
        }, new Map<string, number>()),
      ).map(([blocker, count]) => ({ blocker, count })),
    };
  });

  const regimes = ["RANGE", "TREND", "HIGH_VOLATILITY", "LOW_VOLATILITY", "CHAOS", "LOW_LIQUIDITY", "UNKNOWN"];
  const regimeSuppression = regimes.map((regime) => {
    const rows = simulated.filter((r) => r.regime === regime);
    const total = rows.length;
    return {
      regime,
      historicalProfitableTrades: total,
      currentTdiPassRate: total > 0 ? Number((rows.filter((r) => r.verdict === "APPROVED").length / total).toFixed(6)) : 0,
      currentTdiWaitRate: total > 0 ? Number((rows.filter((r) => r.verdict === "WAIT").length / total).toFixed(6)) : 0,
      currentTdiRejectRate: total > 0 ? Number((rows.filter((r) => r.verdict === "REJECT").length / total).toFixed(6)) : 0,
      firstBlocker: rows.find((r) => r.verdict !== "APPROVED")?.firstBlocker ?? "UNKNOWN",
    };
  });

  const blocked = simulated.filter((r) => r.verdict !== "APPROVED");
  const suppressedNet = blocked.reduce((acc, row) => acc + row.netPnL, 0);
  const avgSuppressed = blocked.length > 0 ? suppressedNet / blocked.length : 0;

  const sortedByTs = [...simulated].filter((r) => r.entryTimestamp).sort((a, b) => Date.parse(a.entryTimestamp) - Date.parse(b.entryTimestamp));
  const split = Math.max(1, Math.floor(sortedByTs.length * 0.7));
  const train = sortedByTs.slice(0, split);
  const oos = sortedByTs.slice(split);
  const trainPass = train.length > 0 ? train.filter((r) => r.verdict === "APPROVED").length / train.length : 0;
  const oosPass = oos.length > 0 ? oos.filter((r) => r.verdict === "APPROVED").length / oos.length : 0;
  const oosSupported = Math.abs(trainPass - oosPass) <= 0.1 ? "YES" : Math.abs(trainPass - oosPass) <= 0.2 ? "PARTIAL" : "NO";

  const useCurrentShares = !historicalPrimary || historicalPrimary.blocker === "UNKNOWN";
  const histTotalBlock = Math.max(1, blockerRank.reduce((acc, row) => acc + row.count, 0));
  const currentTotalBlock = Math.max(1, Object.values(currentBlockerCounts).reduce((a, b) => a + b, 0));
  const momentumShare = useCurrentShares
    ? (currentBlockerCounts.MOMENTUM ?? 0) / currentTotalBlock
    : blockerRank.reduce((acc, row) => acc + (row.blocker === "MOMENTUM" ? row.count : 0), 0) / histTotalBlock;
  const technicalShare = useCurrentShares
    ? (currentBlockerCounts.TECHNICAL ?? 0) / currentTotalBlock
    : blockerRank.reduce((acc, row) => acc + (row.blocker === "TECHNICAL" ? row.count : 0), 0) / histTotalBlock;
  const confidenceShare = useCurrentShares
    ? (currentBlockerCounts.CONFIDENCE ?? 0) / currentTotalBlock
    : blockerRank.reduce((acc, row) => acc + (row.blocker === "CONFIDENCE" ? row.count : 0), 0) / histTotalBlock;

  const currentApproved = currentRows.filter((r) => normalizeVerdict(r.tdiVerdict) === "APPROVED").length;
  const zeroExplained = currentApproved === 0 && simulated.length > 0 ? "YES" : simulated.length > 0 ? "PARTIAL" : "NO";

  const upstreamVsTdi =
    distributionShift === "MATERIAL_SHIFT" || distributionShift === "SEVERE_SHIFT"
      ? "MIXED"
      : (primary?.blocker ?? "UNKNOWN") === "UPSTREAM"
        ? "UPSTREAM_OPPORTUNITY_QUALITY"
        : "TDI_FILTERING";

  const topBottleneckSource = blockerRank.filter((r) => r.blocker !== "UNKNOWN").length > 0
    ? blockerRank.slice(0, 5)
    : Object.entries(currentBlockerCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([blocker, count]) => ({ blocker, count, share: currentRows.length > 0 ? count / currentRows.length : 0, medianScoreGap: null, avgScoreGap: null }));
  const topBottlenecks = topBottleneckSource.map((row, idx) => ({
    rank: idx + 1,
    bottleneck: row.blocker,
    affectedHistoricalProfitableProfiles: row.count,
    affectedCurrentCandidates: currentRows.filter((r) => normalizeBlocker(s(r.firstBlockingCondition)) === normalizeBlocker(String(row.blocker))).length,
    firstStage: row.blocker === "UPSTREAM" ? "scanner/market-context" : "tdi",
    evidence: {
      suppressionShare: row.share,
      medianScoreGap: row.medianScoreGap,
      avgScoreGap: row.avgScoreGap,
    },
    confidence: row.count >= 10 ? "HIGH" : row.count >= 4 ? "MEDIUM" : "LOW",
  }));

  const experiments = [
    {
      experiment: "TDI_INTERACTION_ANALYSIS",
      hypothesis: "Historical profitable profiles are primarily lost at momentum/confidence interactions before AI gate.",
      affectedCohort: "historical profitable trades blocked by simulated current TDI",
      expectedMeasurement: "Pass/Wait/Reject shift by blocker class without changing production thresholds.",
      risk: "LOW (offline replay only)",
      successCriterion: "Primary blocker share remains stable in OOS split (<=10pp drift).",
    },
    {
      experiment: "MOMENTUM_POLICY_SHADOW",
      hypothesis: "Momentum-driven WAIT/REJECT cluster is the largest suppressor bucket for profitable profiles.",
      affectedCohort: "momentum-blocked profitable historical trades",
      expectedMeasurement: "Momentum blocker share and near-threshold density under shadow diagnostics.",
      risk: "LOW (research-only)",
      successCriterion: "Momentum remains top blocker with reproducible share in chronological OOS.",
    },
    {
      experiment: "REGIME_AWARE_TDI_SHADOW",
      hypothesis: "Suppression profile changes by regime and can be measured without touching production policy.",
      affectedCohort: "RANGE/TREND/HIGH_VOL/LOW_VOL regime buckets",
      expectedMeasurement: "Per-regime pass/wait/reject + first-blocker distribution.",
      risk: "LOW (offline + shadow analytics)",
      successCriterion: "At least one regime shows materially different blocker composition.",
    },
  ];

  const summary = {
    generatedAt: new Date().toISOString(),
    sources: {
      historical: HISTORICAL_PATH,
      currentPaper: CURRENT_5R_PATH,
      sessionId: s(current5R.sessionId),
      rounds: roundRoots.length,
    },
    counts: {
      historicalTrades: historicalTrades.length,
      profitableTrades: profitable.length,
      lossTrades: loss.length,
      breakevenTrades: breakeven.length,
      currentPaperCandidates: currentRows.length,
    },
    tdiSuppression: {
      profitableWouldPass: pass,
      profitableWouldWait: wait,
      profitableWouldReject: reject,
      primarySuppression: primary,
      blockerRank,
      momentumBlockShare: Number(momentumShare.toFixed(6)),
      technicalBlockShare: Number(technicalShare.toFixed(6)),
      confidenceBlockShare: Number(confidenceShare.toFixed(6)),
      blockedNearThresholdBreakdown: blocked.reduce((acc, row) => {
        acc[row.nearClass] = (acc[row.nearClass] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    },
    distributions: {
      numeric: distributionCompare,
    },
    stageReach: {
      currentPaper: stageReach,
    },
    strategySuppression,
    regimeSuppression,
    historicalCounterfactual: {
      wouldBeBlockedProfitableTrades: blocked.length,
      totalHistoricalNetPnLSuppressed: Number(suppressedNet.toFixed(8)),
      averageSuppressedNetPnL: Number(avgSuppressed.toFixed(8)),
    },
    distributionShift: {
      classification: distributionShift,
      averageSeparationScore: Number(avgSep.toFixed(6)),
    },
    upstreamVsTdi,
    zeroApprovalExplanation: {
      explained: zeroExplained,
      currentTdiApproved: currentApproved,
      dominantAxis:
        primary?.blocker === "MOMENTUM"
          ? "MOMENTUM"
          : primary?.blocker === "TECHNICAL"
            ? "TECHNICAL"
            : primary?.blocker === "CONFIDENCE"
              ? "CONFIDENCE"
              : primary?.blocker === "UPSTREAM"
                ? "UPSTREAM_CANDIDATE_QUALITY"
                : "MIXED",
    },
    oos: {
      trainCount: train.length,
      oosCount: oos.length,
      trainPassRate: Number(trainPass.toFixed(6)),
      oosPassRate: Number(oosPass.toFixed(6)),
      supported: oosSupported,
    },
    topBottlenecks,
    experiments,
  };

  const profitableCsvRows = simulated.map((row) => ({
    ...row,
    simulatedCurrentTdiVerdict: row.verdict,
    simulatedFirstBlocker: row.firstBlocker,
    technicalGap: row.gaps.technicalGap,
    momentumGap: row.gaps.momentumGap,
    confidenceGap: row.gaps.confidenceGap,
    bullishCountGap: row.gaps.bullishCountGap,
    executionGap: row.gaps.executionGap,
    thresholdDistanceClass: row.nearClass,
  }));

  const currentCsvRows = currentRows;
  const suppressionCsvRows = blocked.map((row) => ({
    tradeId: row.tradeId,
    symbol: row.symbol,
    strategy: row.strategy,
    regime: row.regime,
    netPnL: row.netPnL,
    firstBlocker: row.firstBlocker,
    technicalGap: row.gaps.technicalGap,
    momentumGap: row.gaps.momentumGap,
    confidenceGap: row.gaps.confidenceGap,
    bullishCountGap: row.gaps.bullishCountGap,
    executionGap: row.gaps.executionGap,
    thresholdDistanceClass: row.nearClass,
  }));
  const funnelGapRows = simulated.map((row) => ({
    tradeId: row.tradeId,
    symbol: row.symbol,
    strategy: row.strategy,
    regime: row.regime,
    historicalStageReached: "execution",
    historicalFirstBlock: "NONE",
    historicalTdiVerdict: row.tdiVerdict || "UNKNOWN",
    historicalAiVerdict: row.aiFinalDecision || "UNKNOWN",
    historicalRiskVerdict: row.riskVerdict || "UNKNOWN",
    historicalSizingVerdict: row.sizingVerdict || "UNKNOWN",
    currentTdiSimulatedVerdict: row.verdict,
    currentFirstBlocker: row.firstBlocker,
    historicalDecisionConflict:
      normalizeVerdict(row.tdiVerdict) === "APPROVED" && row.aiFinalDecision.toUpperCase().includes("NO_TRADE")
        ? "HISTORICAL_DECISION_CONFLICT"
        : "",
  }));

  writeCsv(OUTPUT.profitableProfileCsv, profitableCsvRows as unknown as AnyRecord[]);
  writeCsv(OUTPUT.currentCandidateCsv, currentCsvRows as unknown as AnyRecord[]);
  writeCsv(OUTPUT.tdiSuppressionCsv, suppressionCsvRows as unknown as AnyRecord[]);
  writeCsv(OUTPUT.profitableGapCsv, funnelGapRows as unknown as AnyRecord[]);
  writeJson(OUTPUT.summaryJson, summary);
  writeJson(OUTPUT.shiftJson, summary.distributionShift);
  writeJson(OUTPUT.topBottlenecksJson, topBottlenecks);
  writeJson(OUTPUT.experimentsJson, experiments);

  const final = {
    HISTORICAL_PROFITABLE_TRADES: profitable.length,
    CURRENT_PAPER_CANDIDATES: currentRows.length,
    HISTORICAL_PROFITABLE_WOULD_PASS_CURRENT_TDI: pass,
    HISTORICAL_PROFITABLE_WOULD_WAIT_CURRENT_TDI: wait,
    HISTORICAL_PROFITABLE_WOULD_REJECT_CURRENT_TDI: reject,
    PRIMARY_SUPPRESSION_STAGE: (primary?.blocker ?? "UNKNOWN") as
      | "TECHNICAL"
      | "MOMENTUM"
      | "CONFIDENCE"
      | "RISK"
      | "REGIME"
      | "UPSTREAM"
      | "MIXED"
      | "UNKNOWN",
    PRIMARY_SUPPRESSION_SHARE: primary ? Number(primary.share.toFixed(6)) : "UNKNOWN",
    MEDIAN_SCORE_GAP: primary?.medianScoreGap === null || primary?.medianScoreGap === undefined ? "UNKNOWN" : Number(primary.medianScoreGap.toFixed(6)),
    DISTRIBUTION_SHIFT: distributionShift as "NO_SHIFT" | "MILD_SHIFT" | "MATERIAL_SHIFT" | "SEVERE_SHIFT",
    CURRENT_ZERO_APPROVAL_EXPLAINED: zeroExplained as "YES" | "NO" | "PARTIAL",
    UPSTREAM_VS_TDI: upstreamVsTdi as "UPSTREAM_OPPORTUNITY_QUALITY" | "TDI_FILTERING" | "MIXED" | "UNKNOWN",
    TOP_EXPERIMENT: experiments[0].experiment,
    PRODUCTION_CHANGE_RECOMMENDED: "NO" as "NO",
    OOS_SUPPORTED: oosSupported as "YES" | "NO" | "PARTIAL",
  };

  const mustNotChange = [
    "TDI thresholds",
    "technical thresholds",
    "momentum thresholds",
    "confidence thresholds",
    "sizing",
    "EV",
    "risk",
    "maxPositions",
    "AI prompts",
    "AI VETO",
    "scanner rules",
    "strategy rules",
    "SL/TP",
    "TIME_EXIT",
    "fee model",
    "Variant_D",
    "scanner selection policy",
  ];

  const missingEvidence = [
    "Her historical trade için decision-time TDI trace eşleşmesi birebir mevcut değil.",
    "Bazı LearningTrade metadata alanları boş; candidate-level geçmiş chain eksik.",
    "Birebir runtime TDI motor replay’i yerine policy seviyesinde forensics simülasyonu kullanıldı.",
  ];

  const md = [
    "# KRIPTO P2 — HISTORICAL PROFITABLE TRADES vs CURRENT FUNNEL GAP",
    "",
    "## Core Findings",
    `- Historical profitable trades: ${profitable.length}`,
    `- Current paper candidates: ${currentRows.length}`,
    `- Historical profitable -> current TDI pass/wait/reject: ${pass}/${wait}/${reject}`,
    `- Primary suppression stage: ${primary?.blocker ?? "UNKNOWN"}`,
    `- Distribution shift: ${distributionShift}`,
    `- Current zero approval explained: ${zeroExplained}`,
    "",
    "## Required Answers",
    `1. How many historical profitable trades exist? ${profitable.length}`,
    `2. How many would pass CURRENT TDI? ${pass}`,
    `3. How many would be WAIT? ${wait}`,
    `4. How many would be REJECT? ${reject}`,
    `5. Which first blocker kills the most profitable historical opportunities? ${primary?.blocker ?? "UNKNOWN"}`,
    `6. What is the median score gap? ${final.MEDIAN_SCORE_GAP}`,
    `7. Is the problem upstream candidate quality or TDI filtering? ${upstreamVsTdi}`,
    `8. Is there a material regime shift? ${distributionShift}`,
    `9. Is momentum the dominant blocker? ${momentumShare > technicalShare && momentumShare > confidenceShare ? "YES" : "NO"}`,
    `10. Is technical the dominant blocker? ${technicalShare > momentumShare && technicalShare > confidenceShare ? "YES" : "NO"}`,
    `11. Is confidence the dominant blocker? ${confidenceShare > momentumShare && confidenceShare > technicalShare ? "YES" : "NO"}`,
    `12. How many profitable historical opportunities would current TDI suppress? ${blocked.length}`,
    `13. Is current 0 approval explainable without changing thresholds? ${zeroExplained}`,
    `14. What are the top 3 safe experiments? ${experiments.map((e) => e.experiment).join(", ")}`,
    `15. What should NOT be changed? ${mustNotChange.join(", ")}`,
    `16. What evidence is still missing? ${missingEvidence.join(" | ")}`,
    "",
    "## Final Verdict",
    `HISTORICAL_PROFITABLE_TRADES = ${final.HISTORICAL_PROFITABLE_TRADES}`,
    `CURRENT_PAPER_CANDIDATES = ${final.CURRENT_PAPER_CANDIDATES}`,
    `HISTORICAL_PROFITABLE_WOULD_PASS_CURRENT_TDI = ${final.HISTORICAL_PROFITABLE_WOULD_PASS_CURRENT_TDI}`,
    `HISTORICAL_PROFITABLE_WOULD_WAIT_CURRENT_TDI = ${final.HISTORICAL_PROFITABLE_WOULD_WAIT_CURRENT_TDI}`,
    `HISTORICAL_PROFITABLE_WOULD_REJECT_CURRENT_TDI = ${final.HISTORICAL_PROFITABLE_WOULD_REJECT_CURRENT_TDI}`,
    `PRIMARY_SUPPRESSION_STAGE = ${final.PRIMARY_SUPPRESSION_STAGE}`,
    `PRIMARY_SUPPRESSION_SHARE = ${final.PRIMARY_SUPPRESSION_SHARE}`,
    `MEDIAN_SCORE_GAP = ${final.MEDIAN_SCORE_GAP}`,
    `DISTRIBUTION_SHIFT = ${final.DISTRIBUTION_SHIFT}`,
    `CURRENT_ZERO_APPROVAL_EXPLAINED = ${final.CURRENT_ZERO_APPROVAL_EXPLAINED}`,
    `UPSTREAM_VS_TDI = ${final.UPSTREAM_VS_TDI}`,
    `TOP_EXPERIMENT = ${final.TOP_EXPERIMENT}`,
    `PRODUCTION_CHANGE_RECOMMENDED = ${final.PRODUCTION_CHANGE_RECOMMENDED}`,
    `OOS_SUPPORTED = ${final.OOS_SUPPORTED}`,
    "",
  ].join("\n");

  fs.writeFileSync(OUTPUT.reportMd, md, "utf8");
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
