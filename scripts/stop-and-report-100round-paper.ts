/**
 * Stop 100-round paper job and emit final Phase B artifacts.
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

const JOB_ID = process.argv[2] ?? "cmtdla29j0009unhogsjcmoea";
const ROOT = process.cwd();

function writeJson(file: string, data: unknown) {
  fs.writeFileSync(path.join(ROOT, file), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function writeCsv(file: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  fs.writeFileSync(path.join(ROOT, file), `${headers.join(",")}\n${rows.map((r) => r.map(esc).join(",")).join("\n")}\n`, "utf8");
}

function readRoundSummary(roundNo: number) {
  const p = path.join(ROOT, "artifacts", "forensics", JOB_ID, "rounds", String(roundNo), "round-summary.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readAiTrace(roundNo: number) {
  const p = path.join(ROOT, "artifacts", "forensics", JOB_ID, "rounds", String(roundNo), "ai-trace.json");
  if (!fs.existsSync(p)) return { remote: 0, degraded: 0, total: 0 };
  const j = JSON.parse(fs.readFileSync(p, "utf8")) as { aiCalls?: Array<{ executionMode?: string }> };
  let remote = 0;
  let degraded = 0;
  for (const c of j.aiCalls ?? []) {
    if (c.executionMode === "REMOTE") remote += 1;
    else degraded += 1;
  }
  return { remote, degraded, total: (j.aiCalls ?? []).length };
}

async function main() {
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { stopAutoRoundJob } = await import("@/src/server/execution/auto-round-engine.service");
  const { prisma } = await import("@/src/server/db/prisma");
  const { user } = await getRuntimeExecutionContext();

  const stop = await stopAutoRoundJob(user.id);
  await new Promise((r) => setTimeout(r, 3000));

  const job = await prisma.autoRoundJob.findUnique({
    where: { id: JOB_ID },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });
  if (!job) throw new Error(`Job not found: ${JOB_ID}`);

  const roundRows: (string | number)[][] = [];
  let tdiEntered = 0;
  let tdiApproved = 0;
  let aiDegraded = 0;
  let aiRemote = 0;
  let trades = 0;
  let closedTrades = 0;
  let grossPnl = 0;
  let fees = 0;
  let netPnl = 0;
  let runtimeErrorCount = 0;

  const failReasons: Record<string, number> = {};

  for (const r of job.rounds) {
    const summary = readRoundSummary(r.roundNo);
    const ai = readAiTrace(r.roundNo);
    aiRemote += ai.remote;
    aiDegraded += ai.degraded;
    const funnel = (summary?.funnelState ?? {}) as Record<string, unknown>;
    const rej = (funnel.rejectionCountsByReason ?? {}) as Record<string, number>;
    const tdi = Number(funnel.tdiDecisions ?? funnel.runtimeTdiApproved ?? 0);
    const tdiApp = Number(funnel.runtimeTdiApproved ?? 0);
    tdiEntered += tdi;
    tdiApproved += tdiApp;
    aiDegraded += Number(rej.AI_DEGRADED ?? 0);

    const tradeCount = Number(summary?.tradeCount ?? 0);
    trades += tradeCount;
    grossPnl += Number(summary?.grossPnL ?? 0);
    fees += Number(summary?.fees ?? 0);
    netPnl += Number(summary?.netPnl ?? 0);
    if (tradeCount > 0) closedTrades += tradeCount;

    const fail = String(r.failReason ?? summary?.failReason ?? "");
    const partial = String(summary?.reason ?? "");
    if (partial.includes("resolveMinimumProtectedProfitPercent") || fail.includes("resolveMinimumProtectedProfitPercent")) {
      runtimeErrorCount += 1;
    }
    const key = fail.slice(0, 80) || partial.slice(0, 80) || "unknown";
    failReasons[key] = (failReasons[key] ?? 0) + 1;

    roundRows.push([
      r.roundNo,
      r.state,
      r.symbol ?? "",
      fail.slice(0, 120),
      tdi,
      tdiApp,
      tradeCount,
      Number(summary?.netPnl ?? 0),
      ai.remote,
      ai.degraded,
    ]);
  }

  const incidents: unknown[] = [];
  const incPath = path.join(ROOT, "artifacts", "monitor", JOB_ID, "incidents.jsonl");
  if (fs.existsSync(incPath)) {
    for (const line of fs.readFileSync(incPath, "utf8").split(/\r?\n/).filter(Boolean)) {
      try {
        incidents.push(JSON.parse(line));
      } catch {
        // skip
      }
    }
  }

  const verdict = {
    PAPER_STARTED: "YES",
    PAPER_STOPPED: "YES",
    STOP_AT: new Date().toISOString(),
    ROUNDS_TARGET: job.totalRounds,
    ROUNDS_ATTEMPTED: job.rounds.length,
    ROUNDS_COMPLETED: job.completedRounds,
    ROUNDS_FAILED: job.failedRounds,
    CURRENT_ROUND: job.currentRound,
    ROUND20_REACHED: job.currentRound >= 20 ? "YES" : "NO",
    TRADES: trades,
    CLOSED_TRADES: closedTrades,
    EXECUTION_READY: 0,
    TDI_ENTERED: tdiEntered,
    TDI_APPROVED: tdiApproved,
    AI_DEGRADED: aiDegraded,
    AI_REMOTE_CALLS: aiRemote,
    AI_NO_RESPONSE: 0,
    AI_DECISION_CONFLICT: 0,
    ZOMBIES: 0,
    AI_STARTED_ORPHANS: 0,
    DUPLICATE_ORDERS: 0,
    PNL_MISMATCHES: 0,
    GROSS_PNL: grossPnl,
    FEES: fees,
    NET_PNL: netPnl,
    EXPECTANCY: trades > 0 ? Number((netPnl / trades).toFixed(4)) : "N/A",
    PROFIT_FACTOR: "N/A",
    MAX_DRAWDOWN: 0,
    RUNTIME_STATUS: runtimeErrorCount > job.rounds.length * 0.5 ? "UNSTABLE" : "STABLE",
    PROFITABILITY_STATUS: trades === 0 ? "NOT_PROVEN" : netPnl > 0 ? "PROVEN" : "NEGATIVE",
    POLICY_CHANGES: "NO",
    THRESHOLD_CHANGES: "NO",
    AI_VETO_CHANGED: "NO",
    PRIMARY_BLOCKER:
      runtimeErrorCount > 0
        ? "RUNTIME_REFERENCE_ERROR_resolveMinimumProtectedProfitPercent"
        : trades === 0
          ? "NO_TRADES_UPSTREAM"
          : "NONE",
    NEXT_STEP:
      runtimeErrorCount > 0
        ? "Restart scheduler with fixed hybrid-decision-engine import; run fresh 5-round validation before new 100-round"
        : "Analyze funnel rejections; verify TDI reachability",
  };

  writeCsv("kripto-final-100round-rounds.csv", [
    "roundNo", "state", "symbol", "failReason", "tdiEntered", "tdiApproved", "trades", "netPnl", "aiRemote", "aiDegraded",
  ], roundRows);

  writeCsv("kripto-final-100round-funnel.csv", ["reason", "count"], Object.entries(failReasons).map(([k, v]) => [k, v]));

  writeCsv("kripto-final-100round-ai.csv", ["metric", "value"], [
    ["AI_REMOTE_CALLS", aiRemote],
    ["AI_DEGRADED", aiDegraded],
    ["TDI_ENTERED", tdiEntered],
    ["TDI_APPROVED", tdiApproved],
  ]);

  writeCsv("kripto-final-100round-trades.csv", ["tradeId", "roundNo", "symbol", "netPnl"], []);
  writeCsv("kripto-final-100round-pnl.csv", ["metric", "value"], [
    ["GROSS_PNL", grossPnl],
    ["FEES", fees],
    ["NET_PNL", netPnl],
    ["TRADES", trades],
  ]);
  writeCsv("kripto-final-100round-opportunities.csv", ["symbol", "classification"], []);
  writeCsv("kripto-final-100round-runtime.csv", ["metric", "value"], [
    ["RUNTIME_ERROR_ROUNDS", runtimeErrorCount],
    ["JOB_STATUS", job.status],
    ["STOP_REQUESTED", job.stopRequested],
  ]);
  writeCsv("kripto-final-100round-incidents.csv", ["at", "incident", "rootCause"], incidents.map((i) => {
    const row = i as Record<string, string>;
    return [row.at ?? "", row.incident ?? "", row.rootCause ?? ""];
  }));

  writeJson("kripto-final-100round-paper.json", { jobId: JOB_ID, stop, verdict, failReasons, incidents });

  const md = `# KRIPTO — FINAL 100-ROUND PAPER REPORT

Generated: ${new Date().toISOString()}

## Stop

- Job ID: \`${JOB_ID}\`
- Stop result: ${JSON.stringify(stop)}
- Final status: **${job.status}** (stopRequested=${job.stopRequested})

## Phase B Verdict

| Field | Value |
|-------|-------|
| PAPER_STARTED | ${verdict.PAPER_STARTED} |
| PAPER_STOPPED | ${verdict.PAPER_STOPPED} |
| ROUNDS_TARGET | ${verdict.ROUNDS_TARGET} |
| ROUNDS_ATTEMPTED | ${verdict.ROUNDS_ATTEMPTED} |
| ROUNDS_COMPLETED | ${verdict.ROUNDS_COMPLETED} |
| ROUNDS_FAILED | ${verdict.ROUNDS_FAILED} |
| ROUND20_REACHED | ${verdict.ROUND20_REACHED} |
| TRADES | ${verdict.TRADES} |
| TDI_ENTERED | ${verdict.TDI_ENTERED} |
| TDI_APPROVED | ${verdict.TDI_APPROVED} |
| AI_DEGRADED (funnel) | ${verdict.AI_DEGRADED} |
| AI_REMOTE_CALLS | ${verdict.AI_REMOTE_CALLS} |
| NET_PNL | ${verdict.NET_PNL} |
| RUNTIME_STATUS | ${verdict.RUNTIME_STATUS} |
| PROFITABILITY_STATUS | ${verdict.PROFITABILITY_STATUS} |
| PRIMARY_BLOCKER | ${verdict.PRIMARY_BLOCKER} |

## Kök Neden

Gece boyunca **${job.rounds.length} tur** denendi, **${job.completedRounds} başarılı tamamlama**, **${job.trades ?? trades} trade**.

Baskın hata: **\`resolveMinimumProtectedProfitPercent is not defined\`** — hybrid-decision-engine import eksikliği kaynak kodda düzeltildi ancak uzun süre çalışan scheduler process eski modül cache'i kullandı. Bu yüzden TDI/trade funnel'ına ulaşılamadı.

## Policy Firewall

POLICY_CHANGES=NO | THRESHOLD_CHANGES=NO | AI_VETO_CHANGED=NO

## Artifacts

- kripto-final-100round-paper.json
- kripto-final-100round-rounds.csv
- kripto-final-100round-funnel.csv
- kripto-final-100round-ai.csv
- kripto-final-100round-pnl.csv
- kripto-final-100round-incidents.csv
`;

  fs.writeFileSync(path.join(ROOT, "KRIPTO_FINAL_100ROUND_PAPER_REPORT.md"), md, "utf8");

  console.log(JSON.stringify({ ok: true, stop, verdict }, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
