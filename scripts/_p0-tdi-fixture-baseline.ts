/**
 * Offline baseline / blocker analysis for canonical 46-round TDI fixture.
 * Usage: npx tsx scripts/_p0-tdi-fixture-baseline.ts
 */
import fs from "node:fs";
import path from "node:path";

const SESSION = "cmstltuqn0007un9ksbk3xn9c";
const ROOT = path.join(process.cwd(), "artifacts", "forensics", SESSION, "rounds");

type TdiRow = {
  candidateId: string;
  symbol: string;
  verdict: string;
  hybridDecision?: string;
  masterDecision?: string;
  legacyDecision?: string;
  consensusScore?: number;
  confidence?: number;
  strategy?: string;
  reasonDetail?: string;
};

function loadRecords(): TdiRow[] {
  const rows: TdiRow[] = [];
  if (!fs.existsSync(ROOT)) return rows;
  for (const roundDir of fs.readdirSync(ROOT).filter((n) => /^\d+$/.test(n))) {
    const file = path.join(ROOT, roundDir, "tdi-decisions.json");
    if (!fs.existsSync(file)) continue;
    const payload = JSON.parse(fs.readFileSync(file, "utf8")) as { records?: TdiRow[] };
    rows.push(...(payload.records ?? []));
  }
  return rows;
}

function includesMomentumWeak(detail?: string) {
  return Boolean(detail?.includes("Momentum guven vermiyor"));
}

function includesTechStrongOthersWeak(detail?: string) {
  return Boolean(detail?.includes("Teknik guclu ama diger AI destegi zayif"));
}

function includesLearningBlock(detail?: string) {
  return Boolean(detail?.includes("LEARNING"));
}

function includesMomentumBlock(detail?: string) {
  return Boolean(detail?.includes("MOMENTUM"));
}

function classifyFirstBlocker(row: TdiRow): string {
  const detail = row.reasonDetail ?? "";
  const score = row.consensusScore ?? 0;
  if (row.candidateId.startsWith("hybrid:")) {
    if (includesMomentumWeak(detail) && includesTechStrongOthersWeak(detail)) return "DUPLICATE_MOMENTUM_TECH";
    if (includesMomentumWeak(detail)) return "MOMENTUM";
    if (includesTechStrongOthersWeak(detail)) return "TECH_STRONG_OTHERS_WEAK";
    if (row.hybridDecision === "NO_TRADE") return "COMPOSITE_SCORE";
    return "OTHER";
  }
  if (row.candidateId.startsWith("tdi:")) {
    if ((row.confidence ?? 100) < 40) return "CONFIDENCE";
    if (row.masterDecision === "NO_TRADE" && includesLearningBlock(detail) && includesMomentumBlock(detail)) {
      return "LEARNING";
    }
    if (includesMomentumBlock(detail)) return "MOMENTUM";
    if (row.masterDecision === "NO_TRADE") return "MASTER_POLICY";
    return "OTHER";
  }
  return "OTHER";
}

function main() {
  const records = loadRecords();
  const verdictCounts: Record<string, number> = {};
  const hybridDecisions: Record<string, number> = {};
  const masterDecisions: Record<string, number> = {};
  let momentumWeak = 0;
  let techStrongOthersWeak = 0;
  let confidenceLt40 = 0;
  let learningBearishMaster = 0;
  let scoreGe55 = 0;
  let hybridBuy = 0;
  let approved = 0;
  const blockerFreq: Record<string, number> = {};

  for (const row of records) {
    verdictCounts[row.verdict] = (verdictCounts[row.verdict] ?? 0) + 1;
    if (row.hybridDecision) hybridDecisions[row.hybridDecision] = (hybridDecisions[row.hybridDecision] ?? 0) + 1;
    if (row.masterDecision) masterDecisions[row.masterDecision] = (masterDecisions[row.masterDecision] ?? 0) + 1;
    if ((row.consensusScore ?? 0) >= 55) scoreGe55 += 1;
    if (row.hybridDecision === "BUY") hybridBuy += 1;
    if (row.verdict === "APPROVED") approved += 1;
    if (includesMomentumWeak(row.reasonDetail)) momentumWeak += 1;
    if (includesTechStrongOthersWeak(row.reasonDetail)) techStrongOthersWeak += 1;
    if ((row.confidence ?? 100) < 40) confidenceLt40 += 1;
    if (row.candidateId.startsWith("tdi:") && includesLearningBlock(row.reasonDetail)) learningBearishMaster += 1;

    if (row.candidateId.startsWith("hybrid:") && (row.consensusScore ?? 0) >= 55) {
      const blocker = classifyFirstBlocker(row);
      blockerFreq[blocker] = (blockerFreq[blocker] ?? 0) + 1;
    }
  }

  const hybridScoreGe55 = records.filter(
    (r) => r.candidateId.startsWith("hybrid:") && (r.consensusScore ?? 0) >= 55,
  );
  const sample = hybridScoreGe55.slice(0, 50).map((row) => ({
    candidateId: row.candidateId,
    symbol: row.symbol,
    strategy: row.strategy,
    hybridCompositeScore: row.consensusScore,
    hybridDecision: row.hybridDecision,
    confidence: row.confidence,
    reasonDetail: row.reasonDetail,
    firstBlocker: classifyFirstBlocker(row),
  }));

  const duplicatePaperCandidates = hybridScoreGe55.filter(
    (r) =>
      includesMomentumWeak(r.reasonDetail) &&
      includesTechStrongOthersWeak(r.reasonDetail) &&
      (r.confidence ?? 0) >= 32,
  ).length;

  const report = {
    sessionId: SESSION,
    capturedAt: new Date().toISOString(),
    phase: "before_fix_recorded_artifact",
    totals: {
      tdiDecisions: records.length,
      approved,
      wait: verdictCounts.WAIT ?? 0,
      rejected: verdictCounts.REJECTED ?? 0,
      scoreGe55,
      hybridBuy,
      momentumWeakCount: momentumWeak,
      techStrongButOthersWeakCount: techStrongOthersWeak,
      confidenceLt40Count: confidenceLt40,
      learningBearishMasterCount: learningBearishMaster,
    },
    verdictCounts,
    hybridDecisions,
    masterDecisions,
    scoreGe55HybridBlockerFrequency: blockerFreq,
    estimatedDuplicatePaperDowngradeCandidates: duplicatePaperCandidates,
    sampleScoreGe55HybridCandidates: sample,
  };

  const outPath = path.join(process.cwd(), "kripto-p0-tdi-fixture-baseline.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.totals, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main();
