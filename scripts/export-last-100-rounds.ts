import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/src/server/db/prisma";

function normalizeRejectBucket(reason: string) {
  const lower = reason.toLowerCase();
  if (lower.includes("dump tespiti") || lower.includes("sert satis") || lower.includes("dump_")) return "DUMP_TESPITI";
  if (lower.includes("hour negatif") || lower.includes("hour zayif") || lower.includes("hour/tape")) return "HOUR_NEGATIF";
  if (lower.includes("tepe") || lower.includes("asiri uzama") || lower.includes("yorgun") || lower.includes("pump bitmis")) return "TEPE_KOVASI";
  if (lower.includes("calm") && lower.includes("tape")) return "CALM_OLU_TAPE";
  if (lower.includes("tape yetersiz") || lower.includes("tape negatif")) return "TAPE_YETERSIZ";
  if (lower.includes("ema trend") || lower.includes("ema uyumsuz")) return "EMA_UYUMSUZ";
  if (lower.includes("hacim yetersiz")) return "HACIM_YETERSIZ";
  if (lower.includes("btc ema") || lower.includes("btc rsi") || lower.includes("btc trend")) return "BTC_TREND_NEGATIF";
  if (lower.includes("volatilite limiti") || lower.includes("atr/")) return "VOLATILITE_YUKSEK";
  if (lower.includes("kalite skoru")) return "KALITE_SKORU_DUSUK";
  if (lower.includes("momentum teyitsiz")) return "MOMENTUM_TEYITSIZ";
  if (lower.includes("pump late") || lower.includes("pump calm") || lower.includes("hour-only")) return "PUMP_WEAK_ENTRY";
  if (lower.includes("low_confidence") || lower.includes("guven skoru")) return "LOW_CONFIDENCE";
  if (lower.includes("mtf") || lower.includes("timeframe")) return "MTF_CONFLICT";
  if (lower.includes("hedef penceresi") || lower.includes("target")) return "AI_TARGET_WINDOW";
  if (lower.includes("ai-3") || lower.includes("risk veto")) return "AI3_VETO";
  if (lower.includes("spread") || lower.includes("risk gate") || lower.includes("liquidity")) return "RISK_GATE";
  if (lower.includes("data quality") || lower.includes("veri")) return "DATA_QUALITY";
  if (lower.includes("acik pozisyon")) return "OPEN_POSITION_BLOCK";
  if (lower.includes("heartbeat") || lower.includes("watchdog") || lower.includes("zaman asimi")) return "TIMEOUT";
  if (lower.includes("paper no_trade") || lower.includes("no_trade")) return "NO_TRADE";
  return "OTHER";
}

function formatCountdown(totalSec: number) {
  const sec = Math.max(0, Math.floor(totalSec));
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}s ${m}dk`;
  }
  return `${min}dk ${rem}sn`;
}

function formatTrDate(value: Date) {
  return value.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatPnl(value: number) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(6)}`;
}

function stateLabel(state: string, result: string | null) {
  const suffix = result ? ` (${result})` : state === "tur_basarisiz" ? " (failed)" : "";
  return `${state}${suffix}`;
}

async function main() {
  const limit = Number(process.argv[2] ?? process.env.EXPORT_ROUND_LIMIT ?? 100);
  const runs = await prisma.autoRoundRun.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
    include: {
      job: {
        select: {
          id: true,
          totalRounds: true,
          maxWaitSec: true,
          status: true,
          startedAt: true,
        },
      },
    },
  });

  const sorted = [...runs].sort((a, b) => a.roundNo - b.roundNo || a.startedAt.getTime() - b.startedAt.getTime());
  const generatedAt = new Date();
  const lines: string[] = [
    `# Son ${limit} Auto-Round Tur Raporu`,
    "",
    `> Olusturulma: ${formatTrDate(generatedAt)}`,
    `> Kaynak: AutoRoundRun (son ${runs.length} kayit, roundNo artan sira)`,
    "",
    "---",
    "",
  ];

  for (const run of sorted) {
    const meta = (run.metadata as Record<string, unknown> | null) ?? {};
    const rejectBucket = String(meta.rejectBucket ?? normalizeRejectBucket(String(run.failReason ?? "")));
    const maxWaitSec = Number(meta.maxWaitSec ?? run.job.maxWaitSec ?? 0);
    const horizonProfile = String(meta.horizonProfile ?? "-");
    const symbol = run.symbol ?? "NO_TRADE";
    const opened = Number(run.buyPrice ?? 0) > 0 && Number(run.buyQty ?? 0) > 0;

    lines.push(`## Tur #${run.roundNo} - ${symbol} - ${stateLabel(run.state, run.result)}`);
    lines.push("");
    lines.push(
      `${formatTrDate(run.startedAt)}${run.endedAt ? ` → ${formatTrDate(run.endedAt)}` : ""}`,
    );
    lines.push("");

    if (opened) {
      lines.push(
        `Alis: ${Number(run.buyPrice ?? 0).toFixed(6)} | Satis: ${Number(run.sellPrice ?? 0).toFixed(6)} | Net PnL: ${formatPnl(Number(run.netPnl ?? 0))}`,
      );
      const closeReason = String(meta.closeReason ?? "-");
      if (closeReason !== "-") {
        lines.push(`Kapanis nedeni: ${closeReason}`);
      }
      if (run.selectedReason) {
        lines.push(`Secim: ${run.selectedReason}`);
      }
    } else {
      lines.push(`Red nedeni: ${run.failReason ?? run.selectedReason ?? "-"}`);
    }

    if (run.state === "tur_basarisiz" || (!opened && run.failReason)) {
      lines.push("");
      lines.push(
        `Bucket: ${rejectBucket} | Tarama: ${horizonProfile} | Max bekleme: ${maxWaitSec > 0 ? formatCountdown(maxWaitSec) : "-"}`,
      );
    }

    const extras: string[] = [];
    if (meta.selectionSource) extras.push(`Kaynak: ${String(meta.selectionSource)}`);
    if (meta.rejectedCandidate) extras.push(`Reddedilen aday: ${String(meta.rejectedCandidate)}`);
    if (meta.tightFilterReason) extras.push(`Filter: ${String(meta.tightFilterReason)}`);
    if (meta.horizonProfile && meta.targetProfitPct) {
      extras.push(`TP: %${Number(meta.targetProfitPct).toFixed(2)} | SL: %${Number(meta.stopLossPct ?? 0).toFixed(2)}`);
    }
    if (extras.length > 0) {
      lines.push("");
      lines.push(extras.join(" | "));
    }

    lines.push("");
    lines.push(`Job: \`${run.jobId}\` | Run: \`${run.id}\``);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  const summary = {
    total: runs.length,
    failed: runs.filter((r) => r.state === "tur_basarisiz").length,
    completed: runs.filter((r) => r.state === "tur_tamamlandi" || r.result === "profit").length,
    opened: runs.filter((r) => Number(r.buyPrice ?? 0) > 0).length,
  };

  lines.splice(4, 0, `## Ozet`, "", `- Toplam tur: ${summary.total}`, `- Basarisiz: ${summary.failed}`, `- Acilan: ${summary.opened}`, `- Tamamlanan/kar: ${summary.completed}`, "", "---", "");

  const outDir = path.join(process.cwd(), "reports");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, limit === 100 ? "last-100-auto-rounds.md" : `last-${limit}-auto-rounds.md`);
  writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`Wrote ${runs.length} rounds to ${outPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
