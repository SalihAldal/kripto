import { prisma } from "@/src/server/db/prisma";
import { createDurableFakeExchange } from "./durable-fake-exchange";

async function main() {
  const durableFile = String(process.env.ACK_DURABLE_EXCHANGE_FILE ?? "");
  if (durableFile) {
    const binance = await import("@/services/binance.service");
    const exchange = createDurableFakeExchange(durableFile);
    (binance as { getOrderStatusByClientOrderId: typeof binance.getOrderStatusByClientOrderId }).getOrderStatusByClientOrderId =
      async (_symbol: string, clientOrderId: string) => exchange.getOrderByClientOrderId(clientOrderId);
  }
  const { reconcileFix02ExitBundles } = await import("@/src/server/execution/fix02-exit-reconciliation.service");
  await reconcileFix02ExitBundles();
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
