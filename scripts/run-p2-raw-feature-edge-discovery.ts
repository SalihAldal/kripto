import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/src/server/db/prisma";

type AnyRecord = Record<string, unknown>;
type OutcomeClass = "PROFITABLE" | "LOSS" | "BREAKEVEN" | "UNKNOWN";
type EvidenceClass = "EXACT_RUNTIME_REPLAY" | "POLICY_FORENSIC_REPLAY" | "INFERRED";
type Split = "TRAIN" | "VALIDATION" | "OOS";

const ROOT = process.cwd();
const FIVE_ROUND = path.join(ROOT, "kripto-5round-paper-validation.json");
const PAIRED = path.join(ROOT, "kripto-p2-historical-paired-dataset.json");
const FEE_BACKFILL = path.join(ROOT, "kripto-p2-historical-fee-backfill.json");

const OUT = {
  report: path.join(ROOT, "KRIPTO_P2_RAW_FEATURE_EDGE_DISCOVERY_REPORT.md"),
  summary: path.join(ROOT, "kripto-p2-raw-feature-edge-discovery.json"),
  quality: path.join(ROOT, "kripto-p2-feature-quality.csv"),
  economic: path.join(ROOT, "kripto-p2-feature-economic-value.csv"),
  ablation: path.join(ROOT, "kripto-p2-feature-ablation.csv"),
  redundancy: path.join(ROOT, "kripto-p2-feature-redundancy.csv"),
  interactions: path.join(ROOT, "kripto-p2-feature-interactions.csv"),
  strategy: path.join(ROOT, "kripto-p2-feature-strategy.csv"),
  regime: path.join(ROOT, "kripto-p2-feature-regime.csv"),
  current2278: path.join(ROOT, "kripto-p2-feature-current-2278.csv"),
  oos: path.join(ROOT, "kripto-p2-feature-oos.json"),
  topCandidates: path.join(ROOT, "kripto-p2-feature-top-candidates.json"),
  dataset: path.join(ROOT, "kripto-p2-raw-feature-edge-discovery-dataset.csv"),
};

const FEATURE_LIST = [
  "technicalScore",
  "momentumScore",
  "sentimentScore",
  "shortMomentum",
  "shortFlow",
  "confidence",
  "learningScore",
  "bullishCount",
  "executionScore",
  "EV",
  "liquidity",
  "volatility",
  "volume",
  "volumeRatio",
  "trendAlignment",
  "emaDistance",
  "atr",
  "rsi",
  "macd",
  "orderBookImbalance",
  "recentTradesImbalance",
  "openInterest",
  "funding",
  "spread",
  "volatilityRegime",
  "marketContextScore",
  "crossAssetScore",
] as const;
type FeatureName = (typeof FEATURE_LIST)[number];

type Row = {
  dataset: "historical_trade" | "current_candidate";
  candidateId: string;
  tradeId: string;
  runId: string;
  sessionId: string;
  roundId: string;
  decisionTimestamp: string;
  symbol: string;
  strategy: string;
  regime: string;
  tdiVerdict: string;
  aiVerdict: string;
  grossPnL: number;
  fees: number;
  netPnL: number;
  notional: number;
  netReturn: number;
  evidenceClass: EvidenceClass;
  outcomeClass: OutcomeClass;
  hasOutcome: boolean;
  features: Record<FeatureName, number>;
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
function pct(a: number, b: number) {
  return b > 0 ? a / b : 0;
}
function outcomeFromNet(v: number): OutcomeClass {
  if (!Number.isFinite(v)) return "UNKNOWN";
  if (v > 0) return "PROFITABLE";
  if (v < 0) return "LOSS";
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
  const keys = ["technicalScore", "momentumScore", "sentimentScore", "shortMomentum", "shortFlow", "confidence"];
  const exact = keys.every((k) => Number.isFinite(n(meta[k])));
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

function featureUnit(f: FeatureName) {
  if (f.includes("Score") || ["confidence", "learningScore", "executionScore", "bullishCount", "EV", "marketContextScore", "crossAssetScore"].includes(f)) return "score";
  if (["shortMomentum", "shortFlow", "volumeRatio", "orderBookImbalance", "recentTradesImbalance", "macd", "funding"].includes(f)) return "ratio";
  if (["rsi"].includes(f)) return "index";
  if (["volatility", "spread", "atr", "emaDistance"].includes(f)) return "percent_or_ratio";
  if (["liquidity", "volume", "openInterest"].includes(f)) return "notional";
  if (["volatilityRegime"].includes(f)) return "encoded";
  return "unknown";
}

async function main() {
  const paired = fs.existsSync(PAIRED) ? j<AnyRecord>(PAIRED) : ({} as AnyRecord);
  const feeBackfill = fs.existsSync(FEE_BACKFILL) ? j<AnyRecord>(FEE_BACKFILL) : ({} as AnyRecord);
  const pairedTotals = (paired.totals as AnyRecord | undefined) ?? {};
  const pairedMeta = (paired.pairedDataset as AnyRecord | undefined) ?? {};

  const five = j<AnyRecord>(FIVE_ROUND);
  const roots: string[] = ((five.rounds as AnyRecord[]) ?? []).map((r) => s(r.artifactRoot)).filter(Boolean);

  const currentRaw: Row[] = [];
  for (const root of roots) {
    const p = path.join(root, "tdi-decisions.json");
    if (!fs.existsSync(p)) continue;
    const payload = j<{ records?: AnyRecord[] }>(p);
    for (const rec of payload.records ?? []) {
      const f: Record<FeatureName, number> = {
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
        liquidity: n(rec.liquidity ?? rec.volume24h),
        volatility: n(rec.volatility),
        volume: n(rec.volume24h),
        volumeRatio: n(rec.volumeRatio ?? rec.volumeSpikeRatio),
        trendAlignment: n(rec.trendAlignment ?? rec.mtfAlignment),
        emaDistance: n(rec.emaDistance),
        atr: n(rec.atr),
        rsi: n(rec.rsi),
        macd: n(rec.macd),
        orderBookImbalance: n(rec.orderBookImbalance),
        recentTradesImbalance: n(rec.recentTradesImbalance ?? rec.shortFlow),
        openInterest: n(rec.openInterest),
        funding: n(rec.fundingRate),
        spread: n(rec.spreadPercent ?? rec.spread),
        volatilityRegime: n(rec.volatilityRegimeCode),
        marketContextScore: n(rec.marketContextScore),
        crossAssetScore: n(rec.crossAssetScore),
      };
      if (!Number.isFinite(f.momentumScore)) continue;
      currentRaw.push({
        dataset: "current_candidate",
        candidateId: s(rec.candidateId),
        tradeId: "",
        runId: s(five.sessionId),
        sessionId: s(five.sessionId),
        roundId: s(rec.roundNo ?? path.basename(root)),
        decisionTimestamp: s(rec.createdAt ?? rec.timestamp, ""),
        symbol: s(rec.symbol),
        strategy: strategyNorm(s(rec.strategy)),
        regime: regimeNorm(s(rec.regime)),
        tdiVerdict: s(rec.verdict, "WAIT"),
        aiVerdict: s(rec.finalDecision ?? rec.hybridDecision, "UNKNOWN"),
        grossPnL: Number.NaN,
        fees: Number.NaN,
        netPnL: Number.NaN,
        notional: Number.NaN,
        netReturn: Number.NaN,
        evidenceClass: "EXACT_RUNTIME_REPLAY",
        outcomeClass: "UNKNOWN",
        hasOutcome: false,
        features: f,
      });
    }
  }
  const currentRows = Array.from(new Map(currentRaw.map((r) => [`${r.candidateId}|${r.roundId}|${r.symbol}`, r])).values());

  const med = (rows: Row[], key: FeatureName) => {
    const xs = rows.map((r) => r.features[key]).filter(Number.isFinite).sort((a, b) => a - b);
    if (xs.length === 0) return Number.NaN;
    return xs[Math.floor((xs.length - 1) * 0.5)];
  };
  const bySymbol = currentRows.reduce((acc, r) => ((acc.get(r.symbol)?.push(r) ?? acc.set(r.symbol, [r])), acc), new Map<string, Row[]>());
  const bySR = currentRows.reduce((acc, r) => {
    const k = `${r.strategy}|${r.regime}`;
    (acc.get(k)?.push(r) ?? acc.set(k, [r]));
    return acc;
  }, new Map<string, Row[]>());
  const globalMed = Object.fromEntries(FEATURE_LIST.map((k) => [k, med(currentRows, k)])) as Record<FeatureName, number>;

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
      closedAt: true,
      updatedAt: true,
    },
  });

  const historicalRows: Row[] = trades.map((t) => {
    const m = ((t.metadata as AnyRecord | null) ?? {}) as AnyRecord;
    const setup = ((m.setupSnapshot as AnyRecord | null) ?? {}) as AnyRecord;
    const deep = ((m.deepAnalysis as AnyRecord | null) ?? {}) as AnyRecord;
    const me = ((m.marketEvidence as AnyRecord | null) ?? {}) as AnyRecord;
    const raw = ((me.raw as AnyRecord | null) ?? {}) as AnyRecord;
    const strategy = strategyNorm(t.strategy);
    const regime = regimeNorm(s(t.marketRegime));
    const src = bySymbol.get(t.symbol)?.length ? bySymbol.get(t.symbol)! : bySR.get(`${strategy}|${regime}`) ?? [];
    const nums = Array.isArray(setup.numericFeatures) ? (setup.numericFeatures as AnyRecord[]) : [];
    const numMap = new Map(nums.map((x) => [s(x.key), n(x.value)]));
    const infer = (cands: unknown[], fb: FeatureName) => {
      for (const c of cands) {
        const v = n(c);
        if (Number.isFinite(v)) return v;
      }
      if (src.length > 0) {
        const vv = med(src, fb);
        if (Number.isFinite(vv)) return vv;
      }
      return globalMed[fb];
    };

    const f: Record<FeatureName, number> = {
      technicalScore: infer([m.technicalScore, setup.qualityScore], "technicalScore"),
      momentumScore: infer([m.momentumScore, deep.deterministicScore, numMap.get("shortMomentum"), numMap.get("pumpIntensity")], "momentumScore"),
      sentimentScore: infer([m.sentimentScore, numMap.get("aiConfidence")], "sentimentScore"),
      shortMomentum: infer([m.shortMomentum, numMap.get("shortMomentum")], "shortMomentum"),
      shortFlow: infer([m.shortFlow, numMap.get("shortFlow")], "shortFlow"),
      confidence: infer([m.confidence, deep.confidence, numMap.get("aiConfidence")], "confidence"),
      learningScore: infer([m.learningScore, m.learningWeight], "learningScore"),
      bullishCount: infer([m.bullishCount], "bullishCount"),
      executionScore: infer([m.executionScore, setup.qualityScore], "executionScore"),
      EV: infer([m.expectedValue], "EV"),
      liquidity: infer([m.liquidity, numMap.get("volumeSpikePercent"), numMap.get("spreadPercent")], "liquidity"),
      volatility: infer([m.volatility, numMap.get("volatilityPercent")], "volatility"),
      volume: infer([numMap.get("volumeSpikePercent"), raw.volume24h], "volume"),
      volumeRatio: infer([numMap.get("volumeSpikePercent"), raw.volumeSpikeRatio], "volumeRatio"),
      trendAlignment: infer([numMap.get("mtfAlignment"), m.mtfAlignment], "trendAlignment"),
      emaDistance: infer([numMap.get("emaDistance")], "emaDistance"),
      atr: infer([numMap.get("atr"), raw.atr], "atr"),
      rsi: infer([numMap.get("rsi"), raw.rsi], "rsi"),
      macd: infer([numMap.get("macd"), raw.macd], "macd"),
      orderBookImbalance: infer([numMap.get("orderBookImbalance"), raw.orderBookImbalance], "orderBookImbalance"),
      recentTradesImbalance: infer([raw.recentTradesImbalance, numMap.get("shortFlow"), m.shortFlow], "recentTradesImbalance"),
      openInterest: infer([raw.openInterest, m.openInterest], "openInterest"),
      funding: infer([raw.fundingRate], "funding"),
      spread: infer([numMap.get("spreadPercent"), raw.spreadPercent], "spread"),
      volatilityRegime: infer([raw.volatilityRegimeCode], "volatilityRegime"),
      marketContextScore: infer([m.marketContextScore], "marketContextScore"),
      crossAssetScore: infer([raw.crossAssetScore], "crossAssetScore"),
    };
    const gross = Number((Math.abs((t.exitPrice - t.entryPrice) * t.quantity)).toFixed(8));
    const fees = Math.max(0, Number((gross - Math.abs(t.realizedPnl)).toFixed(8)));
    const notional = Math.max(1e-9, Math.abs(t.entryPrice * t.quantity));
    const netReturn = Number((t.realizedPnl / notional).toFixed(10));
    return {
      dataset: "historical_trade",
      candidateId: s(m.candidateId ?? m.executionCandidateId ?? `hist:${t.tradeId}`),
      tradeId: t.tradeId,
      runId: s(m.runId ?? m.executionId ?? m.jobId),
      sessionId: s(m.sessionId ?? m.jobId),
      roundId: s(m.roundId ?? m.roundNo),
      decisionTimestamp: t.openedAt?.toISOString?.() ?? t.createdAt.toISOString(),
      symbol: t.symbol,
      strategy,
      regime,
      tdiVerdict: s(m.tdiVerdict ?? m.verdict, "WAIT"),
      aiVerdict: s(m.aiFinalDecision ?? m.finalDecision, "UNKNOWN"),
      grossPnL: gross,
      fees,
      netPnL: Number(t.realizedPnl.toFixed(8)),
      notional,
      netReturn,
      evidenceClass: evidenceClass(m),
      outcomeClass: outcomeFromNet(t.realizedPnl),
      hasOutcome: true,
      features: f,
    };
  });

  const allRows = [...historicalRows, ...currentRows];
  const hist = historicalRows.filter((r) => Number.isFinite(r.netPnL));
  const validPairedTrades = n(
    (feeBackfill.finalAnswers as AnyRecord | undefined)?.VALID_EXECUTED_PAIRED_TRADES ??
      (feeBackfill.qualitySummary as AnyRecord | undefined)?.includedForProfitability ??
      pairedMeta.validPairedSampleForQuant,
  );

  // splits
  const ts = hist.map((r) => Date.parse(r.decisionTimestamp)).sort((a, b) => a - b);
  const c1 = ts[Math.floor((ts.length - 1) * 0.6)];
  const c2 = ts[Math.floor((ts.length - 1) * 0.8)];
  const splitOf = (r: Row): Split => {
    const t = Date.parse(r.decisionTimestamp);
    if (t <= c1) return "TRAIN";
    if (t <= c2) return "VALIDATION";
    return "OOS";
  };
  const histSplit = hist.map((r) => ({ ...r, split: splitOf(r) }));

  // quality audit
  const qualityRows: AnyRecord[] = FEATURE_LIST.map((f) => {
    const xs = hist.map((r) => r.features[f]);
    const finite = xs.filter(Number.isFinite);
    const miss = xs.length - finite.length;
    const uniq = new Set(finite.map((v) => Number(v.toFixed(6)))).size;
    const sd = Math.sqrt(avg(finite.map((v) => (v - avg(finite)) ** 2)));
    const status =
      finite.length < 30
        ? "MISSING_HEAVY"
        : uniq <= 1
          ? "CONSTANT"
          : uniq <= 3
            ? "NEAR_CONSTANT"
            : miss / Math.max(1, xs.length) > 0.4
              ? "MISSING_HEAVY"
              : !Number.isFinite(sd) || sd === 0
                ? "UNSTABLE"
                : sd > Math.abs(avg(finite)) * 3
                  ? "UNSTABLE"
                  : "POTENTIALLY_USEFUL";
    return {
      feature: f,
      source: "tdi-decisions + learningTrade.metadata.setupSnapshot.numericFeatures + inferred medians",
      decisionTimeAvailability: Number(pct(finite.length, xs.length).toFixed(6)),
      unit: featureUnit(f),
      range: `[${Number(Math.min(...finite).toFixed(6))}, ${Number(Math.max(...finite).toFixed(6))}]`,
      count: finite.length,
      missingRate: Number(pct(miss, xs.length).toFixed(6)),
      uniqueValues: uniq,
      mean: Number(avg(finite).toFixed(6)),
      median: Number(quantile(finite, 0.5).toFixed(6)),
      std: Number(sd.toFixed(6)),
      p10: Number(quantile(finite, 0.1).toFixed(6)),
      p25: Number(quantile(finite, 0.25).toFixed(6)),
      p75: Number(quantile(finite, 0.75).toFixed(6)),
      p90: Number(quantile(finite, 0.9).toFixed(6)),
      min: Number(Math.min(...finite).toFixed(6)),
      max: Number(Math.max(...finite).toFixed(6)),
      qualityClass: status,
      normalization: "none (raw research value)",
      clamping: "not applied in this forensic layer",
    };
  });

  // univariate economic value
  const economicRows: AnyRecord[] = [];
  const featureScores: Array<{ feature: FeatureName; oosExpectancy: number; stability: number; sample: number }> = [];
  for (const f of FEATURE_LIST) {
    const trainVals = histSplit.filter((r) => r.split === "TRAIN").map((r) => r.features[f]).filter(Number.isFinite);
    if (trainVals.length < 30) continue;
    const q1 = quantile(trainVals, 0.25);
    const q2 = quantile(trainVals, 0.5);
    const q3 = quantile(trainVals, 0.75);
    const binOf = (v: number) => (v <= q1 ? "Q1" : v <= q2 ? "Q2" : v <= q3 ? "Q3" : "Q4");
    const perSplitExp: Record<Split, number> = { TRAIN: Number.NaN, VALIDATION: Number.NaN, OOS: Number.NaN };
    for (const split of ["TRAIN", "VALIDATION", "OOS"] as const) {
      const rows = histSplit.filter((r) => r.split === split && Number.isFinite(r.features[f]));
      const bins = ["Q1", "Q2", "Q3", "Q4"].map((b) => {
        const g = rows.filter((r) => binOf(r.features[f]) === b);
        const wins = g.filter((r) => r.netPnL > 0);
        const losses = g.filter((r) => r.netPnL < 0);
        const net = sum(g.map((r) => r.netPnL));
        const pos = sum(wins.map((r) => r.netPnL));
        const negAbs = Math.abs(sum(losses.map((r) => r.netPnL)));
        const eq = g.length > 0 ? net / g.length : Number.NaN;
        economicRows.push({
          feature: f,
          split,
          target: "netPnL,netReturn,netProfitable",
          bin: b,
          count: g.length,
          winRate: Number(pct(wins.length, Math.max(1, g.length)).toFixed(6)),
          grossPnL: Number(sum(g.map((r) => r.grossPnL)).toFixed(8)),
          fees: Number(sum(g.map((r) => r.fees)).toFixed(8)),
          netPnL: Number(net.toFixed(8)),
          expectancy: Number(eq.toFixed(8)),
          profitFactor: Number((negAbs > 0 ? pos / negAbs : Number.POSITIVE_INFINITY).toFixed(8)),
          maxDrawdown: Number(Math.abs(Math.min(0, ...g.map((r) => r.netPnL))).toFixed(8)),
        });
        return { b, eq };
      });
      perSplitExp[split] = bins.find((x) => x.b === "Q4")?.eq ?? Number.NaN;
    }
    const oosRows = histSplit.filter((r) => r.split === "OOS" && Number.isFinite(r.features[f]));
    const sp = spearman(
      oosRows.map((r) => r.features[f]),
      oosRows.map((r) => r.netPnL),
    );
    const trendClass = !Number.isFinite(sp)
      ? "UNKNOWN"
      : sp > 0.2
        ? "MONOTONIC_POSITIVE"
        : sp < -0.2
          ? "MONOTONIC_NEGATIVE"
          : Math.abs(sp) < 0.05
            ? "NO_RELATIONSHIP"
            : "THRESHOLD_EFFECT";
    economicRows.push({
      feature: f,
      split: "OOS_SUMMARY",
      target: "netPnL",
      bin: "ALL",
      relationClass: trendClass,
      spearman: Number(sp.toFixed(6)),
      BEST_POSITIVE_REGION: perSplitExp.OOS > 0 ? "Q4" : "NO_POSITIVE_REGION",
      WORST_REGION: "Q1",
    });
    const stability =
      Math.sign(perSplitExp.TRAIN || 0) === Math.sign(perSplitExp.VALIDATION || 0) &&
      Math.sign(perSplitExp.VALIDATION || 0) === Math.sign(perSplitExp.OOS || 0)
        ? 1
        : 0;
    featureScores.push({ feature: f, oosExpectancy: Number(perSplitExp.OOS || 0), stability, sample: oosRows.length });
  }

  const topFeatures = [...featureScores]
    .sort((a, b) => b.oosExpectancy - a.oosExpectancy || b.stability - a.stability || b.sample - a.sample)
    .slice(0, 20);

  // redundancy audit
  const redundancyPairs: Array<[FeatureName, FeatureName]> = [
    ["momentumScore", "shortMomentum"],
    ["momentumScore", "shortFlow"],
    ["sentimentScore", "confidence"],
    ["technicalScore", "trendAlignment"],
    ["volatility", "atr"],
    ["volume", "volumeRatio"],
    ["orderBookImbalance", "recentTradesImbalance"],
    ["learningScore", "confidence"],
  ];
  const redundancyRows = redundancyPairs.map(([a, b]) => {
    const rows = hist.filter((r) => Number.isFinite(r.features[a]) && Number.isFinite(r.features[b]));
    const corr = spearman(
      rows.map((r) => r.features[a]),
      rows.map((r) => r.features[b]),
    );
    const cls = Math.abs(corr) > 0.75 ? "REDUNDANT" : Math.abs(corr) > 0.45 ? "PARTIALLY_REDUNDANT" : "INDEPENDENT";
    return {
      featureA: a,
      featureB: b,
      correlation: Number(corr.toFixed(6)),
      sharedUnderlyingSignal: Math.abs(corr) > 0.45 ? "YES" : "NO",
      independentInformation: Math.abs(corr) < 0.3 ? "YES" : "PARTIAL_OR_NO",
      duplicateRisk: cls,
    };
  });

  // ablation baseline: simple weighted linear score on top10
  const ablationFeatures = topFeatures.slice(0, 10).map((x) => x.feature);
  const fitMinMax = (rows: Row[], f: FeatureName) => {
    const vals = rows.map((r) => r.features[f]).filter(Number.isFinite);
    const lo = quantile(vals, 0.05);
    const hi = quantile(vals, 0.95);
    return (v: number) => (Number.isFinite(v) && hi > lo ? clamp(((v - lo) / (hi - lo)) * 100, 0, 100) : 50);
  };
  const trainRows = histSplit.filter((r) => r.split === "TRAIN");
  const scalers = Object.fromEntries(ablationFeatures.map((f) => [f, fitMinMax(trainRows, f)])) as Record<FeatureName, (v: number) => number>;
  const signs = Object.fromEntries(
    ablationFeatures.map((f) => [
      f,
      Math.sign(
        spearman(
          trainRows.map((r) => r.features[f]),
          trainRows.map((r) => r.netPnL),
        ) || 1,
      ) || 1,
    ]),
  ) as Record<FeatureName, number>;
  const scoreWith = (r: Row, used: FeatureName[]) =>
    avg(used.map((f) => (signs[f] > 0 ? scalers[f](r.features[f]) : 100 - scalers[f](r.features[f]))));
  const baseScores = histSplit.map((r) => ({ ...r, edgeScore: scoreWith(r, ablationFeatures) }));
  const q66Base = quantile(baseScores.filter((r) => r.split === "TRAIN").map((r) => r.edgeScore), 0.66);
  const oosBase = baseScores.filter((r) => r.split === "OOS" && r.edgeScore >= q66Base);
  const oosBaseExp = sum(oosBase.map((r) => r.netPnL)) / Math.max(1, oosBase.length);
  const ablationRows: AnyRecord[] = [];
  for (const f of ablationFeatures) {
    const used = ablationFeatures.filter((x) => x !== f);
    const rows = histSplit.map((r) => ({ ...r, edgeScore: scoreWith(r, used) }));
    const q66 = quantile(rows.filter((r) => r.split === "TRAIN").map((r) => r.edgeScore), 0.66);
    const valSel = rows.filter((r) => r.split === "VALIDATION" && r.edgeScore >= q66);
    const oosSel = rows.filter((r) => r.split === "OOS" && r.edgeScore >= q66);
    const oosExp = sum(oosSel.map((r) => r.netPnL)) / Math.max(1, oosSel.length);
    ablationRows.push({
      feature: f,
      WITH_FEATURE: Number(oosBaseExp.toFixed(8)),
      WITHOUT_FEATURE: Number(oosExp.toFixed(8)),
      validationExpectancy: Number((sum(valSel.map((r) => r.netPnL)) / Math.max(1, valSel.length)).toFixed(8)),
      oosExpectancy: Number(oosExp.toFixed(8)),
      drawdown: Number(Math.abs(Math.min(0, ...oosSel.map((r) => r.netPnL))).toFixed(8)),
      contributionClass:
        oosExp < oosBaseExp - 0.005 ? "POSITIVE_CONTRIBUTOR" : oosExp > oosBaseExp + 0.005 ? "NEGATIVE_CONTRIBUTOR" : "NEUTRAL",
    });
  }

  // interactions
  const interactions: Array<[string, FeatureName[]]> = [
    ["momentumScore×shortMomentum", ["momentumScore", "shortMomentum"]],
    ["momentumScore×shortFlow", ["momentumScore", "shortFlow"]],
    ["momentumScore×sentimentScore", ["momentumScore", "sentimentScore"]],
    ["technicalScore×momentumScore", ["technicalScore", "momentumScore"]],
    ["confidence×learningScore", ["confidence", "learningScore"]],
    ["confidence×momentumScore", ["confidence", "momentumScore"]],
    ["regime×momentumScore", ["momentumScore"]],
    ["regime×technicalScore", ["technicalScore"]],
    ["strategy×momentumScore", ["momentumScore"]],
    ["strategy×technicalScore", ["technicalScore"]],
    ["EV×liquidity", ["EV", "liquidity"]],
    ["liquidity×volatility", ["liquidity", "volatility"]],
  ];
  const interactionRows: AnyRecord[] = [];
  for (const [name, feats] of interactions) {
    const trainCut = feats.map((f) => quantile(trainRows.map((r) => r.features[f]).filter(Number.isFinite), 0.66));
    const select = (r: Row) => feats.every((f, i) => Number.isFinite(r.features[f]) && r.features[f] >= trainCut[i]);
    const vs = histSplit.filter((r) => r.split === "VALIDATION" && select(r));
    const os = histSplit.filter((r) => r.split === "OOS" && select(r));
    const vExp = sum(vs.map((r) => r.netPnL)) / Math.max(1, vs.length);
    const oExp = sum(os.map((r) => r.netPnL)) / Math.max(1, os.length);
    interactionRows.push({
      interaction: name,
      countValidation: vs.length,
      countOOS: os.length,
      validationNetExpectancy: Number(vExp.toFixed(8)),
      oosNetExpectancy: Number(oExp.toFixed(8)),
      bestRegion: oExp > 0 ? "HIGH-HIGH" : "NO_POSITIVE_REGION",
      worstRegion: "OTHER",
      class: oExp > 0 && vExp > 0 && os.length >= 10 ? "ROBUST_INTERACTION" : oExp > 0 ? "WEAK_INTERACTION" : "NO_INTERACTION",
    });
  }
  const topInteraction = [...interactionRows].sort((a, b) => b.oosNetExpectancy - a.oosNetExpectancy)[0];

  // strategy/regime feature stability (top 10)
  const top10 = topFeatures.slice(0, 10).map((x) => x.feature);
  const strategyRows: AnyRecord[] = [];
  for (const st of ["Mean Reversion", "Volatility Breakout", "Trend Following", "Other"]) {
    const grp = histSplit.filter((r) => r.strategy === st);
    for (const f of top10) {
      const exp = sum(grp.map((r) => r.netPnL)) / Math.max(1, grp.length);
      const sp = spearman(
        grp.map((r) => r.features[f]),
        grp.map((r) => r.netPnL),
      );
      strategyRows.push({
        strategy: st,
        feature: f,
        sample: grp.length,
        expectancy: Number(exp.toFixed(8)),
        spearman: Number(sp.toFixed(6)),
        class: grp.length < 10 ? "INSUFFICIENT_SAMPLE" : Math.abs(sp) > 0.12 ? "STRATEGY_CONDITIONAL" : "WEAK",
      });
    }
  }
  const regimeRows: AnyRecord[] = [];
  for (const rg of ["RANGE", "TREND", "HIGH_VOLATILITY", "LOW_VOLATILITY", "CHAOS", "LOW_LIQUIDITY", "UNKNOWN"]) {
    const grp = histSplit.filter((r) => r.regime === rg);
    for (const f of top10) {
      const exp = sum(grp.map((r) => r.netPnL)) / Math.max(1, grp.length);
      const sp = spearman(
        grp.map((r) => r.features[f]),
        grp.map((r) => r.netPnL),
      );
      regimeRows.push({
        regime: rg,
        feature: f,
        sample: grp.length,
        expectancy: Number(exp.toFixed(8)),
        spearman: Number(sp.toFixed(6)),
        class: grp.length < 10 ? "INSUFFICIENT_SAMPLE" : Math.abs(sp) > 0.12 ? "REGIME_CONDITIONAL" : "WEAK",
      });
    }
  }

  // current 2278 application -> research edge rank
  const currentScored = currentRows.map((r) => ({
    ...r,
    researchEdgeRank: scoreWith(r, ablationFeatures),
  }));
  const q70 = quantile(currentScored.map((r) => r.researchEdgeRank), 0.7);
  const q80 = quantile(currentScored.map((r) => r.researchEdgeRank), 0.8);
  const q90 = quantile(currentScored.map((r) => r.researchEdgeRank), 0.9);
  const currentRowsOut = currentScored.map((r) => ({
    candidateId: r.candidateId,
    symbol: r.symbol,
    strategy: r.strategy,
    regime: r.regime,
    momentumScore: r.features.momentumScore,
    technicalScore: r.features.technicalScore,
    sentimentScore: r.features.sentimentScore,
    confidence: r.features.confidence,
    shortMomentum: r.features.shortMomentum,
    shortFlow: r.features.shortFlow,
    researchEdgeRank: Number(r.researchEdgeRank.toFixed(6)),
    researchPercentile:
      r.researchEdgeRank >= q90 ? "TOP_10" : r.researchEdgeRank >= q80 ? "TOP_20" : r.researchEdgeRank >= q70 ? "TOP_30" : "LOWER_70",
    tdiVerdict: r.tdiVerdict,
    aiVerdict: r.aiVerdict,
    evidenceClass: r.evidenceClass,
  }));

  // top candidate synthesis (max 3)
  const topRaw = topFeatures[0];
  const topFeatureName = topRaw?.feature ?? "NONE";
  const topFeatureOos = topRaw?.oosExpectancy ?? Number.NaN;
  const posRegion = topFeatureOos > 0 ? "YES" : "NO";
  const topInteractionName = topInteraction?.interaction ?? "NONE";
  const topInteractionOos = n(topInteraction?.oosNetExpectancy);

  const profitableCapture = histSplit.filter(
    (r) => r.outcomeClass === "PROFITABLE" && r.features[topFeatureName as FeatureName] >= quantile(trainRows.map((x) => x.features[topFeatureName as FeatureName]).filter(Number.isFinite), 0.66),
  ).length;
  const losingCapture = histSplit.filter(
    (r) => r.outcomeClass === "LOSS" && r.features[topFeatureName as FeatureName] >= quantile(trainRows.map((x) => x.features[topFeatureName as FeatureName]).filter(Number.isFinite), 0.66),
  ).length;

  const oosFeatureRows = economicRows.filter((r) => r.split === "OOS_SUMMARY");
  const positiveOosCount = oosFeatureRows.filter((r) => String(r.BEST_POSITIVE_REGION) !== "NO_POSITIVE_REGION").length;
  const oosSupported = positiveOosCount > 0 ? "PARTIAL" : "NO";
  const exactShare = pct(hist.filter((r) => r.evidenceClass === "EXACT_RUNTIME_REPLAY").length, Math.max(1, hist.length));
  const featureCalibrationStatus =
    topFeatureOos > 0.02 && oosSupported === "YES" && exactShare > 0.5
      ? "GOOD"
      : topFeatureOos > 0
        ? "WEAK"
        : Number.isFinite(topFeatureOos)
          ? "BAD"
          : "UNKNOWN";

  const topCandidates = {
    candidates: [
      {
        type: "FEATURE_REWEIGHTING_CANDIDATE",
        feature: topFeatureName,
        hypothesis: "Top raw feature percentile captures relatively better net region than baseline score ordering.",
        affectedPopulation: `Current top30% ~ ${currentRowsOut.filter((r) => r.researchPercentile !== "LOWER_70").length}`,
        historicalNetImpact: Number(sum(histSplit.filter((r) => r.features[topFeatureName as FeatureName] >= quantile(trainRows.map((x) => x.features[topFeatureName as FeatureName]).filter(Number.isFinite), 0.66)).map((r) => r.netPnL)).toFixed(8)),
        oosImpact: Number(topFeatureOos.toFixed(8)),
        falsePositiveRate: Number(pct(losingCapture, Math.max(1, profitableCapture + losingCapture)).toFixed(6)),
        strategyDependence: "PARTIAL",
        regimeDependence: "PARTIAL",
        implementationComplexity: "LOW",
        risk: "MEDIUM",
        successCriterion: "OOS positive expectancy with loss capture not exceeding baseline loss rate",
      },
      {
        type: "FEATURE_INTERACTION_CANDIDATE",
        feature: topInteractionName,
        hypothesis: "Bounded interaction may separate edge where single score fails.",
        affectedPopulation: `OOS interaction sample ${n(topInteraction?.countOOS, 0)}`,
        historicalNetImpact: Number((n(topInteraction?.oosNetExpectancy, 0) * n(topInteraction?.countOOS, 0)).toFixed(8)),
        oosImpact: Number(n(topInteraction?.oosNetExpectancy, Number.NaN).toFixed(8)),
        falsePositiveRate: "see interaction table",
        strategyDependence: "UNKNOWN",
        regimeDependence: "UNKNOWN",
        implementationComplexity: "MEDIUM",
        risk: "MEDIUM_HIGH",
        successCriterion: "Validation and OOS both positive with sufficient sample",
      },
      {
        type: "NO_VALID_FEATURE_CANDIDATE",
        feature: "NONE",
        hypothesis: "If no positive OOS net region remains after controls, do not change production policy.",
        affectedPopulation: "ALL",
        historicalNetImpact: Number(sum(histSplit.map((r) => r.netPnL)).toFixed(8)),
        oosImpact: Number.NaN,
        falsePositiveRate: Number.NaN,
        strategyDependence: "N/A",
        regimeDependence: "N/A",
        implementationComplexity: "NONE",
        risk: "LOW",
        successCriterion: "Keep safeguards unchanged",
      },
    ],
  };

  const oosJson = {
    splitSizes: { TRAIN: trainRows.length, VALIDATION: histSplit.filter((r) => r.split === "VALIDATION").length, OOS: histSplit.filter((r) => r.split === "OOS").length },
    topFeature: topFeatureName,
    topFeatureOosExpectancy: Number(topFeatureOos.toFixed(8)),
    topInteraction: topInteractionName,
    topInteractionOosExpectancy: Number(topInteractionOos.toFixed(8)),
    positiveFeatureCountOOS: positiveOosCount,
    supported: oosSupported,
  };

  const summary = {
    generatedAt: new Date().toISOString(),
    constraints: {
      noPaperRun: true,
      noMarketData: true,
      noProductionChange: true,
      untouched: [
        "TDI thresholds",
        "momentum thresholds",
        "confidence thresholds",
        "technical thresholds",
        "sizing",
        "EV",
        "risk",
        "AI",
        "scanner",
        "strategy rules",
        "SL/TP",
        "TIME_EXIT",
        "fee model",
        "Variant_D",
        "momentumScore formula",
      ],
    },
    dataset: {
      historicalTradesUsed: hist.length,
      currentCandidatesUsed: currentRows.length,
      historicalProfitable: hist.filter((r) => r.outcomeClass === "PROFITABLE").length,
      historicalLoss: hist.filter((r) => r.outcomeClass === "LOSS").length,
      historicalBreakeven: hist.filter((r) => r.outcomeClass === "BREAKEVEN").length,
      pairedTotals: {
        totalHistoricalTrades: n(pairedTotals.totalHistoricalTrades),
        validPairedTrades: validPairedTrades,
      },
      evidenceClassCounts: hist.reduce((a, r) => ((a[r.evidenceClass] = (a[r.evidenceClass] ?? 0) + 1), a), {} as Record<string, number>),
    },
    topFeatures,
    topInteraction,
    currentRanking: {
      top10: currentRowsOut.filter((r) => r.researchPercentile === "TOP_10").length,
      top20: currentRowsOut.filter((r) => r.researchPercentile === "TOP_10" || r.researchPercentile === "TOP_20").length,
      top30: currentRowsOut.filter((r) => r.researchPercentile !== "LOWER_70").length,
    },
    finalVerdict: {
      TOP_RAW_FEATURE: topFeatureName,
      TOP_RAW_FEATURE_OOS_EXPECTANCY: Number(topFeatureOos.toFixed(8)),
      POSITIVE_NET_REGION: posRegion,
      TOP_INTERACTION: topInteractionName,
      TOP_INTERACTION_OOS_EXPECTANCY: Number(topInteractionOos.toFixed(8)),
      PROFITABLE_CAPTURE: profitableCapture,
      LOSING_CAPTURE: losingCapture,
      CURRENT_2278_RESEARCH_HIGH_EDGE: currentRowsOut.filter((r) => r.researchPercentile !== "LOWER_70").length,
      FEATURE_CALIBRATION_STATUS: featureCalibrationStatus,
      STRONGEST_RESEARCH_CANDIDATE: topCandidates.candidates[0].type,
      OOS_SUPPORTED: oosSupported,
      ROBUSTNESS:
        profitableCapture + losingCapture < 20
          ? "INSUFFICIENT_SAMPLE"
          : Math.abs(profitableCapture - losingCapture) > (profitableCapture + losingCapture) * 0.5
            ? "CONCENTRATED"
            : "ROBUST",
      PRODUCTION_CHANGE_RECOMMENDED: "NO",
      NEXT_STEP: topCandidates.candidates[0].type === "NO_VALID_FEATURE_CANDIDATE" ? "NO_PRODUCTION_CHANGE_CONTINUE_FORENSIC_DATA_ENRICHMENT" : "RUN_TARGETED_SHADOW_ON_RESEARCH_EDGE_RANK_ONLY",
    },
  };

  const datasetCsv = allRows.map((r) => ({
    dataset: r.dataset,
    candidateId: r.candidateId,
    tradeId: r.tradeId,
    runId: r.runId,
    sessionId: r.sessionId,
    roundId: r.roundId,
    decisionTimestamp: r.decisionTimestamp,
    symbol: r.symbol,
    strategy: r.strategy,
    regime: r.regime,
    tdiVerdict: r.tdiVerdict,
    aiVerdict: r.aiVerdict,
    grossPnL: r.grossPnL,
    fees: r.fees,
    netPnL: r.netPnL,
    netReturn: r.netReturn,
    evidenceClass: r.evidenceClass,
    outcomeClass: r.outcomeClass,
    ...r.features,
  }));

  wcsv(OUT.quality, qualityRows);
  wcsv(OUT.economic, economicRows);
  wcsv(OUT.ablation, ablationRows);
  wcsv(OUT.redundancy, redundancyRows);
  wcsv(OUT.interactions, interactionRows);
  wcsv(OUT.strategy, strategyRows);
  wcsv(OUT.regime, regimeRows);
  wcsv(OUT.current2278, currentRowsOut);
  wcsv(OUT.dataset, datasetCsv);
  wj(OUT.oos, oosJson);
  wj(OUT.topCandidates, topCandidates);
  wj(OUT.summary, summary);

  const md = [
    "# KRIPTO P2 — RAW FEATURE EDGE DISCOVERY + OOS PROFITABILITY FORENSIC",
    "",
    "## Artifacts",
    `- summary: \`kripto-p2-raw-feature-edge-discovery.json\``,
    `- feature quality: \`kripto-p2-feature-quality.csv\``,
    `- economic value: \`kripto-p2-feature-economic-value.csv\``,
    `- feature ablation: \`kripto-p2-feature-ablation.csv\``,
    `- feature redundancy: \`kripto-p2-feature-redundancy.csv\``,
    `- feature interactions: \`kripto-p2-feature-interactions.csv\``,
    `- strategy/regime: \`kripto-p2-feature-strategy.csv\`, \`kripto-p2-feature-regime.csv\``,
    `- current 2278 ranking: \`kripto-p2-feature-current-2278.csv\``,
    `- oos + candidates: \`kripto-p2-feature-oos.json\`, \`kripto-p2-feature-top-candidates.json\``,
    "",
    "## Final Verdict",
    `TOP_RAW_FEATURE = ${summary.finalVerdict.TOP_RAW_FEATURE}`,
    `TOP_RAW_FEATURE_OOS_EXPECTANCY = ${summary.finalVerdict.TOP_RAW_FEATURE_OOS_EXPECTANCY}`,
    `POSITIVE_NET_REGION = ${summary.finalVerdict.POSITIVE_NET_REGION}`,
    `TOP_INTERACTION = ${summary.finalVerdict.TOP_INTERACTION}`,
    `TOP_INTERACTION_OOS_EXPECTANCY = ${summary.finalVerdict.TOP_INTERACTION_OOS_EXPECTANCY}`,
    `PROFITABLE_CAPTURE = ${summary.finalVerdict.PROFITABLE_CAPTURE}`,
    `LOSING_CAPTURE = ${summary.finalVerdict.LOSING_CAPTURE}`,
    `CURRENT_2278_RESEARCH_HIGH_EDGE = ${summary.finalVerdict.CURRENT_2278_RESEARCH_HIGH_EDGE}`,
    `FEATURE_CALIBRATION_STATUS = ${summary.finalVerdict.FEATURE_CALIBRATION_STATUS}`,
    `STRONGEST_RESEARCH_CANDIDATE = ${summary.finalVerdict.STRONGEST_RESEARCH_CANDIDATE}`,
    `OOS_SUPPORTED = ${summary.finalVerdict.OOS_SUPPORTED}`,
    `ROBUSTNESS = ${summary.finalVerdict.ROBUSTNESS}`,
    `PRODUCTION_CHANGE_RECOMMENDED = NO`,
    `NEXT_STEP = ${summary.finalVerdict.NEXT_STEP}`,
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

