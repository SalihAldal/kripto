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
  const symbol = (process.argv[2] ?? "TONTRY").toUpperCase();
  const quoteAmount = Number(process.argv[3] ?? 1000);
  if (!Number.isFinite(quoteAmount) || quoteAmount <= 0) {
    throw new Error("Invalid quote amount");
  }

  const exchangeSvc = await import("../services/binance.service");

  const buy = await exchangeSvc.placeMarketBuyByQuote(symbol, quoteAmount, false);
  const executedQty = Number(buy.executedQty ?? 0);
  console.log(
    JSON.stringify(
      {
        step: "BUY",
        symbol,
        quoteAmount,
        orderId: buy.orderId,
        status: buy.status,
        executedQty,
        price: buy.price,
      },
      null,
      2,
    ),
  );

  if (!Number.isFinite(executedQty) || executedQty <= 0) {
    throw new Error("Buy executedQty is zero");
  }

  const sell = await exchangeSvc.placeMarketSell(symbol, executedQty, false);
  console.log(
    JSON.stringify(
      {
        step: "SELL",
        symbol,
        orderId: sell.orderId,
        status: sell.status,
        executedQty: sell.executedQty,
        price: sell.price,
      },
      null,
      2,
    ),
  );
}

run().catch((error: { message?: string }) => {
  console.error("live-order-test error", error?.message ?? error);
});
