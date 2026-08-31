import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

function whyExplanation(category: string, failReason: string | null, symbol: string | null): string[] {
  const lines: string[] = [];
  switch (category) {
    case "AI VETO (AI kapısı)":
      lines.push(
        "Learning/consensus AI pipeline coin seçiminden sonra execution öncesi **AI_GATE** kontrolünden geçmedi.",
        "AI modu `learning` — model bu coin için risk/getiri profiline güvenmedi ve VETO verdi.",
        "Bu bir policy kararı; scanner coin buldu ama AI son kapıda işlemi durdurdu.",
        "Meta genelde EXECUTING adımında kalır; `buyPrice` hiç yazılmaz.",
      );
      if (symbol) lines.push(`Seçilen coin: ${symbol} — AI bu sembolü trade için onaylamadı.`);
      break;
    case "SIM Tight Filter (kalite/consensus)":
      lines.push(
        "Paper simülasyonda **SIM_TIGHT_FILTER_15m** katı kalite filtresi devrede.",
        "Non-pump coinler composite/sentiment/MTF, scanner confidence ve kalite skoru eşiklerini geçemedi.",
      );
      if (failReason?.includes("pump risk")) {
        lines.push(
          "Pump risk skoru 100 görünüyor (eşik 96) — paper shadow'da risk kalibrasyonu aşırı agresif; coin otomatik red.",
        );
      }
      if (failReason?.includes("mtf=0.0")) {
        lines.push("MTF (multi-timeframe momentum) = 0 — TDI/MTF veri feed eksik veya stale.");
      }
      if (failReason?.includes("scanner confidence")) {
        const m = failReason.match(/scanner confidence ([\d.]+) < ([\d.]+)/);
        if (m) lines.push(`Scanner confidence ${m[1]} < eşik ${m[2]} — momentum kalibrasyonu düşük.`);
      }
      if (failReason?.includes("Kalite skoru")) {
        const m = failReason.match(/Kalite skoru cok dusuk \((\d+)\/100 < (\d+)\)/);
        if (m) lines.push(`Kalite skoru ${m[1]}/100 < eşik ${m[2]}.`);
      }
      if (failReason?.includes("Tape yetersiz")) {
        lines.push("Pump profili zayıf + tape (işlem hızı) eşiğin altında — momentum yok.");
      }
      break;
    case "Learning Lane (veri kalitesi)":
      lines.push(
        "**LEARNING_LANE_HARD_REJECT** — TDI/veri kalitesi pipeline coin'i hard reject etti.",
        "Sebep: `data quality issue` — öğrenme modunda eksik/hatalı feature, stale indicator veya TDI policy ihlali.",
        "Scanner aday üretmiş olabilir ama learning lane execution'a izin vermedi.",
      );
      break;
    case "Paper NO_TRADE (aday yok)":
      lines.push(
        "Scanner 100+ coin taradı; pump ve steady-gain lane'lerinde **uygun aday bulunamadı**.",
        "Tur seçim döngüsü `tariyor` state'de kalıp NO_TRADE ile fail eder — coin atanmaz veya atanmış olsa bile trade açılmaz.",
      );
      if (failReason) {
        const m = failReason.match(/scanned=(\d+), candidates=(\d+)/);
        if (m) lines.push(`Tarama: ${m[1]} coin, candidates=${m[2]}.`);
      }
      break;
    case "Zaman aşımı (runtime/dev kesintisi)":
      lines.push(
        "Scheduler heartbeat veya tur yaşı eşiği aşıldı — runtime döngüsü bu turda ilerlemedi.",
        "Tipik senaryo: `npm run dev` kesildi, port çakışması, veya EXECUTING'de takılı kaldı.",
      );
      if (failReason?.includes("1021")) {
        lines.push(
          "~1021s = maxWaitSec(900) + buffer — tur 1–2'de dev/outage sonrası coin seçildi ama alım yapılmadı.",
        );
      }
      if (failReason?.includes("heartbeat")) {
        const m = failReason.match(/heartbeatAge=(\d+)s/);
        if (m) lines.push(`Heartbeat ${m[1]}s güncellenmedi — scheduler process öldü veya stall.`);
      }
      break;
    case "DB transaction hatası (25P02)":
      lines.push(
        "PostgreSQL **25P02**: önceki transaction fail sonrası tx aborted state'de kaldı.",
        "Aynı tx içinde `findFirst` tekrar çağrıldı → cascade Prisma hatası → tur/job FAILED.",
        "Kaynak: `auto-round-integrity.repository.ts` race handler (P2002 sonrası findFirst).",
        "Bu bir **runtime bug** — policy reddi değil; DB tx yönetimi sorunu.",
      );
      break;
    case "Job version conflict (DB)":
      lines.push(
        "Optimistic concurrency: `transactionallyFailRound` job `persistVersion` CAS reddi.",
        "Hızlı ardışık fail döngüsünde iki writer aynı job versiyonuna yazmaya çalıştı.",
        "Tur fail edildi; job FAILED durumuna düşebilir.",
      );
      break;
    default:
      if (failReason) lines.push(failReason.slice(0, 300));
  }
  return lines;
}

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
  if (reason.includes("Invalid `")) return "DB transaction hatası (25P02)";
  return "Diğer";
}

async function main() {
  const p = new PrismaClient();
  const jobId = "cmt95oqos000bunn4s16m7a37";
  const job = await p.autoRoundJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("no job");

  const rounds = await p.autoRoundRun.findMany({
    where: { jobId },
    orderBy: { roundNo: "asc" },
  });

  const meta = (job.metadata ?? {}) as Record<string, unknown>;
  const recoveryAudit = ((meta.recoveryAudit as unknown[]) ?? []).map((a) => {
    const x = a as Record<string, unknown>;
    return {
      at: String(x.timestamp ?? ""),
      action: String(x.action ?? ""),
      result: String(x.result ?? ""),
      failure: String(x.failure ?? ""),
      message: String(x.message ?? ""),
    };
  });

  const significantRecovery = recoveryAudit.filter(
    (a) =>
      a.action === "RESUME" ||
      a.result === "success" ||
      a.result === "partial" ||
      (a.failure === "RUNTIME_STALL" && a.action !== "NO_ACTION"),
  );

  // watch log interruptions
  const watchPath =
    "C:\\Users\\salih\\.cursor\\projects\\c-Users-salih-Desktop-kripto-main\\terminals\\531016.txt";
  const watchInterruptions: Array<{
    at: string;
    round: number;
    blockers: string[];
    recovery: string[];
  }> = [];
  try {
    const raw = readFileSync(watchPath, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.startsWith("{")) continue;
      try {
        const j = JSON.parse(line);
        if (j.event !== "watch_tick") continue;
        if (!j.blockers?.length && !j.recoveryActions?.length) continue;
        watchInterruptions.push({
          at: j.at,
          round: j.currentRound,
          blockers: (j.blockers ?? []).map(
            (b: { code: string; message?: string }) =>
              `${b.code}: ${(b.message ?? "").slice(0, 100)}`,
          ),
          recovery: j.recoveryActions ?? [],
        });
      } catch {
        /* skip */
      }
    }
  } catch {
    /* no log */
  }

  // round gaps (possible outages)
  const gaps: Array<{ afterRound: number; gapMin: number; note: string }> = [];
  for (let i = 1; i < rounds.length; i++) {
    const prev = rounds[i - 1];
    const cur = rounds[i];
    if (!prev.endedAt || !cur.startedAt) continue;
    const gapMin = Math.round(
      (cur.startedAt.getTime() - prev.endedAt.getTime()) / 60000,
    );
    if (gapMin > 30) {
      gaps.push({
        afterRound: prev.roundNo,
        gapMin,
        note: `Tur ${prev.roundNo} bitti → tur ${cur.roundNo} başladı (${gapMin} dk boşluk — muhtemel dev kesintisi/recovery)`,
      });
    }
  }

  // Build expanded sections as markdown
  const sections: string[] = [];

  sections.push("## 2. Neden işlem açılmıyor? (Detaylı Funnel Analizi)");
  sections.push("");
  sections.push(
    "Paper job **coin seçebiliyor** ama **execution pipeline hiçbir turda `alim_yapildi` aşamasına geçmedi**. " +
      "Aşağıdaki tablo her aşamada ne olduğunu ve neden durduğunu gösterir.",
  );
  sections.push("");
  sections.push("| Aşama | Tur | Ne oluyor? | Neden burada duruyor? |");
  sections.push("|-------|-----|------------|----------------------|");
  sections.push(
    "| Tur başlatıldı | 59 DB kaydı / 64 sayaç | Scheduler round row oluşturdu | — |",
  );
  sections.push(
    "| Symbol atandı | 56 | Scanner/decision engine sembol seçti | Seçim ≠ trade onayı; sonraki gate'ler bekliyor |",
  );
  sections.push(
    "| EXECUTING meta | 30 | Log: «işlem açılıyor» | AI analiz + gate kontrolü başladı |",
  );
  sections.push(
    "| **buyPrice** | **0** | Paper alım simülasyonu | Gate VETO / filter reject / NO_TRADE / timeout |",
  );
  sections.push(
    "| Satış / PnL | 0 | Pozisyon kapatma | Alım olmadığı için satış da yok |",
  );
  sections.push("");
  sections.push("### 2.1 Execution pipeline — adım adım «neden»");
  sections.push("");
  sections.push("```");
  sections.push("SCANNER → coin_secildi → AI_ANALYSIS → AI_GATE → SIM_FILTER → LEARNING_LANE → ALIM");
  sections.push("   ✓           ✓              ✓           ✗ (13x)    ✗ (13x)      ✗ (12x)      ✗ (0x)");
  sections.push("```");
  sections.push("");
  sections.push(
    "1. **Scanner** çalışıyor — 100+ coin taranıyor, bazen candidates=0 (14 tur NO_TRADE).",
  );
  sections.push(
    "2. **Coin seçimi** yapılıyor ama `selectedReason` çoğu turda «NO_TRADE resolved by master decision engine» — confidence 15–19 bandında, LEARNING ve MOMENTUM blokluyor.",
  );
  sections.push(
    "3. **AI_GATE** learning modunda 13 turda `AI_VETO` — AI son onayı vermiyor.",
  );
  sections.push(
    "4. **SIM_TIGHT_FILTER** 13 turda composite ~36–52, sentiment ~24–43, **mtf=0.0**, pump risk **100>96**, scanner confidence **15–28 < 36–40**.",
  );
  sections.push(
    "5. **LEARNING_LANE** 12 turda `data quality issue` — TDI/feature kalitesi hard reject.",
  );
  sections.push(
    "6. **Runtime kesintileri** — dev kill, heartbeat stall, tx timeout job'ı FAILED yapıyor; policy reddi olmasa bile tur ilerlemiyor.",
  );
  sections.push("");

  sections.push("## 2B. İşlem kesintileri ve recovery olayları (kronoloji)");
  sections.push("");
  sections.push(
    "Kampanya boyunca job birkaç kez **FAILED** durumuna düştü, watchdog/watch script resume etti, dev sunucusu kesintileri yaşandı.",
  );
  sections.push("");

  sections.push("### 2B.1 Watch script tespit ettiği kritik kesintiler");
  sections.push("");
  sections.push("| Zaman (UTC) | Tur | Olay | Recovery |");
  sections.push("|-------------|-----|------|----------|");
  for (const w of watchInterruptions) {
    const blocker = w.blockers[0]?.replace(/\|/g, "/").slice(0, 80) ?? "—";
    const recovery = w.recovery.slice(0, 2).join("; ").replace(/\|/g, "/").slice(0, 80);
    sections.push(`| ${w.at} | ${w.round} | ${blocker} | ${recovery} |`);
  }
  sections.push("");

  sections.push("### 2B.2 Önemli recovery audit kayıtları (DB metadata)");
  sections.push("");
  sections.push("| Zaman | Action | Result | Failure | Mesaj |");
  sections.push("|-------|--------|--------|---------|-------|");
  for (const a of significantRecovery.slice(-25)) {
    sections.push(
      `| ${a.at} | ${a.action} | ${a.result} | ${a.failure} | ${a.message.slice(0, 60)} |`,
    );
  }
  sections.push("");
  sections.push(
    `Toplam recovery audit: **${recoveryAudit.length}** kayıt — SCHEDULER_CRASH noop: **${recoveryAudit.filter((a) => a.failure === "SCHEDULER_CRASH").length}**, RUNTIME_STALL: **${recoveryAudit.filter((a) => a.failure === "RUNTIME_STALL").length}**, SCHEDULER_LEASE_STALE: **${recoveryAudit.filter((a) => a.failure === "SCHEDULER_LEASE_STALE").length}**`,
  );
  sections.push("");

  sections.push("### 2B.3 Dev sunucu kesintileri ve uzun boşluklar");
  sections.push("");
  sections.push("| Tur aralığı | Boşluk | Yorum |");
  sections.push("|-------------|--------|-------|");
  for (const g of gaps) {
    sections.push(`| Tur ${g.afterRound} → ${g.afterRound + 1} | ${g.gapMin} dk | ${g.note} |`);
  }
  sections.push("");
  sections.push("**Bilinen kesinti olayları:**");
  sections.push("");
  sections.push(
    "- **21:07–22:03** — Job başladı; tur 1–2 ~1021s timeout (dev/outage, EXECUTING'de takılı).",
  );
  sections.push(
    "- **22:17** — Job FAILED (tur 17); watch `resumed FAILED job at round 17`, holder pid spawn.",
  );
  sections.push(
    "- **22:26** — Tur 18 DB 25P02 cascade; JOB FAILED + stale lastError; resume + scheduler spawn.",
  );
  sections.push(
    "- **22:33** — Job FAILED (tur 22); resume + scheduler recovery success.",
  );
  sections.push(
    "- **01:47–07:23** — Gece uzun boşluk (~5.5 saat); tur 63 sonrası version conflict; sabah resume tur 64.",
  );
  sections.push(
    "- **07:23–07:26** — Tur 64 heartbeat timeout (182s); job FAILED. Prisma tx 25s limit aşımı (35–47s işlem).",
  );
  sections.push(
    "- **Dev terminal sonu** — `Unexpected end of JSON input` / `Manifest file is empty` (webpack hot reload corruption, dev unstable).",
  );
  sections.push(
    "- **Arka plan görevleri** — `npm run dev` ve `watch-paper-live` ~9+ saat sonra user abort.",
  );
  sections.push("");

  sections.push("## 3. Hata kategorileri — detaylı «neden» açıklamaları");
  sections.push("");

  const categories = [
    {
      name: "Paper NO_TRADE (aday yok)",
      count: 14,
      why: [
        "Scanner `scanner_best` modunda önce pump cache, sonra steady-gain lane tarıyor.",
        "Paper ortamında pump lane candidates sık sık 0 — piyasa koşulları veya pump cache stale.",
        "`scanned=100, candidates=20` görünen turlarda aday var ama pump/steady profiline uymuyor.",
        "`scanned=108, candidates=0` — hiç qualifying candidate yok, tur doğrudan NO_TRADE fail.",
        "Bu policy: kötü setup'ta trade açmamak. Bug değil ama throughput sıfıra yakın.",
      ],
    },
    {
      name: "AI VETO (AI kapısı)",
      count: 13,
      why: [
        "`aiMode: learning` — öğrenme modu AI gate daha agresif veto veriyor.",
        "Coin seçildikten sonra AI consensus EXECUTION öncesi `AI_GATE_BLOCK: AI_VETO` döndürüyor.",
        "selectedReason zaten NO_TRADE + düşük confidence (15–19) — AI ile scanner çelişkili funnel.",
        "FFTRY, XRPTRY vb. semboller tekrar seçilip tekrar veto — aynı coin loop.",
        "Execution motoru `buyPrice` yazmadan tur fail ediyor.",
      ],
    },
    {
      name: "SIM Tight Filter (kalite/consensus)",
      count: 13,
      why: [
        "15 dakikalık sim tight filter paper'da production parity için aktif.",
        "**mtf=0.0** her turda — multi-timeframe momentum hesaplanmıyor; composite düşük kalıyor.",
        "**pump risk 100 > 96** — risk skoru kalibrasyonu paper'da max; non-pump coinler otomatik eleniyor.",
        "Scanner confidence 15–28 vs eşik 36–40 — momentum recalibration paper'da düşük.",
        "Kalite skoru 26/100 — MTF+sentiment+composite birleşimi eşiği geçemiyor.",
        "Bazı turlarda pump lane'e yakın coin (tape, RANGE zayıf) — pump profili bile yetmiyor.",
      ],
    },
    {
      name: "Learning Lane (veri kalitesi)",
      count: 12,
      why: [
        "LEARNING_LANE_HARD_REJECT — TDI pipeline veri kalitesi kontrolü.",
        "Generic mesaj: `data quality issue` — stale indicator, missing feature, veya TDI confidence düşük.",
        "Learning modunda bu lane hard gate; bypass yok.",
        "Scanner aday üretse bile learning lane execution'ı kesiyor.",
      ],
    },
    {
      name: "Zaman aşımı (runtime/dev kesintisi)",
      count: 3,
      why: [
        "Tur 1–2: state `coin_secildi`/`tariyor`, age ~1021s — dev kesildi, scheduler öldü.",
        "Tur 64: heartbeat 182s güncellenmedi — scheduler stall veya dev yanıt vermiyor.",
        "maxWaitSec=900 + watchdog buffer — uzun outage sonrası otomatik fail.",
      ],
    },
    {
      name: "DB transaction hatası (25P02)",
      count: 3,
      why: [
        "Tur 10, 19, 32 — Postgres transaction aborted (25P02).",
        "Önceki SQL hata sonrası aynı interactive tx içinde findFirst → cascade fail.",
        "Job FAILED durumuna düşebilir; watch script resume eder.",
        "Fix: tx rollback, retry, veya HOT_PATH_TX timeout artırımı + daha az iş tx içinde.",
      ],
    },
    {
      name: "Job version conflict (DB)",
      count: 1,
      why: [
        "Tur 63 — `transactionallyFailRound job version conflict`.",
        "Hızlı fail storm: birden fazla writer aynı job persistVersion güncellemeye çalıştı.",
        "Optimistic concurrency CAS reject — tur fail, job FAILED.",
      ],
    },
  ];

  for (const c of categories) {
    sections.push(`### 3.${categories.indexOf(c) + 1} ${c.name} (${c.count} tur)`);
    sections.push("");
    for (const w of c.why) sections.push(`- ${w}`);
    sections.push("");
  }

  // per-round why blocks
  const roundWhyBlocks: string[] = [];
  for (const r of rounds) {
    const cat = categorizeFail(r.failReason);
    const whys = whyExplanation(cat, r.failReason, r.symbol);
    if (whys.length === 0) continue;
    roundWhyBlocks.push(`### Tur ${r.roundNo} — Neden?`);
    roundWhyBlocks.push("");
    roundWhyBlocks.push(`**Kategori:** ${cat}`);
    roundWhyBlocks.push("");
    for (const w of whys) roundWhyBlocks.push(`- ${w}`);
    roundWhyBlocks.push("");
  }

  const outPath = "artifacts/paper-why-sections.md";
  const roundOutPath = "artifacts/paper-round-why.md";
  const { writeFileSync } = await import("fs");
  writeFileSync(outPath, sections.join("\n"), "utf8");
  writeFileSync(roundOutPath, roundWhyBlocks.join("\n"), "utf8");
  console.log(`Written ${outPath} and ${roundOutPath}`);
  await p.$disconnect();
}

main();
