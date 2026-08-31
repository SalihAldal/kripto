import { afterEach, describe, expect, it } from "vitest";
import type { SymbolMarketSnapshot, RollingMetrics } from "@/src/server/market-data/spine/events";
import { OpportunityEngine, resetOpportunityEngineForTests } from "@/src/server/opportunity/opportunity-engine";
import { buildScoreBreakdown, scoreLane } from "@/src/server/opportunity/score";
import { computeOpportunityFeatures } from "@/src/server/opportunity/features";
import { computeBreadth } from "@/src/server/opportunity/features";
import { isExcludedOpportunitySymbol } from "@/src/server/opportunity/universe-policy";
import { signedScore } from "@/src/server/opportunity/normalize";
import { resetMarketDataDaemonForTests } from "@/src/server/market-data/spine/market-data-daemon";
import { resetPublicMarketRestAudit, countHotPathPublicMarketRestCalls } from "@/src/server/market-data/spine/rest-call-audit";

function rolling(overrides: Partial<RollingMetrics> = {}): RollingMetrics {
  return {
    return1s: 0,
    return5s: 0,
    return15s: 0,
    return30s: 0,
    return1m: 0,
    return3m: 0,
    return5m: 0,
    return15m: 0,
    volumeDelta: 0,
    quoteVolumeDelta: 50_000,
    ...overrides,
  };
}

function snap(symbol: string, input: Partial<SymbolMarketSnapshot> & { rolling?: Partial<RollingMetrics> } = {}): SymbolMarketSnapshot {
  const { rolling: rollingOver, ...rest } = input;
  return {
    symbol,
    lastPrice: 100,
    previousPrice: 99.5,
    openPrice: 99,
    change24h: 1,
    high24h: 102,
    low24h: 97,
    quoteVolume24h: 5_000_000,
    baseVolume24h: 50_000,
    eventTime: Date.now(),
    localReceiveTime: Date.now(),
    lastUpdateAt: Date.now(),
    stale: false,
    rolling: rolling(rollingOver),
    ...rest,
  };
}

function earlyMover(symbol: string, extra?: Partial<RollingMetrics>): SymbolMarketSnapshot {
  return snap(symbol, {
    change24h: 0.4,
    rolling: {
      return1s: 0.08,
      return5s: 0.22,
      return15s: 0.35,
      return30s: 0.48,
      return1m: 0.7,
      return3m: 0.85,
      return5m: 0.95,
      return15m: 1.1,
      quoteVolumeDelta: 180_000,
      ...extra,
    },
  });
}

describe("phase 03 opportunity engine", () => {
  afterEach(() => {
    resetOpportunityEngineForTests();
    resetMarketDataDaemonForTests().stop();
  });

  it("positive return produces positive evidence", () => {
    const features = computeOpportunityFeatures({
      row: earlyMover("AAAUSDT"),
      breadth: computeBreadth([earlyMover("AAAUSDT"), snap("BTCUSDT")]),
      volumeHistory: [40_000, 70_000, 90_000],
    });
    const breakdown = buildScoreBreakdown(features);
    expect(breakdown.priceVelocity).toBeGreaterThan(0);
    expect(scoreLane("EARLY", breakdown, features)).toBeGreaterThan(0);
  });

  it("negative return does not raise LONG opportunity score", () => {
    const down = snap("AAAUSDT", {
      rolling: {
        return1s: -0.4,
        return5s: -0.8,
        return15s: -1.1,
        return30s: -1.3,
        return1m: -1.5,
        return5m: -2.2,
        quoteVolumeDelta: 80_000,
      },
    });
    const features = computeOpportunityFeatures({
      row: down,
      breadth: computeBreadth([down, snap("BTCUSDT")]),
      volumeHistory: [50_000],
    });
    const breakdown = buildScoreBreakdown(features);
    expect(breakdown.priceVelocity).toBeLessThanOrEqual(0);
    expect(scoreLane("EARLY", breakdown, features)).toBeLessThanOrEqual(0);
  });

  it("positive acceleration raises EARLY score", () => {
    const slow = earlyMover("AAAUSDT", { return5s: 0.05, return30s: 0.4, return1m: 0.5 });
    const fast = earlyMover("AAAUSDT", { return5s: 0.45, return30s: 0.2, return1m: 0.7 });
    const breadth = computeBreadth([fast, snap("BTCUSDT")]);
    const slowScore = scoreLane(
      "EARLY",
      buildScoreBreakdown(computeOpportunityFeatures({ row: slow, breadth, volumeHistory: [80_000, 90_000, 100_000] })),
      computeOpportunityFeatures({ row: slow, breadth, volumeHistory: [80_000, 90_000, 100_000] }),
    );
    const fastScore = scoreLane(
      "EARLY",
      buildScoreBreakdown(computeOpportunityFeatures({ row: fast, breadth, volumeHistory: [80_000, 90_000, 100_000] })),
      computeOpportunityFeatures({ row: fast, breadth, volumeHistory: [80_000, 90_000, 100_000] }),
    );
    expect(fastScore).toBeGreaterThan(slowScore);
  });

  it("negative acceleration lowers EARLY score", () => {
    const decelerating = earlyMover("AAAUSDT", { return5s: -0.2, return30s: 0.6, return1m: 0.8 });
    const accelerating = earlyMover("AAAUSDT", { return5s: 0.4, return30s: 0.15, return1m: 0.7 });
    const breadth = computeBreadth([accelerating, snap("BTCUSDT")]);
    const low = scoreLane(
      "EARLY",
      buildScoreBreakdown(computeOpportunityFeatures({ row: decelerating, breadth, volumeHistory: [90_000] })),
      computeOpportunityFeatures({ row: decelerating, breadth, volumeHistory: [90_000] }),
    );
    const high = scoreLane(
      "EARLY",
      buildScoreBreakdown(computeOpportunityFeatures({ row: accelerating, breadth, volumeHistory: [90_000] })),
      computeOpportunityFeatures({ row: accelerating, breadth, volumeHistory: [90_000] }),
    );
    expect(low).toBeLessThan(high);
  });

  it("volume acceleration raises score", () => {
    const row = earlyMover("AAAUSDT");
    const breadth = computeBreadth([row, snap("BTCUSDT")]);
    const low = buildScoreBreakdown(computeOpportunityFeatures({ row, breadth, volumeHistory: [180_000, 175_000, 170_000] }));
    const high = buildScoreBreakdown(computeOpportunityFeatures({ row, breadth, volumeHistory: [40_000, 80_000, 120_000] }));
    expect(high.volumeAcceleration).toBeGreaterThan(low.volumeAcceleration);
  });

  it("RVOL anomaly is bounded", () => {
    expect(Math.abs(signedScore(50, 2.2))).toBeLessThanOrEqual(100);
    const row = earlyMover("AAAUSDT", { quoteVolumeDelta: 9_000_000 });
    const features = computeOpportunityFeatures({
      row,
      breadth: computeBreadth([row, snap("BTCUSDT")]),
      volumeHistory: [10_000, 11_000, 9_000],
    });
    const breakdown = buildScoreBreakdown(features);
    expect(breakdown.relativeVolume).toBeLessThanOrEqual(100);
  });

  it("a single volume outlier cannot max the score", () => {
    const row = earlyMover("AAAUSDT", { quoteVolumeDelta: 50_000_000 });
    const features = computeOpportunityFeatures({
      row,
      breadth: computeBreadth([row, snap("BTCUSDT")]),
      volumeHistory: [20_000],
    });
    const score = scoreLane("EARLY", buildScoreBreakdown(features), features);
    expect(score).toBeLessThan(100);
  });

  it("relative strength is measured against BTC", () => {
    const btc = snap("BTCUSDT", { rolling: { return1m: 0.1, return5m: 0.2 } });
    const alt = earlyMover("ALTUSDT", { return1m: 1.2, return5m: 1.4 });
    const features = computeOpportunityFeatures({
      row: alt,
      breadth: computeBreadth([btc, alt], btc),
      volumeHistory: [80_000],
    });
    expect(features.relativeStrengthBTC1m).toBeCloseTo(1.1, 5);
  });

  it("separates market-wide moves from coin-specific strength", () => {
    const engine = resetOpportunityEngineForTests();
    const universe = Array.from({ length: 24 }, (_, i) =>
      snap(`S${i}USDT`, { rolling: { return1m: 1.0, return5m: 1.1, quoteVolumeDelta: 80_000 } }),
    );
    universe.push(snap("BTCUSDT", { rolling: { return1m: 1.0, return5m: 1.1 } }));
    const wide = engine.scan(universe);
    expect(wide.filterSamples.some((row) => row.reason === "MARKET_WIDE_MOVE_ONLY")).toBe(true);

    const unique = universe.map((row, i) =>
      i === 0
        ? earlyMover("S0USDT", { return1m: 1.6, return5m: 1.8 })
        : snap(row.symbol, { rolling: { return1m: 0.05, return5m: 0.04, quoteVolumeDelta: 80_000 } }),
    );
    unique[unique.length - 1] = snap("BTCUSDT", { rolling: { return1m: 0.02, return5m: 0.01 } });
    engine.resetForTests();
    const specific = engine.scan(unique);
    expect(specific.ranked.some((row) => row.symbol === "S0USDT")).toBe(true);
  });

  it("breakout plus volume scores higher than breakout alone", () => {
    const dry = earlyMover("AAAUSDT", { quoteVolumeDelta: 8_000 });
    const wet = earlyMover("AAAUSDT", { quoteVolumeDelta: 400_000 });
    const breadth = computeBreadth([wet, snap("BTCUSDT")]);
    const dryScore = scoreLane(
      "EARLY",
      buildScoreBreakdown(computeOpportunityFeatures({ row: dry, breadth, volumeHistory: [8_000, 8_000] })),
      computeOpportunityFeatures({ row: dry, breadth, volumeHistory: [8_000, 8_000] }),
    );
    const wetScore = scoreLane(
      "EARLY",
      buildScoreBreakdown(computeOpportunityFeatures({ row: wet, breadth, volumeHistory: [40_000, 80_000, 120_000] })),
      computeOpportunityFeatures({ row: wet, breadth, volumeHistory: [40_000, 80_000, 120_000] }),
    );
    expect(wetScore).toBeGreaterThan(dryScore);
  });

  it("exhaustion / fake spike reduces score", () => {
    const healthy = earlyMover("AAAUSDT", { return5s: 0.2, return5m: 0.9 });
    const spike = snap("AAAUSDT", {
      change24h: 4,
      rolling: {
        return5s: 2.8,
        return1m: 1.0,
        return5m: 6.5,
        return15m: 7,
        quoteVolumeDelta: 20_000,
      },
    });
    const breadth = computeBreadth([healthy, snap("BTCUSDT")]);
    const healthyScore = scoreLane(
      "EARLY",
      buildScoreBreakdown(computeOpportunityFeatures({ row: healthy, breadth, volumeHistory: [80_000, 90_000] })),
      computeOpportunityFeatures({ row: healthy, breadth, volumeHistory: [80_000, 90_000] }),
    );
    const spikeScore = scoreLane(
      "MOMENTUM",
      buildScoreBreakdown(computeOpportunityFeatures({ row: spike, breadth, volumeHistory: [90_000, 40_000] })),
      computeOpportunityFeatures({ row: spike, breadth, volumeHistory: [90_000, 40_000] }),
    );
    expect(spikeScore).toBeLessThan(healthyScore + 5);
  });

  it("filters stable and illiquid pairs", () => {
    expect(isExcludedOpportunitySymbol("USDCUSDT")).toBe(true);
    expect(isExcludedOpportunitySymbol("BTCUPUSDT")).toBe(true);
    expect(isExcludedOpportunitySymbol("BTCUSDT")).toBe(false);
    const engine = resetOpportunityEngineForTests();
    const result = engine.scan([
      snap("USDCUSDT", { quoteVolume24h: 9_000_000, rolling: { return5m: 0.8 } }),
      snap("TINYUSDT", { quoteVolume24h: 1_000, rolling: { return5m: 1.2 } }),
    ]);
    expect(result.ranked).toHaveLength(0);
    expect(result.excludedRejects + result.liquidityRejects).toBeGreaterThan(0);
  });

  it("does not emit duplicate candidates for the same symbol", () => {
    const engine = resetOpportunityEngineForTests();
    const row = earlyMover("AAAUSDT");
    engine.scan([row, snap("BTCUSDT")]);
    const again = engine.scan([row, snap("BTCUSDT")]);
    expect(again.ranked.filter((item) => item.symbol === "AAAUSDT")).toHaveLength(1);
  });

  it("keeps the same candidate id across lane transitions", () => {
    const engine = resetOpportunityEngineForTests();
    engine.scan([earlyMover("AAAUSDT"), snap("BTCUSDT")]);
    const first = engine.getSession("AAAUSDT");
    engine.scan([
      earlyMover("AAAUSDT", { return5m: 4.2, return15m: 5, return1m: 1.8, quoteVolumeDelta: 250_000 }),
      snap("BTCUSDT"),
    ]);
    const second = engine.getSession("AAAUSDT");
    expect(first?.candidateId).toBe(second?.candidateId);
  });

  it("hysteresis prevents candidate churn", () => {
    const engine = resetOpportunityEngineForTests();
    const states: string[] = [];
    for (const ret of [0.9, 0.85, 0.92, 0.88]) {
      engine.scan([earlyMover("AAAUSDT", { return5m: ret, return1m: ret * 0.7 }), snap("BTCUSDT")]);
      states.push(engine.getSession("AAAUSDT")?.state ?? "NONE");
    }
    expect(states.every((state) => state !== "EXPIRED")).toBe(true);
    expect(new Set(states).size).toBeLessThanOrEqual(3);
  });

  it("score decay reduces idle candidates", () => {
    const engine = resetOpportunityEngineForTests();
    engine.scan([earlyMover("AAAUSDT"), snap("BTCUSDT")]);
    const start = engine.getSession("AAAUSDT")?.score ?? 0;
    for (let i = 0; i < 6; i += 1) {
      engine.scan([
        snap("AAAUSDT", {
          rolling: { return5m: 0.2, return1m: 0.1, return5s: 0, quoteVolumeDelta: 10_000 },
        }),
        snap("BTCUSDT"),
      ]);
    }
    expect(engine.getSession("AAAUSDT")?.score ?? 0).toBeLessThan(start);
  });

  it("deep subscription is only requested for HOT/PROMOTED candidates", () => {
    const engine = resetOpportunityEngineForTests();
    const result = engine.scan([earlyMover("AAAUSDT"), snap("BTCUSDT")]);
    const session = engine.getSession("AAAUSDT");
    if (session && (session.state === "HOT" || session.state === "PROMOTED")) {
      expect(session.deepSubscribed).toBe(true);
    } else {
      expect(result.deepSubscriptions).toBe(0);
    }
  });

  it("opportunity scan makes no network request and no AI call", () => {
    resetPublicMarketRestAudit();
    const engine = resetOpportunityEngineForTests();
    engine.scan([earlyMover("AAAUSDT"), snap("BTCUSDT")]);
    expect(countHotPathPublicMarketRestCalls()).toBe(0);
    expect(engine.getTelemetry().aiCalls).toBe(0);
  });

  it("low 24h gain can still be an EARLY candidate", () => {
    const engine = resetOpportunityEngineForTests();
    const result = engine.scan([earlyMover("AAAUSDT"), snap("BTCUSDT")]);
    const hit = result.ranked.find((row) => row.symbol === "AAAUSDT");
    expect(hit).toBeTruthy();
    expect(hit?.features.change24h).toBeLessThan(1);
    expect(hit?.primaryLane).toBe("EARLY");
  });

  it("a +20% exhausted coin is not auto top-ranked", () => {
    const engine = resetOpportunityEngineForTests();
    const parabolic = snap("PUMPUSDT", {
      change24h: 22,
      rolling: {
        return5s: 3.1,
        return1m: 2,
        return5m: 11,
        return15m: 18,
        quoteVolumeDelta: 12_000,
      },
    });
    const result = engine.scan([earlyMover("AAAUSDT"), parabolic, snap("BTCUSDT")]);
    expect(result.ranked[0]?.symbol).not.toBe("PUMPUSDT");
  });

  it("stale market state does not produce candidates", () => {
    const engine = resetOpportunityEngineForTests();
    const result = engine.scan([earlyMover("AAAUSDT", {}), { ...earlyMover("AAAUSDT"), stale: true, symbol: "STALEUSDT" }]);
    expect(result.ranked.some((row) => row.symbol === "STALEUSDT")).toBe(false);
    expect(result.staleRejects).toBeGreaterThan(0);
  });

  it("evaluates 700 symbols well under 250ms", () => {
    const engine = resetOpportunityEngineForTests();
    const rows = Array.from({ length: 699 }, (_, i) =>
      i === 0 ? earlyMover("S0USDT") : snap(`S${i}USDT`, { rolling: { return5m: (i % 7) * 0.02, quoteVolumeDelta: 60_000 } }),
    );
    rows.push(snap("BTCUSDT"));
    const result = engine.scan(rows);
    expect(result.universeSize).toBe(700);
    expect(result.durationMs).toBeLessThan(250);
    expect(result.ranked.length).toBeGreaterThan(0);
    expect(result.ranked[0]?.symbol).toBe("S0USDT");
  });

  it("classifies STEADY / MOMENTUM / CONTINUATION lanes", () => {
    const engine = resetOpportunityEngineForTests();
    const steady = snap("STEADYUSDT", {
      change24h: 0.9,
      rolling: {
        return1s: 0.04,
        return5s: 0.08,
        return15s: 0.14,
        return30s: 0.22,
        return1m: 0.4,
        return3m: 0.7,
        return5m: 1.1,
        return15m: 1.4,
        quoteVolumeDelta: 90_000,
      },
    });
    const momentum = snap("MOMUSDT", {
      change24h: 4.2,
      rolling: {
        return1s: 0.12,
        return5s: 0.35,
        return15s: 0.7,
        return30s: 1.1,
        return1m: 1.8,
        return3m: 3.2,
        return5m: 5.1,
        return15m: 6.4,
        quoteVolumeDelta: 220_000,
      },
    });
    const continuation = snap("CONTUSDT", {
      change24h: 11.5,
      rolling: {
        return1s: 0.05,
        return5s: 0.12,
        return15s: 0.2,
        return30s: 0.35,
        return1m: 0.6,
        return3m: 1.4,
        return5m: 2.2,
        return15m: 9.4,
        quoteVolumeDelta: 260_000,
      },
    });
    const result = engine.scan([earlyMover("EARLYUSDT"), steady, momentum, continuation, snap("BTCUSDT")]);
    expect(result.ranked.find((row) => row.symbol === "EARLYUSDT")?.primaryLane).toBe("EARLY");
    expect(result.ranked.find((row) => row.symbol === "STEADYUSDT")?.primaryLane).toBe("STEADY");
    expect(result.ranked.find((row) => row.symbol === "MOMUSDT")?.primaryLane).toBe("MOMENTUM");
    expect(result.ranked.find((row) => row.symbol === "CONTUSDT")?.primaryLane).toBe("CONTINUATION");
  });

  it("replays an accelerating path and detects before the late high", () => {
    const engine = resetOpportunityEngineForTests();
    const btc = snap("BTCUSDT");
    let firstLane: string | undefined;
    let firstReturn5m = 0;
    let firstPrice = 0;
    for (let step = 1; step <= 40; step += 1) {
      const ret = 0.08 * step + 0.004 * step * step;
      const price = 100 * (1 + ret / 100);
      engine.scan([
        snap("REPLAYUSDT", {
          lastPrice: price,
          change24h: ret,
          rolling: {
            return1s: 0.05 + step * 0.01,
            return5s: 0.1 + step * 0.02,
            return15s: 0.18 + step * 0.03,
            return30s: 0.25 + step * 0.04,
            return1m: Math.min(ret, 0.2 * step),
            return3m: ret * 0.7,
            return5m: ret,
            return15m: ret,
            quoteVolumeDelta: 40_000 + step * 8_000,
          },
        }),
        btc,
      ]);
      const session = engine.getSession("REPLAYUSDT");
      if (session && !firstLane) {
        firstLane = session.primaryLane;
        firstReturn5m = session.features.return5m;
        firstPrice = session.firstDetectionPrice;
      }
    }
    const last = engine.getSession("REPLAYUSDT");
    expect(firstLane).toBe("EARLY");
    expect(firstReturn5m).toBeLessThan(4);
    expect(last?.currentPrice ?? 0).toBeGreaterThan(firstPrice);
    expect(last?.candidateId).toBe(engine.getMilestones()[0]?.candidateId);
  });

  it("ingests daemon snapshots without REST and requests deep streams only when HOT", () => {
    resetPublicMarketRestAudit();
    const daemon = resetMarketDataDaemonForTests();
    const now = Date.now();
    for (let tick = 0; tick < 70; tick += 1) {
      const ts = now - (69 - tick) * 5_000;
      daemon.ingest(
        [
          {
            e: "24hrMiniTicker",
            E: ts,
            s: "HOTUSDT",
            c: String(100 + (tick / 69) ** 1.6 * 2.4),
            o: "99",
            h: String(100 + (tick / 69) ** 1.6 * 2.4),
            l: "98",
            v: "5000",
            q: String(3_000_000 + tick * 55_000),
          },
          {
            e: "24hrMiniTicker",
            E: ts,
            s: "BTCUSDT",
            c: "65000",
            o: "64900",
            h: "65100",
            l: "64800",
            v: "1000",
            q: "80000000",
          },
        ],
        ts,
      );
    }
    const engine = resetOpportunityEngineForTests(
      new OpportunityEngine({ hotThreshold: 50, watchThreshold: 35, dropThreshold: 25 }),
    );
    const result = engine.scan();
    expect(countHotPathPublicMarketRestCalls()).toBe(0);
    expect(result.universeSize).toBeGreaterThanOrEqual(2);
    const hot = engine.getSession("HOTUSDT");
    expect(hot).toBeTruthy();
    if (hot && (hot.state === "HOT" || hot.state === "PROMOTED")) {
      expect(hot.deepSubscribed).toBe(true);
      expect(daemon.telemetry().deepSubscriptions).toBeGreaterThan(0);
    }
  });
});
