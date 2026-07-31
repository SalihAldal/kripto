import type { SpotMarketRegimeLabel, MomentumBreakoutCandidate, Prisma } from "@prisma/client";
import { upsertDecisionLogRecord } from "@/src/server/repositories/decision-log.repository";
import type { MomentumBreakoutEvaluation } from "@/src/server/trading-core-s2/trading-core-s2.types";

function mapVerdictToDecision(verdict: MomentumBreakoutEvaluation["verdict"]) {
  if (verdict === "BUY_CANDIDATE") return "BUY";
  if (verdict === "WAIT") return "WAIT";
  return "SKIP";
}

export async function enqueueMomentumCandidatesForReplay(
  evaluations: MomentumBreakoutEvaluation[],
  records: MomentumBreakoutCandidate[],
  marketRegime?: SpotMarketRegimeLabel,
) {
  const recordBySymbol = new Map(records.map((row) => [row.symbol.toUpperCase(), row]));
  const enqueued: string[] = [];

  for (const evaluation of evaluations) {
    const record = recordBySymbol.get(evaluation.symbol.toUpperCase());
    if (!record) continue;

    const decisionId = `s2mb_${record.candidateKey}`;
    await upsertDecisionLogRecord({
      decisionId,
      symbol: evaluation.symbol,
      timestamp: record.evaluatedAt,
      decision: mapVerdictToDecision(evaluation.verdict),
      executionAllowed: false,
      strategyUsed: "MOMENTUM_BREAKOUT_V1",
      momentumScore: evaluation.entryProbability,
      trendScore: evaluation.expectedRr,
      regimeScore: evaluation.confidence,
      confidence: evaluation.confidence,
      humanSummary: `Momentum Breakout V1 ${evaluation.verdict} (RR ${evaluation.expectedRr}, prob ${evaluation.entryProbability}%)`,
      marketState: {
        marketRegime: String(marketRegime ?? evaluation.features.marketRegime ?? "UNKNOWN"),
        relativeVolume: evaluation.relativeVolume,
        momentum5m: evaluation.momentum5m,
        momentum15m: evaluation.momentum15m,
        spreadPercent: evaluation.spreadPercent,
      } as Prisma.InputJsonValue,
      metadata: {
        source: "trading-core-s2",
        module: "momentum-breakout-v1",
        candidateKey: record.candidateKey,
        snapshotId: record.snapshotId,
        verdict: evaluation.verdict,
        expectedRr: evaluation.expectedRr,
        expectedHoldingMinutes: evaluation.expectedHoldingMinutes,
        expectedVolatility: evaluation.expectedVolatility,
        entryProbability: evaluation.entryProbability,
        relativeBtcStrength: evaluation.relativeBtcStrength,
        relativeEthStrength: evaluation.relativeEthStrength,
        features: evaluation.features,
        discoveryV2Linked: true,
      } as Prisma.InputJsonValue,
      features: {
        momentum: {
          m5: evaluation.momentum5m,
          m15: evaluation.momentum15m,
          relativeVolume: evaluation.relativeVolume,
        },
        volatility: {
          atrPercent: evaluation.expectedVolatility,
        },
        spread: {
          spreadPercent: evaluation.spreadPercent,
        },
        regime: {
          label: marketRegime ?? evaluation.features.marketRegime,
        },
        raw: evaluation.features,
      },
      timeline: [
        {
          stage: "SCANNER",
          stepOrder: 1,
          outcome: evaluation.verdict,
          message: "Momentum Breakout V1 candidate generated (observe-only)",
          details: {
            expectedRr: evaluation.expectedRr,
            entryProbability: evaluation.entryProbability,
          },
        },
      ],
    });
    enqueued.push(decisionId);
  }

  return enqueued;
}
