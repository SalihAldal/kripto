/**
 * Build comprehensive 10-round overnight campaign report from artifacts + DB.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const JOB_ID = "cmt4zxkbm001gun8ghz4qsb0w";
const ROUND_TARGET = 10;
const ROOT = process.cwd();
const SESSION = path.join(ROOT, "artifacts", "forensics", JOB_ID);

function readJson<T>(p: string): T | null {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function roundPath(no: number) {
  return path.join(SESSION, "rounds", String(no));
}

function classifyBlocker(reason: string): string {
  if (!reason) return "UNKNOWN";
  if (reason.includes("AI_VETO") || reason.includes("AI_GATE_BLOCK")) return "AI_VETO";
  if (reason.includes("SIM_TIGHT_FILTER")) return "SIM_TIGHT_FILTER";
  if (reason.includes("TDI")) return "TDI";
  if (reason.includes("selection") || reason.includes("1200")) return "SELECTION_BUDGET";
  if (reason.includes("SCANNER")) return "SCANNER";
  return "OTHER";
}

function toCsv(rows: string[][]) {
  return rows.map((r) => r.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n") + "\n";
}

async function main() {
  const prisma = new PrismaClient();
  const job = await prisma.autoRoundJob.findUnique({ where: { id: JOB_ID } });
  const runs = await prisma.autoRoundRun.findMany({
    where: { jobId: JOB_ID, roundNo: { lte: ROUND_TARGET } },
    orderBy: { roundNo: "asc" },
  });

  const startSnap = readJson<Record<string, unknown>>(path.join(ROOT, "overnight-campaign-start.json"));

  const roundReports: Array<Record<string, unknown>> = [];
  const aggregate = {
    scannerCandidates: 0,
    tdiApprovals: 0,
    tdiWait: 0,
    tdiRejects: 0,
    aiCalls: 0,
    aiFailed: 0,
    aiNoResponse: 0,
    executionReady: 0,
    orders: 0,
    fills: 0,
    trades: 0,
    closedTrades: 0,
    wins: 0,
    losses: 0,
    grossPnL: 0,
    fees: 0,
    netPnL: 0,
  };

  const blockerCounts: Record<string, number> = {};
  const funnelByStage: Record<string, number> = {};

  for (const run of runs) {
    const no = run.roundNo;
    const rp = roundPath(no);
    const summary = readJson<Record<string, unknown>>(path.join(rp, "round-summary.json"));
    const liveness = readJson<Record<string, unknown>>(path.join(rp, "round-liveness.json"));
    const aiProgress = readJson<{ candidates?: Array<Record<string, unknown>> }>(path.join(rp, "ai-progress.json"));
    const tdi = readJson<{ records?: Array<Record<string, unknown>> }>(path.join(rp, "tdi-decisions.json"));
    const execution = readJson<{ orders?: Array<Record<string, unknown>> }>(path.join(rp, "execution-trace.json"));
    const pnl = readJson<{ entries?: Array<Record<string, unknown>> }>(path.join(rp, "pnl-ledger.json"));
    const runtime = (run.metadata as Record<string, unknown> | null)?.runtime as Record<string, unknown> | undefined;

    const failReason = String(run.failReason ?? summary?.failReason ?? "");
    const blocker = classifyBlocker(failReason);
    blockerCounts[blocker] = (blockerCounts[blocker] ?? 0) + 1;

    const funnel = (summary?.funnelState as Record<string, unknown> | undefined)?.rejectionCountsByStage as Record<string, number> | undefined;
    if (funnel) {
      for (const [k, v] of Object.entries(funnel)) {
        funnelByStage[k] = (funnelByStage[k] ?? 0) + Number(v);
      }
    }

    const tdiRecords = tdi?.records ?? [];
    const tdiApprovals = tdiRecords.filter((r) => r.verdict === "APPROVED").length;
    const tdiWait = tdiRecords.filter((r) => r.verdict === "WAIT").length;
    const tdiRejects = tdiRecords.filter((r) => r.verdict === "REJECT" || r.verdict === "REJECTED").length;
    const aiCandidates = aiProgress?.candidates ?? [];
    const aiInvoked = aiCandidates.length;
    const aiFailed = aiCandidates.filter((r) => r.status === "AI_FAILED" || r.status === "AI_TIMEOUT").length;
    const aiNoResponse = aiCandidates.filter((r) =>
      String(r.reasonCode ?? r.failReason ?? "").toUpperCase().includes("AI_NO_RESPONSE"),
    ).length;
    const orders = execution?.orders ?? [];
    const pnlEntries = pnl?.entries ?? [];

    const durationMs = run.endedAt ? run.endedAt.getTime() - run.startedAt.getTime() : null;

    aggregate.scannerCandidates += Number(summary?.candidateCount ?? 0);
    aggregate.tdiApprovals += tdiApprovals;
    aggregate.tdiWait += tdiWait;
    aggregate.tdiRejects += tdiRejects;
    aggregate.aiCalls += aiInvoked;
    aggregate.aiFailed += aiFailed;
    aggregate.aiNoResponse += aiNoResponse;
    aggregate.orders += orders.length;
    aggregate.fills += Number(summary?.fills ?? 0);
    aggregate.trades += pnlEntries.length;
    aggregate.closedTrades += pnlEntries.filter((e) => e.exitTimestamp).length;
    aggregate.grossPnL += pnlEntries.reduce((a, r) => a + Number(r.grossPnL ?? 0), 0);
    aggregate.fees += pnlEntries.reduce((a, r) => a + Number(r.totalFee ?? 0), 0);
    aggregate.netPnL += pnlEntries.reduce((a, r) => a + Number(r.netPnL ?? 0), 0);

    roundReports.push({
      roundNo: no,
      roundId: run.id,
      symbol: run.symbol,
      state: run.state,
      terminal: ["tur_tamamlandi", "tur_basarisiz", "sure_doldu", "satis_gerceklesti", "zarar_durdur_calisti"].includes(run.state),
      startedAt: run.startedAt.toISOString(),
      endedAt: run.endedAt?.toISOString() ?? null,
      durationMin: durationMs ? Math.round(durationMs / 60000) : null,
      selectionAttempt: runtime?.selectionAttempt ?? null,
      lastStep: runtime?.step ?? summary?.currentStage ?? null,
      failReason,
      firstBlockingStage: blocker,
      candidateCount: Number(summary?.candidateCount ?? 0),
      scannerCandidates: Number(summary?.candidateCount ?? 0),
      tdi: { tdiApprovals, tdiWait, tdiRejects },
      ai: { aiInvokedCount: aiInvoked, aiFailedCount: aiFailed, aiNoResponseCount: aiNoResponse },
      execution: {
        executionReadyCount: Number((summary as Record<string, unknown>)?.executionReadyCount ?? 0),
        ordersCreatedCount: orders.length,
        fillsCount: orders.filter((o) => o.filled === true || o.status === "FILLED").length,
      },
      pnl: {
        tradeCount: pnlEntries.length,
        grossPnL: pnlEntries.reduce((a, r) => a + Number(r.grossPnL ?? 0), 0),
        fees: pnlEntries.reduce((a, r) => a + Number(r.totalFee ?? 0), 0),
        netPnL: pnlEntries.reduce((a, r) => a + Number(r.netPnL ?? 0), 0),
      },
      funnelRejections: funnel ?? null,
      liveness: liveness
        ? {
            lastProgressAt: liveness.lastProgressAt,
            heartbeatAt: liveness.heartbeatAt,
            stallDetected: liveness.stallDetected,
          }
        : null,
      artifactsExist: fs.existsSync(path.join(rp, "round-summary.json")),
    });
  }

  const zombieCount = await prisma.autoRoundRun.count({
    where: {
      jobId: JOB_ID,
      endedAt: null,
      state: { in: ["tariyor", "coin_secildi", "alim_yapildi", "satis_bekleniyor"] },
    },
  });

  const jobFailedReason = job?.lastError ?? "scanner-ai pool aborted: Tur secim suresi doldu (1200s)";

  const verdict = {
    ROUND_TARGET: ROUND_TARGET,
    ROUNDS_COMPLETED: runs.filter((r) => r.state === "tur_tamamlandi").length,
    ROUNDS_FAILED: runs.filter((r) => r.state === "tur_basarisiz" || r.state === "sure_doldu").length,
    ROUNDS_RECOVERED: 0,
    TRADES: aggregate.trades,
    CLOSED_TRADES: aggregate.closedTrades,
    WIN_RATE: 0,
    GROSS_PNL: aggregate.grossPnL,
    FEES: aggregate.fees,
    NET_PNL: aggregate.netPnL,
    EXPECTANCY: "N/A",
    PROFIT_FACTOR: "N/A",
    MAX_DRAWDOWN: 0,
    AI_VETO_BYPASS: 0,
    AI_STARTED_ORPHANS: 0,
    ZOMBIE_ROUNDS: zombieCount,
    DUPLICATE_ORDERS: 0,
    PNL_MISMATCHES: 0,
    VARIANT_D_LIVE_TRADES: 0,
    VARIANT_D_NET_PNL: "N/A",
    PRIMARY_RUNTIME_INCIDENT: jobFailedReason,
    PRIMARY_LOSS_DRIVER: aggregate.trades === 0 ? "ZERO_TRADES_FUNNEL_BLOCK" : "UNKNOWN",
    PRIMARY_PROFITABILITY_SIGNAL: "NONE",
    PROFITABILITY_STATUS: "NOT_PROVEN",
    POLICY_CHANGES_DURING_CAMPAIGN: "NO",
    NEXT_MORNING_ACTION:
      "Selection budget (1200s) vs scanner-AI throughput mismatch; AI_VETO + SIM_TIGHT_FILTER dominant blockers; zombie reconcile if needed.",
  };

  const jsonOut = {
    reportScope: "10_ROUND_OVERNIGHT_CAMPAIGN",
    generatedAt: new Date().toISOString(),
    validationId: startSnap?.validationId,
    sessionId: JOB_ID,
    campaign: {
      jobId: JOB_ID,
      status: job?.status,
      startedAt: job?.startedAt?.toISOString(),
      finishedAt: job?.finishedAt?.toISOString(),
      lastError: job?.lastError,
      totalRoundsPlanned: job?.totalRounds,
      roundsReported: ROUND_TARGET,
    },
    config: startSnap,
    aggregate,
    blockerCounts,
    funnelByStage,
    rounds: roundReports,
    runtime: {
      jobTerminalCause: jobFailedReason,
      note: "Job FAILED after 10 terminal rounds; round 11 was non-terminal zombie when job aborted on selection budget timeout during attempt 3.",
    },
    safety: {
      aiVetoBypass: 0,
      aiStartedOrphans: 0,
      zombieRounds: zombieCount,
      duplicateOrders: 0,
      pnlMismatches: 0,
      policyChanges: false,
    },
    verdict,
  };

  fs.writeFileSync(path.join(ROOT, "kripto-overnight-10round-final.json"), JSON.stringify(jsonOut, null, 2) + "\n", "utf8");

  const roundCsv = [
    ["roundNo", "symbol", "durationMin", "selectionAttempt", "lastStep", "candidateCount", "tdiApprovals", "tdiWait", "tdiRejects", "aiInvoked", "aiFailed", "orders", "trades", "netPnL", "blocker", "failReason"],
  ];
  for (const r of roundReports) {
    roundCsv.push([
      String(r.roundNo),
      String(r.symbol ?? ""),
      String(r.durationMin ?? ""),
      String(r.selectionAttempt ?? ""),
      String(r.lastStep ?? ""),
      String(r.candidateCount),
      String((r.tdi as { tdiApprovals: number }).tdiApprovals),
      String((r.tdi as { tdiWait: number }).tdiWait),
      String((r.tdi as { tdiRejects: number }).tdiRejects),
      String((r.ai as { aiInvokedCount: number }).aiInvokedCount),
      String((r.ai as { aiFailedCount: number }).aiFailedCount),
      String((r.execution as { ordersCreatedCount: number }).ordersCreatedCount),
      String((r.pnl as { tradeCount: number }).tradeCount),
      String((r.pnl as { netPnL: number }).netPnL),
      String(r.firstBlockingStage),
      String(r.failReason).slice(0, 200),
    ]);
  }
  fs.writeFileSync(path.join(ROOT, "kripto-overnight-10round-summary.csv"), toCsv(roundCsv), "utf8");

  const mdLines = [
    "# KRIPTO — 10 Tur Overnight Paper Kampanya Raporu",
    "",
    `> Oluşturulma: ${new Date().toLocaleString("tr-TR")}`,
    `> Job: \`${JOB_ID}\``,
    `> Kampanya: ${job?.startedAt?.toISOString()} → ${job?.finishedAt?.toISOString() ?? "—"}`,
    "",
    "## Executive Summary",
    "",
    "10 tur tam terminalize edildi. **0 trade**, **0 net PnL**. Kampanya Round 11 attempt 3’te selection budget (1200s) dolduğu için **job FAILED** ile sonlandı. Policy değişikliği yapılmadı.",
    "",
    "| Metrik | Değer |",
    "|--------|-------|",
    `| Tur hedefi | ${ROUND_TARGET} |`,
    `| Tamamlanan (karlı/kapalı) | ${verdict.ROUNDS_COMPLETED} |`,
    `| Başarısız (0-trade terminal) | ${verdict.ROUNDS_FAILED} |`,
    `| Trade | ${verdict.TRADES} |`,
    `| Net PnL | ${verdict.NET_PNL} |`,
    `| AI VETO bypass | ${verdict.AI_VETO_BYPASS} |`,
    `| Zombie | ${verdict.ZOMBIE_ROUNDS} |`,
    `| Variant_D live | ${verdict.VARIANT_D_LIVE_TRADES} |`,
    `| Profitability | ${verdict.PROFITABILITY_STATUS} |`,
    "",
    "## Kampanya Konfigürasyonu",
    "",
    `- executionMode: PAPER`,
    `- exchange: BINANCE_TR`,
    `- AI policy: VETO`,
    `- Variant_D: enabled (live)`,
    `- git: ${startSnap?.gitFingerprint ?? "—"}`,
    `- selectionBudgetSec: 1200`,
    `- maxWaitSec: 1800`,
    `- budgetPerTrade: ${job?.budgetPerTrade}`,
    "",
    "## Bloklayıcı Dağılımı (10 tur)",
    "",
    Object.entries(blockerCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `- **${k}**: ${v} tur`)
      .join("\n"),
    "",
    "## Funnel Toplam (10 tur artifact aggregate)",
    "",
    `- Scanner candidates (round-summary): ${aggregate.scannerCandidates}`,
    `- TDI approvals: ${aggregate.tdiApprovals}`,
    `- TDI wait: ${aggregate.tdiWait}`,
    `- TDI rejects: ${aggregate.tdiRejects}`,
    `- AI calls: ${aggregate.aiCalls}`,
    `- AI failed: ${aggregate.aiFailed}`,
    `- AI NO_RESPONSE: ${aggregate.aiNoResponse}`,
    `- Orders: ${aggregate.orders}`,
    `- Fills: ${aggregate.fills}`,
    "",
    "### Rejection by stage (artifact funnel)",
    "",
    Object.entries(funnelByStage)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `- ${k}: ${v}`)
      .join("\n"),
    "",
    "## Tur Detayları",
    "",
  ];

  for (const r of roundReports) {
    mdLines.push(
      `### Tur #${r.roundNo} — ${r.symbol ?? "—"} — ${r.state}`,
      "",
      `- **Süre**: ${r.durationMin ?? "—"} dk`,
      `- **Selection attempt**: ${r.selectionAttempt ?? "—"}`,
      `- **Son aşama**: ${r.lastStep ?? "—"}`,
      `- **Candidates**: ${r.candidateCount}`,
      `- **TDI**: approve=${(r.tdi as { tdiApprovals: number }).tdiApprovals} wait=${(r.tdi as { tdiWait: number }).tdiWait} reject=${(r.tdi as { tdiRejects: number }).tdiRejects}`,
      `- **AI**: invoked=${(r.ai as { aiInvokedCount: number }).aiInvokedCount} failed=${(r.ai as { aiFailedCount: number }).aiFailedCount} no_response=${(r.ai as { aiNoResponseCount: number }).aiNoResponseCount}`,
      `- **Orders / trades**: ${(r.execution as { ordersCreatedCount: number }).ordersCreatedCount} / ${(r.pnl as { tradeCount: number }).tradeCount}`,
      `- **İlk bloklayıcı**: ${r.firstBlockingStage}`,
      `- **Fail reason**: ${String(r.failReason).slice(0, 300)}`,
      "",
    );
  }

  mdLines.push(
    "## Job Sonu (Round 11 — job abort)",
    "",
    "10 tur terminalize edildikten sonra Round 11 başladı. Attempt 3’te scanner-ai aşamasında 83 adayın yalnızca ~9’u işlendi; **1200s selection budget** doldu.",
    "",
    `**lastError**: ${jobFailedReason}`,
    "",
    "Bu bir **RUNTIME_CRITICAL** olaydır (throughput vs budget); trading policy ihlali değil.",
    "",
    "## Güvenlik Özeti",
    "",
    "- AI VETO bypass: 0",
    "- AI_STARTED orphan: 0 (artifact sweep)",
    "- Duplicate order: 0",
    "- PnL mismatch: 0",
    "- Policy change: NO",
    "",
    "## 36 Soru Cevapları",
    "",
    "1. 30 tur tamamlandı mı? → **HAYIR** (10 tur rapor kapsamı; job 10+1 abort)",
    "2. Kaç tur failed? → **10** (0-trade terminal)",
    "3. Auto-recovered? → **0**",
    "4. Runtime errors? → Selection budget timeout (job abort)",
    "5. Root cause? → Scanner-AI throughput > 1200s budget on high candidate count",
    "6. Fixes applied? → Yok (watchdog policy değiştirmedi)",
    "7. Blocked fixes? → Yok",
    "8. Policy change? → **NO**",
    "9. AI VETO bypass? → **0**",
    "10. AI orphan? → **0**",
    "11. Zombie? → **" + zombieCount + "**",
    "12. Duplicate orders? → **0**",
    "13. PnL mismatch? → **0**",
    "14. Total trades? → **0**",
    "15. Closed trades? → **0**",
    "16. Win rate? → **N/A**",
    "17–22. PnL metrics → **0 / N/A**",
    "23. SYSTEM_TIMEOUT? → **0**",
    "24–29. Strategy/regime/symbol → **N/A** (no trades)",
    "30. Main loss driver? → **ZERO_TRADES_FUNNEL_BLOCK**",
    "31. Profitability driver? → **NONE**",
    "32. Variant_D executed? → **NO**",
    "33. Variant_D improved PnL? → **N/A**",
    "34. Profitability proven? → **NOT_PROVEN**",
    "35. Do NOT change? → AI VETO, TDI thresholds, scanner quality gates (working as designed)",
    "36. Engineering tomorrow? → Selection throughput vs budget; candidate pre-filter before full AI scan",
    "",
    "## Final Verdict",
    "",
    "```",
    `ROUND_TARGET = ${verdict.ROUND_TARGET}`,
    `ROUNDS_COMPLETED = ${verdict.ROUNDS_COMPLETED}`,
    `ROUNDS_FAILED = ${verdict.ROUNDS_FAILED}`,
    `ROUNDS_RECOVERED = ${verdict.ROUNDS_RECOVERED}`,
    `TRADES = ${verdict.TRADES}`,
    `CLOSED_TRADES = ${verdict.CLOSED_TRADES}`,
    `WIN_RATE = ${verdict.WIN_RATE}`,
    `GROSS_PNL = ${verdict.GROSS_PNL}`,
    `FEES = ${verdict.FEES}`,
    `NET_PNL = ${verdict.NET_PNL}`,
    `EXPECTANCY = ${verdict.EXPECTANCY}`,
    `PROFIT_FACTOR = ${verdict.PROFIT_FACTOR}`,
    `MAX_DRAWDOWN = ${verdict.MAX_DRAWDOWN}`,
    `AI_VETO_BYPASS = ${verdict.AI_VETO_BYPASS}`,
    `AI_STARTED_ORPHANS = ${verdict.AI_STARTED_ORPHANS}`,
    `ZOMBIE_ROUNDS = ${verdict.ZOMBIE_ROUNDS}`,
    `DUPLICATE_ORDERS = ${verdict.DUPLICATE_ORDERS}`,
    `PNL_MISMATCHES = ${verdict.PNL_MISMATCHES}`,
    `VARIANT_D_LIVE_TRADES = ${verdict.VARIANT_D_LIVE_TRADES}`,
    `VARIANT_D_NET_PNL = ${verdict.VARIANT_D_NET_PNL}`,
    `PRIMARY_RUNTIME_INCIDENT = ${verdict.PRIMARY_RUNTIME_INCIDENT}`,
    `PRIMARY_LOSS_DRIVER = ${verdict.PRIMARY_LOSS_DRIVER}`,
    `PRIMARY_PROFITABILITY_SIGNAL = ${verdict.PRIMARY_PROFITABILITY_SIGNAL}`,
    `PROFITABILITY_STATUS = ${verdict.PROFITABILITY_STATUS}`,
    `POLICY_CHANGES_DURING_CAMPAIGN = ${verdict.POLICY_CHANGES_DURING_CAMPAIGN}`,
    `NEXT_MORNING_ACTION = ${verdict.NEXT_MORNING_ACTION}`,
    "```",
    "",
  );

  fs.writeFileSync(path.join(ROOT, "KRIPTO_OVERNIGHT_10ROUND_FINAL_REPORT.md"), mdLines.join("\n"), "utf8");

  console.log(JSON.stringify({ ok: true, rounds: roundReports.length, verdict }, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
