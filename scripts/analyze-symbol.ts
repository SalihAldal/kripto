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
  const symbol = (process.argv[2] ?? "NOMTRY").toUpperCase();
  const { buildAIInput, runAIConsensusFromInput } = await import("../src/server/ai/analysis-orchestrator");
  const { buildShortTermReport } = await import("../src/server/ai/short-term-report.service");

  const input = await buildAIInput(symbol);
  const consensus = await runAIConsensusFromInput(input);
  const report = buildShortTermReport(input, consensus);

  console.log(
    JSON.stringify(
      {
        symbol,
        lastPrice: input.lastPrice,
        change24h: input.marketSignals?.change24h ?? 0,
        decision: consensus.finalDecision,
        confidence: consensus.finalConfidence,
        riskScore: consensus.finalRiskScore,
        expectedMovePercent: consensus.analysisScorecard?.expectedMovePercent ?? 0,
        timeHorizonMinutes: consensus.analysisScorecard?.timeHorizonMinutes ?? 0,
        report,
      },
      null,
      2,
    ),
  );
}

run().catch((error: { message?: string }) => {
  console.error("analyze-symbol error", error?.message ?? error);
  process.exitCode = 1;
});
