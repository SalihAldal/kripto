import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";

const jobId = process.argv[2] ?? "cmt95oqos000bunn4s16m7a37";

function categorizeFail(reason: string | null): string {
  if (!reason) return "Bilinmeyen";
  if (reason.startsWith("AI_GATE_BLOCK")) return "AI VETO (AI kapısı)";
  if (reason.startsWith("SIM_TIGHT_FILTER")) return "SIM Tight Filter (kalite/consensus)";
  if (reason.startsWith("LEARNING_LANE_HARD_REJECT")) return "Learning Lane (veri kalitesi)";
  if (reason.startsWith("Paper NO_TRADE")) return "Paper NO_TRADE (aday yok)";
  if (reason.includes("Tur zaman asimi") || reason.includes("heartbeat zaman asimi"))
    return "Zaman aşımı (runtime/dev kesintisi)";
  if (reason.includes("25P02") || reason.includes("transaction is aborted"))
    return "DB transaction hatası (25P02)";
  if (reason.includes("transactionallyFailRound")) return "Job version conflict (DB)";
  if (reason.includes("Invalid `")) return "Prisma/DB invocation hatası";
  return "Diğer";
}

function extractSimDetails(reason: string): string[] {
  const parts: string[] = [];
  if (reason.includes("scanner confidence")) {
    const m = reason.match(/scanner confidence ([\d.]+) < ([\d.]+)/);
    if (m) parts.push(`Scanner confidence ${m[1]} < eşik ${m[2]}`);
  }
  if (reason.includes("scanner ")) {
    const m = reason.match(/scanner ([\d.]+) < ([\d.]+)/);
    if (m) parts.push(`Scanner skor ${m[1]} < eşik ${m[2]}`);
  }
  if (reason.includes("pump risk")) {
    const m = reason.match(/pump risk ([\d.]+) > ([\d.]+)/);
    if (m) parts.push(`Pump risk ${m[1]} > eşik ${m[2]}`);
  }
  if (reason.includes("Kalite skoru")) {
    const m = reason.match(/Kalite skoru cok dusuk \((\d+)\/100 < (\d+)\)/);
    if (m) parts.push(`Kalite skoru ${m[1]}/100 < eşik ${m[2]}`);
  }
  if (reason.includes("composite=")) {
    const m = reason.match(/composite=([\d.]+)/);
    if (m) parts.push(`Composite ${m[1]}`);
  }
  if (reason.includes("mtf=0.0")) parts.push("MTF = 0 (multi-timeframe veri yok)");
  if (reason.includes("AI role consensus zayif")) {
    const m = reason.match(/tech=([\d.]+), sentiment=([\d.]+), risk=([\d.]+)/);
    if (m) parts.push(`AI consensus zayıf: tech=${m[1]}, sentiment=${m[2]}, risk=${m[3]}`);
  }
  if (reason.includes("Tape yetersiz")) {
    const m = reason.match(/tape=([\d.]+)% < ([\d.]+)%/);
    if (m) parts.push(`Tape ${m[1]}% < eşik ${m[2]}%`);
  }
  return parts;
}

async function main() {
  const p = new PrismaClient();
  const job = await p.autoRoundJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Job not found");

  const rounds = await p.autoRoundRun.findMany({
    where: { jobId },
    orderBy: { roundNo: "asc" },
  });

  const byCategory: Record<string, number> = {};
  const byState: Record<string, number> = {};
  let coinSelected = 0;
  let reachedBuy = 0;
  let reachedExecuting = 0;

  const roundRows = rounds.map((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const runtime = meta.runtime as { step?: string; message?: string } | undefined;
    const cat = categorizeFail(r.failReason);
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    byState[r.state] = (byState[r.state] ?? 0) + 1;
    if (r.symbol) coinSelected++;
    if (r.buyPrice) reachedBuy++;
    if (runtime?.step === "EXECUTING" || runtime?.message?.includes("islem aciliyor"))
      reachedExecuting++;

    const durationSec =
      r.endedAt && r.startedAt
        ? Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 1000)
        : null;

    return {
      roundNo: r.roundNo,
      state: r.state,
      symbol: r.symbol,
      failReason: r.failReason,
      category: cat,
      selectedReason: r.selectedReason,
      runtimeStep: runtime?.step,
      runtimeMessage: runtime?.message,
      durationSec,
      details: r.failReason ? extractSimDetails(r.failReason) : [],
    };
  });

  const missingRounds: number[] = [];
  for (let i = 1; i <= job.currentRound; i++) {
    if (!rounds.find((r) => r.roundNo === i)) missingRounds.push(i);
  }

  const lines: string[] = [];
  lines.push("# 100 Tur Paper Simülasyon — Tam Forensic Rapor");
  lines.push("");
  lines.push(`**Oluşturma:** ${new Date().toISOString()}`);
  lines.push(`**Job ID:** ${job.id}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 1. Executive Özet");
  lines.push("");
  lines.push("| Alan | Değer |");
  lines.push("|------|-------|");
  lines.push(`| Durum | ${job.status} |`);
  lines.push(`| Hedef tur | ${job.totalRounds} |`);
  lines.push(`| Mevcut tur | ${job.currentRound} |`);
  lines.push(`| Tamamlanan (başarılı işlem) | **${job.completedRounds}** |`);
  lines.push(`| Başarısız tur | ${job.failedRounds} |`);
  lines.push(`| Son hata | ${job.lastError ?? "—"} |`);
  lines.push(`| Bütçe/işlem | ${job.budgetPerTrade} TRY |`);
  lines.push(`| Hedef kâr | ${job.targetProfitPct}% |`);
  lines.push(`| Stop loss | ${job.stopLossPct}% |`);
  lines.push(`| Max bekleme | ${job.maxWaitSec}s |`);
  lines.push(`| Coin seçim | ${job.coinSelectionMode} |`);
  lines.push(`| AI modu | ${job.aiMode} |`);
  lines.push(`| Başlangıç | ${job.startedAt?.toISOString() ?? "—"} |`);
  lines.push("");
  lines.push("### Kritik bulgu");
  lines.push("");
  lines.push(
    `**${rounds.length} tur kaydı var, ${job.completedRounds} başarılı işlem, ${reachedBuy} alım fiyatı kaydı.** Hiçbir turda ` +
      "`alim_yapildi` / satış aşamasına geçilmedi. Coin seçildi (" +
      `${coinSelected} tur) ama execution pipeline işlem açmadan tur fail etti.`,
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 2. Neden işlem açılmıyor? (Funnel)");
  lines.push("");
  lines.push("| Aşama | Tur sayısı | Açıklama |");
  lines.push("|-------|------------|----------|");
  lines.push(`| DB'de round kaydı | ${rounds.length} | Scheduler tur başlattı |`);
  lines.push(`| Symbol seçildi | ${coinSelected} | Scanner/decision engine coin atadı |`);
  lines.push(`| Runtime EXECUTING | ${reachedExecuting} | Meta: "işlem açılıyor" mesajı |`);
  lines.push(`| buyPrice dolu | ${reachedBuy} | **Gerçek paper alım yok** |`);
  lines.push(`| Tamamlanan | ${job.completedRounds} | Satış + PnL yok |`);
  lines.push("");
  lines.push("**Ana sebep zinciri:**");
  lines.push("1. Scanner coin buluyor → coin seçiliyor");
  lines.push("2. AI gate / SIM tight filter / learning lane → **VETO veya HARD REJECT**");
  lines.push("3. Veya pump/steady-gain adayı yok → **NO_TRADE**");
  lines.push("4. Veya dev kesintisi → tur **zaman aşımı** (1021s)");
  lines.push("5. Veya DB transaction abort → **25P02** cascade fail");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 3. Hata kategorileri (özet)");
  lines.push("");
  lines.push("| Kategori | Tur | % |");
  lines.push("|----------|-----|---|");
  const total = rounds.length;
  for (const [cat, count] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${cat} | ${count} | ${((count / total) * 100).toFixed(1)}% |`);
  }
  lines.push("");
  lines.push("### Kategori açıklamaları");
  lines.push("");
  lines.push("- **AI VETO:** Learning/consensus AI pipeline işlemi veto etti (`AI_GATE_BLOCK: AI_VETO`). Policy — bug değil.");
  lines.push("- **SIM Tight Filter:** 15m non-pump kalite, scanner confidence, pump risk, kalite skoru eşikleri.");
  lines.push("- **Learning Lane:** TDI/veri kalitesi hard reject (`data quality issue`).");
  lines.push("- **Paper NO_TRADE:** 100+ coin tarandı, pump/steady-gain adayı 0.");
  lines.push("- **Zaman aşımı:** Dev kapandı veya scheduler stall; tur 1021s sonra fail.");
  lines.push("- **DB 25P02:** Önceki transaction fail sonrası aborted state; cascade Prisma hataları.");
  lines.push("- **Version conflict:** Optimistic concurrency — hızlı fail döngüsünde job persistVersion çakışması.");
  lines.push("");
  if (missingRounds.length > 0) {
    lines.push(`**Eksik tur kayıtları (currentRound içinde DB'de yok):** ${missingRounds.join(", ")}`);
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push("## 4. Final state dağılımı");
  lines.push("");
  for (const [state, count] of Object.entries(byState).sort((a, b) => b[1] - a[1])) {
    lines.push(`- \`${state}\`: ${count} tur`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 5. Tur bazında detay (A→Z)");
  lines.push("");

  for (const r of roundRows) {
    lines.push(`### Tur ${r.roundNo}`);
    lines.push("");
    lines.push(`| Alan | Değer |`);
    lines.push(`|------|-------|`);
    lines.push(`| State | ${r.state} |`);
    lines.push(`| Symbol | ${r.symbol ?? "—"} |`);
    lines.push(`| Süre | ${r.durationSec != null ? `${r.durationSec}s` : "—"} |`);
    lines.push(`| Kategori | ${r.category} |`);
    if (r.runtimeStep) lines.push(`| Runtime step | ${r.runtimeStep} |`);
    if (r.selectedReason) {
      const short =
        r.selectedReason.length > 180 ? r.selectedReason.slice(0, 180) + "…" : r.selectedReason;
      lines.push(`| Seçim gerekçesi | ${short.replace(/\|/g, "\\|")} |`);
    }
    lines.push("");
    if (r.failReason) {
      lines.push(`**Fail reason:**`);
      lines.push("");
      lines.push("```");
      lines.push(r.failReason);
      lines.push("```");
      lines.push("");
      if (r.details.length > 0) {
        lines.push("**Çıkarılan eşik ihlalleri:**");
        for (const d of r.details) lines.push(`- ${d}`);
        lines.push("");
      }
    } else {
      lines.push("Fail reason kaydı yok.");
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  lines.push("## 6. Tekrarlayan pattern'ler");
  lines.push("");
  lines.push("### 6.1 MTF = 0.0 (çoğu SIM_TIGHT_FILTER turunda)");
  lines.push("Multi-timeframe momentum verisi 0 — TDI/MTF pipeline eksik veya stale. Bu tek başına kalite skorunu düşürüyor.");
  lines.push("");
  lines.push("### 6.2 Pump risk 100 > 96");
  lines.push("Paper modda pump risk skoru sürekli 100 görünüyor; eşik 96 — neredeyse her non-pump coin otomatik red.");
  lines.push("");
  lines.push("### 6.3 Scanner confidence ~15–28 vs eşik 36–40");
  lines.push("Momentum/confidence kalibrasyonu paper ortamında düşük; scanner adayları eşiği geçemiyor.");
  lines.push("");
  lines.push("### 6.4 selectedReason = NO_TRADE ama symbol atanmış");
  lines.push("Master decision engine NO_TRADE derken round yine symbol alıyor; sonra AI gate veto ediyor. Funnel tutarsızlığı.");
  lines.push("");
  lines.push("### 6.5 Tur 1–2: 1021s timeout (state=tariyor)");
  lines.push("İlk gece dev kesintisi; coin seçildi (SENTTRY, TAOTRY) ama EXECUTING'de takılı kaldı, alım yapılmadı.");
  lines.push("");
  lines.push("## 7. Önerilen aksiyonlar (policy değiştirmeden)");
  lines.push("");
  lines.push("1. **Runtime stabilitesi:** `npm run dev` tek instance, port 3000; watchdog recovery test.");
  lines.push("2. **DB 25P02:** `transactionallyFailRound` retry + transaction isolation audit.");
  lines.push("3. **MTF/TDI veri:** Paper modda MTF=0 root cause — veri feed veya cache.");
  lines.push("4. **Pump risk 100:** Paper shadow'da risk skoru kalibrasyonu (forensic only).");
  lines.push("5. **NO_TRADE + symbol:** Decision engine ve round state sync.");
  lines.push("");
  lines.push("## 8. Ham veri");
  lines.push("");
  lines.push("JSON export: `artifacts/paper-100-round-raw.json` (script: `scripts/_extract-paper-job-report.ts`)");
  lines.push("");

  const outPath = "KRIPTO_100ROUND_PAPER_FORENSIC_REPORT.md";
  writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`Written ${outPath} (${lines.length} lines, ${rounds.length} rounds)`);
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
