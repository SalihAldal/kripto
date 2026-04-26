import type { KlineItem } from "@/src/types/exchange";

export type TfDirection = "BULLISH" | "BEARISH" | "RANGE";

export type TimeframeSignal = {
  timeframe: "5m" | "15m" | "1h" | "4h" | "1d";
  direction: TfDirection;
  strength: number;
  slopePercent: number;
  lastClose: number;
};

export type MultiTimeframeAnalysis = {
  higher: {
    d1: TimeframeSignal;
    h4: TimeframeSignal;
    trend: TfDirection;
    confidence: number;
  };
  mid: {
    h1: TimeframeSignal;
    structure: "TREND_CONTINUATION" | "POTENTIAL_REVERSAL" | "RANGE";
    momentumBias: TfDirection;
  };
  lower: {
    m15: TimeframeSignal;
    m5: TimeframeSignal;
    entryQuality: "HIGH" | "MEDIUM" | "LOW";
  };
  entry: {
    m15: TimeframeSignal;
    m5: TimeframeSignal;
  };
  trend: {
    h1: TimeframeSignal;
  };
  macro: {
    h4: TimeframeSignal;
    d1: TimeframeSignal;
  };
  dominantTrend: TfDirection;
  alignmentScore: number;
  conflict: boolean;
  trendAligned: boolean;
  entrySuitable: boolean;
  conflictingSignals: string[];
  finalAlignmentSummary: string;
  reason: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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

export function deriveTimeframeSignal(
  timeframe: TimeframeSignal["timeframe"],
  klines: KlineItem[],
): TimeframeSignal {
  const closes = klines.map((x) => x.close).filter((x) => Number.isFinite(x) && x > 0);
  const first = closes[0] ?? 0;
  const last = closes[closes.length - 1] ?? first;
  const emaFast = ema(closes.slice(-60), 9);
  const emaSlow = ema(closes.slice(-60), 21);
  const slopePercent = first > 0 ? ((last - first) / first) * 100 : 0;
  const emaDiffPercent = last > 0 ? ((emaFast - emaSlow) / last) * 100 : 0;

  let direction: TfDirection = "RANGE";
  if (emaDiffPercent > 0.08 && slopePercent > 0.15) direction = "BULLISH";
  else if (emaDiffPercent < -0.08 && slopePercent < -0.15) direction = "BEARISH";

  const strength = clamp(Math.abs(slopePercent) * 12 + Math.abs(emaDiffPercent) * 70, 0, 100);
  return {
    timeframe,
    direction,
    strength: Number(strength.toFixed(2)),
    slopePercent: Number(slopePercent.toFixed(4)),
    lastClose: Number(last.toFixed(8)),
  };
}

function isOpposite(a: TfDirection, b: TfDirection) {
  return (a === "BULLISH" && b === "BEARISH") || (a === "BEARISH" && b === "BULLISH");
}

function dominantDirection(signals: TimeframeSignal[]): TfDirection {
  const bulls = signals.filter((x) => x.direction === "BULLISH").length;
  const bears = signals.filter((x) => x.direction === "BEARISH").length;
  if (bulls > bears) return "BULLISH";
  if (bears > bulls) return "BEARISH";
  return "RANGE";
}

export function buildMultiTimeframeAnalysis(input: {
  m1?: KlineItem[];
  m5: KlineItem[];
  m15: KlineItem[];
  h1: KlineItem[];
  h4: KlineItem[];
  d1: KlineItem[];
}): MultiTimeframeAnalysis {
  const s5 = deriveTimeframeSignal("5m", input.m5);
  const s15 = deriveTimeframeSignal("15m", input.m15);
  const s1h = deriveTimeframeSignal("1h", input.h1);
  const s4h = deriveTimeframeSignal("4h", input.h4);
  const s1d = deriveTimeframeSignal("1d", input.d1);

  const higherTrend = dominantDirection([s4h, s1d]);
  const higherConfidence = clamp(
    ((s4h.strength + s1d.strength) / 2) * (higherTrend === "RANGE" ? 0.72 : 1),
    0,
    100,
  );
  const midMomentumBias = s1h.direction;
  const midStructure =
    higherTrend === "RANGE"
      ? "RANGE"
      : midMomentumBias === higherTrend
        ? "TREND_CONTINUATION"
        : midMomentumBias === "RANGE"
          ? "RANGE"
          : "POTENTIAL_REVERSAL";

  const lowerOpposeCount = [s15.direction, s5.direction].filter((dir) => isOpposite(dir, higherTrend)).length;
  const lowerSupportCount = [s15.direction, s5.direction].filter((dir) => dir === higherTrend).length;
  const lowerEntryQuality: "HIGH" | "MEDIUM" | "LOW" =
    higherTrend === "RANGE"
      ? s15.direction !== "RANGE" && s5.direction !== "RANGE"
        ? "MEDIUM"
        : "LOW"
      : lowerSupportCount === 2
        ? "HIGH"
        : lowerSupportCount === 1
          ? "MEDIUM"
          : "LOW";

  const conflictingSignals: string[] = [];
  if (isOpposite(s4h.direction, s1d.direction)) {
    conflictingSignals.push(`Higher conflict 4h=${s4h.direction} vs 1d=${s1d.direction}`);
  }
  if (higherTrend !== "RANGE" && isOpposite(s1h.direction, higherTrend)) {
    conflictingSignals.push(`Mid conflict 1h=${s1h.direction} vs higher=${higherTrend}`);
  }
  if (higherTrend !== "RANGE" && lowerOpposeCount === 2) {
    conflictingSignals.push(`Lower conflict 15m/5m her ikisi de ${higherTrend} tersinde`);
  }

  const conflict = conflictingSignals.length > 0;
  const higherUncertain = higherTrend === "RANGE" || higherConfidence < 45;
  const trendAligned = !conflict && (higherTrend === "RANGE" || s1h.direction === "RANGE" || s1h.direction === higherTrend);
  const entrySuitable =
    trendAligned &&
    (higherTrend === "RANGE" ? lowerEntryQuality !== "LOW" : lowerSupportCount >= 1) &&
    !(higherTrend !== "RANGE" && lowerOpposeCount === 2);

  const alignmentScore = clamp(
    (higherConfidence * 0.45) +
      (s1h.strength * 0.2) +
      ((lowerEntryQuality === "HIGH" ? 90 : lowerEntryQuality === "MEDIUM" ? 62 : 34) * 0.25) -
      (conflict ? 28 : 0) -
      (higherUncertain ? 10 : 0),
    0,
    100,
  );
  const dominantTrend = higherTrend;
  const finalAlignmentSummary = conflict
    ? `TF conflict: ${conflictingSignals.join(" | ")}`
    : higherUncertain
      ? `Higher timeframe belirsiz, quality dusuruldu. higher=${higherTrend}, lower=${s15.direction}/${s5.direction}`
      : `MTF hizali: higher=${higherTrend}, mid=${s1h.direction}, lower=${s15.direction}/${s5.direction}, entry=${lowerEntryQuality}`;
  const reason = finalAlignmentSummary;

  return {
    higher: {
      d1: s1d,
      h4: s4h,
      trend: higherTrend,
      confidence: Number(higherConfidence.toFixed(2)),
    },
    mid: {
      h1: s1h,
      structure: midStructure,
      momentumBias: midMomentumBias,
    },
    lower: {
      m15: s15,
      m5: s5,
      entryQuality: lowerEntryQuality,
    },
    entry: { m15: s15, m5: s5 },
    trend: { h1: s1h },
    macro: { h4: s4h, d1: s1d },
    dominantTrend,
    alignmentScore: Number(alignmentScore.toFixed(2)),
    conflict,
    trendAligned,
    entrySuitable,
    conflictingSignals,
    finalAlignmentSummary,
    reason,
  };
}
