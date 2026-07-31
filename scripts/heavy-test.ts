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
  const contextSvc = await import("../src/server/scanner/market-context-builder");
  const binanceSvc = await import("../services/binance.service");
  const symbols = ["BTCTRY", "ETHTRY", "SOLTRY", "BNBTRY", "XRPTRY"];

  for (const sym of symbols) {
    const ctx = await contextSvc.buildMarketContext(sym, { lite: false, forceLive: true });
    console.log(
      `${sym} change24h=${ctx.change24h.toFixed(2)} volume24h=${Math.round(ctx.volume24h)} ` +
        `pump=${ctx.pumpIntensity.toFixed(1)} spike=${ctx.volumeSpikePercent.toFixed(1)} ` +
        `sentiment=${Number(ctx.metadata.socialSentimentScore ?? 50).toFixed(0)} news=${ctx.metadata.macroNewsSentiment}`,
    );
  }

  const testSymbol = "BTCTRY";
  const qty = 0.0002;
  const validation = await binanceSvc
    .validateSymbolFilters(testSymbol, qty)
    .catch((error: { message?: string }) => ({ ok: false, reasons: [error?.message ?? "error"] }));

  console.log(
    `Order preflight ${testSymbol} qty=${qty} ok=${validation.ok} reasons=${validation.reasons?.join("|") ?? ""}`,
  );
}

run().catch((error: { message?: string }) => {
  console.error("error", error?.message ?? error);
});
