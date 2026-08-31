/**
 * Full forensic MD report for Campaign A — 10 terminal rounds.
 * Usage: npx tsx scripts/build-overnight-10round-full-report.ts
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const ROOT = process.cwd();
const JOB_ID = "cmt4zxkbm001gun8ghz4qsb0w";
const ROUND_COUNT = 10;
const OUT_MD = path.join(ROOT, "KRIPTO_OVERNIGHT_10ROUND_FINAL_REPORT.md");

type Json = Record<string, unknown>;

function readJson<T>(p: string): T | null {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

function rp(roundNo: number) {
  return path.join(ROOT, "artifacts", "forensics", JOB_ID, "rounds", String(roundNo));
}

function fmtTs(v: string | null | undefined) {
  if (!v) return "—";
  return v.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function fmtMin(ms: number | null | undefined) {
  if (!ms) return "—";
  return `${(ms / 60000).toFixed(1)} dk`;
}

function pct(n: number, total: number) {
  if (!total) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

function countBy<T>(items: T[], keyFn: (x: T) => string): Record<string, number> {
  const m: Record<string, number> = {};
  for (const item of items) {
    const k = keyFn(item);
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
}

function topEntries(map: Record<string, number>, limit = 20) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function mdTable(headers: string[], rows: string[][]) {
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map((c) => String(c).replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`),
  ];
  return lines.join("\n");
}

function bulletMap(map: Record<string, number>, limit = 30) {
  if (!Object.keys(map).length) return "- (yok)";
  return topEntries(map, limit)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
}

function listArtifactFiles(roundNo: number) {
  const dir = rp(roundNo);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") || f.endsWith(".csv"))
    .map((f) => {
      const stat = fs.statSync(path.join(dir, f));
      return { name: f, kb: Math.round(stat.size / 1024) };
    })
    .sort((a, b) => b.kb - a.kb);
}

function aggregateScannerSummary(data: { cycles?: Array<Json> } | null) {
  const agg = {
    cycles: 0,
    universe: 0,
    eligible: 0,
    qualified: 0,
    rejected: 0,
    errors: 0,
    rejectionReasons: {} as Record<string, number>,
  };
  if (!data?.cycles) return agg;
  for (const c of data.cycles) {
    agg.cycles += 1;
    agg.universe += Number(c.universeCount ?? 0);
    agg.eligible += Number(c.eligibleCount ?? 0);
    agg.qualified += Number(c.qualifiedCount ?? 0);
    agg.rejected += Number(c.rejectedCount ?? 0);
    agg.errors += Number(c.errorCount ?? 0);
    const reasons = c.rejectionReasons as Record<string, number> | undefined;
    if (reasons) {
      for (const [k, v] of Object.entries(reasons)) {
        agg.rejectionReasons[k] = (agg.rejectionReasons[k] ?? 0) + Number(v);
      }
    }
  }
  return agg;
}

function aiProgressStats(candidates: Array<Json>) {
  const statuses = countBy(candidates, (c) => String(c.status ?? "UNKNOWN"));
  const durations = candidates.map((c) => Number(c.durationMs ?? 0)).filter((n) => n > 0);
  const sorted = [...durations].sort((a, b) => a - b);
  const p50 = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : 0;
  const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
  return { statuses, p50, p95, max: sorted.at(-1) ?? 0, total: candidates.length };
}

function filterBySymbol<T extends Json>(items: T[], symbol: string, symKey = "symbol") {
  return items.filter((x) => String(x[symKey] ?? "") === symbol);
}

function buildSelectedSymbolTrail(roundNo: number, symbol: string) {
  const base = rp(roundNo);
  const decisions = readJson<{ decisions?: Array<Json> }>(path.join(base, "decision-trace.json"))?.decisions ?? [];
  const consensus = readJson<{ consensus?: Array<Json> }>(path.join(base, "consensus-trace.json"))?.consensus ?? [];
  const evAudits = readJson<{ evAudits?: Array<Json> }>(path.join(base, "ev-trace.json"))?.evAudits ?? [];
  const lifecycle = readJson<Array<Json>>(path.join(base, "candidate-lifecycle.json")) ?? [];
  const tdiRecords = readJson<{ records?: Array<Json> }>(path.join(base, "tdi-decisions.json"))?.records ?? [];

  return {
    decisions: filterBySymbol(decisions, symbol),
    consensus: filterBySymbol(consensus, symbol),
    evAudits: filterBySymbol(evAudits, symbol),
    lifecycle: filterBySymbol(lifecycle, symbol),
    tdi: filterBySymbol(tdiRecords, symbol),
  };
}

function buildRoundSection(
  roundNo: number,
  run: {
    id: string;
    symbol: string | null;
    state: string;
    startedAt: Date;
    endedAt: Date | null;
    failReason: string | null;
    metadata: unknown;
  },
) {
  const symbol = run.symbol ?? "—";
  const base = rp(roundNo);
  const summary = readJson<Json>(path.join(base, "round-summary.json"));
  const budget = readJson<Json>(path.join(base, "selectionTimeBudgetBreakdown.json"));
  const oppFunnel = readJson<Json>(path.join(base, "opportunity-funnel.json"));
  const scanner = readJson<{ cycles?: Array<Json> }>(path.join(base, "scanner-summary.json"));
  const aiProgress = readJson<{ candidates?: Array<Json> }>(path.join(base, "ai-progress.json"));
  const errors = readJson<{ failures?: Array<Json>; failReason?: string }>(path.join(base, "errors.json"));
  const liveness = readJson<Json>(path.join(base, "round-liveness.json"));
  const watchdog = readJson<Json>(path.join(base, "round-watchdog.json"));
  const resolved = readJson<Json>(path.join(base, "resolved-config.json"));
  const tdiSens = readJson<Json>(path.join(base, "tdi-sensitivity.json"));
  const evAttrib = readJson<Json>(path.join(base, "ev-component-attribution.json"));
  const promo = readJson<Json>(path.join(base, "promotion-gate.json"));
  const p1Promo = readJson<Json>(path.join(base, "p1-promotion-gate.json"));
  const stratCmp = readJson<Json>(path.join(base, "strategy-comparison-report.json"));
  const artifacts = listArtifactFiles(roundNo);

  const runtime = (run.metadata as Json | null)?.runtime as Json | undefined;
  const durationMs = run.endedAt ? run.endedAt.getTime() - run.startedAt.getTime() : null;
  const funnel = (summary?.funnelState as Json | undefined) ?? {};
  const byStage = funnel.rejectionCountsByStage as Record<string, number> | undefined;
  const byReason = funnel.rejectionCountsByReason as Record<string, number> | undefined;

  const failures = errors?.failures ?? [];
  const failByStage = countBy(failures, (f) => String(f.stage ?? "unknown"));
  const failByReason = countBy(failures, (f) => String(f.reasonCode ?? "unknown"));

  const aiCandidates = aiProgress?.candidates ?? [];
  const aiStats = aiProgressStats(aiCandidates);
  const scannerAgg = aggregateScannerSummary(scanner);

  const trail = buildSelectedSymbolTrail(roundNo, symbol);

  const lines: string[] = [
    `## Tur #${roundNo} — ${symbol}`,
    "",
    "### Kimlik & DB",
    "",
    mdTable(
      ["Alan", "Değer"],
      [
        ["runId", run.id],
        ["jobId", JOB_ID],
        ["roundNo", String(roundNo)],
        ["state", run.state],
        ["symbol", symbol],
        ["startedAt", run.startedAt.toISOString()],
        ["endedAt", run.endedAt?.toISOString() ?? "—"],
        ["duration", fmtMin(durationMs)],
        ["selectionAttempt", String(runtime?.selectionAttempt ?? "—")],
        ["runtime.step", String(runtime?.step ?? summary?.currentStage ?? "—")],
        ["failReason (DB)", run.failReason ?? "—"],
        ["failReason (artifact)", String(summary?.failReason ?? "—")],
        ["exportKind", String(summary?.exportKind ?? "—")],
        ["exportStatus", String(summary?.exportStatus ?? "—")],
      ],
    ),
    "",
    "### round-summary — Özet Metrikler",
    "",
    mdTable(
      ["Metrik", "Değer"],
      [
        ["candidateCount", String(summary?.candidateCount ?? "—")],
        ["failureCount", String(summary?.failureCount ?? "—")],
        ["tradeCount", String(summary?.tradeCount ?? 0)],
        ["fills", String(summary?.fills ?? 0)],
        ["grossPnL", String(summary?.grossPnL ?? 0)],
        ["fees", String(summary?.fees ?? 0)],
        ["netPnl", String(summary?.netPnl ?? 0)],
        ["currentStage", String(summary?.currentStage ?? "—")],
        ["elapsedMs", String(summary?.elapsedMs ?? "—")],
        ["selectionBudgetMs", String(summary?.selectionBudgetMs ?? "—")],
        ["lastProgressAt", String(summary?.lastProgressAt ?? "—")],
        ["heartbeatAt", String(summary?.heartbeatAt ?? "—")],
      ],
    ),
    "",
    "### funnelState — Tam Rejection Haritası",
    "",
    "**By stage:**",
    bulletMap(byStage ?? {}, 50),
    "",
    "**By reason (tam liste):**",
    bulletMap(byReason ?? {}, 50),
    "",
    "**TDI runtime counters:**",
    "",
    mdTable(
      ["Counter", "Değer"],
      [
        ["tdiDecisions", String(funnel.tdiDecisions ?? "—")],
        ["runtimeTdiApproved", String(funnel.runtimeTdiApproved ?? "—")],
        ["runtimeTdiWait", String(funnel.runtimeTdiWait ?? "—")],
        ["runtimeTdiRejected", String(funnel.runtimeTdiRejected ?? "—")],
        ["upstreamCandidateRejected", String(funnel.upstreamCandidateRejected ?? "—")],
        ["hybridRejected", String(funnel.hybridRejected ?? "—")],
        ["consensusRejected", String(funnel.consensusRejected ?? "—")],
        ["masterRejected", String(funnel.masterRejected ?? "—")],
        ["scannerQualificationRejections", String(funnel.scannerQualificationRejections ?? "—")],
      ],
    ),
    "",
    "### opportunity-funnel — Aşama Kayıpları",
    "",
  ];

  const stages = (oppFunnel?.stages as Array<Json> | undefined) ?? [];
  if (stages.length) {
    lines.push(
      mdTable(
        ["Stage", "entered", "lost", "lostReason", "count", "%", "evidence"],
        stages.map((s) => [
          String(s.stage ?? ""),
          String(s.entered ?? ""),
          String(s.lost ?? ""),
          String(s.lostReason ?? ""),
          String(s.count ?? ""),
          String(s.percentage ?? ""),
          String(s.evidenceCompleteness ?? ""),
        ]),
      ),
      "",
    );
    const lossByReason = oppFunnel?.lossByReason as Record<string, { count?: number; percentage?: number }> | undefined;
    if (lossByReason) {
      lines.push("**lossByReason:**", "");
      lines.push(
        mdTable(
          ["Reason", "count", "%"],
          Object.entries(lossByReason).map(([k, v]) => [k, String(v.count ?? ""), String(v.percentage ?? "")]),
        ),
        "",
      );
    }
  } else {
    lines.push("- opportunity-funnel.json yok veya boş", "");
  }

  lines.push(
    "### selectionTimeBudgetBreakdown — Zaman Bütçesi",
    "",
    mdTable(
      ["Alan", "Değer"],
      [
        ["selectionBudgetMs", String(budget?.selectionBudgetMs ?? "—")],
        ["totalElapsedMs", String(budget?.totalElapsedMs ?? "—")],
        ["measuredTotalMs", String(budget?.measuredTotalMs ?? "—")],
        ["PRIMARY_TIME_CONSUMER", String(budget?.PRIMARY_TIME_CONSUMER ?? "—")],
      ],
    ),
    "",
  );

  const top5 = (budget?.TOP_5_TIME_CONSUMERS as Array<Json> | undefined) ?? [];
  if (top5.length) {
    lines.push("**TOP_5_TIME_CONSUMERS:**", "");
    lines.push(
      mdTable(
        ["stage", "totalMs", "share%"],
        top5.map((t) => [
          String(t.stage ?? ""),
          String(t.totalMs ?? ""),
          budget?.selectionBudgetMs
            ? pct(Number(t.totalMs ?? 0), Number(budget.selectionBudgetMs))
            : "—",
        ]),
      ),
      "",
    );
  }

  const budgetRows = (budget?.rows as Array<Json> | undefined) ?? [];
  if (budgetRows.length) {
    lines.push("**Tüm stage satırları:**", "");
    lines.push(
      mdTable(
        ["stage", "count", "totalMs", "p50", "p95", "max", "budgetShare%"],
        budgetRows
          .filter((r) => Number(r.totalMs ?? 0) > 0 || Number(r.count ?? 0) > 0)
          .map((r) => [
            String(r.stage ?? ""),
            String(r.count ?? ""),
            String(r.totalMs ?? ""),
            String(r.p50 ?? ""),
            String(r.p95 ?? ""),
            String(r.max ?? ""),
            String(r.shareOfSelectionBudget ?? ""),
          ]),
      ),
      "",
    );
  }

  lines.push(
    "### scanner-summary — Aggregate",
    "",
    mdTable(
      ["Metrik", "Değer"],
      [
        ["scanner cycles", String(scannerAgg.cycles)],
        ["universe (sum)", String(scannerAgg.universe)],
        ["eligible (sum)", String(scannerAgg.eligible)],
        ["qualified (sum)", String(scannerAgg.qualified)],
        ["rejected (sum)", String(scannerAgg.rejected)],
        ["errors (sum)", String(scannerAgg.errors)],
      ],
    ),
    "",
    "**Scanner rejection reasons (aggregate):**",
    bulletMap(scannerAgg.rejectionReasons, 25),
    "",
    "### errors.json — Failure Özeti",
    "",
    mdTable(
      ["Alan", "Değer"],
      [
        ["total failures", String(failures.length)],
        ["artifact failReason", String(errors?.failReason ?? "—")],
      ],
    ),
    "",
    "**By stage:**",
    bulletMap(failByStage, 15),
    "",
    "**By reasonCode (top 20):**",
    bulletMap(failByReason, 20),
    "",
    "### ai-progress — AI Pool",
    "",
    mdTable(
      ["Metrik", "Değer"],
      [
        ["processed", String(aiProgress?.processed ?? aiCandidates.length)],
        ["total", String(aiProgress?.total ?? aiCandidates.length)],
        ["successCount", String(aiProgress?.successCount ?? "—")],
        ["failedCount", String(aiProgress?.failedCount ?? "—")],
        ["timeoutCount", String(aiProgress?.timeoutCount ?? "—")],
        ["concurrency", String(aiProgress?.concurrency ?? "—")],
        ["duration p50", `${aiStats.p50} ms`],
        ["duration p95", `${aiStats.p95} ms`],
        ["duration max", `${aiStats.max} ms`],
        ["currentCandidate", String(aiProgress?.currentCandidate ?? "—")],
        ["currentStage", String(aiProgress?.currentStage ?? "—")],
      ],
    ),
    "",
    "**Status dağılımı:**",
    bulletMap(aiStats.statuses, 10),
    "",
  );

  if (aiCandidates.length) {
    lines.push("**Tüm AI candidate satırları:**", "");
    lines.push(
      mdTable(
        ["symbol", "status", "durationMs", "retry", "provider", "completedAt"],
        aiCandidates.map((c) => [
          String(c.symbol ?? ""),
          String(c.status ?? ""),
          String(c.durationMs ?? ""),
          String(c.retryCount ?? ""),
          String(c.provider ?? "").slice(0, 20),
          String(c.completedAt ?? "").slice(11, 19),
        ]),
      ),
      "",
    );
  }

  lines.push(
    `### Seçilen Sembol Pipeline — ${symbol}`,
    "",
    `Decision trace kayıtları: **${trail.decisions.length}** | Consensus: **${trail.consensus.length}** | EV: **${trail.evAudits.length}** | Lifecycle: **${trail.lifecycle.length}** | TDI: **${trail.tdi.length}**`,
    "",
  );

  if (trail.decisions.length) {
    lines.push("**decision-trace (seçilen sembol):**", "");
    lines.push(
      mdTable(
        ["timestamp", "stage", "verdict", "reasonCode", "reasonDetail", "score"],
        trail.decisions.slice(-25).map((d) => [
          String(d.timestamp ?? "").slice(11, 19),
          String(d.stage ?? ""),
          String(d.verdict ?? ""),
          String(d.reasonCode ?? ""),
          String(d.reasonDetail ?? "").slice(0, 80),
          String(d.score ?? ""),
        ]),
      ),
      "",
    );
  }

  if (trail.consensus.length) {
    lines.push("**consensus-trace (seçilen sembol, son 10):**", "");
    lines.push(
      mdTable(
        ["timestamp", "finalDecision", "masterRule", "reason", "votes"],
        trail.consensus.slice(-10).map((c) => [
          String(c.timestamp ?? "").slice(11, 19),
          String(c.finalDecision ?? ""),
          String(c.masterRuleId ?? ""),
          String(c.reason ?? "").slice(0, 60),
          JSON.stringify(c.providerVotes ?? {}).slice(0, 40),
        ]),
      ),
      "",
    );
  }

  if (trail.evAudits.length) {
    lines.push("**ev-trace (seçilen sembol, son 10):**", "");
    lines.push(
      mdTable(
        ["timestamp", "verdict", "EV", "threshold", "winProb", "RR", "reason"],
        trail.evAudits.slice(-10).map((e) => [
          String(e.timestamp ?? "").slice(11, 19),
          String(e.verdict ?? ""),
          String(e.expectedValue ?? ""),
          String(e.threshold ?? ""),
          String(e.winProbability ?? ""),
          String(e.expectedRiskReward ?? ""),
          String(e.reasonCode ?? ""),
        ]),
      ),
      "",
    );
  }

  if (trail.lifecycle.length) {
    lines.push("**candidate-lifecycle (seçilen sembol):**", "");
    lines.push(
      mdTable(
        ["timestamp", "stage", "verdict", "reasonCode", "detail"],
        trail.lifecycle.map((l) => [
          String(l.timestamp ?? "").slice(11, 19),
          String(l.stage ?? ""),
          String(l.verdict ?? ""),
          String(l.reasonCode ?? ""),
          String(l.reasonDetail ?? "").slice(0, 70),
        ]),
      ),
      "",
    );
  }

  if (trail.tdi.length) {
    lines.push("**tdi-decisions (seçilen sembol, son 15):**", "");
    lines.push(
      mdTable(
        ["timestamp", "verdict", "hybrid", "score", "detail"],
        trail.tdi.slice(-15).map((t) => [
          String(t.timestamp ?? t.evaluatedAt ?? "").slice(11, 19),
          String(t.verdict ?? ""),
          String(t.hybridDecision ?? ""),
          String(t.score ?? t.compositeScore ?? ""),
          String(t.reasonDetail ?? t.reason ?? "").slice(0, 70),
        ]),
      ),
      "",
    );
  }

  if (tdiSens) {
    lines.push(
      "### tdi-sensitivity",
      "",
      mdTable(
        ["Alan", "Değer"],
        [
          ["currentThreshold", String(tdiSens.currentThreshold ?? "—")],
          ["scoreAboveThresholdRate", String(tdiSens.scoreAboveThresholdRate ?? "—")],
          ["runtimeApprovalEquivalentRate", String(tdiSens.runtimeApprovalEquivalentRate ?? "—")],
          ["runtimeWaitCount", String(tdiSens.runtimeWaitCount ?? "—")],
          ["runtimeRejectedCount", String(tdiSens.runtimeRejectedCount ?? "—")],
          ["recommendation", String(tdiSens.recommendation ?? "—")],
          ["productionReplayStatus", String(tdiSens.productionReplayStatus ?? "—")],
        ],
      ),
      "",
    );
    const dist = tdiSens.scoreDistribution as Json | undefined;
    if (dist) {
      lines.push(
        "**Score distribution:** min=" +
          String(dist.min) +
          " p50=" +
          String(dist.p50) +
          " p90=" +
          String(dist.p90) +
          " max=" +
          String(dist.max),
        "",
      );
    }
  }

  if (evAttrib) {
    lines.push(
      "### ev-component-attribution",
      "",
      mdTable(
        ["component", "weight", "observed", "quality"],
        ((evAttrib.components as Array<Json> | undefined) ?? []).map((c) => [
          String(c.component ?? ""),
          String(c.weight ?? ""),
          String(c.observedContribution ?? ""),
          String(c.evidenceQuality ?? ""),
        ]),
      ),
      "",
      `Dominant component: **${String(evAttrib.dominantComponent ?? "—")}** (sample=${String(evAttrib.sampleSize ?? "—")})`,
      "",
    );
  }

  lines.push(
    "### round-liveness (tur sonu snapshot)",
    "",
    liveness
      ? mdTable(
          ["Alan", "Değer"],
          Object.entries(liveness).slice(0, 18).map(([k, v]) => [k, JSON.stringify(v).slice(0, 80)]),
        )
      : "- round-liveness.json yok",
    "",
    "### round-watchdog",
    "",
    watchdog
      ? mdTable(
          ["Alan", "Değer"],
          Object.entries(watchdog).map(([k, v]) => [k, JSON.stringify(v).slice(0, 100)]),
        )
      : "- round-watchdog.json yok",
    "",
    "### resolved-config (runtime)",
    "",
    resolved
      ? "```json\n" + JSON.stringify(resolved, null, 2).slice(0, 1200) + "\n```"
      : "- resolved-config.json yok",
    "",
    "### Promotion / Research Gates",
    "",
    mdTable(
      ["Gate", "promoted", "status/detail"],
      [
        ["promotion-gate", String(promo?.promoted ?? "—"), String(promo?.status ?? promo?.changeId ?? "—")],
        ["p1-promotion-gate", String(p1Promo?.promoted ?? "—"), String(p1Promo?.status ?? "—")],
        ["strategy-comparison", String(stratCmp?.promotionReady ?? "—"), String(stratCmp?.deterministicHash ?? "—")],
      ],
    ),
    "",
    "### Artifact Envanteri (bu tur)",
    "",
    mdTable(
      ["dosya", "KB"],
      artifacts.map((a) => [a.name, String(a.kb)]),
    ),
    "",
    "---",
    "",
  );

  return lines.join("\n");
}

async function main() {
  const prisma = new PrismaClient();
  const job = await prisma.autoRoundJob.findUnique({ where: { id: JOB_ID } });
  const runs = await prisma.autoRoundRun.findMany({
    where: { jobId: JOB_ID, roundNo: { gte: 1, lte: ROUND_COUNT } },
    orderBy: { roundNo: "asc" },
  });

  const round11 = await prisma.autoRoundRun.findFirst({
    where: { jobId: JOB_ID, roundNo: 11 },
    orderBy: { startedAt: "desc" },
  });

  const zombieCount = await prisma.autoRoundRun.count({
    where: {
      jobId: JOB_ID,
      endedAt: null,
      state: { in: ["tariyor", "coin_secildi", "alim_yapildi", "satis_bekleniyor"] },
    },
  });

  const startSnap = readJson<Json>(path.join(ROOT, "overnight-campaign-start.json"));

  const blockerCounts: Record<string, number> = {};
  for (const run of runs) {
    const reason = run.failReason ?? "";
    let blocker = "OTHER";
    if (reason.includes("AI_VETO") || reason.includes("AI_GATE_BLOCK")) blocker = "AI_VETO";
    else if (reason.includes("SIM_TIGHT_FILTER")) blocker = "SIM_TIGHT_FILTER";
    else if (reason.includes("TDI")) blocker = "TDI";
    blockerCounts[blocker] = (blockerCounts[blocker] ?? 0) + 1;
  }

  let aggCandidates = 0;
  let aggAi = 0;
  let aggTdiRej = 0;
  let aggTdiWait = 0;
  for (let i = 1; i <= ROUND_COUNT; i++) {
    const s = readJson<Json>(path.join(rp(i), "round-summary.json"));
    const tdi = readJson<{ records?: Array<Json> }>(path.join(rp(i), "tdi-decisions.json"));
    const ai = readJson<{ candidates?: Array<Json> }>(path.join(rp(i), "ai-progress.json"));
    aggCandidates += Number(s?.candidateCount ?? 0);
    aggAi += ai?.candidates?.length ?? 0;
    const recs = tdi?.records ?? [];
    aggTdiRej += recs.filter((r) => r.verdict === "REJECT" || r.verdict === "REJECTED").length;
    aggTdiWait += recs.filter((r) => r.verdict === "WAIT").length;
  }

  const md: string[] = [
    "# KRIPTO — Overnight 10 Tur FULL Forensic Rapor",
    "",
    `> Oluşturulma: ${new Date().toLocaleString("tr-TR")}`,
    `> Kapsam: Campaign A — job \`${JOB_ID}\` — terminal tur 1–10 (yeni kampanya başlatılmayacak)`,
    "",
    "---",
    "",
    "## 0. Executive Summary",
    "",
    "10 tur terminalize edildi. **0 trade**, **0 net PnL**. Dominant blok **AI_VETO (8/10)**. Scanner katmanı **SIM_TIGHT_FILTER (2/10)**. Job 30 tur planlıydı; Round 11 selection budget timeout sonrası **FAILED**. Policy değişikliği yapılmadı.",
    "",
    mdTable(
      ["Alan", "Değer"],
      [
        ["jobId", JOB_ID],
        ["status", String(job?.status ?? "—")],
        ["startedAt", job?.startedAt?.toISOString() ?? "—"],
        ["finishedAt", job?.finishedAt?.toISOString() ?? "—"],
        ["planlanan tur", String(job?.totalRounds ?? "—")],
        ["rapor tur", String(ROUND_COUNT)],
        ["failed tur", String(runs.filter((r) => r.state === "tur_basarisiz").length)],
        ["zombie", String(zombieCount)],
        ["lastError", String(job?.lastError ?? "—")],
        ["aggregate candidates", String(aggCandidates)],
        ["aggregate AI calls", String(aggAi)],
        ["aggregate TDI reject (artifact)", String(aggTdiRej)],
        ["aggregate TDI wait (artifact)", String(aggTdiWait)],
        ["profitability", "NOT_PROVEN"],
      ],
    ),
    "",
    "## 1. Kampanya Konfigürasyonu",
    "",
    mdTable(
      ["Parametre", "Değer"],
      [
        ["executionMode", String(startSnap?.executionMode ?? "paper")],
        ["exchange", String(startSnap?.exchange ?? "tr")],
        ["aiPolicy", String(startSnap?.aiPolicy ?? "VETO")],
        ["variantDEnabled", String(startSnap?.variantDEnabled ?? "—")],
        ["variantDShadow", String(startSnap?.variantDShadowEnabled ?? "—")],
        ["gitFingerprint", String(startSnap?.gitFingerprint ?? "—")],
        ["configFingerprint", String(startSnap?.configFingerprint ?? "—")],
        ["attachMode", String(startSnap?.attachMode ?? "—")],
        ["selectionBudgetSec", "1200"],
        ["maxWaitSec", "1800"],
      ],
    ),
    "",
    "## 2. Bloklayıcı Dağılımı",
    "",
    bulletMap(blockerCounts, 10),
    "",
    "## 3. Tur Zaman Çizelgesi (DB)",
    "",
    mdTable(
      ["Tur", "Sembol", "Başlangıç", "Bitiş", "Süre", "Attempt", "Son aşama", "Blok", "failReason"],
      runs.map((r) => {
        const rt = (r.metadata as Json | null)?.runtime as Json | undefined;
        const s = readJson<Json>(path.join(rp(r.roundNo), "round-summary.json"));
        const dur = r.endedAt ? Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 60000) : null;
        let blocker = "OTHER";
        const fr = r.failReason ?? "";
        if (fr.includes("AI_VETO") || fr.includes("AI_GATE_BLOCK")) blocker = "AI_VETO";
        else if (fr.includes("SIM_TIGHT_FILTER")) blocker = "SIM_TIGHT_FILTER";
        return [
          String(r.roundNo),
          r.symbol ?? "—",
          r.startedAt.toISOString().slice(11, 19),
          r.endedAt?.toISOString().slice(11, 19) ?? "—",
          dur ? `${dur}dk` : "—",
          String(rt?.selectionAttempt ?? "—"),
          String(rt?.step ?? s?.currentStage ?? "—"),
          blocker,
          String(r.failReason ?? "").slice(0, 100),
        ];
      }),
    ),
    "",
    "---",
    "",
    "## 4. Tur Bazlı FULL Detay",
    "",
  ];

  for (const run of runs) {
    md.push(buildRoundSection(run.roundNo, run));
  }

  md.push(
    "## 5. Round 11 — Job Abort & Zombie",
    "",
    round11
      ? mdTable(
          ["Alan", "Değer"],
          [
            ["round11 runId", round11.id],
            ["state", round11.state],
            ["symbol", round11.symbol ?? "—"],
            ["startedAt", round11.startedAt.toISOString()],
            ["endedAt", round11.endedAt?.toISOString() ?? "— (ZOMBIE)"],
            ["failReason", round11.failReason ?? "—"],
          ],
        )
      : "- Round 11 DB kaydı bulunamadı",
    "",
    "**Job lastError:** `" + String(job?.lastError ?? "—") + "`",
    "",
    "Round 11 attempt 3: scanner-ai pool ~83 candidate, ~9 işlendi → **1200s selection budget** doldu → job FAILED.",
    "",
    "## 6. Final Verdict",
    "",
    "```",
    "ROUND_TARGET = 10",
    "ROUNDS_COMPLETED = 0",
    "ROUNDS_FAILED = 10",
    "TRADES = 0",
    "NET_PNL = 0",
    "AI_VETO_BYPASS = 0",
    "ZOMBIE_ROUNDS = " + zombieCount,
    "VARIANT_D_LIVE_TRADES = 0",
    "PRIMARY_RUNTIME_INCIDENT = scanner-ai pool aborted: Tur secim suresi doldu (1200s)",
    "PRIMARY_LOSS_DRIVER = ZERO_TRADES_FUNNEL_BLOCK",
    "PROFITABILITY_STATUS = NOT_PROVEN",
    "POLICY_CHANGES = NO",
    "```",
    "",
    "## 7. Mühendislik Önceliği (10 tur verisi)",
    "",
    "1. **Selection budget vs throughput** — Round 1 `execution_preparation` ~87% budget; Round 11 scanner-ai timeout.",
    "2. **AI_VETO @ EXECUTING** — 8 tur pipeline derinliği yüksek; final gate reddi.",
    "3. **SIM_TIGHT_FILTER** — Tur #2 INJTRY, #6 LUNCTRY scanner block.",
    "4. **TDI approval = 0** — yoğun reject/wait; sensitivity NO_CHANGE öneriyor.",
    "5. **Zombie Round 11 reconcile** — yeni job engeli riski.",
    "",
  );

  fs.writeFileSync(OUT_MD, md.join("\n"), "utf8");
  const lineCount = md.join("\n").split("\n").length;
  console.log(JSON.stringify({ ok: true, out: OUT_MD, lines: lineCount, rounds: runs.length }));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
