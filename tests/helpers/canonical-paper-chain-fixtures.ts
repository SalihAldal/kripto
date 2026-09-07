import type { AIConsensusResult } from "@/src/types/ai";
import type { ScannerCandidate } from "@/src/types/scanner";
import {
  attachCanonicalHandoff,
  buildCanonicalHandoffMetadata,
} from "@/src/server/execution/canonical-handoff.service";
import {
  getCanonicalCandidateStore,
  type CanonicalCandidateRecord,
} from "@/src/server/candidate/candidate-store.service";

export const CHAIN_SYMBOL = "BTCTRY";
export const CHAIN_CANDIDATE_ID = "cand-paper-chain-1";

export function buildAiConsensus(overrides: Partial<AIConsensusResult> = {}): AIConsensusResult {
  const now = new Date().toISOString();
  const base: AIConsensusResult = {
    finalDecision: "BUY",
    finalConfidence: 86,
    finalRiskScore: 25,
    score: 86,
    explanation: "integration fixture consensus",
    outputs: [],
    rejected: false,
    generatedAt: now,
    roleScores: [
      { role: "AI-1_TECHNICAL", score: 88, weight: 1 },
      { role: "AI-2_SENTIMENT", score: 82, weight: 1 },
    ],
    decisionPayload: {
      timeframeAnalysis: { aligned: true, conflict: false, alignmentScore: 92 },
      liquidityIntel: { safeEntryTiming: "IMMEDIATE", sweepDetected: false },
      regimeStability: { stabilityScore: 88, transitionProbability: 0.05, flipRisk: 0.02, chaosProbability: 0.03, lifecyclePhase: "EXPANSION", chopWarning: false, unstableBreakoutCondition: false },
      futuresIntel: { riskScore: 10, leverageStressScore: 5, leveragedTrapProbability: 0.02, intent: "BULLISH" },
      strategyRuntime: { strategyKey: "early_acceleration", entryType: "BREAKOUT", exitType: "TRAIL" },
    },
    analysisScorecard: {
      symbol: CHAIN_SYMBOL,
      currentPrice: 100,
      direction: "BUY",
      confidenceScore: 86,
      expectedMovePercent: 2,
      expectedMoveRange: { min: 1, max: 3 },
      targetSellPercent: 1.2,
      initialStopPercent: 0.6,
      trailingStartPercent: 0.6,
      trailingGapPercent: 0.3,
      riskLevel: "LOW",
      reasons: [],
      invalidationReason: null,
      timeHorizonMinutes: 10,
    },
  };
  return { ...base, ...overrides, analysisScorecard: { ...base.analysisScorecard!, ...(overrides.analysisScorecard ?? {}) } };
}

export function buildScannerCandidateWithoutAi(): ScannerCandidate {
  return {
    rank: 1,
    context: {
      symbol: CHAIN_SYMBOL,
      lastPrice: 100,
      change24h: 1.2,
      volume24h: 12_000_000,
      volumeSpikePercent: 0.25,
      spreadPercent: 0.02,
      volatilityPercent: 0.35,
      momentumPercent: 0.55,
      orderBookImbalance: 0.15,
      buyPressure: 0.25,
      shortCandleSignal: 0.6,
      fakeSpikeScore: 0.05,
      pumpIntensity: 0.15,
      pumpRisk: 0.08,
      tradable: true,
      rejectReasons: [],
      metadata: {
        opportunityCandidateId: CHAIN_CANDIDATE_ID,
        opportunityLifecycleId: "life-paper-chain",
        firstDetectionPrice: 100.2,
        sourceType: "INTEGRATION_FIXTURE",
        marketDataTimestamp: new Date().toISOString(),
        strategyStatus: "PAPER_EXPERIMENT",
        shortMomentumPercent: 0.35,
        shortFlowImbalance: 0.1,
        tradeVelocity: 0.85,
        priceAcceleration: 0.8,
        volumeAcceleration: 0.78,
        relativeStrength: 0.75,
        exhaustion: 0.15,
        retracement: 0.2,
        breakoutHeld: true,
        rangeScore: 0.35,
        distanceFromMean: 0.25,
        flowRecovery: 0.75,
        trendStrength: 0.85,
        volatilityRatio: 0.3,
        regimeTransitionProbability: 0.1,
        regimeChaosProbability: 0.05,
        pumpScore: 0.15,
        expectedMovePercent: 2.5,
        takerFeePercent: 0.1,
        strategyProfitBuffer: 0.2,
        expectedSlippageBps: 3,
        bidDepth: 600_000,
        askDepth: 550_000,
        liquidityScore: 85,
        marketRegime: "TREND_UP",
        marketRegimeStrategy: "early_acceleration",
        marketRegimeOpenTradeAllowed: true,
      },
    },
    score: {
      symbol: CHAIN_SYMBOL,
      score: 82,
      confidence: 84,
      status: "QUALIFIED",
      reasons: [],
      metrics: {
        momentum: 1,
        microMomentum: 1,
        volume: 1,
        spread: 1,
        volatility: 1,
        orderBook: 1,
        pressure: 1,
        microFlow: 1,
        velocity: 1,
        candle: 1,
        fakeSpikePenalty: 0,
        liquidityPenalty: 0,
        pumpBoost: 0,
        pumpRiskPenalty: 0,
      },
    },
  };
}

export function seedExecutionReadyCandidate(input?: {
  candidateId?: string;
  symbol?: string;
  stale?: boolean;
  wrongSymbol?: string;
}): CanonicalCandidateRecord {
  const store = getCanonicalCandidateStore();
  const candidateId = input?.candidateId ?? CHAIN_CANDIDATE_ID;
  const symbol = input?.symbol ?? CHAIN_SYMBOL;
  const now = Date.now();
  store.createCandidate({
    candidateId,
    symbol,
    lane: "STEADY",
    detectedAt: now - 5_000,
    detectedPrice: 100,
    ttlMs: 600_000,
  });
  store.updateCandidate(candidateId, {
    state: "EXECUTION_READY",
    lastUpdatedAt: now,
    expiresAt: now + 600_000,
  });
  if (input?.stale) {
    store.updateCandidate(candidateId, { lastUpdatedAt: now - 120_000 });
  }
  if (input?.wrongSymbol) {
    store.updateCandidate(candidateId, { symbol: input.wrongSymbol });
  }
  return store.getCandidate(candidateId)!;
}

export function buildHandoffCandidate(record: CanonicalCandidateRecord, symbol = CHAIN_SYMBOL) {
  const candidate = buildScannerCandidateWithoutAi();
  const handoff = buildCanonicalHandoffMetadata({
    candidateId: record.candidateId,
    symbol,
    record,
  });
  return attachCanonicalHandoff(candidate, handoff);
}
