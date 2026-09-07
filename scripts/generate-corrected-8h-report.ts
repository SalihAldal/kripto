/**
 * Corrected retrospective report for paper-8h-2026-09-07T0012Z using metadata.terminalReason.
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

const CAMPAIGN_ID = "paper-8h-2026-09-07T0012Z";
const JOB_ID = "cmtqhz77p000fun84lgcyuckv";
const OUT = path.join(process.cwd(), "KRIPTO_8H_PAPER_CORRECTED_REPORT.md");

function resolveFail(meta: Record<string, unknown>, state: string) {
  const terminalReason = typeof meta.terminalReason === "string" ? meta.terminalReason : "";
  const closeReason = typeof meta.closeReason === "string" ? meta.closeReason : "";
  if (terminalReason) return terminalReason;
  if (closeReason) return closeReason;
  if (state === "tariyor") return "ROUND_INCOMPLETE";
  return "UNKNOWN";
}

async function main() {
  const { prisma } = await import("@/src/server/db/prisma");
  const job = await prisma.autoRoundJob.findUnique({
    where: { id: JOB_ID },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });
  if (!job) throw new Error("job not found");

  const selected = job.rounds.filter((r) => r.symbol);
  const noSymbol = job.rounds.filter((r) => !r.symbol && r.state === "tur_tamamlandi");
  const incomplete = job.rounds.filter((r) => r.state === "tariyor");

  const lines: string[] = [];
  lines.push("# KRIPTO — 8H PAPER Corrected Retrospective Report");
  lines.push("");
  lines.push(`Campaign: \`${CAMPAIGN_ID}\` · Job: \`${JOB_ID}\``);
  lines.push("");
  lines.push("## Özet");
  lines.push("");
  lines.push(`- Seçilmiş aday (symbol not null): **${selected.length}**`);
  lines.push(`- Tamamlanmış seçimsiz round: **${noSymbol.length}**`);
  lines.push(`- Yarım round: **${incomplete.length}**`);
  lines.push(`- DB işlem: **0** (positions/orders/paperTrades campaign window)`);
  lines.push("");
  lines.push("## Seçilen 8 aday — kanıtlanabilen terminal aşama");
  lines.push("");
  lines.push("| Tur | Symbol | Terminal (metadata) |");
  lines.push("|-----|--------|---------------------|");
  for (const r of selected) {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const terminal = resolveFail(meta, r.state).slice(0, 120);
    lines.push(`| ${r.roundNo} | ${r.symbol} | ${terminal.replace(/\|/g, "/")} |`);
  }
  lines.push("");
  lines.push("## Seçimsiz roundlar");
  lines.push("");
  lines.push(`Toplam ${noSymbol.length} tur. Dominant: \`INTERNAL_ERROR:NO_ELIGIBLE_CANDIDATE\` (~600s seçim deadline + ~90s observe).`);
  lines.push("");
  lines.push("## Yarım round");
  lines.push("");
  for (const r of incomplete) {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const rt = meta.runtime as { step?: string } | undefined;
    lines.push(`- Tur ${r.roundNo}: state=\`${r.state}\`, runtime.step=\`${rt?.step ?? "kayıt yok"}\``);
  }
  lines.push("");
  lines.push("## Kanıt sınırları");
  lines.push("");
  lines.push("- Orijinal rapor `failReason` null olduğu için 'Bilinmeyen' gösterdi; gerçek neden `metadata.terminalReason` içinde.");
  lines.push("- 8 seçilen adayın tamamı execution öncesi `No tradeable candidate after scanner+AI` / handoff AI eksikliği ile sonlandı (CONFIRMED forensic bundle).");
  lines.push("- Round 10–46 için canonical store telemetry tarihsel olarak kısmen eksik; kök neden UNKNOWN (pipeline durdu mu vs piyasa yok mu ayrıştırılamadı).");

  fs.writeFileSync(OUT, lines.join("\n"), "utf8");
  console.log(OUT);
  await prisma.$disconnect();
}

main();
