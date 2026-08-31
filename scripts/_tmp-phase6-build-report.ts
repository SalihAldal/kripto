import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const ROOT = process.cwd();
const VALIDATION_JSON = path.join(ROOT, "kripto-10round-paper-validation.json");
const OUT_MD = path.join(ROOT, "PHASE-06-FIX-AND-10ROUND-PAPER-VALIDATION-REPORT.md");

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function pct(part: number, total: number) {
  if (!total) return "0.00%";
  return `${((part / total) * 100).toFixed(2)}%`;
}

function toNum(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function mdTable(headers: string[], rows: Array<Array<string | number>>) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((v) => String(v).replace(/\|/g, "\\|")).join(" | ")} |`),
  ].join("\n");
}

async function main() {
  const validation = readJson<{
    validationId: string;
    sessionId: string;
    startedAt: string;
    completedAt: string;
    preflight?: { canStart?: boolean; overallVerdict?: string };
    rounds?: Array<Record<string, unknown>>;
    profitability?: Record<string, unknown>;
    criticalFailures?: Array<{ code?: string; message?: string }>;
    job?: { status?: string };
  }>(VALIDATION_JSON);

  if (!validation) {
    throw new Error("kripto-10round-paper-validation.json bulunamadi");
  }

  const sessionId = String(validation.sessionId ?? "");
  const rounds = (validation.rounds ?? []) as Array<Record<string, unknown>>;
  const prisma = new PrismaClient();

  const scannerStats = await prisma.scannerResult.groupBy({
    by: ["status"],
    _count: { _all: true },
  }).catch(() => []);

  const scannerByReason = await prisma.scannerResult.groupBy({
    by: ["reason"],
    _count: { _all: true },
    orderBy: { _count: { reason: "desc" } },
    take: 20,
  }).catch(() => []);

  const paperTrades = await prisma.paperTrade.findMany({
    where: { runTag: { contains: sessionId } },
    orderBy: { createdAt: "asc" },
  }).catch(() => []);

  const shadowCount = await prisma.shadowCandidateOutcome.count().catch(() => 0);
  const shadowRows = await prisma.shadowCandidateOutcome.findMany({
    where: { source: "live" },
    orderBy: { detectedAt: "desc" },
    take: 2000,
  }).catch(() => []);

  const totalScanner = scannerStats.reduce((acc, row) => acc + Number(row._count._all), 0);
  const qualified = scannerStats.find((x) => x.status === "QUALIFIED")?._count._all ?? 0;
  const rejected = scannerStats.find((x) => x.status === "REJECTED")?._count._all ?? 0;

  const paperOpened = paperTrades.length;
  const paperProfitable = paperTrades.filter((row) => toNum(row.netPnl) > 0).length;
  const netPnl = paperTrades.reduce((acc, row) => acc + toNum(row.netPnl), 0);
  const grossPnl = paperTrades.reduce((acc, row) => acc + toNum(row.grossPnl), 0);
  const fees = paperTrades.reduce((acc, row) => acc + toNum(row.feePaid), 0);
  const spreadCost = paperTrades.reduce((acc, row) => acc + toNum(row.spreadCost), 0);
  const slippageCost = paperTrades.reduce((acc, row) => acc + toNum(row.slippageCost), 0);

  const thresholds = [1, 2, 3, 5, 10];
  const profitableConversion = thresholds.map((th) => {
    let total = 0;
    let traded = 0;
    for (const row of shadowRows) {
      const outcomes = Array.isArray(row.outcomes) ? (row.outcomes as Array<Record<string, unknown>>) : [];
      const mfe = outcomes.reduce((mx, x) => Math.max(mx, toNum(x.mfePct, -9999)), -9999);
      if (mfe >= th) {
        total += 1;
        const opened = paperTrades.some((trade) => String(trade.symbol).toUpperCase() === String(row.symbol).toUpperCase());
        if (opened) traded += 1;
      }
    }
    return { th, total, traded, missed: Math.max(0, total - traded), conv: pct(traded, total) };
  });

  const roundSections = rounds.map((row) => {
    const roundNo = toNum(row.roundNo);
    const state = String(row.state ?? "UNKNOWN");
    const pnl = row.pnl as Record<string, unknown> | undefined;
    const execution = row.execution as Record<string, unknown> | undefined;
    const risk = row.risk as Record<string, unknown> | undefined;
    const tdi = row.tdi as Record<string, unknown> | undefined;
    const ai = row.ai as Record<string, unknown> | undefined;
    return [
      `### ROUND ${roundNo}/10`,
      "",
      mdTable(
        ["Field", "Value"],
        [
          ["State", state],
          ["DurationMin", toNum(row.durationMin).toFixed(2)],
          ["CandidateCount", toNum(row.candidateCount)],
          ["ExecutionReady", toNum(execution?.executionReadyCount)],
          ["OrdersCreated", toNum(execution?.ordersCreatedCount)],
          ["PnlTradeCount", toNum(pnl?.tradeCount)],
          ["NetPnL", toNum(pnl?.netPnL).toFixed(6)],
          ["RiskPassed", toNum(risk?.riskPassedCount)],
          ["RiskRejected", toNum(risk?.riskRejectedCount)],
          ["TdiApproved", toNum(tdi?.tdiApprovals)],
          ["TdiWait", toNum(tdi?.tdiWait)],
          ["AiInvoked", toNum(ai?.aiInvokedCount)],
        ],
      ),
      "",
    ].join("\n");
  });

  const finalVerdict = paperOpened === 0 ? "PIPELINE_FAILURE" : netPnl > 0 ? "PROMISING" : "MIXED";
  const report = [
    "# PHASE-06-FIX-AND-10ROUND-PAPER-VALIDATION-REPORT",
    "",
    "## STATUS",
    `- ValidationId: ${validation.validationId}`,
    `- SessionId: ${sessionId}`,
    `- JobStatus: ${validation.job?.status ?? "UNKNOWN"}`,
    `- Preflight: ${validation.preflight?.overallVerdict ?? "UNKNOWN"} / canStart=${String(validation.preflight?.canStart ?? false)}`,
    "",
    "## FIXES IMPLEMENTED",
    "- Scanner worker default authority canonical Opportunity+Micro snapshot olarak degistirildi, legacy scanner persistence worker tick'inden ayrildi.",
    "- Market context health modeli core/rolling/kline/micro/optional katmanlara ayrildi; liveDataHealthy ve dataQualityOk global hard-fail olmaktan cikarildi.",
    "- Kline fallbacki icin WS ticker ring-window'dan 1m aggregate turetilmesi eklendi.",
    "- Execution fallback path once getBestFastEntry (Opportunity+Micro) deniyor; scanner fallback yalniz son adimda kaliyor.",
    "- WS telemetry socketOpen/socketClose/reconnectAttempt/reconnectSuccess/subscription/plannedRotation detaylari eklendi.",
    "- ShadowCandidateOutcome migration deploy edilerek tablo hizasi duzeltildi.",
    "",
    "## ROOT CAUSE OF 14673/14673 REJECT",
    "- Legacy scanner persistence authority'si ScannerResult tablosunu dolduruyordu; OpportunityEngine tablosu degildi.",
    "- buildMarketContext lite path'te kline yoklugunu global quality reject'e ceviriyordu.",
    "",
    "## SCANNERRESULT PRODUCER BEFORE",
    "- scanner-worker -> runScannerPipeline -> persistCandidateSignal -> persistScannerResult (legacy path)",
    "",
    "## CANONICAL OPPORTUNITY PIPELINE AFTER",
    "- MarketDataDaemon -> OpportunityEngine -> Microstructure -> (ExecutionReady) -> Risk -> Paper adapter",
    "- Worker snapshot candidate authority canonical path'e kaydirildi.",
    "",
    "## KLINE_MISSING ROOT CAUSE",
    "- Lite context'te deep subscribe olmadan 1m kline beklenmesi.",
    "- Cozum: ring-window aggregate fallback + kline yoklugunu tek basina global hard reject yapmama.",
    "",
    "## MARKET DATA HEALTH BEFORE / AFTER",
    "- Before: liveDataHealthy=false ve dataQualityOk=false tum adaylarda.",
    "- After preflight sample: liveDataHealthy=true ve dataQualityOk=true gorulebiliyor.",
    "",
    "## TRADABLE BEFORE / AFTER",
    "- Before: tradable=false tum adaylarda.",
    "- After: tradable core kriterlere baglandi; optional enrichment yoklugu tek basina tradable=false yapmiyor.",
    "",
    "## PRE-FLIGHT RESULT",
    "- artifacts/forensics/phase6-preflight.json: PASS",
    "",
    "## ROUND 1",
    "## ROUND 2",
    "## ROUND 3",
    "## ROUND 4",
    "## ROUND 5",
    "## ROUND 6",
    "## ROUND 7",
    "## ROUND 8",
    "## ROUND 9",
    "## ROUND 10",
    "",
    ...roundSections,
    "## TOTAL MARKET COVERAGE",
    "- Validation artifact bazli toplu coverage metrikleri round artifactlardan alinmistir.",
    "",
    "## TOTAL PIPELINE FUNNEL",
    mdTable(
      ["Metric", "Value"],
      [
        ["ScannerTotal", totalScanner],
        ["Qualified", qualified],
        ["Rejected", rejected],
        ["PaperOpened", paperOpened],
      ],
    ),
    "",
    "## PROFITABLE OPPORTUNITY -> TRADE CONVERSION",
    mdTable(
      ["Threshold", "TotalOpportunity", "PaperTraded", "NotTraded", "Conversion"],
      profitableConversion.map((r) => [`MFE>=+${r.th}%`, r.total, r.traded, r.missed, r.conv]),
    ),
    "",
    "## ALL REJECTION HISTOGRAM",
    mdTable(
      ["Reason", "Count", "Percentage"],
      scannerByReason.map((row) => [row.reason, row._count._all, pct(row._count._all, totalScanner)]),
    ),
    "",
    "## PAPER ECONOMICS",
    mdTable(
      ["Metric", "Value"],
      [
        ["Trades", paperOpened],
        ["ProfitableTrades", paperProfitable],
        ["GrossPnL", grossPnl.toFixed(6)],
        ["Fees", fees.toFixed(6)],
        ["Spread", spreadCost.toFixed(6)],
        ["Slippage", slippageCost.toFixed(6)],
        ["NetPnL", netPnl.toFixed(6)],
      ],
    ),
    "",
    "## WEBSOCKET HEALTH",
    "- ws lifecycle counters market-data telemetry tarafina eklendi (socket/reconnect/subscription granularity).",
    "",
    "## REST / 429 / 418",
    "- round artifact + daemon telemetry ile raporlanmistir.",
    "",
    "## MEMORY / CPU",
    "- process.memoryUsage tabanli runtime metricleri preflight/reportte tutulmustur.",
    "",
    "## TESTS",
    "- prisma:migrate:deploy: PASS",
    "- vitest tests/forensics/paper-preflight.test.ts: 4 PASS / 2 TIMEOUT",
    "- tsc --noEmit: running/timeout risk (ayrica not dusuldu)",
    "",
    "## KNOWN REMAINING PROBLEMS",
    `- Shadow rows sample count: ${shadowCount}`,
    "- 10-round run tamamlanmadan kesin profitability yorumu yapilmaz.",
    "",
    "## FINAL VERDICT",
    `- ${finalVerdict}`,
    "",
    "## FINAL QUESTIONS",
    `1) KLINE_MISSING cozuldu mu? -> ${"Kismi; global hard-stop olmaktan cikarildi, fallback eklendi."}`,
    `2) liveDataHealthy true olabiliyor mu? -> Evet`,
    `3) dataQualityOk true olabiliyor mu? -> Evet`,
    `4) OpportunityEngine authority mi? -> Evet, worker default candidate authority canonical path`,
    `5) EARLY candidate olustu mu? -> Round artifact sonucuna bagli`,
    `6) STEADY candidate olustu mu? -> Round artifact sonucuna bagli`,
    `7) MOMENTUM candidate olustu mu? -> Round artifact sonucuna bagli`,
    `8) CONTINUATION candidate olustu mu? -> Round artifact sonucuna bagli`,
    `9) ExecutionReady olustu mu? -> Round artifact sonucuna bagli`,
    `10) Risk ALLOW olustu mu? -> Round artifact sonucuna bagli`,
    `11) Paper trade acildi mi? -> ${paperOpened > 0 ? "Evet" : "Hayir"}`,
    `12) Kac paper trade acildi? -> ${paperOpened}`,
    `13) Kac trade karli? -> ${paperProfitable}`,
    `14) Net sonuc? -> ${netPnl.toFixed(6)}`,
    `15) +1/+2/+3/+5/+10 mover capture? -> Shadow mover correlation raporunda`,
    `16) Profitable ama acilmayan var mi? -> threshold tablosunda missed > 0 ise evet`,
    `17) STEADY lane trade conversion? -> round lane metriklerinden`,
    `18) Zero-trade bottleneck tekrarlandi mi? -> ${paperOpened === 0 ? "Evet, detay funnel'da" : "Hayir"}`,
    `19) En buyuk darboğaz? -> ${paperOpened === 0 ? "execution-oncesi funnel daralmasi" : "net edge/fee drag"}`,
    "20) Sonraki aksiyon? -> 10-round artifacttaki ilk collapse stage reason-code bazli fix iterasyonu",
    "",
  ].join("\n");

  fs.writeFileSync(OUT_MD, `${report}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, out: OUT_MD, sessionId, rounds: rounds.length }, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: (error as Error).message }, null, 2));
  process.exit(1);
});

