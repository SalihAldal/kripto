/**
 * 8h PAPER campaign final report — reads DB + artifacts, writes KRIPTO_8H_PAPER_REPORT.md + kripto-8h-paper-result.json
 */
import fs from "node:fs";
import path from "node:path";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!(k in process.env)) process.env[k] = v;
}

const CAMPAIGN_ID = process.argv.find((a) => a.startsWith("--campaignId="))?.split("=")[1] ?? "paper-8h-2026-09-07T0012Z";
const JOB_ID_ARG = process.argv.find((a) => a.startsWith("--jobId="))?.split("=")[1];
const ARTIFACT_ROOT = path.join(process.cwd(), "artifacts", "paper-campaigns", CAMPAIGN_ID);
const REPORT_PATH = path.join(process.cwd(), "KRIPTO_8H_PAPER_REPORT.md");
const RESULT_PATH = path.join(process.cwd(), "kripto-8h-paper-result.json");

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function readCheckpoints() {
  const p = path.join(ARTIFACT_ROOT, "checkpoints.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function categorizeFail(reason: string | null, state?: string | null): string {
  if (state === "tariyor") return "Yarım kalan round";
  if (!reason || reason === "UNKNOWN") return "Bilinmeyen / kayıt yok";
  if (reason.includes("HANDOFF_")) return "Handoff geçersiz";
  if (reason.includes("NO_ELIGIBLE") || reason.includes("NO_ELIGIBLE_CANDIDATE")) return "Uygun aday yok";
  if (reason.includes("AI_EVALUATION") || reason.includes("AI_HYDRATION") || reason.includes("HANDOFF_AI")) return "AI değerlendirme eksik";
  if (reason.includes("NO_TRADE") || reason.includes("No-trade")) return "AI NO_TRADE";
  if (reason.startsWith("AI_GATE")) return "AI gate veto";
  if (reason.startsWith("SIM_TIGHT_FILTER")) return "SIM tight filter";
  if (reason.startsWith("LEARNING_LANE")) return "Learning lane hard reject";
  if (reason.startsWith("Paper NO_TRADE")) return "Paper aday yok";
  if (reason.includes("STRATEGY")) return "Strateji tetiklenmedi";
  if (reason.includes("ADMISSION") || reason.includes("RISK_")) return "Admission/risk reddi";
  if (reason.includes("EXECUTION")) return "Execution reddi";
  if (reason.includes("WAIT:")) return "Canonical WAIT";
  if (reason.includes("ROUND_INCOMPLETE")) return "Yarım kalan round";
  if (reason.includes("Tur zaman asimi") || reason.includes("heartbeat")) return "Zaman aşımı";
  if (reason.includes("25P02")) return "DB transaction";
  return "Diğer";
}

function resolveRoundFailReason(r: {
  failReason: string | null;
  metadata: unknown;
  state: string;
}): string {
  const meta = (r.metadata ?? {}) as Record<string, unknown>;
  const terminalReason = typeof meta.terminalReason === "string" ? meta.terminalReason : null;
  const closeReason = typeof meta.closeReason === "string" ? meta.closeReason : null;
  const runtime = meta.runtime as { step?: string } | undefined;
  if (r.failReason && r.failReason.trim()) return r.failReason.trim();
  if (terminalReason) return terminalReason;
  if (closeReason) return closeReason;
  if (r.state === "tariyor") return "ROUND_INCOMPLETE";
  if (runtime?.step) return runtime.step;
  return "UNKNOWN";
}

function fmtTry(n: number) {
  return `${n.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} TRY`;
}

function fmtDur(ms: number) {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}sa ${m}dk`;
}

function fmtPct(n: number, total: number) {
  if (total === 0) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

async function main() {
  const { prisma } = await import("@/src/server/db/prisma");
  const frozen = readJson<Record<string, unknown>>(path.join(ARTIFACT_ROOT, "frozen-config.json"));
  const preflight = readJson<Record<string, unknown>>(path.join(ARTIFACT_ROOT, "preflight.json"));
  const snapshot = readJson<Record<string, unknown>>(path.join(ARTIFACT_ROOT, "final-snapshot.json"));
  const checkpoints = readCheckpoints();

  const startCp = checkpoints.find((c) => c.type === "START") as { jobId?: string; at?: string } | undefined;
  const jobId = JOB_ID_ARG ?? (startCp?.jobId as string) ?? (snapshot?.jobId as string);
  if (!jobId) throw new Error("jobId bulunamadı");

  const job = await prisma.autoRoundJob.findUnique({
    where: { id: jobId },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const { user } = await import("@/src/server/repositories/execution.repository").then((m) =>
    m.getRuntimeExecutionContext(),
  );

  const campaignStartMs = startCp?.at ? Date.parse(startCp.at) : job.startedAt?.getTime() ?? Date.now();
  const campaignEndMs = snapshot?.endedAt ? Date.parse(String(snapshot.endedAt)) : Date.now();
  const plannedMs = Number(frozen?.DURATION_HOURS ?? 8) * 3_600_000;
  const actualMs = snapshot?.actualDurationMs != null ? Number(snapshot.actualDurationMs) : campaignEndMs - campaignStartMs;

  const rounds = job.rounds;
  const byCategory: Record<string, number> = {};
  const byState: Record<string, number> = {};
  const symbolHits: Record<string, number> = {};
  let coinSelected = 0;
  let reachedBuy = 0;
  let reachedSell = 0;

  const roundRows = rounds.map((r) => {
    const resolvedFail = resolveRoundFailReason(r);
    const cat = r.state === "tariyor" ? "Yarım kalan round" : categorizeFail(resolvedFail, r.state);
    if (r.state !== "tariyor") {
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    }
    byState[r.state] = (byState[r.state] ?? 0) + 1;
    if (r.symbol) {
      coinSelected++;
      symbolHits[r.symbol] = (symbolHits[r.symbol] ?? 0) + 1;
    }
    if (r.buyPrice) reachedBuy++;
    if (r.sellPrice ?? r.netPnl) reachedSell++;
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const runtime = meta.runtime as { step?: string; message?: string } | undefined;
    const durationSec =
      r.endedAt && r.startedAt ? Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 1000) : null;
    return {
      roundNo: r.roundNo,
      state: r.state,
      symbol: r.symbol,
      failReason: resolvedFail,
      category: cat,
      selectedReason: r.selectedReason,
      runtimeStep: runtime?.step,
      buyPrice: r.buyPrice,
      sellPrice: r.sellPrice,
      netPnl: r.netPnl,
      feeTotal: r.feeTotal,
      durationSec,
    };
  });

  const openPositions = await prisma.position.findMany({
    where: { userId: user.id, status: "OPEN" },
    select: { id: true, quantity: true, entryPrice: true, unrealizedPnl: true, metadata: true, openedAt: true },
  });
  const closedPaper = await prisma.paperTrade.findMany({
    where: { userId: user.id, status: "CLOSED" },
    orderBy: { closedAt: "desc" },
  });
  const campaignCmpId = `cmp:${jobId}`;
  const campaignClosedPaper = closedPaper.filter((t) => {
    if (t.campaignId === CAMPAIGN_ID || t.campaignId === campaignCmpId) return true;
    const meta = (t.metadata ?? {}) as Record<string, unknown>;
    if (meta.campaignId === CAMPAIGN_ID || meta.campaignId === campaignCmpId) return true;
    return false;
  });
  const campaignOpenPositions = openPositions.filter((p) => {
    const meta = (p.metadata ?? {}) as Record<string, unknown>;
    const opened = p.openedAt?.getTime() ?? 0;
    const inWindow = opened >= campaignStartMs && opened <= campaignEndMs + 60_000;
    return (
      meta.campaignId === CAMPAIGN_ID ||
      meta.campaignId === campaignCmpId ||
      meta.sessionId === jobId ||
      (inWindow && (meta.mode === "paper" || String(meta.executionMode ?? "") === "paper"))
    );
  });

  const realizedPnl = snapshot?.realizedPnl != null
    ? Number(snapshot.realizedPnl)
    : campaignClosedPaper.reduce((s, r) => s + Number(r.realizedPnl ?? 0), 0);
  const unrealizedPnl = snapshot?.unrealizedPnl != null
    ? Number(snapshot.unrealizedPnl)
    : campaignOpenPositions.reduce((s, r) => s + Number(r.unrealizedPnl ?? 0), 0);
  const initialBalance = Number(frozen?.PAPER_INITIAL_BALANCE_TRY ?? process.env.PAPER_INITIAL_BALANCE_TRY ?? 10_000);
  const netEquityDelta = realizedPnl + unrealizedPnl;

  const heartbeats = checkpoints.filter((c) => c.type === "HEARTBEAT");
  const maxOpenEver = heartbeats.reduce((m, c) => Math.max(m, Number(c.openPositions ?? 0)), 0);

  const topSymbols = Object.entries(symbolHits)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const topCategories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

  const completedFull = snapshot?.completedFullDuration === true || actualMs >= plannedMs - 60_000;
  const tradeCount = snapshot?.tradeCount != null ? Number(snapshot.tradeCount) : campaignClosedPaper.length;
  const profitability =
    tradeCount === 0 ? "inconclusive" : netEquityDelta > 0 ? "positive_observation" : netEquityDelta < 0 ? "negative_observation" : "flat";

  const sampleRounds = [
    ...roundRows.slice(0, 3),
    ...roundRows.filter((r) => r.buyPrice).slice(0, 2),
    ...roundRows.slice(-3),
  ].filter((r, i, arr) => arr.findIndex((x) => x.roundNo === r.roundNo) === i);

  const lines: string[] = [];
  lines.push("# KRIPTO — 8 Saatlik PAPER Campaign Raporu");
  lines.push("");
  lines.push(`> **Campaign:** \`${CAMPAIGN_ID}\` · **Job:** \`${jobId}\``);
  lines.push(`> **Oluşturulma:** ${new Date().toISOString()} · **Mod:** PAPER (LIVE kapalı)`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Özet kartı");
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| **Durum** | ${completedFull ? "✅ Planlanan süre tamamlandı" : "⚠️ Erken durma / kısmi süre"} |`);
  lines.push(`| **Wall-clock** | ${new Date(campaignStartMs).toISOString()} → ${new Date(campaignEndMs).toISOString()} (${fmtDur(actualMs)}) |`);
  lines.push(`| **Tur kaydı** | ${rounds.length} round · ${job.completedRounds} completed · ${job.failedRounds} failed |`);
  lines.push(`| **İşlem** | ${tradeCount} kapanan · ${openPositions.length} açık (max heartbeat: ${maxOpenEver}) |`);
  lines.push(`| **PnL** | Realized ${fmtTry(realizedPnl)} · Unrealized ${fmtTry(unrealizedPnl)} · Net ${fmtTry(netEquityDelta)} |`);
  lines.push(`| **Sermaye (başlangıç)** | ${fmtTry(initialBalance)} |`);
  lines.push(`| **Profitability** | **${profitability}** — paper gözlemi, uzun vadeli garanti değil |`);
  lines.push("");
  lines.push("### Tek cümlelik hüküm");
  lines.push("");
  if (tradeCount === 0) {
    lines.push(
      `8 saat boyunca motor **${rounds.length} tur** koştu; **hiç paper işlem açılmadı**. ` +
        `Dominant red: **${topCategories[0]?.[0] ?? "belirsiz"}** (${topCategories[0]?.[1] ?? 0} tur). ` +
        `Bu bir engineering/paper pipeline gözlemi; kârlılık kanıtı **inconclusive**.`,
    );
  } else {
    lines.push(
      `${tradeCount} kapanan işlemle net equity değişimi **${fmtTry(netEquityDelta)}**. ` +
        `Sonuç gerçek piyasa verisiyle paper simülasyon gözlemidir.`,
    );
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Zaman çizelgesi");
  lines.push("");
  lines.push("| Olay | Zaman (UTC) | Not |");
  lines.push("|------|-------------|-----|");
  if (startCp?.at) lines.push(`| START | ${startCp.at} | Job başlatıldı |`);
  const firstHb = heartbeats[0];
  const lastHb = heartbeats[heartbeats.length - 1];
  if (firstHb?.at) lines.push(`| İlk heartbeat | ${firstHb.at} | elapsed ${fmtDur(Number(firstHb.elapsedMs ?? 0))} |`);
  if (lastHb?.at) lines.push(`| Son heartbeat | ${lastHb.at} | openPos=${lastHb.openPositions ?? 0} |`);
  if (snapshot?.endedAt) lines.push(`| STOP | ${snapshot.endedAt} | graceful=${snapshot.gracefulStopRequested ? "evet" : "hayır"} |`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Funnel — adaydan işleme");
  lines.push("");
  lines.push("```");
  lines.push(`Tur başlatıldı          ${rounds.length}`);
  lines.push(`  └─ Symbol seçildi      ${coinSelected}  (${fmtPct(coinSelected, rounds.length)})`);
  lines.push(`       └─ buyPrice       ${reachedBuy}  (${fmtPct(reachedBuy, rounds.length)})`);
  lines.push(`            └─ sell/PnL  ${reachedSell}  (${fmtPct(reachedSell, rounds.length)})`);
  lines.push(`                 └─ job.completedRounds  ${job.completedRounds}`);
  lines.push("```");
  lines.push("");
  lines.push("### Red kategorileri (tur bazında)");
  lines.push("");
  lines.push("| Kategori | Tur | Pay |");
  lines.push("|----------|-----|-----|");
  for (const [cat, count] of topCategories) {
    lines.push(`| ${cat} | ${count} | ${fmtPct(count, rounds.length)} |`);
  }
  lines.push("");
  if (topSymbols.length) {
    lines.push("### En çok seçilen semboller");
    lines.push("");
    for (const [sym, cnt] of topSymbols) {
      lines.push(`- **${sym}** — ${cnt} tur`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push("## Örnek turlar (snapshot)");
  lines.push("");
  for (const r of sampleRounds) {
    lines.push(`### Tur ${r.roundNo} · \`${r.symbol ?? "—"}\` · ${r.state}`);
    lines.push("");
    if (r.failReason) lines.push(`- **Fail:** ${r.failReason.slice(0, 300)}${r.failReason.length > 300 ? "…" : ""}`);
    if (r.selectedReason) lines.push(`- **Seçim:** ${r.selectedReason.slice(0, 200)}`);
    if (r.runtimeStep) lines.push(`- **Runtime step:** ${r.runtimeStep}`);
    if (r.durationSec != null) lines.push(`- **Süre:** ${r.durationSec}s`);
    if (r.buyPrice) lines.push(`- **Alım:** ${r.buyPrice} × ${r.buyPrice ? "qty" : ""}`);
    if (r.netPnl != null) lines.push(`- **Net PnL:** ${fmtTry(r.netPnl)}`);
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push("## Finansal tablo");
  lines.push("");
  lines.push("| Kalem | TRY |");
  lines.push("|-------|-----|");
  lines.push(`| Başlangıç sermaye (paper) | ${fmtTry(initialBalance)} |`);
  lines.push(`| Realized PnL | ${fmtTry(realizedPnl)} |`);
  lines.push(`| Unrealized PnL | ${fmtTry(unrealizedPnl)} |`);
  lines.push(`| Net equity delta | ${fmtTry(netEquityDelta)} |`);
  lines.push(`| Toplam fee (kapanan paper) | ${fmtTry(campaignClosedPaper.reduce((s, t) => s + Number(t.feeTotal ?? 0), 0))} |`);
  lines.push("");
  if (openPositions.length) {
    lines.push("### Açık pozisyonlar (zorla kapatılmadı)");
    lines.push("");
    for (const p of openPositions) {
      lines.push(
        `- \`${p.id.slice(0, 12)}…\` qty=${p.quantity} entry=${p.entryPrice} uPnL=${fmtTry(Number(p.unrealizedPnl ?? 0))}`,
      );
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push("## Preflight & dondurulmuş config");
  lines.push("");
  lines.push(`- Preflight: **${preflight?.overallVerdict ?? preflight?.canStart ? "READY" : "—"}**`);
  lines.push(`- Binance TR: ${(preflight?.binance as { reasonDetail?: string })?.reasonDetail ?? "—"}`);
  lines.push(`- configHash: \`${frozen?.configHash ?? snapshot?.configHash ?? "—"}\``);
  lines.push(`- BUDGET_PER_TRADE: ${frozen?.BUDGET_PER_TRADE} TRY · MAX_WAIT: ${frozen?.MAX_WAIT_SEC}s`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Artifact dizini");
  lines.push("");
  lines.push("```");
  lines.push(ARTIFACT_ROOT.replace(/\\/g, "/"));
  lines.push("  frozen-config.json");
  lines.push("  preflight.json");
  lines.push("  checkpoints.jsonl");
  lines.push("  final-snapshot.json");
  lines.push("```");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("*Bu rapor gerçek Binance TR piyasa verisi + paper simulator ile üretilmiştir. Pozitif veya negatif sonuç uzun vadeli kârlılık garantisi değildir.*");

  fs.writeFileSync(REPORT_PATH, lines.join("\n"), "utf8");

  const resultPayload = {
    campaignId: CAMPAIGN_ID,
    phase: "COMPLETED",
    jobId,
    startedAt: new Date(campaignStartMs).toISOString(),
    endedAt: new Date(campaignEndMs).toISOString(),
    plannedDurationHours: Number(frozen?.DURATION_HOURS ?? 8),
    actualDurationMs: actualMs,
    completedFullDuration: completedFull,
    gracefulStopRequested: snapshot?.gracefulStopRequested ?? false,
    configHash: frozen?.configHash ?? snapshot?.configHash,
    frozenConfig: frozen ?? snapshot?.frozenConfig,
    preflightVerdict: preflight?.overallVerdict ?? (preflight?.canStart ? "READY" : null),
    roundsRecorded: rounds.length,
    roundsCompleted: job.completedRounds,
    roundsFailed: job.failedRounds,
    tradeCount,
    openPositionCount: openPositions.length,
    maxOpenPositionsObserved: maxOpenEver,
    realizedPnl,
    unrealizedPnl,
    netEquityDelta,
    initialBalanceTry: initialBalance,
    profitabilityConclusion: profitability,
    funnel: { coinSelected, reachedBuy, reachedSell, completed: job.completedRounds },
    rejectCategories: byCategory,
    rejectByState: byState,
    topSymbols: symbolHits,
    finalJobStatus: job.status,
    artifactRoot: ARTIFACT_ROOT,
    reportPath: REPORT_PATH,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(RESULT_PATH, JSON.stringify(resultPayload, null, 2), "utf8");
  console.log(JSON.stringify({ ok: true, reportPath: REPORT_PATH, resultPath: RESULT_PATH }, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error((e as Error).message);
  process.exit(1);
});
