import fs from "node:fs";

const raw = fs.readFileSync(".env", "utf8");
for (const line of raw.split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const idx = line.indexOf("=");
  if (idx === -1) continue;
  const key = line.slice(0, idx);
  const value = line.slice(idx + 1);
  if (!(key in process.env)) process.env[key] = value;
}

async function run() {
  const executionRepo = await import("../src/server/repositories/execution.repository");
  const paperSvc = await import("../src/server/simulation/paper-trading.service");
  const exchangeSvc = await import("../services/binance.service");

  const { user } = await executionRepo.getRuntimeExecutionContext();
  const symbol = "BTCTRY";
  const priceRow = await exchangeSvc.getTicker(symbol);
  const entryPrice = Number(priceRow.price);
  const quantity = 0.0002;
  const baseAsset = "BTC";
  const quoteAsset = "TRY";

  const open = await paperSvc.executePaperOpenOrder({
    userId: user.id,
    symbol,
    side: "BUY",
    quantity,
    price: entryPrice,
    baseAsset,
    quoteAsset,
  });
  const exitPrice = Number((entryPrice * 1.01).toFixed(2));
  const close = await paperSvc.executePaperCloseOrder({
    userId: user.id,
    symbol,
    side: "SELL",
    quantity,
    price: exitPrice,
    baseAsset,
    quoteAsset,
  });

  console.log(`Paper open ${symbol} qty=${quantity} price=${entryPrice} status=${open.status}`);
  console.log(`Paper close ${symbol} qty=${quantity} price=${exitPrice} status=${close.status}`);
}

run().catch((error: { message?: string }) => {
  console.error("paper-trade-test error", error?.message ?? error);
});
