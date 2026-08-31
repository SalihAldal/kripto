import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const prisma = new PrismaClient();
  const validation = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "kripto-10round-paper-validation.json"), "utf8"),
  ) as { startedAt: string; completedAt: string; sessionId: string };
  const startedAt = new Date(validation.startedAt);
  const endedAt = new Date(validation.completedAt);

  const scannerTotal = await prisma.scannerResult.count({
    where: { createdAt: { gte: startedAt, lte: endedAt } },
  });
  const scannerByStatus = await prisma.scannerResult.groupBy({
    by: ["status"],
    where: { createdAt: { gte: startedAt, lte: endedAt } },
    _count: { _all: true },
  });
  const scannerByReason = await prisma.scannerResult.groupBy({
    by: ["reason"],
    where: { createdAt: { gte: startedAt, lte: endedAt } },
    _count: { _all: true },
    orderBy: { _count: { reason: "desc" } },
    take: 20,
  });

  const paperTrades = await prisma.paperTrade.findMany({
    where: { createdAt: { gte: startedAt, lte: endedAt } },
    orderBy: { createdAt: "asc" },
  });
  const sampleScannerRows = await prisma.scannerResult.findMany({
    where: { createdAt: { gte: startedAt, lte: endedAt } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      createdAt: true,
      scannerName: true,
      status: true,
      reason: true,
      metadata: true,
    },
  });

  const result: Record<string, unknown> = {
    sessionId: validation.sessionId,
    startedAt: validation.startedAt,
    completedAt: validation.completedAt,
    scannerTotal,
    scannerByStatus,
    scannerByReason,
    paperTradeCount: paperTrades.length,
    sampleScannerRows,
  };

  const shadowModel = (prisma as unknown as Record<string, unknown>).shadowCandidateOutcome as
    | {
        count: (args?: unknown) => Promise<number>;
      }
    | undefined;

  if (shadowModel?.count) {
    const shadowTotal = await shadowModel.count({
      where: {
        detectedAt: { gte: startedAt, lte: endedAt },
      },
    });
    result.shadowCount = shadowTotal;
  } else {
    result.shadowCount = "MODEL_NOT_GENERATED";
  }

  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
