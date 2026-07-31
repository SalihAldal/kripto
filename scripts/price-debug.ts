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
  const exchangeSvc = await import("../services/binance.service");
  const contextSvc = await import("../src/server/scanner/market-context-builder");

  const ticker = await exchangeSvc.getTicker(symbol);
  const klines = await exchangeSvc.getKlines(symbol, "1m", 5);
  const orderBook = await exchangeSvc.getOrderBook(symbol, 5);

  const latestClose = klines[klines.length - 1]?.close ?? 0;
  const lastTrade = (await exchangeSvc.getRecentTrades(symbol, 5))[4]?.price ?? 0;
  const bestBid = orderBook.bids[0]?.price ?? 0;
  const bestAsk = orderBook.asks[0]?.price ?? 0;
  const bookMid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : 0;

  const ctx = await contextSvc.buildMarketContext(symbol, { lite: false, forceLive: true });

  console.log(
    JSON.stringify(
      {
        symbol,
        tickerPrice: ticker.price,
        tickerChange24h: ticker.change24h,
        latestClose,
        lastTrade,
        bestBid,
        bestAsk,
        bookMid,
        contextLastPrice: ctx.lastPrice,
        priceDispersion: ctx.metadata.priceDispersionPercent,
        tickerOutlier: ctx.metadata.tickerOutlier,
      },
      null,
      2,
    ),
  );
}

run().catch((error: { message?: string }) => {
  console.error("price-debug error", error?.message ?? error);
});
