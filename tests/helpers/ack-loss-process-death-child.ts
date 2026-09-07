import path from "node:path";
import { prisma } from "@/src/server/db/prisma";
import { processFix02Pr04ExitTick } from "@/src/server/execution/fix02-exit-routing.service";
import { createDurableFakeExchange } from "./durable-fake-exchange";

const baseNow = Date.parse("2026-09-06T10:00:00.000Z");

async function installSubmitTimeoutShim(filePath: string) {
  const binancePath = path.resolve(process.cwd(), "services/binance.service.ts");
  const adapterPath = path.resolve(process.cwd(), "src/server/exchange-simulator/paper-exchange-adapter.service.ts");
  void binancePath;
  void adapterPath;
  const exchange = createDurableFakeExchange(filePath);
  const binance = await import("@/services/binance.service");
  const originalSell = binance.placeMarketSell;
  const originalTicker = binance.getTicker;
  (binance as { getTicker: typeof originalTicker }).getTicker = async () => ({
    symbol: "BTCTRY",
    price: 90,
    change24h: 0,
    volume24h: 0,
  });
  (binance as { placeMarketSell: typeof originalSell }).placeMarketSell = async (
    symbol: string,
    quantity: number,
    dryRun?: boolean,
    opts?: { clientOrderId?: string },
  ) => {
    const clientOrderId = opts?.clientOrderId ?? "missing-client";
    exchange.recordSubmit({
      clientOrderId,
      symbol,
      side: "SELL",
      quantity,
      price: 89,
      tradeId: `ack-child-${clientOrderId}`,
      fee: 0.09,
      filledAtMs: baseNow + 3_000,
    });
    throw new Error("SUBMIT_TIMEOUT");
  };
}

async function main() {
  const positionId = String(process.env.ACK_POSITION_ID ?? "");
  const userId = String(process.env.ACK_USER_ID ?? "");
  const executionId = String(process.env.ACK_EXECUTION_ID ?? "");
  const durableFile = String(process.env.ACK_DURABLE_EXCHANGE_FILE ?? "");
  if (!positionId || !userId || !executionId || !durableFile) {
    throw new Error("ACK_CHILD_MISSING_ENV");
  }
  process.env.EXECUTION_PR04_EXIT_EVAL_ENABLED = "true";
  process.env.EXECUTION_PR04_EXIT_ROUTING_ENABLED = "true";
  await installSubmitTimeoutShim(durableFile);
  const position = await prisma.position.findUnique({ where: { id: positionId } });
  if (!position) throw new Error("POSITION_NOT_FOUND");
  const t = baseNow + 3_000;
  await processFix02Pr04ExitTick({
    executionId,
    positionId,
    userId,
    side: "LONG",
    mode: "live",
    observation: {
      eventId: `evt-child-${t}`,
      eventAtMs: t,
      availableAtMs: t,
      markPrice: 90,
      bid: 89.9,
      ask: 90.1,
      high: 90.2,
      low: 89.8,
      closed: true,
      stale: false,
      dataGap: false,
    },
  });
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error((error as Error).message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => null);
  });
