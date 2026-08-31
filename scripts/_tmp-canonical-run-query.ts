import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/src/server/db/prisma";

async function main() {
  const validationPath = path.join(process.cwd(), "kripto-10round-paper-validation.json");
  const validation = JSON.parse(fs.readFileSync(validationPath, "utf8")) as {
    sessionId: string;
    startedAt: string;
    completedAt: string;
  };
  const startedAt = new Date(validation.startedAt);
  const completedAt = new Date(validation.completedAt);

  const scannerRows = await prisma.scannerResult.findMany({
    where: { createdAt: { gte: startedAt, lte: completedAt } },
    select: { scannerName: true, reason: true, createdAt: true, metadata: true },
  });
  const scannerByName: Record<string, number> = {};
  let klineMissingCount = 0;
  for (const row of scannerRows) {
    const name = String(row.scannerName ?? "UNKNOWN");
    scannerByName[name] = (scannerByName[name] ?? 0) + 1;
    if (String(row.reason ?? "").includes("KLINE_MISSING")) klineMissingCount += 1;
  }

  const runs = await prisma.autoRoundRun.findMany({
    where: { jobId: validation.sessionId },
    orderBy: { roundNo: "asc" },
    select: {
      roundNo: true,
      state: true,
      result: true,
      startedAt: true,
      endedAt: true,
      failReason: true,
      metadata: true,
    },
  });

  const shadowRows = await prisma.shadowCandidateOutcome.findMany({
    where: { detectedAt: { gte: startedAt, lte: completedAt } },
    select: { id: true, symbol: true, lane: true, outcomes: true, source: true },
    take: 2000,
  });
  const missedRows = await prisma.paperMissedOpportunity.findMany({
    where: { createdAt: { gte: startedAt, lte: completedAt } },
    select: { category: true, symbol: true },
    take: 2000,
  });
  const paperTrades = await prisma.paperTrade.findMany({
    where: { createdAt: { gte: startedAt, lte: completedAt } },
    select: {
      id: true,
      symbol: true,
      realizedPnl: true,
      fees: true,
      slippagePct: true,
      metadata: true,
    },
    take: 2000,
  });

  const output = {
    window: { startedAt: validation.startedAt, completedAt: validation.completedAt },
    scanner: {
      total: scannerRows.length,
      byName: scannerByName,
      klineMissingCount,
    },
    runs: runs.map((r) => ({
      roundNo: r.roundNo,
      state: r.state,
      result: r.result,
      failReason: r.failReason,
      durationSec:
        r.endedAt && r.startedAt
          ? Math.max(0, Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 1000))
          : null,
      metadata: r.metadata,
    })),
    shadow: {
      count: shadowRows.length,
      byLane: shadowRows.reduce<Record<string, number>>((acc, row) => {
        acc[String(row.lane ?? "UNKNOWN")] = (acc[String(row.lane ?? "UNKNOWN")] ?? 0) + 1;
        return acc;
      }, {}),
      sample: shadowRows.slice(0, 3),
    },
    missed: {
      count: missedRows.length,
      byCategory: missedRows.reduce<Record<string, number>>((acc, row) => {
        acc[String(row.category ?? "UNKNOWN")] = (acc[String(row.category ?? "UNKNOWN")] ?? 0) + 1;
        return acc;
      }, {}),
    },
    paper: {
      trades: paperTrades.length,
      wins: paperTrades.filter((t) => Number(t.realizedPnl ?? 0) > 0).length,
      losses: paperTrades.filter((t) => Number(t.realizedPnl ?? 0) < 0).length,
      fees: paperTrades.reduce((a, t) => a + Number(t.fees ?? 0), 0),
      slippagePctSum: paperTrades.reduce((a, t) => a + Number(t.slippagePct ?? 0), 0),
      net: paperTrades.reduce((a, t) => a + Number(t.realizedPnl ?? 0), 0),
    },
  };

  const out = path.join(process.cwd(), "artifacts", "forensics", "canonical-10round-query.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(out);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error((error as Error).message);
  await prisma.$disconnect();
  process.exit(1);
});
