import type { AIAnalysisInput } from "@/src/types/ai";

type Candle = AIAnalysisInput["klines"][number];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function sma(values: number[], period: number) {
  const scope = values.slice(-period);
  if (scope.length === 0) return 0;
  return scope.reduce((acc, x) => acc + x, 0) / scope.length;
}

function ema(values: number[], period: number) {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let prev = values[0];
  for (let i = 1; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

function rsi(values: number[], period = 14) {
  if (values.length < period + 1) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss += Math.abs(diff);
  }
  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function rsiSeries(values: number[], period = 14) {
  if (values.length < period + 2) return values.map(() => 50);
  const out: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    if (i < period + 1) {
      out.push(50);
      continue;
    }
    const slice = values.slice(0, i + 1);
    out.push(rsi(slice, period));
  }
  return out;
}

function std(values: number[]) {
  if (values.length === 0) return 0;
  const mean = values.reduce((acc, x) => acc + x, 0) / values.length;
  const variance = values.reduce((acc, x) => acc + (x - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function trueRange(current: Candle, prev: Candle | null) {
  if (!prev) return current.high - current.low;
  return Math.max(
    current.high - current.low,
    Math.abs(current.high - prev.close),
    Math.abs(current.low - prev.close),
  );
}

function atr(klines: Candle[], period = 14) {
  const trs: number[] = [];
  for (let i = 0; i < klines.length; i += 1) {
    trs.push(trueRange(klines[i], i > 0 ? klines[i - 1] : null));
  }
  return sma(trs, period);
}

function aggregate(klines: Candle[], chunk: number) {
  const rows: Candle[] = [];
  for (let i = 0; i < klines.length; i += chunk) {
    const part = klines.slice(i, i + chunk);
    if (part.length === 0) continue;
    rows.push({
      open: part[0].open,
      high: Math.max(...part.map((x) => x.high)),
      low: Math.min(...part.map((x) => x.low)),
      close: part[part.length - 1].close,
      volume: part.reduce((acc, x) => acc + x.volume, 0),
      openTime: part[0].openTime,
      closeTime: part[part.length - 1].closeTime,
    });
  }
  return rows;
}

function vwap(klines: Candle[]) {
  const totalPv = klines.reduce((acc, x) => acc + x.close * x.volume, 0);
  const totalV = klines.reduce((acc, x) => acc + x.volume, 0);
  return totalV > 0 ? totalPv / totalV : klines[klines.length - 1]?.close ?? 0;
}

function candleWickProfile(candle: Candle) {
  const range = Math.max(candle.high - candle.low, 0.0000001);
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperRatio = upperWick / range;
  const lowerRatio = lowerWick / range;
  const wickDominance = Math.max(upperRatio, lowerRatio);
  return {
    range,
    body,
    upperWick,
    lowerWick,
    upperRatio,
    lowerRatio,
    wickDominance,
  };
}

function clusterLevels(levels: number[], tolerancePercent: number) {
  const sorted = [...levels].sort((a, b) => a - b);
  const clusters: Array<{ level: number; count: number }> = [];
  for (const level of sorted) {
    const prev = clusters[clusters.length - 1];
    if (!prev) {
      clusters.push({ level, count: 1 });
      continue;
    }
    const tolerance = Math.max(Math.abs(prev.level) * tolerancePercent, 0.0000001);
    if (Math.abs(level - prev.level) <= tolerance) {
      const mergedCount = prev.count + 1;
      prev.level = (prev.level * prev.count + level) / mergedCount;
      prev.count = mergedCount;
    } else {
      clusters.push({ level, count: 1 });
    }
  }
  return clusters;
}

function findSwing(highs: number[], lows: number[], lookback: number) {
  const scopeHigh = highs.slice(-lookback);
  const scopeLow = lows.slice(-lookback);
  const swingHigh = Math.max(...scopeHigh);
  const swingLow = Math.min(...scopeLow);
  return { swingHigh, swingLow };
}

function buildFvg(klines: Candle[]) {
  if (klines.length < 3) return null;
  const last = klines[klines.length - 1];
  const prev2 = klines[klines.length - 3];
  if (prev2.high < last.low) {
    return {
      direction: "BULLISH" as const,
      gapLow: prev2.high,
      gapHigh: last.low,
    };
  }
  if (prev2.low > last.high) {
    return {
      direction: "BEARISH" as const,
      gapLow: last.high,
      gapHigh: prev2.low,
    };
  }
  return null;
}

function findOrderBlock(klines: Candle[], atrValue: number) {
  const recent = klines.slice(-30);
  for (let i = recent.length - 3; i >= 1; i -= 1) {
    const candle = recent[i];
    const next = recent[i + 1];
    const body = Math.abs(next.close - next.open);
    const displacement = atrValue > 0 ? body >= atrValue * 0.6 : body >= next.close * 0.0035;
    const bullishBreak = next.close > next.open && next.close > candle.high;
    const bearishBreak = next.close < next.open && next.close < candle.low;
    if (displacement && bullishBreak && candle.close < candle.open) {
      return {
        type: "DEMAND" as const,
        low: candle.low,
        high: candle.open,
      };
    }
    if (displacement && bearishBreak && candle.close > candle.open) {
      return {
        type: "SUPPLY" as const,
        low: candle.open,
        high: candle.high,
      };
    }
  }
  return null;
}

function detectDivergence(closes: number[], rsiValues: number[]) {
  const slice = closes.slice(-30);
  if (slice.length < 10) {
    return { bullish: false, bearish: false };
  }
  const recentLow = Math.min(...slice.slice(-10));
  const prevLow = Math.min(...slice.slice(0, 10));
  const recentHigh = Math.max(...slice.slice(-10));
  const prevHigh = Math.max(...slice.slice(0, 10));
  const recentRsi = rsiValues[rsiValues.length - 1] ?? 50;
  const prevRsi = rsiValues[Math.max(0, rsiValues.length - 12)] ?? 50;
  const bullish = recentLow < prevLow && recentRsi > prevRsi + 2;
  const bearish = recentHigh > prevHigh && recentRsi < prevRsi - 2;
  return { bullish, bearish };
}

export function buildIndicatorSnapshot(input: AIAnalysisInput) {
  const closes = input.klines.map((x) => x.close);
  const highs = input.klines.map((x) => x.high);
  const lows = input.klines.map((x) => x.low);
  const volumes = input.klines.map((x) => x.volume);
  const lastPrice = input.lastPrice;
  const ema9 = ema(closes.slice(-80), 9);
  const ema21 = ema(closes.slice(-80), 21);
  const ema20 = ema(closes.slice(-120), 20);
  const ema50 = ema(closes.slice(-160), 50);
  const ema200 = ema(closes.slice(-240), 200);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const rsi14 = rsi(closes, 14);
  const macdFast = ema(closes.slice(-120), 12);
  const macdSlow = ema(closes.slice(-120), 26);
  const macd = macdFast - macdSlow;
  const signalLine = ema([...closes.slice(-50), macd], 9);
  const bbStd = std(closes.slice(-20));
  const bollMid = sma20;
  const bollUp = bollMid + bbStd * 2;
  const bollLow = bollMid - bbStd * 2;
  const atr14 = atr(input.klines, 14);
  const support = Math.min(...lows.slice(-30));
  const resistance = Math.max(...highs.slice(-30));
  const avgVol20 = sma(volumes, 20);
  const currentVol = volumes[volumes.length - 1] ?? 0;
  const volumeBoost = avgVol20 > 0 ? currentVol / avgVol20 : 1;
  const recent5m = aggregate(input.klines.slice(-75), 5);
  const recent15m = aggregate(input.klines.slice(-120), 15);
  const trend1m = ema9 >= ema21 ? "UP" : "DOWN";
  const trend5m = recent5m.length > 6 && recent5m[recent5m.length - 1].close >= recent5m[0].close ? "UP" : "DOWN";
  const trend15m = recent15m.length > 3 && recent15m[recent15m.length - 1].close >= recent15m[0].close ? "UP" : "DOWN";
  const mtfAligned = trend1m === trend5m && trend5m === trend15m;
  const breakoutUp = lastPrice > resistance * 0.9995 && volumeBoost > 1.15;
  const breakoutDown = lastPrice < support * 1.0005 && volumeBoost > 1.15;
  const fakeBreakout = (breakoutUp || breakoutDown) && volumeBoost < 1.2;
  const stochRsi = clamp(((rsi14 - 20) / Math.max(80 - 20, 1)) * 100, 0, 100);
  const rsiValues = rsiSeries(closes, 14);
  const divergence = detectDivergence(closes, rsiValues);
  const vw = vwap(input.klines.slice(-80));
  const bullishCandle = (() => {
    const c = input.klines[input.klines.length - 1];
    if (!c) return false;
    return c.close > c.open && (c.close - c.open) / Math.max(c.high - c.low, 0.0001) > 0.5;
  })();
  const bearishCandle = (() => {
    const c = input.klines[input.klines.length - 1];
    if (!c) return false;
    return c.open > c.close && (c.open - c.close) / Math.max(c.high - c.low, 0.0001) > 0.5;
  })();
  const liquiditySkew =
    (input.orderBookSummary.bidDepth - input.orderBookSummary.askDepth) /
    Math.max(input.orderBookSummary.bidDepth + input.orderBookSummary.askDepth, 1);
  const lastCandle = input.klines[input.klines.length - 1];
  const prevCandle = input.klines[input.klines.length - 2];
  const wickProfiles = input.klines.slice(-40).map(candleWickProfile);
  const wickHeavyCandles = input.klines
    .slice(-40)
    .map((candle, idx) => ({ candle, profile: wickProfiles[idx] }))
    .filter((x) => x.profile.wickDominance >= 0.58 && x.profile.range > 0);
  const wickClusterLevels = clusterLevels(
    wickHeavyCandles.map((x) => (x.profile.upperRatio >= x.profile.lowerRatio ? x.candle.high : x.candle.low)),
    0.0014,
  ).filter((x) => x.count >= 2);
  const equalHighClusters = clusterLevels(highs.slice(-36), 0.0012).filter((x) => x.count >= 2);
  const equalLowClusters = clusterLevels(lows.slice(-36), 0.0012).filter((x) => x.count >= 2);
  const majorEqualHigh = [...equalHighClusters].sort((a, b) => b.count - a.count)[0] ?? null;
  const majorEqualLow = [...equalLowClusters].sort((a, b) => b.count - a.count)[0] ?? null;
  const nearUpperLiquidity = Boolean(
    majorEqualHigh &&
      Math.abs(lastPrice - majorEqualHigh.level) / Math.max(lastPrice, 1) <= 0.0016,
  );
  const nearLowerLiquidity = Boolean(
    majorEqualLow &&
      Math.abs(lastPrice - majorEqualLow.level) / Math.max(lastPrice, 1) <= 0.0016,
  );
  const sessionWindow = Math.max(120, Math.min(240, input.klines.length));
  const sessionSlice = input.klines.slice(-sessionWindow);
  const sessionHigh = Math.max(...sessionSlice.map((x) => x.high));
  const sessionLow = Math.min(...sessionSlice.map((x) => x.low));
  const nearSessionHigh = Math.abs(lastPrice - sessionHigh) / Math.max(lastPrice, 1) <= 0.0018;
  const nearSessionLow = Math.abs(lastPrice - sessionLow) / Math.max(lastPrice, 1) <= 0.0018;
  const lastWick = lastCandle ? candleWickProfile(lastCandle) : null;
  const prevWick = prevCandle ? candleWickProfile(prevCandle) : null;
  const breakoutAndReturnUp = Boolean(
    lastCandle &&
      lastCandle.high > resistance * 1.0015 &&
      lastCandle.close < resistance &&
      (lastWick?.upperRatio ?? 0) >= 0.5,
  );
  const breakoutAndReturnDown = Boolean(
    lastCandle &&
      lastCandle.low < support * 0.9985 &&
      lastCandle.close > support &&
      (lastWick?.lowerRatio ?? 0) >= 0.5,
  );
  const lowVolumeBreakout = (breakoutUp || breakoutDown) && volumeBoost < 1.08;
  const fakeBreakoutEnhanced =
    fakeBreakout ||
    breakoutAndReturnUp ||
    breakoutAndReturnDown ||
    lowVolumeBreakout ||
    Boolean(lastWick && lastWick.wickDominance >= 0.62 && volumeBoost < 1.15);
  const stopHuntAboveDetected = Boolean(
    (breakoutAndReturnUp || nearUpperLiquidity) &&
      (lastWick?.upperRatio ?? 0) >= 0.48 &&
      lastCandle &&
      lastCandle.close < lastCandle.open,
  );
  const stopHuntBelowDetected = Boolean(
    (breakoutAndReturnDown || nearLowerLiquidity) &&
      (lastWick?.lowerRatio ?? 0) >= 0.48 &&
      lastCandle &&
      lastCandle.close > lastCandle.open,
  );
  const stopHuntDetected = stopHuntAboveDetected || stopHuntBelowDetected;
  const liquiditySweepDetected = stopHuntDetected || breakoutAndReturnUp || breakoutAndReturnDown;
  const sweepConfirmedDirection: "BULLISH" | "BEARISH" | "NONE" =
    stopHuntBelowDetected && volumeBoost >= 1.02
      ? "BULLISH"
      : stopHuntAboveDetected && volumeBoost >= 1.02
        ? "BEARISH"
        : "NONE";
  const breakoutTrap = fakeBreakoutEnhanced && (breakoutAndReturnUp || breakoutAndReturnDown);
  const trappedTradersScenario =
    breakoutAndReturnUp && !breakoutAndReturnDown
      ? "LONG_TRAP"
      : breakoutAndReturnDown && !breakoutAndReturnUp
        ? "SHORT_TRAP"
        : breakoutAndReturnUp && breakoutAndReturnDown
          ? "BOTH_SIDE_TRAP"
          : "NONE";
  const rangeLiquidityGrab =
    Boolean(majorEqualHigh && majorEqualLow) &&
    Math.abs((majorEqualHigh?.level ?? lastPrice) - (majorEqualLow?.level ?? lastPrice)) / Math.max(lastPrice, 1) <= 0.025 &&
    (breakoutAndReturnUp || breakoutAndReturnDown || stopHuntDetected);
  const probableStopClusters = [
    ...equalHighClusters
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((x) => ({
        level: Number(x.level.toFixed(8)),
        side: "ABOVE_EQUAL_HIGHS" as const,
        intensity: x.count,
      })),
    ...equalLowClusters
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((x) => ({
        level: Number(x.level.toFixed(8)),
        side: "BELOW_EQUAL_LOWS" as const,
        intensity: x.count,
      })),
  ];
  const fakeBreakoutRiskScore = clamp(
    (fakeBreakoutEnhanced ? 52 : 18) +
      ((lastWick?.wickDominance ?? 0) >= 0.62 ? 16 : 0) +
      (lowVolumeBreakout ? 18 : 0) +
      ((breakoutAndReturnUp || breakoutAndReturnDown) ? 14 : 0),
    0,
    100,
  );
  const liquidityRiskScore = clamp(
    24 +
      (nearUpperLiquidity || nearLowerLiquidity ? 18 : 0) +
      (stopHuntDetected ? 10 : 0) +
      (breakoutTrap ? 24 : 0) +
      (fakeBreakoutRiskScore * 0.35) +
      (volumeBoost < 1 ? 12 : 0),
    0,
    100,
  );
  const safeEntryTiming =
    breakoutTrap || fakeBreakoutRiskScore >= 62
      ? "NO_ENTRY_FAKE_BREAKOUT_RISK"
      : liquiditySweepDetected && sweepConfirmedDirection !== "NONE"
        ? "POST_SWEEP_CONFIRMATION"
        : nearUpperLiquidity || nearLowerLiquidity
          ? "WAIT_LIQUIDITY_CLEARANCE"
          : "STANDARD_CONFIRMATION";
  const smartMoneyStyleSummary =
    breakoutTrap
      ? "Likidite avı + breakout trap yapısı; direkt giriş riskli."
      : liquiditySweepDetected && sweepConfirmedDirection !== "NONE"
        ? `Sweep sonrası ${sweepConfirmedDirection} teyidi var; temizlenme sonrası giriş değerlendirilebilir.`
        : nearUpperLiquidity || nearLowerLiquidity
          ? "Likidite havuzu yakınında; kör giriş yerine temizlenme beklenmeli."
          : "Belirgin trap yok, yine de teyitli ve hacim destekli giriş aranmalı.";
  const safeEntryPoint = stopHuntBelowDetected
    ? Number((Math.max(support, lastPrice * 0.998)).toFixed(8))
    : stopHuntAboveDetected
      ? Number((Math.min(resistance, lastPrice * 1.002)).toFixed(8))
      : Number((((support + resistance) / 2) || lastPrice).toFixed(8));
  const { swingHigh, swingLow } = findSwing(highs, lows, Math.min(180, highs.length));
  const fibRange = Math.max(swingHigh - swingLow, 0.0000001);
  const fib382 = swingHigh - fibRange * 0.382;
  const fib50 = swingHigh - fibRange * 0.5;
  const fib618 = swingHigh - fibRange * 0.618;
  const fibTolerance = Math.max(lastPrice * 0.0025, 0.0000001);
  const nearFib =
    Math.abs(lastPrice - fib382) <= fibTolerance ||
    Math.abs(lastPrice - fib50) <= fibTolerance ||
    Math.abs(lastPrice - fib618) <= fibTolerance;
  const orderBlock = findOrderBlock(input.klines, atr14);
  const fvg = buildFvg(input.klines);
  const expansionCandle = lastCandle
    ? Math.abs(lastCandle.close - lastCandle.open) >= Math.max(atr14 * 0.55, lastPrice * 0.0032) &&
      volumeBoost > 1.05
    : false;
  const bosUp = breakoutUp && volumeBoost >= 1.08;
  const bosDown = breakoutDown && volumeBoost >= 1.08;
  const marketStructure = {
    bosUp,
    bosDown,
    chochLikely: trend15m !== trend5m && (bosUp || bosDown),
    mssLikely: trend15m !== trend1m && (bosUp || bosDown),
    phase: expansionCandle ? "EXPANSION" : liquiditySweepDetected ? "MANIPULATION" : "ACCUMULATION",
  };
  const liquidityZones = [
    ...equalHighClusters.slice(0, 4).map((x) => ({
      level: Number(x.level.toFixed(8)),
      type: "equal_high" as const,
      strength: x.count,
      note: "Equal highs stop cluster",
    })),
    ...equalLowClusters.slice(0, 4).map((x) => ({
      level: Number(x.level.toFixed(8)),
      type: "equal_low" as const,
      strength: x.count,
      note: "Equal lows stop cluster",
    })),
    ...wickClusterLevels.slice(0, 4).map((x) => ({
      level: Number(x.level.toFixed(8)),
      type: "wick_cluster" as const,
      strength: x.count,
      note: "Wick liquidity concentration",
    })),
  ];
  const riskyAreas = [
    majorEqualHigh
      ? {
          label: "upper_liquidity",
          level: Number(majorEqualHigh.level.toFixed(8)),
          reason: "Equal highs and stop cluster",
        }
      : null,
    majorEqualLow
      ? {
          label: "lower_liquidity",
          level: Number(majorEqualLow.level.toFixed(8)),
          reason: "Equal lows and stop cluster",
        }
      : null,
    ...wickClusterLevels.slice(0, 2).map((x) => ({
      label: "wick_density",
      level: Number(x.level.toFixed(8)),
      reason: "High wick rejection density",
    })),
  ].filter((x): x is { label: string; level: number; reason: string } => Boolean(x));

  return {
    trend1m,
    trend5m,
    trend15m,
    mtfAligned,
    ema9,
    ema21,
    ema20,
    ema50,
    ema200,
    sma20,
    sma50,
    rsi14,
    macd,
    signalLine,
    bollMid,
    bollUp,
    bollLow,
    atr14,
    stochRsi,
    vwap: vw,
    support,
    resistance,
    breakoutUp,
    breakoutDown,
    fakeBreakout: fakeBreakoutEnhanced,
    volumeBoost,
    liquiditySkew,
    bullishCandle,
    bearishCandle,
    liquidity: {
      equalHighClusters: equalHighClusters.map((x) => ({
        level: Number(x.level.toFixed(8)),
        count: x.count,
      })),
      equalLowClusters: equalLowClusters.map((x) => ({
        level: Number(x.level.toFixed(8)),
        count: x.count,
      })),
      wickClusters: wickClusterLevels.map((x) => ({
        level: Number(x.level.toFixed(8)),
        count: x.count,
      })),
      liquidityZones,
      riskyAreas,
      nearUpperLiquidity,
      nearLowerLiquidity,
      fakeBreakoutDetected: fakeBreakoutEnhanced,
      breakoutAndReturnUp,
      breakoutAndReturnDown,
      lowVolumeBreakout,
      wickDominance: Number((lastWick?.wickDominance ?? 0).toFixed(4)),
      stopHuntDetected,
      liquiditySweepDetected,
      sweepConfirmedDirection,
      stopHuntAboveDetected,
      stopHuntBelowDetected,
      probableStopClusters,
      breakoutTrap,
      trappedTradersScenario,
      rangeLiquidityGrab,
      safeEntryTiming,
      fakeBreakoutRiskScore: Number(fakeBreakoutRiskScore.toFixed(2)),
      liquidityRiskScore: Number(liquidityRiskScore.toFixed(2)),
      smartMoneyStyleSummary,
      safeEntryPoint,
      previousWickDominance: Number((prevWick?.wickDominance ?? 0).toFixed(4)),
      sessionHigh: Number(sessionHigh.toFixed(8)),
      sessionLow: Number(sessionLow.toFixed(8)),
      nearSessionHigh,
      nearSessionLow,
    },
    fib: {
      swingHigh: Number(swingHigh.toFixed(8)),
      swingLow: Number(swingLow.toFixed(8)),
      fib382: Number(fib382.toFixed(8)),
      fib50: Number(fib50.toFixed(8)),
      fib618: Number(fib618.toFixed(8)),
      nearFib,
    },
    orderBlock,
    fvg,
    divergence,
    marketStructure,
    expansionCandle,
  };
}
