/**
 * Extract TDI validation metrics from a forensic session folder.
 * Usage: npx tsx scripts/_p0-tdi-validation-metrics.ts [sessionId]
 */
import fs from "node:fs";
import path from "node:path";

const sessionId = process.argv[2] ?? "";
if (!sessionId) {
  console.error("Usage: npx tsx scripts/_p0-tdi-validation-metrics.ts <sessionId>");
  process.exit(1);
}

const ROOT = path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds");

type TdiRow = {
  verdict?: string;
  hybridDecision?: string;
  masterDecision?: string;
  legacyDecision?: string;
  reasonDetail?: string;
  confidence?: number;
};

function loadTdi(): TdiRow[] {
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

function readJson(filePath: string) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function main() {
  const tdi = loadTdi();
  const verdicts: Record<string, number> = {};
  let hybridBuy = 0;
  let masterBuy = 0;
  let momentumWeak = 0;
  let techStrongOthersWeak = 0;
  let confidenceLt40 = 0;

  for (const row of tdi) {
    const v = row.verdict ?? "UNKNOWN";
    verdicts[v] = (verdicts[v] ?? 0) + 1;
    if (row.hybridDecision === "BUY") hybridBuy += 1;
    if (row.masterDecision === "BUY" || row.masterDecision === "STRONG_BUY" || row.legacyDecision === "BUY") {
      masterBuy += 1;
    }
    if (row.reasonDetail?.includes("Momentum guven vermiyor")) momentumWeak += 1;
    if (row.reasonDetail?.includes("Teknik guclu ama diger AI destegi zayif")) techStrongOthersWeak += 1;
    if ((row.confidence ?? 100) < 40) confidenceLt40 += 1;
  }

  const rounds = fs.existsSync(ROOT) ? fs.readdirSync(ROOT).filter((n) => /^\d+$/.test(n)) : [];
  const roundSummaries = rounds.map((roundNo) => {
    const summary = readJson(path.join(ROOT, roundNo, "round-summary.json"));
    const scanner = readJson(path.join(ROOT, roundNo, "scanner-summary.json"));
    const aiProgress = readJson(path.join(ROOT, roundNo, "ai-progress.json"));
    const decisionTrace = readJson(path.join(ROOT, roundNo, "decision-trace.json"));
    const riskSizing = readJson(path.join(ROOT, roundNo, "risk-sizing-trace.json"));
    const execution = readJson(path.join(ROOT, roundNo, "execution-trace.json"));
    const roundTdi = (readJson(path.join(ROOT, roundNo, "tdi-decisions.json")) as { records?: TdiRow[] })?.records ?? [];
    return {
      roundNo: Number(roundNo),
      scannerCount: scanner?.totalScanned ?? scanner?.symbolCount ?? null,
      candidateCount: aiProgress?.candidates?.length ?? decisionTrace?.decisions?.length ?? null,
      tdiApproved: roundTdi.filter((r) => r.verdict === "APPROVED").length,
      tdiWait: roundTdi.filter((r) => r.verdict === "WAIT").length,
      tdiRejected: roundTdi.filter((r) => r.verdict === "REJECTED").length,
      executionReady: execution?.records?.length ?? 0,
      aiInvoked: aiProgress?.candidates?.length ?? 0,
      riskSizingRows: riskSizing?.records?.length ?? 0,
      orders: execution?.records?.filter((r: { action?: string }) => r.action === "ORDER")?.length ?? 0,
      summary,
    };
  });

  const out = {
    sessionId,
    capturedAt: new Date().toISOString(),
    tdi: {
      total: tdi.length,
      approved: verdicts.APPROVED ?? 0,
      wait: verdicts.WAIT ?? 0,
      rejected: verdicts.REJECTED ?? 0,
      hybridBuy,
      masterBuy,
      momentumWeak,
      techStrongButOthersWeak: techStrongOthersWeak,
      confidenceLt40,
    },
    rounds: roundSummaries,
  };

  const outPath = path.join(process.cwd(), "kripto-p0-tdi-buy-bottleneck-validation.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main();
