import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const JOB_ID = process.argv[2] ?? "cmtasbdi60029unbwdxrckdxb";

function categorize(reason: string) {
  if (!reason) return "UNKNOWN";
  if (reason.includes("Tur motoru durduruldu") || reason.includes("kullanici")) return "OPERATOR_STOP";
  if (reason.includes("Transaction already closed") || reason.includes("expired transaction")) return "P0_DB_TX_TIMEOUT";
  if (reason.includes("heartbeat") || reason.includes("stall threshold") || reason.includes("HEARTBEAT")) return "P0_RUNTIME_STALL";
  if (reason.includes("RECOVERY_EXHAUSTED") || reason.includes("Recovery escalation")) return "P0_RECOVERY_ESCALATION";
  if (reason.includes("AI_VETO") || reason.includes("AI_GATE")) return "POLICY_AI_VETO";
  if (reason.includes("SIM_TIGHT_FILTER")) return "POLICY_SIM_TIGHT";
  if (reason.includes("NO_TRADE") || reason.includes("pump ve steady-gain")) return "POLICY_NO_TRADE";
  return "OTHER";
}

async function main() {
  const p = new PrismaClient();
  const job = await p.autoRoundJob.findUnique({
    where: { id: JOB_ID },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });
  if (!job) {
    console.error("job not found");
    process.exit(1);
  }

  const meta = (job.metadata ?? {}) as Record<string, unknown>;
  const recoveryAudit = (meta.recoveryAudit ?? []) as Array<Record<string, unknown>>;

  const rows = job.rounds.map((r) => ({
    roundNo: r.roundNo,
    state: r.state,
    symbol: r.symbol,
    startedAt: r.startedAt?.toISOString(),
    endedAt: r.endedAt?.toISOString(),
    failReason: r.failReason ?? "",
    category: categorize(String(r.failReason ?? "")),
    durationSec:
      r.endedAt && r.startedAt
        ? Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 1000)
        : null,
  }));

  const byCategory: Record<string, number> = {};
  for (const row of rows) {
    byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
  }

  const lines: string[] = [];
  lines.push("# 100 Tur Paper — Tur 18 Durma Forensic Raporu");
  lines.push("");
  lines.push(`**Oluşturma:** ${new Date().toISOString()}`);
  lines.push(`**Job ID:** ${JOB_ID}`);
  lines.push("");
  lines.push("## Özet — Neden Durdu?");
  lines.push("");
  lines.push("| Alan | Değer |");
  lines.push("|------|-------|");
  lines.push(`| Job status | **${job.status}** |`);
  lines.push(`| currentRound | ${job.currentRound} |`);
  lines.push(`| completedRounds | ${job.completedRounds} |`);
  lines.push(`| failedRounds | ${job.failedRounds} |`);
  lines.push(`| stopRequested | ${job.stopRequested} |`);
  lines.push(`| lastError | ${job.lastError ?? "null"} |`);
  lines.push(`| activeState | ${job.activeState} |`);
  lines.push("");
  lines.push("### Kısa cevap");
  lines.push("");
  lines.push(
    "**Ben (agent) paper job'ı durdurmadım.** Sadece eski watchdog sürecini yeniden başlatmak için `Stop-Process` kullandım; paper motoru dev server içinde çalışmaya devam etti.",
  );
  lines.push("");
  lines.push(
    "**Tur 18** fail reason: `Tur motoru durduruldu` — bu, `stopRequested` flag'i set edildikten sonra aktif turun finalize edilmesi. Watchdog log'u **02:08:53 UTC** `STOP_REQUESTED` (operator stop) kaydıyla uyumlu. Muhtemel kaynak: UI'dan durdurma veya stop API; agent tarafından otomatik stop komutu çalıştırılmadı.",
  );
  lines.push("");
  lines.push(
    "**Asıl engineering zinciri (tur 17–18 öncesi):** Prisma interactive transaction **25s timeout** aşıldı (30s+ iş) → job FAILED → recovery döngüsü → heartbeat stall'lar → sonunda **Recovery escalation limit** (`REGISTRY_INTEGRITY`, level 5) → job `STOPPED`, `lastError: Recovery escalation limit reached`.",
  );
  lines.push("");
  lines.push("## Fail Kategori Dağılımı");
  lines.push("");
  for (const [cat, count] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    lines.push(`- **${cat}:** ${count} tur`);
  }
  lines.push("");
  lines.push("## Tur Bazlı Tablo");
  lines.push("");
  lines.push("| Tur | Süre (sn) | Kategori | Fail / Durum |");
  lines.push("|-----|-----------|----------|--------------|");
  for (const row of rows) {
    const reason = (row.failReason || row.state).replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 120);
    lines.push(`| ${row.roundNo} | ${row.durationSec ?? "—"} | ${row.category} | ${reason} |`);
  }
  lines.push("");
  lines.push("## Tur 16–18 Kronoloji (Engineering + Stop)");
  lines.push("");
  lines.push("1. **Tur 16** — `Tur heartbeat zaman asimi (heartbeatAge=181s)` → AI/scan aşamasında heartbeat 180s eşiğini aştı.");
  lines.push("2. **Tur 17** — Prisma tx timeout: `Transaction already closed ... timeout 25000 ms, 30210 ms passed` → **P0 DB transaction süresi yetmedi.**");
  lines.push("3. **02:02:43** — Job `FAILED` (aynı tx timeout); watchdog otomatik resume → tur 19'a zıpladı.");
  lines.push("4. **Tur 18** (02:02:16–02:08:36) — Devam eden tur; **02:08:36** `Tur motoru durduruldu`.");
  lines.push("5. **02:08:53** — Watchdog: `STOP_REQUESTED` → job `STOPPED`.");
  lines.push("6. **Sonraki saatler** — `REGISTRY_INTEGRITY` recovery denemeleri escalation level 5 → `STOP_JOB` / `Recovery escalation limit reached`.");
  lines.push("");
  lines.push("## İlk 11 Tur (Önceki Session Özeti)");
  lines.push("");
  lines.push("- Tur 1–3: `AI_GATE_BLOCK: AI_VETO` (policy)");
  lines.push("- Tur 4, 7: `SIM_TIGHT_FILTER_15m` (kalite/scanner/pump risk — policy)");
  lines.push("- Tur 5–6, 8–11: `Paper NO_TRADE` (pump/steady-gain adayı yok — policy)");
  lines.push("- **Tur 12 kayıt yok** — round registry'de atlanmış numara (tur 11→13).");
  lines.push("");
  lines.push("## Watchdog Olayları (artifacts/monitor/100round-paper-watch.jsonl)");
  lines.push("");
  lines.push("- Cycle 39–42: Tur 14 sonrası `STALE_HEARTBEAT` 260–627s → recovery tetiklendi, sonra tur 16'ya geçildi.");
  lines.push("- Cycle 46: Tur 16 `TIMEOUT` step.");
  lines.push("- Cycle 8 (02:02:43): Job `FAILED` tx timeout → auto resume round 19.");
  lines.push("- Cycle 50 (02:08:53): `STOP_REQUESTED` → watchdog tamamlandı.");
  lines.push("");
  lines.push("## Dev Server (şu an)");
  lines.push("");
  lines.push("- Binance cooldown / network unstable uyarıları — scanner pump boş, fallback data.");
  lines.push("- Job `STOPPED`; tur motoru aktif çalışmıyor.");
  lines.push("");
  lines.push("## Engineering Blocker Listesi (Düzeltilmeli)");
  lines.push("");
  lines.push("| ID | Sorun | Etki |");
  lines.push("|----|-------|------|");
  lines.push("| P0-TX-001 | Hot-path tx 25s limit, AI+scan işi 30s+ | Tur 17–18 job FAILED |");
  lines.push("| P0-STALL-001 | Heartbeat 180s stall → tur fail | Tur 13, 16 |");
  lines.push("| P0-RECOVERY-001 | REGISTRY_INTEGRITY escalation → STOP_JOB | Job kalıcı STOPPED |");
  lines.push("| P1-POLICY-001 | 0 başarılı tur / çoğu NO_TRADE veya VETO | Trade açılmıyor (policy) |");
  lines.push("");
  lines.push("## Policy (Bug Değil — Beklenen Red)");
  lines.push("");
  lines.push("- AI_VETO, SIM_TIGHT_FILTER, NO_TRADE — funnel policy; motor durmuyor, tur fail edip devam ediyor.");
  lines.push("");
  lines.push("## Sonuç");
  lines.push("");
  lines.push(
    "Paper **18. turda 'Tur motoru durduruldu' mesajıyla fail etti** çünkü **stop isteği** işlendi (`stopRequested`). Bu agent'ın watchdog kill'inden değil; UI/API stop veya recovery sonrası finalize akışı. **Kalıcı durma** nedeni: tx timeout + heartbeat stall zinciri recovery escalation'a taşındı → `Recovery escalation limit reached`.",
  );
  lines.push("");
  lines.push("## Önerilen Sonraki Adım");
  lines.push("");
  lines.push("1. Job'ı resume et (`resume-failed-paper-job.ts`) tur 19'dan.");
  lines.push("2. P0: hot-path transaction timeout artır veya tx içi işi böl.");
  lines.push("3. Heartbeat stall eşiğini AI_ANALYSIS uzun turlar için gözden geçir.");
  lines.push("4. REGISTRY_INTEGRITY recovery escalation öncesi registry reconcile.");

  const out = "KRIPTO_18ROUND_STOP_FORENSIC_REPORT.md";
  writeFileSync(out, lines.join("\n"), "utf8");

  const json = {
    jobId: JOB_ID,
    status: job.status,
    stopRequested: job.stopRequested,
    lastError: job.lastError,
    currentRound: job.currentRound,
    failedRounds: job.failedRounds,
    byCategory,
    rounds: rows,
    recoveryAuditTail: recoveryAudit.slice(0, 8),
  };
  writeFileSync("kripto-18round-stop-forensic.json", JSON.stringify(json, null, 2), "utf8");
  console.log(`Written ${out} (${rows.length} rounds)`);
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
