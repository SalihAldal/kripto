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
  const { env } = await import("../lib/config");
  const { getBestFastEntry } = await import("../src/server/scanner/fast-entry.service");
  const { openTrade } = await import("../services/trading-engine.service");

  const original = {
    AI_MIN_CONFIDENCE: env.AI_MIN_CONFIDENCE,
    EXECUTION_FAST_MIN_CONFIDENCE: env.EXECUTION_FAST_MIN_CONFIDENCE,
    EXECUTION_MIN_TRADE_QUALITY_SCORE: env.EXECUTION_MIN_TRADE_QUALITY_SCORE,
  };
  (env as unknown as { AI_MIN_CONFIDENCE: number }).AI_MIN_CONFIDENCE = 52;
  (env as unknown as { EXECUTION_FAST_MIN_CONFIDENCE: number }).EXECUTION_FAST_MIN_CONFIDENCE = 52;
  (env as unknown as { EXECUTION_MIN_TRADE_QUALITY_SCORE: number }).EXECUTION_MIN_TRADE_QUALITY_SCORE = 45;

  const best = await getBestFastEntry();
  if (!best.selected || !best.selected.ai) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          reason: best.reason ?? "No suitable candidate",
          scannedAt: best.scannedAt,
          evaluated: best.evaluated,
          diagnostics: best.diagnostics,
        },
        null,
        2,
      ),
    );
    (env as unknown as { AI_MIN_CONFIDENCE: number }).AI_MIN_CONFIDENCE = original.AI_MIN_CONFIDENCE;
    (env as unknown as { EXECUTION_FAST_MIN_CONFIDENCE: number }).EXECUTION_FAST_MIN_CONFIDENCE =
      original.EXECUTION_FAST_MIN_CONFIDENCE;
    (env as unknown as { EXECUTION_MIN_TRADE_QUALITY_SCORE: number }).EXECUTION_MIN_TRADE_QUALITY_SCORE =
      original.EXECUTION_MIN_TRADE_QUALITY_SCORE;
    return;
  }

  const execution = await openTrade({
    symbol: best.selected.context.symbol,
    amountTry: 1000,
    maxCoins: 1,
    maxDurationSec: 600,
  });

  (env as unknown as { AI_MIN_CONFIDENCE: number }).AI_MIN_CONFIDENCE = original.AI_MIN_CONFIDENCE;
  (env as unknown as { EXECUTION_FAST_MIN_CONFIDENCE: number }).EXECUTION_FAST_MIN_CONFIDENCE =
    original.EXECUTION_FAST_MIN_CONFIDENCE;
  (env as unknown as { EXECUTION_MIN_TRADE_QUALITY_SCORE: number }).EXECUTION_MIN_TRADE_QUALITY_SCORE =
    original.EXECUTION_MIN_TRADE_QUALITY_SCORE;

  console.log(
    JSON.stringify(
      {
        ok: !execution?.rejected,
        selected: {
          symbol: best.selected.context.symbol,
          decision: best.selected.ai.finalDecision,
          aiConfidence: best.selected.ai.finalConfidence,
        },
        execution,
      },
      null,
      2,
    ),
  );
}

run().catch((error: { message?: string }) => {
  console.error("live-trade-test error", error?.message ?? error);
});
