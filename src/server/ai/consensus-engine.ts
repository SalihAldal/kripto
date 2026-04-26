import { env } from "@/lib/config";
import type { AIConsensusResult, AIDecision, AIProviderResult } from "@/src/types/ai";

function decisionToScore(decision: AIDecision) {
  if (decision === "BUY") return 1;
  if (decision === "SELL") return -1;
  return 0;
}

export function scoreTradeOpportunity(outputs: AIProviderResult[]) {
  const valid = outputs.filter((x) => x.ok && x.output);
  if (valid.length === 0) return 0;
  const total = valid.reduce((acc, row) => acc + (row.output!.confidence / 100) * decisionToScore(row.output!.decision), 0);
  return Number((total / valid.length).toFixed(4));
}

export function rejectUnsafeTrade(outputs: AIProviderResult[]) {
  const valid = outputs.filter((x) => x.ok && x.output).map((x) => x.output!);
  if (valid.length === 0) {
    return { reject: true, reason: "No healthy provider result" };
  }
  const highRiskCount = valid.filter((x) => x.riskScore > env.AI_MAX_RISK_SCORE).length;
  const avgRisk = valid.reduce((acc, x) => acc + x.riskScore, 0) / valid.length;
  if (highRiskCount >= 2) {
    return {
      reject: true,
      reason: `Risk score exceeded threshold by majority (${highRiskCount}/${valid.length}, limit=${env.AI_MAX_RISK_SCORE})`,
    };
  }
  if (highRiskCount === 1 && avgRisk > env.AI_MAX_RISK_SCORE - 4) {
    return {
      reject: true,
      reason: `Risk score exceeded threshold with elevated average risk (avg=${avgRisk.toFixed(2)}, limit=${env.AI_MAX_RISK_SCORE})`,
    };
  }
  return { reject: false };
}

export function summarizeConsensus(outputs: AIProviderResult[]): AIConsensusResult {
  const isEliteQuality = env.AI_QUALITY_PROFILE === "elite";
  const healthy = outputs.filter((x) => x.ok && x.output);
  const remoteHealthy = healthy.filter((row) => {
    const meta = row.output?.metadata as Record<string, unknown> | undefined;
    const coverage = Number(meta?.remoteCoverage ?? (meta?.remote === true ? 1 : 0));
    return Number.isFinite(coverage) ? coverage > 0 : Boolean(meta?.remote);
  });
  const decisionCount: Record<AIDecision, number> = { BUY: 0, SELL: 0, HOLD: 0, NO_TRADE: 0 };
  const allDegraded =
    healthy.length > 0 &&
    healthy.every((row) => {
      const meta = row.output?.metadata as Record<string, unknown> | undefined;
      const coverage = Number(meta?.remoteCoverage ?? (meta?.remote === true ? 1 : 0));
      if (Number.isFinite(coverage)) return coverage <= 0;
      return !Boolean(meta?.remote);
    });

  for (const row of healthy) {
    decisionCount[row.output!.decision] += 1;
  }

  const weighted = scoreTradeOpportunity(outputs);
  const avgConfidence =
    healthy.length > 0
      ? Number((healthy.reduce((acc, row) => acc + row.output!.confidence, 0) / healthy.length).toFixed(2))
      : 0;
  const avgRisk =
    healthy.length > 0 ? Number((healthy.reduce((acc, row) => acc + row.output!.riskScore, 0) / healthy.length).toFixed(2)) : 100;

  const unsafe = rejectUnsafeTrade(outputs);
  if (unsafe.reject) {
    return {
      finalDecision: "NO_TRADE",
      finalConfidence: avgConfidence,
      finalRiskScore: avgRisk,
      score: weighted,
      explanation: unsafe.reason ?? "Risk rejected",
      outputs,
      rejected: true,
      rejectReason: unsafe.reason,
      generatedAt: new Date().toISOString(),
    };
  }

  const hasOnlyBuyBias = decisionCount.BUY > 0 && decisionCount.SELL === 0;
  const hasOnlySellBias = decisionCount.SELL > 0 && decisionCount.BUY === 0;
  const softDirectionalThreshold = 0.12;
  const softMinConfidence = Math.max(50, env.AI_MIN_CONFIDENCE - 12);
  const degradedMinConfidence = Math.max(42, env.AI_MIN_CONFIDENCE - 20);
  let finalDecision: AIDecision = "HOLD";
  if (decisionCount.BUY >= 2 && weighted > 0.12) finalDecision = "BUY";
  else if (decisionCount.SELL >= 2 && weighted < -0.12) finalDecision = "SELL";
  else if (hasOnlyBuyBias && weighted >= softDirectionalThreshold) finalDecision = "BUY";
  else if (hasOnlySellBias && weighted <= -softDirectionalThreshold) finalDecision = "SELL";
  else if (decisionCount.NO_TRADE >= 2) finalDecision = "NO_TRADE";
  else if (decisionCount.BUY > 0 && decisionCount.SELL > 0) finalDecision = "NO_TRADE";

  const unanimousDirectional =
    healthy.length > 0 &&
    ((finalDecision === "BUY" && decisionCount.BUY === healthy.length) ||
      (finalDecision === "SELL" && decisionCount.SELL === healthy.length));
  const directionalMajorityAccepted =
    (finalDecision === "BUY" && decisionCount.BUY >= 2) ||
    (finalDecision === "SELL" && decisionCount.SELL >= 2);
  const directionalSoftAccepted =
    (finalDecision === "BUY" && hasOnlyBuyBias && weighted >= softDirectionalThreshold) ||
    (finalDecision === "SELL" && hasOnlySellBias && weighted <= -softDirectionalThreshold);
  const majorityMinConfidence = Math.max(46, env.AI_MIN_CONFIDENCE - 6);
  const unanimousMinConfidence = Math.max(44, env.AI_MIN_CONFIDENCE - 8);
  const minConfidenceGate = allDegraded
    ? directionalSoftAccepted
      ? Math.max(40, degradedMinConfidence - 2)
      : degradedMinConfidence
    : unanimousDirectional
      ? unanimousMinConfidence
      : directionalMajorityAccepted
        ? majorityMinConfidence
    : directionalSoftAccepted
      ? softMinConfidence
      : env.AI_MIN_CONFIDENCE;
  const eliteDirectionalMinConfidence =
    finalDecision === "BUY" || finalDecision === "SELL"
      ? Math.max(minConfidenceGate, env.AI_LEVERAGE_MIN_CONFIDENCE_ULTRA)
      : minConfidenceGate;
  if (avgConfidence < eliteDirectionalMinConfidence) {
    finalDecision = "NO_TRADE";
  }

  if (env.AI_STRICT_ANALYST_MODE) {
    const effectiveMinHealthy = allDegraded
      ? Math.max(2, env.AI_MIN_HEALTHY_PROVIDER_COUNT - 1)
      : env.AI_MIN_HEALTHY_PROVIDER_COUNT;
    if (healthy.length < effectiveMinHealthy) {
      finalDecision = "NO_TRADE";
    }
    // Provider kredisi/model erisimi gecici olarak dusse bile akisi tamamen kilitleme.
    // Strict modda minimum 1 gercek remote provider yeterli olsun.
    const effectiveMinRemoteHealthy = 1;
    if (remoteHealthy.length < effectiveMinRemoteHealthy) {
      finalDecision = "NO_TRADE";
    }
    const requireUnanimousDirectional = env.AI_REQUIRE_UNANIMOUS_BUY_SELL || isEliteQuality;
    if (requireUnanimousDirectional && (finalDecision === "BUY" || finalDecision === "SELL")) {
      const sameDecision = healthy.every((x) => x.output?.decision === finalDecision);
      if (!sameDecision) finalDecision = "NO_TRADE";
    }
    const eliteRiskCap = isEliteQuality
      ? Math.min(env.AI_ULTRA_MAX_RISK_SCORE_SPOT, env.AI_ULTRA_MAX_RISK_SCORE_LEVERAGE)
      : Math.max(10, env.AI_MAX_RISK_SCORE - 8);
    if (avgRisk > eliteRiskCap) {
      finalDecision = "NO_TRADE";
    }
  }

  const explanation = `Consensus=${finalDecision}, buy:${decisionCount.BUY}, sell:${decisionCount.SELL}, hold:${decisionCount.HOLD}, no_trade:${decisionCount.NO_TRADE}, score:${weighted}, strict=${env.AI_STRICT_ANALYST_MODE ? "on" : "off"}, degraded=${allDegraded ? "yes" : "no"}, remoteHealthy:${remoteHealthy.length}/${healthy.length}`;
  return {
    finalDecision,
    finalConfidence: avgConfidence,
    finalRiskScore: avgRisk,
    score: weighted,
    explanation,
    outputs,
    rejected: finalDecision === "NO_TRADE",
    rejectReason: finalDecision === "NO_TRADE" ? "Consensus or confidence threshold not met" : undefined,
    generatedAt: new Date().toISOString(),
  };
}
