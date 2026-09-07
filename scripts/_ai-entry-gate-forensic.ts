import fs from "node:fs";
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!(k in process.env)) process.env[k] = v;
}

const JOB_ID = "cmtrezwvc000bunbk5fgm1kvl";
const OUT = "artifacts/paper-campaigns/paper-1h-2026-09-07T15-47-43-241Z/ai-consensus-trace.json";

async function main() {
  const { prisma } = await import("@/src/server/db/prisma");
  const runs = await prisma.autoRoundRun.findMany({
    where: { jobId: JOB_ID, symbol: { not: null } },
    orderBy: { roundNo: "asc" },
  });

  const traces = [];
  for (const r of runs) {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const consensusRows = await prisma.consensusDecision.findMany({
      where: {
        symbol: r.symbol ?? "",
        createdAt: { gte: r.startedAt ?? new Date(0), lte: r.endedAt ?? new Date() },
      },
      orderBy: { createdAt: "desc" },
      take: 3,
    });

    const tradeLogs = await prisma.tradeEventLog.findMany({
      where: {
        symbol: r.symbol ?? undefined,
        createdAt: { gte: r.startedAt ?? new Date(0), lte: r.endedAt ?? new Date() },
      },
      orderBy: { createdAt: "asc" },
      take: 15,
    }).catch(() => []);

    traces.push({
      roundNo: r.roundNo,
      symbol: r.symbol,
      failReason: r.failReason,
      terminalReason: meta.terminalReason,
      aiFinalDecision: meta.aiFinalDecision,
      aiConsensusDecision: meta.aiConsensusDecision,
      aiVetoStatus: meta.aiVetoStatus,
      confidence: meta.confidence,
      executionDetails: meta.executionDetails ?? meta.executionRejectDetails,
      consensusDecisions: consensusRows,
      tradeEventLogs: tradeLogs.map((e) => ({
        eventType: e.eventType,
        reason: e.reason,
        metadata: e.metadata,
      })),
    });
  }

  fs.writeFileSync(OUT, JSON.stringify({ jobId: JOB_ID, traces }, null, 2));
  console.log(OUT);
  console.log(JSON.stringify(traces, null, 2));
  await prisma.$disconnect();
}

main();
