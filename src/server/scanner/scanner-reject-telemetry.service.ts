import { env } from "@/lib/config";
import { evaluateMomentumBreakout } from "@/src/server/scanner/momentum-breakout.service";
import type { MarketContext, ScannerScore } from "@/src/types/scanner";

export type DataFieldState = "AVAILABLE" | "MISSING" | "STALE" | "INVALID" | "UNKNOWN";

export type ScannerPolicyOutcome = "PASS" | "REJECT" | "UNKNOWN";

export type ScannerRejectTelemetry = {
  candidateId: string;
  symbol: string;
  timestamp: string;
  rejectStage: string;
  rejectReasonCode: string;
  rejectReasonDetail: string;
  spreadPercent: number | "MISSING";
  maxPreAiSpreadPercent: number;
  momentumBreakoutOk: boolean | "MISSING";
  qualityScore: number | "MISSING";
  compositeScore: number | "MISSING";
  sentimentScore: number | "MISSING";
  mtfScore: number | "MISSING";
  volume: number | "MISSING";
  liquidity: number | "MISSING";
  regime: string | "MISSING";
  dataQualityState: "OK" | "STALE" | "MISSING" | "INVALID" | "UNKNOWN";
  spreadState: DataFieldState;
  momentumState: DataFieldState;
};

export type SpreadMomentumShadowResult = {
  currentPolicyDecision: ScannerPolicyOutcome;
  shadowPolicyDecision: ScannerPolicyOutcome;
  spreadPercent: number | "MISSING";
  spreadThreshold: number;
  momentumBreakoutOk: boolean | "MISSING";
  dataQuality: DataFieldState;
  shadowRationale: string;
};

export type ScannerRejectTelemetryBundle = {
  telemetry: ScannerRejectTelemetry | null;
  shadow: SpreadMomentumShadowResult;
};

function numOrMissing(value: unknown): number | "MISSING" {
  if (value === null || value === undefined || value === "") return "MISSING";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : "MISSING";
}

function strOrMissing(value: unknown): string | "MISSING" {
  if (value === null || value === undefined || value === "") return "MISSING";
  return String(value);
}

export function resolveSpreadFieldState(context: MarketContext): DataFieldState {
  if (context.spreadPercent === undefined || context.spreadPercent === null) return "MISSING";
  if (!Number.isFinite(context.spreadPercent)) return "INVALID";
  const issues = Array.isArray(context.metadata.dataQualityIssues) ? context.metadata.dataQualityIssues : [];
  if (issues.some((row) => String(row).includes("PRICE_STALE") || String(row).includes("BOOK_PRICE"))) return "STALE";
  return "AVAILABLE";
}

export function resolveMomentumFieldState(context: MarketContext): DataFieldState {
  const shortMomentum = context.metadata.shortMomentumPercent;
  const hourMomentum = context.metadata.hourMomentumPercent;
  if (shortMomentum === undefined && hourMomentum === undefined) return "MISSING";
  const shortOk = shortMomentum !== undefined && Number.isFinite(Number(shortMomentum));
  const hourOk = hourMomentum !== undefined && Number.isFinite(Number(hourMomentum));
  if (!shortOk && !hourOk) return "INVALID";
  const issues = Array.isArray(context.metadata.dataQualityIssues) ? context.metadata.dataQualityIssues : [];
  if (issues.some((row) => String(row).includes("KLINE_MISSING"))) return "STALE";
  return "AVAILABLE";
}

export function resolveDataQualityState(context: MarketContext): ScannerRejectTelemetry["dataQualityState"] {
  const issues = Array.isArray(context.metadata.dataQualityIssues)
    ? context.metadata.dataQualityIssues.map((row) => String(row))
    : [];
  if (issues.length === 0) {
    if (context.metadata.dataQualityOk === false) return "UNKNOWN";
    return "OK";
  }
  if (issues.some((row) => row.includes("STALE") || row.includes("PRICE_STALE"))) return "STALE";
  if (issues.some((row) => row.includes("MISSING") || row.includes("FALLBACK"))) return "MISSING";
  if (issues.some((row) => row.includes("ANOMALY") || row.includes("CONFLICTING"))) return "INVALID";
  return "UNKNOWN";
}

function resolveMtfScore(context: MarketContext): number | "MISSING" {
  const candidates = [
    context.metadata.mtfScore,
    context.metadata.multiTimeframeScore,
    context.metadata.mtfAlignmentScore,
  ];
  for (const value of candidates) {
    const parsed = numOrMissing(value);
    if (parsed !== "MISSING") return parsed;
  }
  return "MISSING";
}

export function deriveExactScannerRejectReason(
  context: MarketContext,
  score: ScannerScore,
): { rejectStage: string; rejectReasonCode: string; rejectReasonDetail: string } | null {
  if (score.status === "QUALIFIED") return null;

  for (const reason of context.rejectReasons) {
    const upper = reason.toUpperCase();
    if (reason.includes("Low liquidity")) {
      return { rejectStage: "filter", rejectReasonCode: "LIQUIDITY_LOW", rejectReasonDetail: reason };
    }
    if (reason.includes("Spread")) {
      return { rejectStage: "filter", rejectReasonCode: "SPREAD_TOO_WIDE", rejectReasonDetail: reason };
    }
    if (upper.includes("DATA QUALITY") || upper.includes("PRICE_STALE") || upper.includes("KLINE_MISSING")) {
      return {
        rejectStage: "filter",
        rejectReasonCode: upper.includes("STALE") ? "STALE_TELEMETRY" : "MISSING_TELEMETRY",
        rejectReasonDetail: reason,
      };
    }
    if (upper.includes("PUMP")) {
      return { rejectStage: "filter", rejectReasonCode: "PUMP_GATE_BLOCK", rejectReasonDetail: reason };
    }
  }

  if (!context.tradable) {
    return {
      rejectStage: "filter",
      rejectReasonCode: "NOT_TRADABLE",
      rejectReasonDetail: context.rejectReasons.join(" | ") || "Symbol marked not tradable",
    };
  }

  const momentumBreakout = evaluateMomentumBreakout(context);
  const marketRegime = String(context.metadata.marketRegime ?? "UNKNOWN");
  const shortMomentumPercent = Number(context.metadata.shortMomentumPercent ?? 0);

  for (const reason of score.reasons) {
    if (reason.includes("Score below threshold")) {
      return { rejectStage: "qualification", rejectReasonCode: "QUALITY_LOW", rejectReasonDetail: reason };
    }
    if (reason.includes("Directional edge")) {
      return { rejectStage: "qualification", rejectReasonCode: "NO_DIRECTIONAL_EDGE", rejectReasonDetail: reason };
    }
    if (reason.includes("Regime LOW_VOLUME_DEAD_MARKET")) {
      return { rejectStage: "qualification", rejectReasonCode: "REGIME_GATE", rejectReasonDetail: reason };
    }
    if (reason.includes("Futures risk elevated")) {
      return { rejectStage: "qualification", rejectReasonCode: "BTC_CONTEXT_BLOCK", rejectReasonDetail: reason };
    }
    if (reason.includes("Leveraged trap")) {
      return { rejectStage: "qualification", rejectReasonCode: "RISK_GATE", rejectReasonDetail: reason };
    }
    if (reason.includes("Regime transition")) {
      return { rejectStage: "qualification", rejectReasonCode: "REGIME_GATE", rejectReasonDetail: reason };
    }
    if (reason.includes("chop/rapid switching")) {
      return { rejectStage: "qualification", rejectReasonCode: "REGIME_GATE", rejectReasonDetail: reason };
    }
    if (reason.includes("LOW_VOLATILITY")) {
      return { rejectStage: "qualification", rejectReasonCode: "MOMENTUM_BREAKOUT_FAILED", rejectReasonDetail: reason };
    }
    if (reason.includes("CHAOS/UNSTABLE")) {
      return { rejectStage: "qualification", rejectReasonCode: "SPREAD_TOO_WIDE", rejectReasonDetail: reason };
    }
    if (reason.includes("BEARISH")) {
      return { rejectStage: "qualification", rejectReasonCode: "STRATEGY_BLOCK", rejectReasonDetail: reason };
    }
    return {
      rejectStage: "qualification",
      rejectReasonCode: reason.replace(/\s+/g, "_").toUpperCase().slice(0, 48),
      rejectReasonDetail: reason,
    };
  }

  if (!momentumBreakout.ok) {
    return {
      rejectStage: "qualification",
      rejectReasonCode: "MOMENTUM_BREAKOUT_FAILED",
      rejectReasonDetail: momentumBreakout.reasons.join(" | ") || "Momentum breakout gate failed",
    };
  }

  if (score.score < env.SCANNER_MIN_SCORE) {
    return {
      rejectStage: "qualification",
      rejectReasonCode: "QUALITY_LOW",
      rejectReasonDetail: `Score ${score.score} below threshold ${env.SCANNER_MIN_SCORE}`,
    };
  }

  if (marketRegime === "LOW_VOLUME_DEAD_MARKET") {
    return {
      rejectStage: "qualification",
      rejectReasonCode: "REGIME_GATE",
      rejectReasonDetail: `Regime ${marketRegime}`,
    };
  }

  if (
    (marketRegime === "HIGH_VOLATILITY_CHAOS" || marketRegime === "NEWS_DRIVEN_UNSTABLE") &&
    (context.spreadPercent > 0.12 || context.fakeSpikeScore > 1.8) &&
    !momentumBreakout.ok
  ) {
    return {
      rejectStage: "qualification",
      rejectReasonCode: "SPREAD_TOO_WIDE",
      rejectReasonDetail: `Regime ${marketRegime} with spread/wick strict filter`,
    };
  }

  if (
    (marketRegime === "STRONG_BEARISH_TREND" || marketRegime === "WEAK_BEARISH_TREND") &&
    shortMomentumPercent <= 0
  ) {
    return {
      rejectStage: "qualification",
      rejectReasonCode: "STRATEGY_BLOCK",
      rejectReasonDetail: `Regime ${marketRegime} bearish filter`,
    };
  }

  return {
    rejectStage: "qualification",
    rejectReasonCode: "OTHER",
    rejectReasonDetail: score.reasons.join(" | ") || context.rejectReasons.join(" | ") || "Scanner rejected without mapped reason",
  };
}

export function evaluateScannerSpreadMomentumShadow(input: {
  context: MarketContext;
  score: ScannerScore;
  maxPreAiSpreadPercent: number;
}): SpreadMomentumShadowResult {
  const spreadState = resolveSpreadFieldState(input.context);
  const momentumState = resolveMomentumFieldState(input.context);
  const dataQuality = resolveDataQualityState(input.context);
  const spreadPercent = numOrMissing(input.context.spreadPercent);

  let momentumBreakoutOk: boolean | "MISSING" = "MISSING";
  if (spreadState === "MISSING" || spreadState === "INVALID") {
    momentumBreakoutOk = "MISSING";
  } else if (momentumState === "AVAILABLE") {
    momentumBreakoutOk = evaluateMomentumBreakout(input.context).ok;
  } else if (momentumState === "MISSING" || momentumState === "STALE" || momentumState === "INVALID") {
    momentumBreakoutOk = "MISSING";
  }

  const currentPolicyDecision: ScannerPolicyOutcome =
    input.score.status === "QUALIFIED" ? "PASS" : "REJECT";

  let shadowPolicyDecision: ScannerPolicyOutcome = "UNKNOWN";
  let shadowRationale = "Insufficient spread/momentum telemetry";

  if (spreadState === "MISSING" || momentumState === "MISSING") {
    shadowPolicyDecision = "UNKNOWN";
    shadowRationale = "Spread or momentum telemetry MISSING";
  } else if (spreadState === "STALE" || momentumState === "STALE") {
    shadowPolicyDecision = "UNKNOWN";
    shadowRationale = "Spread or momentum telemetry STALE";
  } else if (spreadState === "INVALID" || momentumState === "INVALID") {
    shadowPolicyDecision = "UNKNOWN";
    shadowRationale = "Spread or momentum telemetry INVALID";
  } else if (dataQuality === "STALE" || dataQuality === "MISSING" || dataQuality === "INVALID") {
    shadowPolicyDecision = "UNKNOWN";
    shadowRationale = `Data quality state ${dataQuality}`;
  } else if (momentumBreakoutOk === "MISSING") {
    shadowPolicyDecision = "UNKNOWN";
    shadowRationale = "Momentum breakout state unavailable";
  } else {
    const spread = input.context.spreadPercent;
    const spreadBlocked = spread > input.maxPreAiSpreadPercent && !momentumBreakoutOk;
    shadowPolicyDecision = spreadBlocked ? "REJECT" : "PASS";
    shadowRationale = spreadBlocked
      ? `spread ${spread.toFixed(4)}% > ${input.maxPreAiSpreadPercent} and momentumBreakout.ok=false`
      : momentumBreakoutOk
        ? "momentumBreakout.ok bypasses spread gate in shadow"
        : `spread ${spread.toFixed(4)}% <= ${input.maxPreAiSpreadPercent}`;
  }

  return {
    currentPolicyDecision,
    shadowPolicyDecision,
    spreadPercent,
    spreadThreshold: input.maxPreAiSpreadPercent,
    momentumBreakoutOk,
    dataQuality: dataQuality === "OK" ? "AVAILABLE" : dataQuality === "UNKNOWN" ? "UNKNOWN" : dataQuality,
    shadowRationale,
  };
}

export function buildScannerRejectTelemetryBundle(input: {
  context: MarketContext;
  score: ScannerScore;
  maxPreAiSpreadPercent: number;
  candidateId: string;
  timestamp?: string;
}): ScannerRejectTelemetryBundle {
  const shadow = evaluateScannerSpreadMomentumShadow({
    context: input.context,
    score: input.score,
    maxPreAiSpreadPercent: input.maxPreAiSpreadPercent,
  });
  const exact = deriveExactScannerRejectReason(input.context, input.score);
  const momentumState = resolveMomentumFieldState(input.context);
  const spreadState = resolveSpreadFieldState(input.context);
  let momentumBreakoutOk: boolean | "MISSING" = "MISSING";
  if (spreadState === "MISSING" || spreadState === "INVALID") {
    momentumBreakoutOk = "MISSING";
  } else if (momentumState === "AVAILABLE") {
    momentumBreakoutOk = evaluateMomentumBreakout(input.context).ok;
  }

  const telemetry: ScannerRejectTelemetry | null = exact
    ? {
        candidateId: input.candidateId,
        symbol: input.context.symbol.toUpperCase(),
        timestamp: input.timestamp ?? new Date().toISOString(),
        rejectStage: exact.rejectStage,
        rejectReasonCode: exact.rejectReasonCode,
        rejectReasonDetail: exact.rejectReasonDetail,
        spreadPercent: numOrMissing(input.context.spreadPercent),
        maxPreAiSpreadPercent: input.maxPreAiSpreadPercent,
        momentumBreakoutOk: momentumBreakoutOk,
        qualityScore: numOrMissing(input.score.score),
        compositeScore: numOrMissing(input.score.score),
        sentimentScore: numOrMissing(input.context.metadata.sentimentScore),
        mtfScore: resolveMtfScore(input.context),
        volume: numOrMissing(input.context.volume24h),
        liquidity: numOrMissing(input.context.metadata.liquidityScore ?? input.context.volume24h),
        regime: strOrMissing(input.context.metadata.marketRegime),
        dataQualityState: resolveDataQualityState(input.context),
        spreadState: resolveSpreadFieldState(input.context),
        momentumState,
      }
    : null;

  return { telemetry, shadow };
}

export function classifyFalseNegativeScannerCause(
  telemetry: ScannerRejectTelemetry | null,
  shadow: SpreadMomentumShadowResult,
): string {
  if (!telemetry) return "UNKNOWN";
  if (telemetry.spreadState === "MISSING" || telemetry.momentumState === "MISSING") return "missing_data";
  if (telemetry.spreadState === "STALE" || telemetry.momentumState === "STALE") return "stale_data";
  if (telemetry.rejectReasonCode === "SPREAD_TOO_WIDE" || shadow.shadowPolicyDecision === "REJECT") {
    if (shadow.momentumBreakoutOk === true) return "duplicate";
    return "true_spread";
  }
  if (telemetry.rejectReasonCode === "MOMENTUM_BREAKOUT_FAILED") return "true_momentum_breakout_failure";
  if (telemetry.dataQualityState !== "OK") return "missing_data";
  if (telemetry.rejectReasonCode === "OTHER" || telemetry.rejectReasonCode === "GENERIC_REJECTED") return "unknown";
  return "unknown";
}
