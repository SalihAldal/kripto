import { prisma } from "@/src/server/db/prisma";
import type { AIAnalysisInput, AIConsensusResult } from "@/src/types/ai";

type Horizon = "SCALP_5M" | "INTRADAY_15M" | "SHORT_30M" | "INTRADAY_1H" | "INTRADAY_4H" | "SESSION";
type Outcome = "WIN" | "LOSS" | "BREAKEVEN";

type MemoryModel = {
  upsert: (args: Record<string, unknown>) => Promise<unknown>;
  update: (args: Record<string, unknown>) => Promise<unknown>;
  findMany: (args: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
};

const memoryModel = () => (prisma as unknown as { aIAnalysisMemory: MemoryModel }).aIAnalysisMemory;

function finite(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(min: number, value: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function tag(value: unknown) {
  return String(value ?? "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 64);
}

export function resolveAnalysisHorizon(maxDurationSec?: unknown): Horizon {
  const sec = finite(maxDurationSec, 0);
  if (sec > 0 && sec <= 300) return "SCALP_5M";
  if (sec > 0 && sec <= 900) return "INTRADAY_15M";
  if (sec > 0 && sec <= 1800) return "SHORT_30M";
  if (sec > 0 && sec <= 3600) return "INTRADAY_1H";
  if (sec > 0 && sec <= 14_400) return "INTRADAY_4H";
  return "SESSION";
}

function resolveInputHorizon(input: AIAnalysisInput) {
  const strategy = input.strategyParams ?? {};
  return resolveAnalysisHorizon(
    strategy.maxDurationSec ??
      strategy.suggestedMaxDurationSec ??
      strategy.estimatedDurationSec,
  );
}

function buildPatternKey(input: {
  symbol?: string;
  horizon: Horizon;
  marketRegime?: string;
  strategy?: string;
  decision?: string;
  mtfAlignment?: number;
  spread?: number;
  flow?: number;
  velocity?: number;
}) {
  const mtf =
    finite(input.mtfAlignment, 0) >= 70
      ? "mtf:strong"
      : finite(input.mtfAlignment, 0) >= 50
        ? "mtf:ok"
        : "mtf:weak";
  const spread = finite(input.spread, 0) <= 0.12 ? "spread:tight" : finite(input.spread, 0) <= 0.25 ? "spread:ok" : "spread:wide";
  const flow = Math.abs(finite(input.flow, 0)) >= 0.08 ? "flow:strong" : Math.abs(finite(input.flow, 0)) >= 0.02 ? "flow:ok" : "flow:weak";
  const velocity = finite(input.velocity, 0) >= 0.12 ? "velocity:strong" : finite(input.velocity, 0) >= 0.035 ? "velocity:ok" : "velocity:weak";
  return [
    `horizon:${input.horizon.toLowerCase()}`,
    `regime:${tag(input.marketRegime)}`,
    `strategy:${tag(input.strategy)}`,
    `decision:${tag(input.decision)}`,
    mtf,
    spread,
    flow,
    velocity,
  ].join("|");
}

function buildInputPatternKey(input: AIAnalysisInput, decision: string) {
  return buildPatternKey({
    symbol: input.symbol,
    horizon: resolveInputHorizon(input),
    marketRegime: input.marketRegime?.mode,
    strategy: input.marketRegime?.selectedStrategy,
    decision,
    mtfAlignment: input.multiTimeframe?.alignmentScore,
    spread: input.spread,
    flow: input.marketSignals?.shortFlowImbalance,
    velocity: input.marketSignals?.tradeVelocity,
  });
}

function expectedMove(input: AIAnalysisInput, result?: AIConsensusResult) {
  const scorecardMove = finite(result?.analysisScorecard?.expectedMovePercent, Number.NaN);
  if (Number.isFinite(scorecardMove)) return scorecardMove;
  const target = finite(result?.analysisScorecard?.targetSellPercent, Number.NaN);
  if (Number.isFinite(target)) return target;
  return undefined;
}

async function upsertMemory(input: {
  userId?: string;
  symbol: string;
  horizon: Horizon;
  marketRegime?: string;
  patternKey: string;
  decision: string;
  confidence: number;
  expectedMovePercent?: number;
  actualReturnPercent?: number;
  outcome?: Outcome;
  errorType?: string;
  aiMistakeTags?: string[];
  metadata?: Record<string, unknown>;
  executionId?: string;
}) {
  const model = memoryModel();
  const now = new Date();
  const outcomeWin = input.outcome === "WIN" ? 1 : 0;
  const outcomeLoss = input.outcome === "LOSS" ? 1 : 0;
  const reject = input.errorType ? 1 : 0;
  const confidence = Number(input.confidence.toFixed(4));
  const actualReturn = input.actualReturnPercent;

  await model.upsert({
    where: {
      patternKey_horizon_decision: {
        patternKey: input.patternKey,
        horizon: input.horizon,
        decision: input.decision,
      },
    },
    create: {
      userId: input.userId,
      symbol: input.symbol.toUpperCase(),
      horizon: input.horizon,
      marketRegime: input.marketRegime,
      patternKey: input.patternKey,
      decision: input.decision,
      confidence,
      expectedMovePercent: input.expectedMovePercent,
      actualReturnPercent: actualReturn,
      outcome: input.outcome,
      errorType: input.errorType,
      aiMistakeTags: input.aiMistakeTags ?? [],
      sampleCount: 1,
      winCount: outcomeWin,
      lossCount: outcomeLoss,
      rejectCount: reject,
      winRate: outcomeWin ? 100 : 0,
      avgReturn: actualReturn ?? 0,
      avgConfidence: confidence,
      lastPredictionId: `${input.symbol}:${Date.now()}`,
      lastExecutionId: input.executionId,
      lastSeenAt: now,
      metadata: input.metadata ?? {},
    },
    update: {
      userId: input.userId,
      symbol: input.symbol.toUpperCase(),
      marketRegime: input.marketRegime,
      confidence,
      expectedMovePercent: input.expectedMovePercent,
      actualReturnPercent: actualReturn,
      outcome: input.outcome,
      errorType: input.errorType,
      aiMistakeTags: input.aiMistakeTags ?? [],
      sampleCount: { increment: 1 },
      winCount: { increment: outcomeWin },
      lossCount: { increment: outcomeLoss },
      rejectCount: { increment: reject },
      lastPredictionId: `${input.symbol}:${Date.now()}`,
      lastExecutionId: input.executionId,
      lastSeenAt: now,
      metadata: input.metadata ?? {},
    },
  });

  const rows = await model.findMany({
    where: {
      patternKey: input.patternKey,
      horizon: input.horizon,
      decision: input.decision,
    },
    take: 1,
  });
  const row = rows[0];
  if (!row) return;
  const sampleCount = Math.max(1, finite(row.sampleCount, 1));
  const winCount = finite(row.winCount, 0);
  const oldAvgReturn = finite(row.avgReturn, 0);
  const oldAvgConfidence = finite(row.avgConfidence, 0);
  const nextAvgReturn = actualReturn === undefined ? oldAvgReturn : oldAvgReturn + (actualReturn - oldAvgReturn) / sampleCount;
  const nextAvgConfidence = oldAvgConfidence + (confidence - oldAvgConfidence) / sampleCount;
  await model.update({
    where: {
      patternKey_horizon_decision: {
        patternKey: input.patternKey,
        horizon: input.horizon,
        decision: input.decision,
      },
    },
    data: {
      winRate: Number(((winCount / sampleCount) * 100).toFixed(2)),
      avgReturn: Number(nextAvgReturn.toFixed(4)),
      avgConfidence: Number(nextAvgConfidence.toFixed(2)),
    },
  });
}

export async function recordAIAnalysisPrediction(input: {
  userId?: string;
  analysisInput: AIAnalysisInput;
  result: AIConsensusResult;
}) {
  const horizon = resolveInputHorizon(input.analysisInput);
  await upsertMemory({
    userId: input.userId,
    symbol: input.analysisInput.symbol,
    horizon,
    marketRegime: input.analysisInput.marketRegime?.mode,
    patternKey: buildInputPatternKey(input.analysisInput, input.result.finalDecision),
    decision: input.result.finalDecision,
    confidence: input.result.finalConfidence,
    expectedMovePercent: expectedMove(input.analysisInput, input.result),
    errorType: input.result.finalDecision === "NO_TRADE" ? "NO_TRADE_ANALYSIS" : undefined,
    aiMistakeTags: input.result.rejected ? ["ai:rejected"] : [],
    metadata: {
      source: "ai-consensus",
      riskScore: input.result.finalRiskScore,
      scorecard: input.result.analysisScorecard,
      roleScores: input.result.roleScores,
      explanation: input.result.explanation,
    },
  }).catch(() => null);
}

export async function recordAIAnalysisRejectSample(input: {
  userId?: string;
  symbol: string;
  horizon?: Horizon;
  marketRegime?: string;
  decision?: string;
  confidence?: number;
  reason: string;
  metadata?: Record<string, unknown>;
}) {
  const horizon = input.horizon ?? "INTRADAY_1H";
  const decision = input.decision ?? "NO_TRADE";
  await upsertMemory({
    userId: input.userId,
    symbol: input.symbol,
    horizon,
    marketRegime: input.marketRegime,
    patternKey: buildPatternKey({
      symbol: input.symbol,
      horizon,
      marketRegime: input.marketRegime,
      decision,
      spread: input.metadata?.spreadPercent as number | undefined,
      flow: input.metadata?.shortFlowImbalance as number | undefined,
      velocity: input.metadata?.tradeVelocity as number | undefined,
    }),
    decision,
    confidence: finite(input.confidence, 0),
    errorType: input.reason.slice(0, 80),
    aiMistakeTags: ["reject:scan", `reason:${tag(input.reason)}`],
    metadata: input.metadata,
  }).catch(() => null);
}

export async function calibrateAIAnalysisFromTrade(input: {
  userId?: string;
  symbol: string;
  side: "LONG" | "SHORT";
  maxDurationSec?: number;
  marketRegime?: string;
  strategy?: string;
  confidence?: number;
  returnPercent: number;
  executionId?: string;
  closeReason?: string;
  metadata?: Record<string, unknown>;
}) {
  const horizon = resolveAnalysisHorizon(input.maxDurationSec);
  const decision = input.side === "SHORT" ? "SELL" : "BUY";
  const outcome: Outcome = input.returnPercent >= 0.5 ? "WIN" : input.returnPercent < 0 ? "LOSS" : "BREAKEVEN";
  const mistakeTags = [
    outcome === "LOSS" ? "prediction:false_positive" : "",
    outcome === "BREAKEVEN" ? "prediction:weak_edge" : "",
    input.returnPercent > 0 && input.returnPercent < 0.5 ? "profit:below_net_target" : "",
  ].filter(Boolean);
  await upsertMemory({
    userId: input.userId,
    symbol: input.symbol,
    horizon,
    marketRegime: input.marketRegime,
    patternKey: buildPatternKey({
      symbol: input.symbol,
      horizon,
      marketRegime: input.marketRegime,
      strategy: input.strategy,
      decision,
      mtfAlignment: input.metadata?.mtfAlignmentScore as number | undefined,
      spread: input.metadata?.spreadPercent as number | undefined,
      flow: input.metadata?.shortFlowImbalance as number | undefined,
      velocity: input.metadata?.tradeVelocity as number | undefined,
    }),
    decision,
    confidence: finite(input.confidence, 0),
    actualReturnPercent: input.returnPercent,
    outcome,
    errorType: outcome === "LOSS" ? "WRONG_DIRECTION_OR_WEAK_EDGE" : outcome === "BREAKEVEN" ? "BELOW_NET_TARGET" : undefined,
    aiMistakeTags: mistakeTags,
    executionId: input.executionId,
    metadata: {
      ...input.metadata,
      closeReason: input.closeReason,
      source: "post-trade-settlement",
    },
  }).catch(() => null);
}

export async function getAIAnalysisMemoryContext(input: AIAnalysisInput) {
  const horizon = resolveInputHorizon(input);
  const rows = await memoryModel().findMany({
    where: {
      horizon,
      OR: [
        { marketRegime: input.marketRegime?.mode },
        { symbol: input.symbol.toUpperCase() },
      ],
    },
    orderBy: [{ lastSeenAt: "desc" }],
    take: 8,
  }).catch(() => []);
  return rows.map((row) => ({
    patternKey: String(row.patternKey ?? ""),
    decision: String(row.decision ?? ""),
    sampleCount: finite(row.sampleCount, 0),
    winRate: finite(row.winRate, 0),
    avgReturn: finite(row.avgReturn, 0),
    avgConfidence: finite(row.avgConfidence, 0),
    errorType: row.errorType ? String(row.errorType) : null,
  }));
}

export async function listAIAnalysisMemory(limit = 60) {
  return memoryModel().findMany({
    orderBy: [{ lastSeenAt: "desc" }],
    take: Math.max(1, Math.min(200, limit)),
  });
}

export async function getAIAnalysisMemoryReport() {
  const rows = await listAIAnalysisMemory(120);
  const byHorizon = new Map<string, { horizon: string; count: number; winRate: number; avgReturn: number }>();
  for (const row of rows) {
    const horizon = String(row.horizon ?? "UNKNOWN");
    const count = finite(row.sampleCount, 0);
    const cur = byHorizon.get(horizon) ?? { horizon, count: 0, winRate: 0, avgReturn: 0 };
    const nextCount = cur.count + count;
    cur.winRate = nextCount > 0 ? (cur.winRate * cur.count + finite(row.winRate, 0) * count) / nextCount : cur.winRate;
    cur.avgReturn = nextCount > 0 ? (cur.avgReturn * cur.count + finite(row.avgReturn, 0) * count) / nextCount : cur.avgReturn;
    cur.count = nextCount;
    byHorizon.set(horizon, cur);
  }
  const reliable = rows
    .filter((row) => finite(row.sampleCount, 0) >= 3)
    .sort((a, b) => finite(b.avgReturn, 0) - finite(a.avgReturn, 0))
    .slice(0, 8);
  const risky = rows
    .filter((row) => finite(row.sampleCount, 0) >= 2)
    .sort((a, b) => finite(a.avgReturn, 0) - finite(b.avgReturn, 0))
    .slice(0, 8);
  const missedNoTrade = rows
    .filter((row) => String(row.decision ?? "") === "NO_TRADE" && finite(row.avgReturn, 0) > 0.5)
    .slice(0, 8);
  return {
    sampleCount: rows.reduce((acc, row) => acc + finite(row.sampleCount, 0), 0),
    byHorizon: Array.from(byHorizon.values()).map((row) => ({
      ...row,
      winRate: Number(row.winRate.toFixed(2)),
      avgReturn: Number(row.avgReturn.toFixed(4)),
    })),
    reliable,
    risky,
    missedNoTrade,
    recent: rows.slice(0, 12),
  };
}

export function adjustConfidenceWithAnalysisMemory(confidence: number, memory: unknown) {
  const rows = Array.isArray(memory) ? memory as Array<Record<string, unknown>> : [];
  const qualified = rows.filter((row) => finite(row.sampleCount, 0) >= 5);
  if (qualified.length === 0) return confidence;
  const avgReturn = qualified.reduce((acc, row) => acc + finite(row.avgReturn, 0), 0) / qualified.length;
  const winRate = qualified.reduce((acc, row) => acc + finite(row.winRate, 0), 0) / qualified.length;
  const penalty = avgReturn < -0.15 || winRate < 35 ? -6 : 0;
  const boost = avgReturn >= 0.5 && winRate >= 58 ? 4 : 0;
  return Number(clamp(0, confidence + penalty + boost, 100).toFixed(2));
}
