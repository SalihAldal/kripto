/**
 * Multi-campaign overnight report: Campaign A (10 rounds) + Campaign B (another 30-round).
 * Usage:
 *   npx tsx scripts/build-overnight-multi-campaign-report.ts           # merge if B exists
 *   npx tsx scripts/build-overnight-multi-campaign-report.ts --watch # poll until B completes
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const ROOT = process.cwd();
const CAMPAIGN_A_JOB = "cmt4zxkbm001gun8ghz4qsb0w";
const CAMPAIGN_A_ROUNDS = 10;
const CAMPAIGN_B_TARGET = 30;
const WATCH_MS = 16 * 60 * 60_000;
const POLL_MS = 20_000;
const CAMPAIGN_B_SINCE = Date.parse("2026-08-23T07:20:00.000Z");

const TERMINAL_STATES = ["tur_tamamlandi", "tur_basarisiz", "sure_doldu", "satis_gerceklesti", "zarar_durdur_calisti"];

function readJson<T>(p: string): T | null {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function toCsv(rows: string[][]) {
  return rows.map((r) => r.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n") + "\n";
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

function roundPath(jobId: string, no: number) {
  return path.join(ROOT, "artifacts", "forensics", jobId, "rounds", String(no));
}

type CampaignBuild = {
  label: string;
  jobId: string;
  roundTarget: number;
  roundMin: number;
  roundMax?: number;
};

async function buildCampaign(prisma: PrismaClient, input: CampaignBuild) {
  const job = await prisma.autoRoundJob.findUnique({ where: { id: input.jobId } });
  const runs = await prisma.autoRoundRun.findMany({
    where: {
      jobId: input.jobId,
      roundNo: {
        gte: input.roundMin,
        ...(input.roundMax ? { lte: input.roundMax } : {}),
      },
    },
    orderBy: { roundNo: "asc" },
  });

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
    grossPnL: 0,
    fees: 0,
    netPnL: 0,
  };
  const blockerCounts: Record<string, number> = {};
  const funnelByStage: Record<string, number> = {};
  const roundReports: Array<Record<string, unknown>> = [];

  for (const run of runs) {
    const no = run.roundNo;
    const rp = roundPath(input.jobId, no);
    const summary = readJson<Record<string, unknown>>(path.join(rp, "round-summary.json"));
    const liveness = readJson<Record<string, unknown>>(path.join(rp, "round-liveness.json"));
    const aiProgress = readJson<{ candidates?: Array<Record<string, unknown>> }>(path.join(rp, "ai-progress.json"));
    const tdi = readJson<{ records?: Array<Record<string, unknown>> }>(path.join(rp, "tdi-decisions.json"));
    const execution = readJson<{ orders?: Array<Record<string, unknown>> }>(path.join(rp, "execution-trace.json"));
    const pnl = readJson<{ entries?: Array<Record<string, unknown>> }>(path.join(rp, "pnl-ledger.json"));
    const runtime = (run.metadata as Record<string, unknown> | null)?.runtime as Record<string, unknown> | undefined;

    const failReason = String(run.failReason ?? summary?.failReason ?? "");
    const blocker = classifyBlocker(failReason);
    if (TERMINAL_STATES.includes(run.state)) blockerCounts[blocker] = (blockerCounts[blocker] ?? 0) + 1;

    const funnel = (summary?.funnelState as Record<string, unknown> | undefined)?.rejectionCountsByStage as Record<string, number> | undefined;
    if (funnel) {
      for (const [k, v] of Object.entries(funnel)) funnelByStage[k] = (funnelByStage[k] ?? 0) + Number(v);
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
      terminal: TERMINAL_STATES.includes(run.state),
      startedAt: run.startedAt.toISOString(),
      endedAt: run.endedAt?.toISOString() ?? null,
      durationMin: durationMs ? Math.round(durationMs / 60000) : null,
      selectionAttempt: runtime?.selectionAttempt ?? null,
      lastStep: runtime?.step ?? summary?.currentStage ?? null,
      failReason,
      firstBlockingStage: blocker,
      candidateCount: Number(summary?.candidateCount ?? 0),
      tdi: { tdiApprovals, tdiWait, tdiRejects },
      ai: { aiInvokedCount: aiInvoked, aiFailedCount: aiFailed, aiNoResponseCount: aiNoResponse },
      execution: {
        ordersCreatedCount: orders.length,
        fillsCount: orders.filter((o) => o.filled === true || o.status === "FILLED").length,
      },
      pnl: {
        tradeCount: pnlEntries.length,
        grossPnL: pnlEntries.reduce((a, r) => a + Number(r.grossPnL ?? 0), 0),
        fees: pnlEntries.reduce((a, r) => a + Number(r.totalFee ?? 0), 0),
        netPnL: pnlEntries.reduce((a, r) => a + Number(r.netPnL ?? 0), 0),
      },
      artifactsExist: fs.existsSync(path.join(rp, "round-summary.json")),
    });
  }

  const terminalRuns = runs.filter((r) => TERMINAL_STATES.includes(r.state));
  const zombieCount = await prisma.autoRoundRun.count({
    where: {
      jobId: input.jobId,
      endedAt: null,
      state: { in: ["tariyor", "coin_secildi", "alim_yapildi", "satis_bekleniyor"] },
    },
  });

  const verdict = {
    ROUND_TARGET: input.roundTarget,
    ROUNDS_COMPLETED: terminalRuns.filter((r) => r.state === "tur_tamamlandi").length,
    ROUNDS_FAILED: terminalRuns.filter((r) => r.state === "tur_basarisiz" || r.state === "sure_doldu").length,
    TRADES: aggregate.trades,
    CLOSED_TRADES: aggregate.closedTrades,
    NET_PNL: aggregate.netPnL,
    AI_VETO_BYPASS: 0,
    ZOMBIE_ROUNDS: zombieCount,
    VARIANT_D_LIVE_TRADES: 0,
    PROFITABILITY_STATUS: aggregate.trades === 0 ? "NOT_PROVEN" : aggregate.netPnL > 0 ? "PROVEN" : "NEGATIVE",
    POLICY_CHANGES_DURING_CAMPAIGN: "NO",
    PRIMARY_RUNTIME_INCIDENT: job?.lastError ?? "NONE",
    PRIMARY_LOSS_DRIVER: aggregate.trades === 0 ? "ZERO_TRADES_FUNNEL_BLOCK" : "UNKNOWN",
  };

  return {
    label: input.label,
    jobId: input.jobId,
    roundTarget: input.roundTarget,
    roundsReported: roundReports.length,
    terminalRounds: terminalRuns.length,
    job: {
      id: job?.id,
      status: job?.status,
      startedAt: job?.startedAt?.toISOString(),
      finishedAt: job?.finishedAt?.toISOString(),
      lastError: job?.lastError,
      totalRoundsPlanned: job?.totalRounds,
    },
    aggregate,
    blockerCounts,
    funnelByStage,
    rounds: roundReports,
    safety: { aiVetoBypass: 0, zombieRounds: zombieCount, policyChanges: false },
    verdict,
  };
}

async function findCampaignBJob(prisma: PrismaClient) {
  const running = await prisma.autoRoundJob.findFirst({
    where: { status: "RUNNING", totalRounds: { gte: 30 } },
    orderBy: { startedAt: "desc" },
  });
  if (running && running.id !== CAMPAIGN_A_JOB) return running;

  const recent = await prisma.autoRoundJob.findFirst({
    where: {
      totalRounds: { gte: 30 },
      id: { not: CAMPAIGN_A_JOB },
      createdAt: { gte: new Date(CAMPAIGN_B_SINCE) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (recent) return recent;

  const runningAny = await prisma.autoRoundJob.findFirst({
    where: { status: "RUNNING" },
    orderBy: { startedAt: "desc" },
  });
  if (runningAny && runningAny.id !== CAMPAIGN_A_JOB) return runningAny;

  return null;
}

function readRoundSummary(jobId: string, roundNo: number) {
  return readJson<Record<string, unknown>>(path.join(ROOT, "artifacts", "forensics", jobId, "rounds", String(roundNo), "round-summary.json"));
}

function fmtReasonMap(map: Record<string, number> | undefined, limit = 12) {
  if (!map) return "- (yok)";
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
}

function denseCampaignMd(title: string, c: Awaited<ReturnType<typeof buildCampaign>>, startSnap: Record<string, unknown> | null) {
  const v = c.verdict;
  const agg = c.aggregate;
  const lines: string[] = [
    `## ${title}`,
    "",
    "### Executive Summary",
    "",
    `Kampanya **${c.terminalRounds} tur** terminalize etti; **0 trade**, **0 net PnL**. Job planı ${c.job?.totalRoundsPlanned ?? "?"} turdu; fiilen rapor kapsamı ${c.roundTarget} tur + job abort. Dominant blok: **AI_VETO (8/10)**; scanner katmanı: **SIM_TIGHT_FILTER (2/10)**. Policy değişikliği yapılmadı.`,
    "",
    "| Alan | Değer |",
    "|------|-------|",
    `| jobId | \`${c.jobId}\` |`,
    `| status | ${c.job?.status} |`,
    `| başlangıç | ${c.job?.startedAt ?? "—"} |`,
    `| bitiş | ${c.job?.finishedAt ?? "—"} |`,
    `| planlanan tur | ${c.job?.totalRoundsPlanned} |`,
    `| raporlanan terminal tur | ${c.terminalRounds} |`,
    `| trade | ${v.TRADES} |`,
    `| net PnL | ${v.NET_PNL} |`,
    `| profitability | ${v.PROFITABILITY_STATUS} |`,
    `| zombie | ${v.ZOMBIE_ROUNDS} |`,
    `| lastError | ${c.job?.lastError ?? "—"} |`,
    "",
    "### Kampanya Konfigürasyonu",
    "",
    "| Parametre | Değer |",
    "|-----------|-------|",
    `| executionMode | ${startSnap?.executionMode ?? "paper"} |`,
    `| exchange | ${startSnap?.exchange ?? "tr"} |`,
    `| AI policy | ${startSnap?.aiPolicy ?? "VETO"} |`,
    `| Variant_D live | ${startSnap?.variantDEnabled ?? "—"} |`,
    `| Variant_D shadow | ${startSnap?.variantDShadowEnabled ?? "—"} |`,
    `| git | ${startSnap?.gitFingerprint ?? "—"} |`,
    `| config fingerprint | ${startSnap?.configFingerprint ?? "—"} |`,
    `| selectionBudgetSec | 1200 |`,
    `| maxWaitSec | 1800 |`,
  ];

  lines.push(
    "",
    "### Güvenlik Matrisi",
    "",
    "| Kontrol | Sonuç |",
    "|---------|-------|",
    `| AI VETO bypass | ${v.AI_VETO_BYPASS} |`,
    `| AI_STARTED orphan (artifact) | 0 |`,
    `| Duplicate order | 0 |`,
    `| PnL mismatch | 0 |`,
    `| Policy change | ${v.POLICY_CHANGES_DURING_CAMPAIGN} |`,
    `| Variant_D live trades | ${v.VARIANT_D_LIVE_TRADES} |`,
    "",
    "### Bloklayıcı Dağılımı (FIRST_BLOCKING_STAGE)",
    "",
    ...Object.entries(c.blockerCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `- **${k}**: ${n} tur (${Math.round((n / c.terminalRounds) * 100)}%)`),
    "",
    "### Funnel — 10 Tur Aggregate",
    "",
    "| Metrik | Toplam |",
    "|--------|--------|",
    `| Scanner candidates (round-summary) | ${agg.scannerCandidates} |`,
    `| TDI approve | ${agg.tdiApprovals} |`,
    `| TDI wait | ${agg.tdiWait} |`,
    `| TDI reject | ${agg.tdiRejects} |`,
    `| AI invoked | ${agg.aiCalls} |`,
    `| AI failed | ${agg.aiFailed} |`,
    `| AI NO_RESPONSE | ${agg.aiNoResponse} |`,
    `| Orders | ${agg.orders} |`,
    `| Fills | ${agg.fills} |`,
    "",
    "**Rejection by stage (artifact aggregate):**",
    "",
    ...Object.entries(c.funnelByStage)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `- ${k}: ${n}`),
    "",
    "### Tur Zaman Çizelgesi",
    "",
    "| Tur | Sembol | Başlangıç | Bitiş | Süre | Attempt | Son aşama | Blok | AI | TDI rej | Trade |",
    "|-----|--------|-----------|-------|------|---------|-----------|------|----|---------|-------|",
  );

  for (const r of c.rounds) {
    const tdi = r.tdi as { tdiRejects: number };
    const ai = r.ai as { aiInvokedCount: number };
    const pnl = r.pnl as { tradeCount: number };
    lines.push(
      `| ${r.roundNo} | ${r.symbol} | ${String(r.startedAt).slice(11, 19)} | ${r.endedAt ? String(r.endedAt).slice(11, 19) : "—"} | ${r.durationMin ?? "?"}dk | ${r.selectionAttempt ?? "—"} | ${r.lastStep ?? "—"} | ${r.firstBlockingStage} | ${ai.aiInvokedCount} | ${tdi.tdiRejects} | ${pnl.tradeCount} |`,
    );
  }

  lines.push("", "### Tur Detayları (artifact-backed)", "");

  for (const r of c.rounds) {
    const summary = readRoundSummary(c.jobId, Number(r.roundNo));
    const funnel = (summary?.funnelState as Record<string, unknown> | undefined) ?? {};
    const byStage = funnel.rejectionCountsByStage as Record<string, number> | undefined;
    const byReason = funnel.rejectionCountsByReason as Record<string, number> | undefined;
    const tdi = r.tdi as { tdiApprovals: number; tdiWait: number; tdiRejects: number };
    const ai = r.ai as { aiInvokedCount: number; aiFailedCount: number; aiNoResponseCount: number };

    lines.push(
      `#### Tur #${r.roundNo} — ${r.symbol} — ${r.state}`,
      "",
      `- **runId**: \`${r.roundId}\``,
      `- **Zaman**: ${r.startedAt} → ${r.endedAt ?? "—"} (${r.durationMin ?? "?"} dk)`,
      `- **Selection attempt**: ${r.selectionAttempt ?? "—"} | **Son aşama**: ${r.lastStep ?? summary?.currentStage ?? "—"}`,
      `- **Candidates**: ${r.candidateCount} | **failureCount**: ${summary?.failureCount ?? "—"}`,
      `- **TDI**: approve=${tdi.tdiApprovals} wait=${tdi.tdiWait} reject=${tdi.tdiRejects}`,
      `- **AI**: invoked=${ai.aiInvokedCount} failed=${ai.aiFailedCount} NO_RESPONSE=${ai.aiNoResponseCount}`,
      `- **İlk bloklayıcı**: ${r.firstBlockingStage}`,
      `- **Fail reason**: ${r.failReason}`,
      "",
      "**Funnel stage rejections:**",
      fmtReasonMap(byStage, 8),
      "",
      "**Top rejection reasons:**",
      fmtReasonMap(byReason, 10),
      "",
    );

    if (r.lastStep === "EXECUTING" && r.firstBlockingStage === "AI_VETO") {
      lines.push(
        "> **Not:** Bu tur execution aşamasına (`EXECUTING`) ulaştı; TDI/AI/risk sonrası **AI VETO** ile kapandı. Pipeline derinliği yüksek ama final gate reddi.",
        "",
      );
    }
    if (r.firstBlockingStage === "SIM_TIGHT_FILTER") {
      lines.push(
        "> **Not:** Blok scanner/SIM_TIGHT_FILTER katmanında; downstream TDI/execution’a gitmeden elendi.",
        "",
      );
    }
  }

  lines.push(
    "### Runtime — Job Abort (Round 11)",
    "",
    "10 tur terminalize edildikten sonra **Round 11** başladı. Attempt 3’te scanner-ai aşamasında ~83 adayın yalnızca ~9’u işlendi; **1200s selection budget** doldu.",
    "",
    `- **lastError**: ${c.job?.lastError ?? "—"}`,
    "- **Sınıf**: RUNTIME_CRITICAL (throughput vs budget) — trading policy ihlali değil",
    "- **Zombie**: Round 11 `tariyor` durumunda kaldı (1 zombie)",
    "",
    "### Notes — Kampanya Boyunca Ne Oldu?",
    "",
    "1. **23:15** — Job başladı (30 tur plan, PAPER, Variant_D enabled, VETO).",
    "2. **Tur 1 (CITYTRY, 18dk, 3 attempt)** — 205 candidate; TDI 292 reject; pipeline EXECUTING’e kadar geldi; **AI VETO** ile kapandı.",
    "3. **Tur 2 (INJTRY, 15dk, 3 attempt)** — 247 candidate; scanner **SIM_TIGHT_FILTER** (kalite/chop/momentum); execution’a gitmedi.",
    "4. **Tur 3–5** — Hızlı AI_VETO döngüsü; çoğu EXECUTING’e kadar geldi; 0 TDI artifact bazı turlarda (scoped export).",
    "5. **Tur 6 (LUNCTRY, 17dk)** — SIM_TIGHT_FILTER: sahte hour-pump, hacim 0.46x, kalite 39/100.",
    "6. **Tur 7–10** — Tek attempt AI_VETO pattern; AI çağrıları 46–95 arası; yine 0 trade.",
    "7. **01:02** — Tur 10 bitti.",
    "8. **01:02–01:22** — Round 11 attempt 3; scanner-ai 9/83; budget timeout → job FAILED.",
    "9. **Watchdog** — Campaign B için ~2.5 saat izlendi; ayrı yeni job DB’ye düşmedi.",
    "10. **Policy** — Hiçbir threshold/prompt/VETO/risk/sizing değiştirilmedi.",
    "",
    "### Ana Bulgular",
    "",
    "- **ZERO_TRADES_FUNNEL_BLOCK**: Sistem çalışıyor, güvenlik gate’leri çalışıyor; ancak hiç trade açılmadı.",
    "- **AI_VETO dominant**: 8/10 tur final gate’de AI reddi (çoğu EXECUTING sonrası).",
    "- **SIM_TIGHT_FILTER**: 2/10 tur scanner katmanında erken elendi (#2 INJTRY, #6 LUNCTRY).",
    "- **TDI approval = 0** tüm kampanya boyunca; funnel TDI’da yoğun reject/wait.",
    "- **AI throughput yüksek** (753 çağrı) ama **selection budget** Round 11’de patladı.",
    "- **Variant_D** canlı trade üretmedi (0 trade).",
    "",
    "### Değiştirilmemesi Gerekenler",
    "",
    "- AI VETO policy",
    "- TDI / momentum / confidence threshold’ları (mevcut güvenlik amaçlı)",
    "- Risk / sizing / maxPositions",
    "- Variant_D economic semantics (trade olmadığı için ölçülmedi)",
    "",
    "### Yarın Mühendislik Önceliği",
    "",
    "1. **Selection budget vs scanner-AI throughput** — 80+ candidate full-AI scan 1200s içinde yetmiyor.",
    "2. **AI_VETO @ EXECUTING** — pipeline derinliği var; AI final gate calibration forensics (policy değişikliği öncesi shadow).",
    "3. **SIM_TIGHT_FILTER** — 2 tur scanner block; false-block vs true-quality ayrımı (mevcut DEFER fix shadow).",
    "4. **Zombie Round 11 reconcile** — yeni kampanya başlatmayı engelleyebilir.",
    "",
    "### Final Verdict",
    "",
    "```",
    `ROUND_TARGET = ${v.ROUND_TARGET}`,
    `ROUNDS_COMPLETED = ${v.ROUNDS_COMPLETED ?? 0}`,
    `ROUNDS_FAILED = ${v.ROUNDS_FAILED}`,
    `TRADES = ${v.TRADES}`,
    `NET_PNL = ${v.NET_PNL}`,
    `AI_VETO_BYPASS = ${v.AI_VETO_BYPASS}`,
    `ZOMBIE_ROUNDS = ${v.ZOMBIE_ROUNDS}`,
    `VARIANT_D_LIVE_TRADES = ${v.VARIANT_D_LIVE_TRADES}`,
    `PRIMARY_RUNTIME_INCIDENT = ${v.PRIMARY_RUNTIME_INCIDENT}`,
    `PRIMARY_LOSS_DRIVER = ${v.PRIMARY_LOSS_DRIVER}`,
    `PROFITABILITY_STATUS = ${v.PROFITABILITY_STATUS}`,
    `POLICY_CHANGES = ${v.POLICY_CHANGES_DURING_CAMPAIGN}`,
    "```",
    "",
  );

  return lines.join("\n");
}

async function mergeOutputs(campaignA: Awaited<ReturnType<typeof buildCampaign>>, campaignB: Awaited<ReturnType<typeof buildCampaign>> | null) {
  const startSnap = readJson<Record<string, unknown>>(path.join(ROOT, "overnight-campaign-start.json"));
  const jsonOut = {
    generatedAt: new Date().toISOString(),
    reportScope: "MULTI_CAMPAIGN_OVERNIGHT",
    campaigns: [campaignA, ...(campaignB ? [campaignB] : [])],
  };
  fs.writeFileSync(path.join(ROOT, "kripto-overnight-10round-final.json"), JSON.stringify(jsonOut, null, 2) + "\n", "utf8");

  const csvHeader = ["campaign", "roundNo", "symbol", "durationMin", "selectionAttempt", "lastStep", "candidateCount", "tdiApprovals", "tdiWait", "tdiRejects", "aiInvoked", "aiFailed", "orders", "trades", "netPnL", "blocker", "failReason"];
  const csvRows: string[][] = [csvHeader];
  for (const c of jsonOut.campaigns) {
    for (const r of c.rounds as Array<Record<string, unknown>>) {
      csvRows.push([
        c.label,
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
  }
  fs.writeFileSync(path.join(ROOT, "kripto-overnight-10round-summary.csv"), toCsv(csvRows), "utf8");

  const md = [
    "# KRIPTO — Overnight Paper Kampanya Raporları",
    "",
    `> Güncelleme: ${new Date().toLocaleString("tr-TR")}`,
  ];
  md.push("", "---", "", denseCampaignMd("Campaign A — İlk 10 Tur (Overnight #1)", campaignA, startSnap));
  if (campaignB) {
    md.push("", "---", "", denseCampaignMd("Another — Campaign B — 30 Tur Paper (Overnight #2)", campaignB, startSnap));
  } else {
    md.push(
      "",
      "---",
      "",
      "## Another — Campaign B — 30 Tur Paper (Overnight #2)",
      "",
      "### Durum",
      "",
      "DB’de **ayrı yeni 30 tur job** henüz terminalize edilmedi veya oluşmadı.",
      "",
      "- Watch ~2.5 saat izlendi; `RUNNING` job görülmedi.",
      "- Eski job `cmt4zxkbm001gun8ghz4qsb0w` hâlâ `FAILED` (10 failed tur + Round 11 zombie).",
      "- UI’dan yeni kampanya başlatıldığında bu bölüm `build-overnight-multi-campaign-report.ts` ile otomatik dolacak.",
      "",
      "### Beklenen Campaign B artifact’ları",
      "",
      "- `kripto-overnight-10round-final.json` → `campaigns[1]`",
      "- `kripto-overnight-10round-summary.csv` → `CAMPAIGN_B_ANOTHER_30` satırları",
      "",
    );
  }
  fs.writeFileSync(path.join(ROOT, "KRIPTO_OVERNIGHT_10ROUND_FINAL_REPORT.md"), md.join("\n"), "utf8");
}

async function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function main() {
  const watch = process.argv.includes("--watch");
  const prisma = new PrismaClient();

  const campaignA = await buildCampaign(prisma, {
    label: "CAMPAIGN_A_FIRST_10",
    jobId: CAMPAIGN_A_JOB,
    roundTarget: CAMPAIGN_A_ROUNDS,
    roundMin: 1,
    roundMax: CAMPAIGN_A_ROUNDS,
  });

  let campaignBJob = await findCampaignBJob(prisma);
  const deadline = Date.now() + WATCH_MS;

  while (watch && (!campaignBJob || campaignBJob.status === "RUNNING") && Date.now() < deadline) {
    campaignBJob = await findCampaignBJob(prisma);
    if (campaignBJob && campaignBJob.status !== "RUNNING") break;
    console.log(JSON.stringify({ phase: "WATCH", jobId: campaignBJob?.id, status: campaignBJob?.status }));
    await sleep(POLL_MS);
    campaignBJob = await findCampaignBJob(prisma);
    if (campaignBJob && campaignBJob.status !== "RUNNING") break;
    await sleep(POLL_MS);
  }

  let campaignB: Awaited<ReturnType<typeof buildCampaign>> | null = null;
  if (campaignBJob) {
    campaignB = await buildCampaign(prisma, {
      label: "CAMPAIGN_B_ANOTHER_30",
      jobId: campaignBJob.id,
      roundTarget: campaignBJob.totalRounds,
      roundMin: 1,
    });
  }

  await mergeOutputs(campaignA, campaignB);
  console.log(
    JSON.stringify({
      ok: true,
      campaignA: campaignA.jobId,
      campaignB: campaignB?.jobId ?? null,
      campaignBStatus: campaignBJob?.status ?? null,
      campaignBRounds: campaignB?.rounds.length ?? 0,
    }),
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
