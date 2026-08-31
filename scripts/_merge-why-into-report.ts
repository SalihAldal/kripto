import { readFileSync, writeFileSync } from "fs";

const reportPath = "KRIPTO_100ROUND_PAPER_FORENSIC_REPORT.md";
const whyPath = "artifacts/paper-why-sections.md";
const roundWhyPath = "artifacts/paper-round-why.md";

let report = readFileSync(reportPath, "utf8");
const whySections = readFileSync(whyPath, "utf8");
const roundWhy = readFileSync(roundWhyPath, "utf8");

// Parse round why blocks by round number
const whyByRound = new Map<number, string>();
const blocks = roundWhy.split(/(?=### Tur \d+ — Neden\?)/);
for (const block of blocks) {
  const m = block.match(/^### Tur (\d+) — Neden\?/);
  if (!m) continue;
  whyByRound.set(Number(m[1]), block.trim());
}

// Replace section 2 through start of section 4
const sec2Start = report.indexOf("## 2. Neden işlem açılmıyor?");
const sec4Start = report.indexOf("## 4. Final state dağılımı");
if (sec2Start < 0 || sec4Start < 0) throw new Error("section markers not found");

report =
  report.slice(0, sec2Start) +
  whySections +
  "\n\n---\n\n" +
  report.slice(sec4Start);

// Insert why after each ### Tur N block's fail reason section (before ---)
report = report.replace(
  /(### Tur (\d+)\n[\s\S]*?(?:\n---\n))/g,
  (full, _g0, roundNoStr) => {
    const n = Number(roundNoStr);
    const why = whyByRound.get(n);
    if (!why) return full;
    // avoid double insert
    if (full.includes("— Neden?")) return full;
    const insertPoint = full.lastIndexOf("\n---\n");
    if (insertPoint < 0) return full;
    return full.slice(0, insertPoint) + "\n\n" + why + "\n\n" + full.slice(insertPoint);
  },
);

// Expand section 6 patterns
const sec6Start = report.indexOf("## 6. Tekrarlayan pattern'ler");
const sec7Start = report.indexOf("## 7. Önerilen aksiyonlar");
if (sec6Start >= 0 && sec7Start >= 0) {
  const expanded6 = [
    "## 6. Tekrarlayan pattern'ler (detaylı neden)",
    "",
    "### 6.1 MTF = 0.0 (çoğu SIM_TIGHT_FILTER turunda)",
    "",
    "**Ne görüyoruz:** Her non-pump red mesajında mtf=0.0.",
    "",
    "**Neden:** Multi-timeframe momentum pipeline paper modda veri üretmiyor veya cache stale. TDI/MTF feed bağlantısı kopuk, timeframe aggregation çalışmıyor, veya indicator backfill eksik.",
    "",
    "**Etki:** Composite ve kalite skoru düşer; SIM tight filter eşiği geçilemez. Tek başına 26/100 kalite skoruna katkı.",
    "",
    "### 6.2 Pump risk 100 > 96",
    "",
    "**Ne görüyoruz:** pump risk 100.00 > 96 neredeyse her SIM_TIGHT turunda.",
    "",
    "**Neden:** Paper shadow risk skoru kalibrasyonu — non-pump coinlere max risk atanmış olabilir. Eşik 96 ile birleşince fiili sıfır tolerance.",
    "",
    "**Etki:** Pump lane dışı coinler execution'a ulaşamaz; işlem açılmaz.",
    "",
    "### 6.3 Scanner confidence ~15–28 vs eşik 36–40",
    "",
    "**Ne görüyoruz:** Scanner aday üretiyor ama confidence 15–28 bandında.",
    "",
    "**Neden:** Momentum recalibration paper ortamında düşük; learning mod confidence interaction; spread/liquidity paper sim farkı.",
    "",
    "**Etki:** Scanner gate reddi → coin seçilse bile filter VETO.",
    "",
    "### 6.4 selectedReason = NO_TRADE ama symbol atanmış",
    "",
    "**Ne görüyoruz:** NO_TRADE resolved by master decision engine, confidence 16–19 ama symbol dolu.",
    "",
    "**Neden:** Master decision engine NO_TRADE derken round selection pipeline yine symbol bind ediyor — funnel state sync bug veya shadow execute path.",
    "",
    "**Etki:** EXECUTING'e giriliyor, sonra AI_VETO — gereksiz AI çağrısı ve zaman kaybı.",
    "",
    "### 6.5 Tur 1–2: 1021s timeout",
    "",
    "**Ne görüyoruz:** SENTTRY, TAOTRY seçildi; state coin_secildi/EXECUTING; 1021s sonra fail.",
    "",
    "**Neden:** Dev sunucu kesildi veya scheduler process öldü; heartbeat güncellenmedi; watchdog tur yaşı limiti.",
    "",
    "**Etki:** İlk gece işlem pipeline hiç tamamlanmadı.",
    "",
    "### 6.6 DB 25P02 cascade (tur 10, 19, 32)",
    "",
    "**Ne görüyoruz:** Prisma findFirst inside aborted transaction.",
    "",
    "**Neden:** Önceki SQL error aynı interactive tx'te rollback edilmedi; P2002 race handler ek query çalıştırdı.",
    "",
    "**Etki:** Job FAILED; manuel/watch resume gerekti.",
    "",
    "### 6.7 Version conflict (tur 63)",
    "",
    "**Ne görüyoruz:** transactionallyFailRound job version conflict.",
    "",
    "**Neden:** Ardışık hızlı fail + recovery + multiple scheduler owner aynı job version yazdı.",
    "",
    "**Etki:** Job FAILED; gece kampanyası durdu.",
    "",
  ].join("\n");
  report = report.slice(0, sec6Start) + expanded6 + "\n\n" + report.slice(sec7Start);
}

// Update timestamp
report = report.replace(
  /\*\*Oluşturma:\*\* [^\n]+/,
  `**Oluşturma:** ${new Date().toISOString()} (genişletilmiş neden + kesinti analizi)`,
);

writeFileSync(reportPath, report, "utf8");
console.log("Merged report:", reportPath, "lines:", report.split("\n").length);
