/**
 * 4-hour extended PAPER strategy baseline campaign runner.
 */
import path from "node:path";
import { loadEnvFile, runPaperCampaign, writeJson } from "./paper-campaign-runner-core";

loadEnvFile();

const DURATION_MINUTES = Number(
  process.argv.find((a) => a.startsWith("--durationMinutes="))?.split("=")[1] ?? 240,
);
const CAMPAIGN_ID = String(
  process.argv.find((a) => a.startsWith("--campaignId="))?.split("=")[1] ??
    `paper-4h-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);

const artifactRoot = path.join(process.cwd(), "artifacts", "paper-campaigns", CAMPAIGN_ID);

async function captureAccountSnapshot() {
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { ensurePaperAccountInitialized, readPaperCashBalances } = await import(
    "@/src/server/simulation/paper-trading.service"
  );
  const { prisma } = await import("@/src/server/db/prisma");
  const { user } = await getRuntimeExecutionContext();
  await ensurePaperAccountInitialized(user.id);
  const paperCashBefore = await readPaperCashBalances(user.id);
  const openPositions = await prisma.position.findMany({
    where: { userId: user.id, status: "OPEN" },
    select: { id: true, quantity: true, entryPrice: true, unrealizedPnl: true, metadata: true, openedAt: true },
  });
  const activeOrders = await prisma.tradeOrder.count({
    where: { userId: user.id, status: { in: ["NEW", "PARTIALLY_FILLED"] } },
  });
  const closedPnl = await prisma.paperTrade.aggregate({
    where: { userId: user.id, status: "CLOSED" },
    _sum: { realizedPnl: true },
  });
  const openUnrealized = openPositions.reduce((s, p) => s + Number(p.unrealizedPnl ?? 0), 0);
  const snapshot = {
    capturedAt: new Date().toISOString(),
    userId: user.id,
    paperCashBefore,
    paperEquityBefore: {
      TRY: Number(paperCashBefore.TRY ?? 0),
      USDT: Number(paperCashBefore.USDT ?? 0),
      BTC: Number(paperCashBefore.BTC ?? 0),
    },
    realizedPnlBefore: Number(closedPnl._sum.realizedPnl ?? 0),
    unrealizedPnlBefore: openUnrealized,
    openPositionsBefore: openPositions.length,
    openPositions,
    activePaperOrdersBefore: activeOrders,
    safety: {
      EXECUTION_MODE: process.env.EXECUTION_MODE,
      LIVE_TRADING_ENABLED: process.env.LIVE_TRADING_ENABLED,
      LIVE_AUTHORIZATION: process.env.LIVE_AUTHORIZATION,
    },
  };
  writeJson(path.join(artifactRoot, "account-snapshot-before.json"), snapshot);
  await prisma.$disconnect();
  return snapshot;
}

captureAccountSnapshot()
  .then(() =>
    runPaperCampaign({
      durationMs: DURATION_MINUTES * 60 * 1000,
      campaignId: CAMPAIGN_ID,
      artifactRoot,
      resultFile: "kripto-4h-extended-paper-baseline-result.json",
      heartbeatMs: 120_000,
      pollMs: 15_000,
      maxWaitSec: 600,
      budgetPerTrade: 1000,
      terminalWaitMs: 300_000,
    }),
  )
  .then(async (result) => {
    console.log(JSON.stringify(result, null, 2));
    try {
      const { build4hExtendedPaperBaselineReport } = await import("./build-4h-extended-paper-baseline-report");
      await build4hExtendedPaperBaselineReport({ campaignId: CAMPAIGN_ID });
    } catch (error) {
      console.error("post-run report failed:", error instanceof Error ? error.message : String(error));
      process.exit(5);
    }
    if ((result as { phase?: string }).phase === "PREFLIGHT_BLOCKED") process.exit(2);
    if ((result as { phase?: string }).phase === "START_FAILED") process.exit(3);
    if ((result as { reachedTerminal?: boolean }).reachedTerminal === false) process.exit(4);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
