import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const JOB_ID = process.argv[2] ?? "cmtasbdi60029unbwdxrckdxb";

type RoundRow = {
  roundNo: number;
  state: string;
  symbol: string | null;
  startedAt: string | null;
  endedAt: string | null;
  failReason: string;
  meta: Record<string, unknown>;
};

function pickMeta(meta: Record<string, unknown>, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (meta[k] !== undefined && meta[k] !== null) out[k] = meta[k];
  }
  return out;
}

function explainNoTrade(row: RoundRow): string[] {
  const lines: string[] = [];
  const reason = row.failReason ?? "";
  const m = row.meta;

  if (reason.includes("AI_GATE_BLOCK: AI_VETO")) {
    const veto = String(m.aiVetoStatus ?? m.aiVeto ?? "AI_VETO");
    const decision = String(m.aiFinalDecision ?? m.finalDecision ?? "");
    const consensus = String(m.aiConsensusDecision ?? "");
    const conf = m.confidence ?? m.aiConfidence;
    const symbol = row.symbol ?? m.symbol ?? "?";
    lines.push(`**Gate:** ` + "`ai-execution-gate.service` → AI VETO (risk lane red)");
    lines.push(`- Sembol: **${symbol}** seçildi, execution öncesi AI gate blokladı`);
    lines.push(`- AI finalDecision: ${decision || "—"}, consensus: ${consensus || "—"}, confidence: ${conf ?? "—"}`);
    lines.push(`- vetoStatus: ${veto}`);
    if (m.roleRiskVeto) lines.push("- AI-3_RISK role **veto=true** (risk skoru eşik altı)");
    if (m.technicalRoleScore) lines.push(`- Role skorları: tech=${m.technicalRoleScore}, sentiment=${m.sentimentRoleScore ?? "—"}, risk=${m.riskRoleScore ?? "—"}`);
    lines.push("- **Neden işlem yok:** Policy — AI risk/consensus BUY onaylamadı, execution gate hard block.");
    return lines;
  }

  if (reason.includes("SIM_TIGHT_FILTER")) {
    const profile = reason.match(/SIM_TIGHT_FILTER_(\w+)/)?.[1] ?? "15m";
    lines.push(`**Gate:** ` + "`evaluateAutoRoundLearningCandidate` → paper SIM tight filter (profile: ${profile})");
    lines.push(`- Sembol: **${row.symbol ?? m.symbol ?? "?"}** funnel sonrası learning lane reddi`);
    const parts = reason.split("|").map((s) => s.trim()).filter(Boolean);
    for (const p of parts.slice(1)) lines.push(`- Red koşulu: ${p}`);
    if (reason.includes("mtf=0.0")) {
      lines.push("- MTF alignment 0.0 → ya AI MTF verisi yok ya da alignment skoru 0 (data contract veya zayıf teknik uyum)");
    }
    if (reason.includes("pump risk")) {
      const raw = m.pumpRiskRawScore ?? m.pumpRisk;
      lines.push(`- pumpRisk capped: score=${m.pumpRisk ?? "—"}, raw=${raw ?? "—"} (formül 100'e clamp)");
    }
    const eq = m.entryQuality as Record<string, unknown> | undefined;
    if (eq) lines.push(`- entryQuality: ok=${eq.ok}, score=${eq.score ?? eq.totalScore ?? "—"}, min=${eq.minScore ?? "—"}`);
    lines.push("- **Neden işlem yok:** Policy — paper kalite eşikleri (composite, scanner, spread, pump risk, kalite skoru) geçilemedi.");
    return lines;
  }

  if (reason.includes("NO_TRADE") || reason.includes("pump ve steady-gain")) {
    const scanned = reason.match(/scanned=(\d+)/)?.[1] ?? m.scannedCount ?? "?";
    const candidates = reason.match(/candidates=(\d+)/)?.[1] ?? m.candidateCount ?? "?";
    lines.push(`**Gate:** ` + "`round-selection` / scanner funnel → pump-lane + steady-gain lane");
    lines.push(`- Bu turda **pump continuation** veya **steady-gain** lane'ine uygun aday bulunamadı`);
    lines.push(`- Taranan: ${scanned} sembol, funnel sonrası candidate: ${candidates}`);
    lines.push("- Scanner 100 sembol tarar; adaylar `PUMP_CONTINUATION`, `PUMP_INTRADAY`, `steady-gain` explanation veya top-gainer pump metadata ile işaretlenmeli");
    lines.push("- **Neden işlem yok:** Funnel — piyasa koşulu veya scanner seçimi pump/steady lane'e düşmedi (policy, bug değil).");
    if (m.consecutiveFilterRejections) lines.push(`- consecutiveFilterRejections: ${m.consecutiveFilterRejections}`);
    return lines;
  }

  if (reason.includes("heartbeat") || reason.includes("stall")) {
    lines.push(`**Gate:** Runtime stall watchdog (180s eşik)`);
    lines.push(`- Step: ${m.step ?? m.runtimeStep ?? "—"}, heartbeatAge: ${m.heartbeatAgeSec ?? "181s+"}`);
    lines.push("- **Neden işlem yok:** Engineering — tur AI/scan aşamasında takıldı, heartbeat güncellenmedi, watchdog turu fail etti.");
    return lines;
  }

  if (reason.includes("Transaction already closed") || reason.includes("expired transaction")) {
    lines.push(`**Gate:** Prisma interactive transaction (hot-path 25s timeout)`);
    lines.push("- Tx içinde AI+DB işi 30s+ sürdü → transaction expire → tur/job FAILED");
    lines.push("- **Neden işlem yok:** Engineering P0 — DB tx süresi yetmedi, execution aşamasına ulaşılmadı veya finalize crash.");
    return lines;
  }

  if (reason.includes("Tur motoru durduruldu")) {
    lines.push(`**Gate:** ` + "`stopAutoRoundJob` / finalizeStoppedAutoRoundJob`");
    lines.push("- Job `stopRequested=true` → aktif tur `Tur motoru durduruldu` ile fail");
    lines.push("- **Neden işlem yok:** Operator veya stop API; policy/engineering değil, manuel/otomatik durdurma.");
    return lines;
  }

  lines.push(`- Ham fail: ${reason.slice(0, 300)}`);
  return lines;
}

function categorize(reason: string) {
  if (!reason) return "UNKNOWN";
  if (reason.includes("Tur motoru durduruldu")) return "OPERATOR_STOP";
  if (reason.includes("Transaction already closed")) return "P0_DB_TX_TIMEOUT";
  if (reason.includes("heartbeat") || reason.includes("stall")) return "P0_RUNTIME_STALL";
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

  const rows: RoundRow[] = job.rounds.map((r) => {
    const m = (r.metadata ?? {}) as Record<string, unknown>;
    return {
      roundNo: r.roundNo,
      state: r.state,
      symbol: r.symbol,
      startedAt: r.startedAt?.toISOString() ?? null,
      endedAt: r.endedAt?.toISOString() ?? null,
      failReason: String(r.failReason ?? ""),
      meta: m,
    };
  });

  const lines: string[] = [];
  lines.push("# 100 Tur Paper — Tur 18 Durma + İşlem Açmama Derin Forensic Raporu");
  lines.push("");
  lines.push(`**Job:** ${JOB_ID}`);
  lines.push(`**Rapor zamanı:** ${new Date().toISOString()}`);
  lines.push(`**Job status:** ${job.status} | stopRequested: ${job.stopRequested} | lastError: ${job.lastError ?? "—"}`);
  lines.push(`**Özet:** ${job.failedRounds} fail tur, ${job.completedRounds} başarılı tur, **0 açık işlem** (hiç `alim_yapildi` / pozisyon açılmadı).");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 1. İşlem Neden Hiç Açılmadı? (Üst Düzey)");
  lines.push("");
  lines.push("| Engel tipi | Tur sayısı | Kullanılan mekanizma |");
  lines.push("|------------|------------|----------------------|");
  const counts: Record<string, number> = {};
  for (const r of rows) counts[categorize(r.failReason)] = (counts[categorize(r.failReason)] ?? 0) + 1;
  const mechanism: Record<string, string> = {
    POLICY_AI_VETO: "`ai-execution-gate` → AI_VETO after symbol selected",
    POLICY_NO_TRADE: "`round-selection` → pump/steady-gain lane boş",
    POLICY_SIM_TIGHT: "`evaluateAutoRoundLearningCandidate` → SIM tight filter",
    P0_RUNTIME_STALL: "Round progress watchdog 180s heartbeat",
    P0_DB_TX_TIMEOUT: "Prisma tx 25s timeout (hot-path)",
    OPERATOR_STOP: "`stopAutoRoundJob` stopRequested",
    OTHER: "—",
  };
  for (const [cat, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${cat} | ${n} | ${mechanism[cat] ?? "—"} |`);
  }
  lines.push("");
  lines.push("**Önemli:** Tur 1–3 sembol **seçildi** (coin_secildi) ama AI gate VETO verdi — scanner aday buldu, execution gate kapattı. Tur 4+ çoğunlukla funnel hiç uygun lane adayı üretmedi veya SIM filter reddi.");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 2. Funnel Haritası (Kod Yolu)");
  lines.push("");
  lines.push("```");
  lines.push("PUMP_SCAN / FULL_SCAN → scanner candidates");
  lines.push("  → AI_ANALYSIS (64–100 sembol consensus)");
  lines.push("  → lane: pump-lane | steady-gain | learning-micro");
  lines.push("  → evaluateAutoRoundLearningCandidate (SIM_TIGHT_FILTER paper profile)");
  lines.push("  → ai-execution-gate (AI_VETO / BUY)");
  lines.push("  → executeAnalyzeAndTrade (paper order)");
  lines.push("```");
  lines.push("");
  lines.push("Bu job'da **execution satırına hiç ulaşılmadı** — tüm turlar yukarıdaki zincirde erken fail.");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 3. Tur Bazlı Detay (Neden İşlem Yok?)");
  lines.push("");

  for (const row of rows) {
    const dur =
      row.startedAt && row.endedAt
        ? Math.round((new Date(row.endedAt).getTime() - new Date(row.startedAt).getTime()) / 1000)
        : null;
    lines.push(`### Tur ${row.roundNo} — ${categorize(row.failReason)} (${dur ?? "?"} sn)`);
    lines.push("");
    if (row.symbol) lines.push(`- **Seçilen sembol:** ${row.symbol}`);
    lines.push(`- **Son state:** ${row.state}`);
    lines.push(`- **Başlangıç / bitiş:** ${row.startedAt ?? "—"} → ${row.endedAt ?? "—"}`);
    const snap = pickMeta(row.meta, [
      "step",
      "selectedReason",
      "aiFinalDecision",
      "aiConsensusDecision",
      "aiVetoStatus",
      "confidence",
      "technicalRoleScore",
      "sentimentRoleScore",
      "riskRoleScore",
      "compositeAvg",
      "mtfAlignment",
      "mtfStatus",
      "scannerScore",
      "scannerConfidence",
      "pumpRisk",
      "pumpRiskRawScore",
      "pumpRiskCapped",
      "spreadPercent",
      "consecutiveFilterRejections",
      "entryQuality",
      "entryDecision",
      "scannerPolicyAction",
      "learningLane",
      "pumpLane",
    ]);
    if (Object.keys(snap).length > 0) {
      lines.push("- **Metadata snapshot:**");
      lines.push("```json");
      lines.push(JSON.stringify(snap, null, 2).slice(0, 2000));
      lines.push("```");
    }
    lines.push("");
    for (const l of explainNoTrade(row)) lines.push(l);
    lines.push("");
    if (row.failReason) {
      lines.push("<details><summary>Ham failReason</summary>");
      lines.push("");
      lines.push(row.failReason.replace(/\n/g, " "));
      lines.push("");
      lines.push("</details>");
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  lines.push("## 4. Policy Eşikleri (Paper Profile — 15m)");
  lines.push("");
  lines.push("`resolvePaperRoundProfile` paper modda eşikleri gevşetir ama yine de:");
  lines.push("- minConfidence ~48+, minScannerScore ~44+, maxPumpRisk ~92");
  lines.push("- SIM tight filter: composite, sentiment, MTF, scanner confidence, kalite skoru (entryQuality)");
  lines.push("- AI gate: `AI_VETO` = risk lane veto veya consensus SELL/HOLD");
  lines.push("");
  lines.push("## 5. Engineering Fail Zinciri (Tur 16–18)");
  lines.push("");
  lines.push("1. Uzun AI_ANALYSIS (64–100 sembol) → heartbeat 180s+ güncellenmez");
  lines.push("2. Stall watchdog tur fail (`No heartbeat/progress within stall threshold`)");
  lines.push("3. Prisma `runInstrumentedTransaction` 25s limit — finalize/complete round 30s+ → **tx expired**");
  lines.push("4. Recovery `REGISTRY_INTEGRITY` tekrarları → escalation 5 → `STOP_JOB`");
  lines.push("5. Tur 18: `stopRequested` → `Tur motoru durduruldu`");
  lines.push("");
  lines.push("## 6. Watchdog / Recovery Özeti");
  lines.push("");
  for (const ev of recoveryAudit.slice(0, 12)) {
    lines.push(`- ${ev.timestamp}: action=${ev.action}, failure=${ev.failure}, message=${ev.message}`);
  }
  lines.push("");
  lines.push("## 7. Sonuç");
  lines.push("");
  lines.push("- **0 trade:** Policy funnel (NO_TRADE, VETO, SIM filter) + engineering stall/tx — execution'a ulaşılmadı.");
  lines.push("- **18. tur durması:** `stopRequested` (Tur motoru durduruldu); agent watchdog kill değil.");
  lines.push("- **Kalıcı STOP:** Recovery escalation limit + REGISTRY_INTEGRITY.");
  lines.push("");
  lines.push("## 8. Açık P0 Fix Listesi");
  lines.push("");
  lines.push("| Fix | Dosya / alan |");
  lines.push("|-----|----------------|");
  lines.push("| Tx timeout 25s → 45s veya tx split | `auto-round-integrity.repository.ts` HOT_PATH_TX |");
  lines.push("| AI_ANALYSIS heartbeat interval | `round-runtime.service.ts` |");
  lines.push("| Stall 180s vs uzun AI batch | `round-progress-watchdog` |");
  lines.push("| REGISTRY reconcile before escalation | `scheduler-recovery.service.ts` |");

  const out = "KRIPTO_18ROUND_STOP_FORENSIC_REPORT.md";
  writeFileSync(out, lines.join("\n"), "utf8");
  console.log(`Written ${out} (${rows.length} rounds, ${lines.length} lines)`);
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
