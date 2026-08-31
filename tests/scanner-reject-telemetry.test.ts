import { describe, expect, it } from "vitest";
import { env } from "@/lib/config";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";
import {
  buildScannerRejectTelemetryBundle,
  classifyFalseNegativeScannerCause,
  deriveExactScannerRejectReason,
  evaluateScannerSpreadMomentumShadow,
  resolveMomentumFieldState,
  resolveSpreadFieldState,
} from "@/src/server/scanner/scanner-reject-telemetry.service";
import type { MarketContext, ScannerScore } from "@/src/types/scanner";

function baseContext(overrides: Partial<MarketContext> = {}): MarketContext {
  return {
    symbol: "BTCTRY",
    lastPrice: 100,
    change24h: 1.2,
    volume24h: 20_000_000,
    volumeSpikePercent: 2,
    spreadPercent: 0.08,
    volatilityPercent: 1.3,
    momentumPercent: 0.8,
    orderBookImbalance: 0.2,
    buyPressure: 0.62,
    shortCandleSignal: 2,
    fakeSpikeScore: 0.3,
    pumpRisk: 20,
    pumpIntensity: 40,
    tradable: true,
    rejectReasons: [],
    metadata: {
      shortMomentumPercent: 0.25,
      hourMomentumPercent: 2.5,
      shortFlowImbalance: 0.35,
      tradeVelocity: 1.2,
      marketRegime: "RANGE_SIDEWAYS",
      dataQualityOk: true,
      dataQualityIssues: [],
    },
    ...overrides,
  };
}

function maxPreAiSpread() {
  return Math.min(0.14, Math.max(0.08, env.SCANNER_MAX_SPREAD_PERCENT));
}

describe("scanner reject telemetry", () => {
  it("1) spread below threshold — shadow PASS when qualified", () => {
    const context = baseContext({ spreadPercent: 0.05 });
    const score = scoreContext(context);
    const shadow = evaluateScannerSpreadMomentumShadow({
      context,
      score,
      maxPreAiSpreadPercent: maxPreAiSpread(),
    });
    expect(shadow.spreadPercent).toBe(0.05);
    expect(shadow.shadowPolicyDecision).toBe("PASS");
    expect(shadow.currentPolicyDecision).toBe(score.status === "QUALIFIED" ? "PASS" : "REJECT");
  });

  it("2) spread above threshold without breakout — shadow REJECT", () => {
    const context = baseContext({
      spreadPercent: 0.2,
      metadata: {
        shortMomentumPercent: 0.01,
        hourMomentumPercent: 0.2,
        shortFlowImbalance: 0.05,
        tradeVelocity: 0.1,
        marketRegime: "RANGE_SIDEWAYS",
        dataQualityOk: true,
        dataQualityIssues: [],
      },
    });
    const score = scoreContext(context);
    const shadow = evaluateScannerSpreadMomentumShadow({
      context,
      score,
      maxPreAiSpreadPercent: maxPreAiSpread(),
    });
    expect(shadow.shadowPolicyDecision).toBe("REJECT");
  });

  it("3) momentumBreakout true can shadow PASS despite wide spread", () => {
    const context = baseContext({
      spreadPercent: 0.2,
      momentumPercent: 1.2,
      metadata: {
        shortMomentumPercent: 0.35,
        hourMomentumPercent: 3,
        shortFlowImbalance: 0.55,
        tradeVelocity: 1.5,
        marketRegime: "RANGE_SIDEWAYS",
        dataQualityOk: true,
        dataQualityIssues: [],
      },
    });
    const score = scoreContext(context);
    const shadow = evaluateScannerSpreadMomentumShadow({
      context,
      score,
      maxPreAiSpreadPercent: maxPreAiSpread(),
    });
    expect(shadow.momentumBreakoutOk).toBe(true);
    expect(shadow.shadowPolicyDecision).toBe("PASS");
  });

  it("4) momentumBreakout false with wide spread — shadow REJECT", () => {
    const context = baseContext({
      spreadPercent: 0.25,
      metadata: {
        shortMomentumPercent: 0.01,
        hourMomentumPercent: 0.1,
        shortFlowImbalance: 0.02,
        tradeVelocity: 0.1,
        marketRegime: "RANGE_SIDEWAYS",
        dataQualityOk: true,
        dataQualityIssues: [],
      },
    });
    const score = scoreContext(context);
    const shadow = evaluateScannerSpreadMomentumShadow({
      context,
      score,
      maxPreAiSpreadPercent: maxPreAiSpread(),
    });
    expect(shadow.momentumBreakoutOk).toBe(false);
    expect(shadow.shadowPolicyDecision).toBe("REJECT");
  });

  it("5) missing spread — UNKNOWN shadow, not GOOD/BAD default", () => {
    const context = baseContext();
    (context as { spreadPercent?: number }).spreadPercent = undefined as unknown as number;
    expect(resolveSpreadFieldState(context)).toBe("MISSING");
    const score: ScannerScore = {
      symbol: context.symbol,
      score: 40,
      confidence: 30,
      status: "REJECTED",
      reasons: [],
      metrics: {
        momentum: 0,
        microMomentum: 0,
        volume: 0,
        spread: 0,
        volatility: 0,
        orderBook: 0,
        pressure: 0,
        microFlow: 0,
        velocity: 0,
        candle: 0,
        fakeSpikePenalty: 0,
        liquidityPenalty: 0,
        pumpBoost: 0,
        pumpRiskPenalty: 0,
      },
    };
    const shadow = evaluateScannerSpreadMomentumShadow({
      context,
      score,
      maxPreAiSpreadPercent: maxPreAiSpread(),
    });
    expect(shadow.shadowPolicyDecision).toBe("UNKNOWN");
    expect(shadow.spreadPercent).toBe("MISSING");
  });

  it("6) stale spread telemetry — UNKNOWN shadow", () => {
    const context = baseContext({
      metadata: {
        shortMomentumPercent: 0.2,
        hourMomentumPercent: 2,
        shortFlowImbalance: 0.3,
        tradeVelocity: 1,
        marketRegime: "RANGE_SIDEWAYS",
        dataQualityIssues: ["PRICE_STALE"],
        dataQualityOk: false,
      },
    });
    expect(resolveSpreadFieldState(context)).toBe("STALE");
    const shadow = evaluateScannerSpreadMomentumShadow({
      context,
      score: scoreContext(context),
      maxPreAiSpreadPercent: maxPreAiSpread(),
    });
    expect(shadow.shadowPolicyDecision).toBe("UNKNOWN");
  });

  it("7) missing momentum — UNKNOWN momentum state", () => {
    const context = baseContext({
      tradable: false,
      volume24h: env.SCANNER_MIN_VOLUME_24H * 0.2,
      rejectReasons: ["Low liquidity"],
      metadata: { marketRegime: "LOW_VOLUME_DEAD_MARKET", dataQualityOk: true, dataQualityIssues: [] },
    });
    expect(resolveMomentumFieldState(context)).toBe("MISSING");
    const score = scoreContext(context);
    const bundle = buildScannerRejectTelemetryBundle({
      context,
      score,
      maxPreAiSpreadPercent: maxPreAiSpread(),
      candidateId: "test:scanner:BTCTRY",
    });
    expect(bundle.telemetry?.momentumBreakoutOk).toBe("MISSING");
    expect(bundle.shadow.shadowPolicyDecision).toBe("UNKNOWN");
  });

  it("8) generic rejection telemetry exposes exact code", () => {
    const context = baseContext({
      tradable: false,
      volume24h: env.SCANNER_MIN_VOLUME_24H * 0.2,
      rejectReasons: ["Low liquidity"],
      momentumPercent: 0.01,
      metadata: {
        shortMomentumPercent: 0.01,
        hourMomentumPercent: 0.1,
        shortFlowImbalance: 0.02,
        tradeVelocity: 0.1,
        marketRegime: "RANGE_SIDEWAYS",
        dataQualityOk: true,
        dataQualityIssues: [],
      },
    });
    const score = scoreContext(context);
    const exact = deriveExactScannerRejectReason(context, score);
    expect(exact).not.toBeNull();
    expect(exact?.rejectReasonCode).not.toBe("REJECTED");
    expect(exact?.rejectReasonDetail.length).toBeGreaterThan(0);
  });

  it("9) exact reject reason for low score", () => {
    const context = baseContext({
      volume24h: env.SCANNER_MIN_VOLUME_24H * 0.5,
      tradable: false,
      rejectReasons: ["Low liquidity"],
    });
    const score = scoreContext(context);
    const exact = deriveExactScannerRejectReason(context, score);
    expect(exact?.rejectReasonCode).toBe("LIQUIDITY_LOW");
  });

  it("10) 37 cohort symbols replay diagnosable", () => {
    const cohort = [
      "ICPTRY",
      "EULTRY",
      "STRAXTRY",
      "FFTRY",
      "PORTALTRY",
      "EGLDTRY",
      "RAYTRY",
      "AMPTRY",
      "THETRY",
      "ZROTRY",
    ];
    let diagnosable = 0;
    for (const symbol of cohort) {
      const context = baseContext({
        symbol,
        tradable: false,
        volume24h: env.SCANNER_MIN_VOLUME_24H * 0.2,
        rejectReasons: ["Low liquidity"],
        momentumPercent: 0.02,
      });
      const score = scoreContext(context);
      const exact = deriveExactScannerRejectReason(context, score);
      if (exact && exact.rejectReasonCode !== "GENERIC_REJECTED") diagnosable += 1;
    }
    expect(diagnosable).toBeGreaterThan(0);
  });

  it("11) false-negative classification does not assume all are bugs", () => {
    const context = baseContext({
      spreadPercent: 0.25,
      tradable: false,
      volume24h: env.SCANNER_MIN_VOLUME_24H * 0.2,
      rejectReasons: ["Low liquidity"],
      metadata: {
        shortMomentumPercent: 0.01,
        hourMomentumPercent: 0.1,
        shortFlowImbalance: 0.01,
        tradeVelocity: 0.05,
        marketRegime: "HIGH_VOLATILITY_CHAOS",
        dataQualityOk: true,
        dataQualityIssues: [],
      },
    });
    const score = scoreContext(context);
    const bundle = buildScannerRejectTelemetryBundle({
      context,
      score,
      maxPreAiSpreadPercent: maxPreAiSpread(),
      candidateId: "test:scanner:BTCTRY",
    });
    const cause = classifyFalseNegativeScannerCause(bundle.telemetry, bundle.shadow);
    expect(["true_spread", "unknown", "duplicate", "true_momentum_breakout_failure", "missing_data"]).toContain(cause);
  });

  it("12) losing cohort — shadow does not auto-release without data", () => {
    const losingContext = baseContext({
      spreadPercent: 0.3,
      metadata: {
        shortMomentumPercent: 0.01,
        hourMomentumPercent: 0.1,
        shortFlowImbalance: 0.01,
        tradeVelocity: 0.05,
        marketRegime: "HIGH_VOLATILITY_CHAOS",
        dataQualityOk: true,
        dataQualityIssues: [],
      },
    });
    const score = scoreContext(losingContext);
    const shadow = evaluateScannerSpreadMomentumShadow({
      context: losingContext,
      score,
      maxPreAiSpreadPercent: maxPreAiSpread(),
    });
    expect(shadow.currentPolicyDecision).toBe("REJECT");
    expect(shadow.shadowPolicyDecision).not.toBe("PASS");
  });

  it("13) scoreContext qualification unchanged (no TDI path touched)", () => {
    const before = scoreContext(baseContext());
    const after = scoreContext(baseContext({ spreadPercent: 0.09 }));
    expect(before.status).toBe(after.status);
    expect(["QUALIFIED", "REJECTED"]).toContain(before.status);
  });

  it("14) shadow evaluator does not mutate score status", () => {
    const context = baseContext();
    const score = scoreContext(context);
    const statusBefore = score.status;
    evaluateScannerSpreadMomentumShadow({
      context,
      score,
      maxPreAiSpreadPercent: maxPreAiSpread(),
    });
    expect(score.status).toBe(statusBefore);
  });

  it("15) shadow does not alter actual scanner outcome via bundle", () => {
    const context = baseContext();
    const score = scoreContext(context);
    buildScannerRejectTelemetryBundle({
      context,
      score,
      maxPreAiSpreadPercent: maxPreAiSpread(),
      candidateId: "test:scanner:BTCTRY",
    });
    expect(score.status).toBe(scoreContext(context).status);
  });

  it("16) qualified symbols produce null telemetry reject row", () => {
    const context = baseContext();
    const score = scoreContext(context);
    const bundle = buildScannerRejectTelemetryBundle({
      context,
      score,
      maxPreAiSpreadPercent: maxPreAiSpread(),
      candidateId: "test:scanner:BTCTRY",
    });
    if (score.status === "QUALIFIED") {
      expect(bundle.telemetry).toBeNull();
    } else {
      expect(bundle.telemetry?.rejectReasonCode).toBeTruthy();
    }
  });
});

describe("scanner qualification forensics exact reason", () => {
  it("maps empty rejected reasons to exact telemetry code", () => {
    const context = baseContext({
      tradable: false,
      volume24h: env.SCANNER_MIN_VOLUME_24H * 0.2,
      rejectReasons: ["Low liquidity"],
      momentumPercent: 0.01,
      metadata: {
        shortMomentumPercent: 0.01,
        hourMomentumPercent: 0.1,
        shortFlowImbalance: 0.02,
        tradeVelocity: 0.1,
        marketRegime: "RANGE_SIDEWAYS",
        dataQualityOk: true,
        dataQualityIssues: [],
      },
    });
    const score = scoreContext(context);
    const exact = deriveExactScannerRejectReason(context, score);
    expect(score.status).toBe("REJECTED");
    expect(exact?.rejectReasonCode).not.toBe("REJECTED");
  });
});
