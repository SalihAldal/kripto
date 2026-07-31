import type { AIAnalysisInput, AIConsensusResult } from "@/src/types/ai";
import { buildIndicatorSnapshot } from "@/src/server/ai/indicator-suite";
import { computeShortTermScore } from "@/src/server/ai/short-term-score.service";

function formatPrice(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) return "-";
  const price = Number(value);
  if (price >= 1000) return price.toFixed(2);
  if (price >= 10) return price.toFixed(3);
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.1) return price.toFixed(5);
  return price.toFixed(6);
}

function formatDurationBucket(minutes: number) {
  if (minutes <= 20) return "10-20 dakika";
  if (minutes <= 60) return "30-60 dakika";
  if (minutes <= 120) return "1-2 saat";
  return "2-3 saat";
}

function resolveQualityTier(score: number) {
  if (score >= 90) return "Elite setup";
  if (score >= 80) return "Cok guclu";
  if (score >= 70) return "Guclu";
  if (score >= 60) return "Orta kalite";
  return "Islem acma";
}

function resolveRiskLabel(level: string | undefined, riskScore: number) {
  if (level === "LOW") return "Dusuk";
  if (level === "MEDIUM") return "Orta";
  if (level === "HIGH") return "Yuksek";
  if (riskScore >= 70) return "Yuksek";
  if (riskScore >= 45) return "Orta";
  return "Dusuk";
}

function resolveManipulationRisk(fakeBreakoutRisk: number, wickDominance: number, volumeSpike: number) {
  const score =
    (fakeBreakoutRisk >= 70 ? 2 : fakeBreakoutRisk >= 55 ? 1 : 0) +
    (wickDominance >= 0.66 ? 2 : wickDominance >= 0.58 ? 1 : 0) +
    (volumeSpike >= 2.2 ? 2 : volumeSpike >= 1.6 ? 1 : 0);
  if (score >= 4) return "Yuksek";
  if (score >= 2) return "Orta";
  return "Dusuk";
}

function buildSetup(params: {
  direction: "LONG" | "SHORT";
  entry: number | null;
  stop: number | null;
  target: number | null;
  rr: number;
  confidenceScore: number;
  durationLabel: string;
  active: boolean;
}) {
  const { direction, entry, stop, target, rr, confidenceScore, durationLabel, active } = params;
  if (!active) {
    return [
      `${direction} SETUP:`,
      "Entry: -",
      "Stop Loss: -",
      "TP1: -",
      "TP2: -",
      "RR: -",
      "Confidence Score: -",
      "Estimated Trade Duration: -",
    ].join("\n");
  }
  const tp1 =
    entry && target
      ? direction === "LONG"
        ? entry + (target - entry) * 0.5
        : entry - (entry - target) * 0.5
      : null;
  return [
    `${direction} SETUP:`,
    `Entry: ${formatPrice(entry)}`,
    `Stop Loss: ${formatPrice(stop)}`,
    `TP1: ${formatPrice(tp1)}`,
    `TP2: ${formatPrice(target)}`,
    `RR: ${Number(rr).toFixed(2)}`,
    `Confidence Score: ${Number(confidenceScore).toFixed(1)}`,
    `Estimated Trade Duration: ${durationLabel}`,
  ].join("\n");
}

// buildShortTermReportVerbose: detailed legacy format (used internally for full diagnostic output)
export function buildShortTermReportVerbose(input: AIAnalysisInput, consensus: AIConsensusResult) {
  const indicators = buildIndicatorSnapshot(input);
  const mtf = input.multiTimeframe;
  const scorecard = consensus.analysisScorecard;
  const shortTermScore = computeShortTermScore(input, consensus);
  const confidenceScore = Number(shortTermScore.total ?? scorecard?.confidenceScore ?? consensus.finalConfidence ?? 0);
  const riskScore = Number(consensus.finalRiskScore ?? 0);
  const rr = Number(consensus.decisionPayload?.riskRewardRatio ?? 0);
  const timeHorizonMinutes = Number(scorecard?.timeHorizonMinutes ?? 20);
  const durationLabel = formatDurationBucket(Math.max(1, Math.min(180, timeHorizonMinutes)));
  const volumeSpike = Number(input.marketSignals?.volumeSpikeRatio ?? indicators.volumeBoost ?? 1);

  const htfTrend = mtf ? `4H=${mtf.higher.h4.direction} | 1H=${mtf.mid.h1.direction}` : "UNKNOWN";
  const ltfTrend = mtf
    ? `15M=${mtf.lower.m15.direction} | 5M=${mtf.lower.m5.direction} | 1M=${mtf.lower.m1.direction}`
    : "UNKNOWN";
  const structureTrend =
    mtf?.dominantTrend === "BULLISH"
      ? "HH/HL"
      : mtf?.dominantTrend === "BEARISH"
        ? "LH/LL"
        : "RANGE";
  const bos = indicators.marketStructure.bosUp || indicators.marketStructure.bosDown ? "BOS var" : "BOS yok";
  const choch = indicators.marketStructure.chochLikely ? "CHOCH olasi" : "CHOCH yok";
  const mss = indicators.marketStructure.mssLikely ? "MSS olasi" : "MSS yok";
  const liquidity = indicators.liquidity;
  const eqHighs = liquidity.equalHighClusters.length;
  const eqLows = liquidity.equalLowClusters.length;
  const sweep = liquidity.liquiditySweepDetected ? "sweep var" : "sweep yok";
  const orderBlock = indicators.orderBlock
    ? `${indicators.orderBlock.type} OB ${formatPrice(indicators.orderBlock.low)}-${formatPrice(indicators.orderBlock.high)}`
    : "OB yok";
  const fvg = indicators.fvg
    ? `${indicators.fvg.direction} FVG ${formatPrice(indicators.fvg.gapLow)}-${formatPrice(indicators.fvg.gapHigh)}`
    : "FVG yok";
  const fib = indicators.fib.nearFib
    ? `Fib confluence: 0.382/0.5/0.618 yakin`
    : `Fib uzak`;
  const smartMoney = `${orderBlock} | ${fvg} | ${fib}`;
  const volumeNote =
    volumeSpike >= 1.8
      ? "Volume spike var, teyit gerekli"
      : indicators.volumeBoost < 0.95
        ? "Hacim zayif"
        : "Hacim stabil";

  const entry = Number(consensus.decisionPayload?.entryPrice ?? input.lastPrice);
  const target = consensus.decisionPayload?.targetPrice ?? null;
  const stop = consensus.decisionPayload?.stopPrice ?? null;

  const longSetup = buildSetup({
    direction: "LONG",
    entry: consensus.finalDecision === "BUY" ? entry : null,
    stop: consensus.finalDecision === "BUY" ? stop : null,
    target: consensus.finalDecision === "BUY" ? target : null,
    rr,
    confidenceScore,
    durationLabel,
    active: consensus.finalDecision === "BUY",
  });

  const shortSetup = buildSetup({
    direction: "SHORT",
    entry: consensus.finalDecision === "SELL" ? entry : null,
    stop: consensus.finalDecision === "SELL" ? stop : null,
    target: consensus.finalDecision === "SELL" ? target : null,
    rr,
    confidenceScore,
    durationLabel,
    active: consensus.finalDecision === "SELL",
  });

  const qualityTier = resolveQualityTier(confidenceScore);
  const riskLabel = resolveRiskLabel(scorecard?.riskLevel, riskScore);
  const manipulationRisk = resolveManipulationRisk(
    Number(liquidity.fakeBreakoutRiskScore ?? 0),
    Number(liquidity.wickDominance ?? 0),
    volumeSpike,
  );
  const waitSuggestion =
    consensus.decisionPayload?.noTradeMode?.retryLaterSuggestion ??
    "Teyit gelene kadar bekle.";
  const finalScenario =
    consensus.decisionPayload?.consensusEngine?.reasonedFinalReport ??
    consensus.explanation ??
    "No trade.";

  const marketRegime = input.marketRegime?.mode ?? "RANGE_SIDEWAYS";
  const simulationFilter =
    confidenceScore >= 85 && rr >= 2 && manipulationRisk === "Dusuk" ? "PASS" : "FAIL";

  return [
    `COIN: ${input.symbol}`,
    "TIMEFRAME: HTF 4H/1H | LTF 15M/5M/1M",
    "",
    `MARKET REGIME: ${marketRegime}`,
    "",
    `HTF BIAS: ${htfTrend}`,
    `LTF STRUCTURE: ${ltfTrend}`,
    "",
    "LIQUIDITY MAP:",
    `Equal highs=${eqHighs}, Equal lows=${eqLows}, sessionHigh=${formatPrice(liquidity.sessionHigh)}, sessionLow=${formatPrice(liquidity.sessionLow)}, ${sweep}`,
    "",
    "SMART MONEY ZONES:",
    smartMoney,
    "",
    "VOLUME & MOMENTUM:",
    `Volume boost=${Number(indicators.volumeBoost).toFixed(2)} | spike=${Number(volumeSpike).toFixed(2)} | RSI=${Number(indicators.rsi14).toFixed(2)} | MACD=${Number(indicators.macd).toFixed(4)} | ${volumeNote}`,
    "",
    `EDGE SCORE: ${Number(confidenceScore).toFixed(1)}`,
    `SIMULATION FILTER: ${simulationFilter}`,
    "",
    "ENTRY:",
    "",
    longSetup,
    "",
    shortSetup,
    "",
    `MANIPULATION RISK: ${manipulationRisk}`,
    `FINAL DECISION: ${consensus.finalDecision === "BUY" ? "LONG" : consensus.finalDecision === "SELL" ? "SHORT" : "NO TRADE"}`,
    `REASONING: ${finalScenario}`,
    "",
    `CONFIDENCE: ${Number(confidenceScore).toFixed(1)} (${qualityTier})`,
    `SCORE BREAKDOWN: structure=${shortTermScore.breakdown.structure} | liquidity=${shortTermScore.breakdown.liquidity} | volume=${shortTermScore.breakdown.volume} | smc=${shortTermScore.breakdown.smartMoney} | rr=${shortTermScore.breakdown.riskReward} | momentum=${shortTermScore.breakdown.momentum}`,
    `RISK LEVEL: ${riskLabel}`,
    `WAITING NOTE: ${waitSuggestion}`,
    `ESTIMATED DURATION: ${durationLabel}`,
    "MARKET STRUCTURE:",
    `${structureTrend} | ${bos} | ${choch} | ${mss} | phase=${indicators.marketStructure.phase}`,
  ].join("\n");
}

// buildShortTermReport: compact Mod A (tarama) format
export function buildShortTermReport(input: AIAnalysisInput, consensus: AIConsensusResult) {
  const indicators = buildIndicatorSnapshot(input);
  const scorecard = consensus.analysisScorecard;
  const shortTermScore = computeShortTermScore(input, consensus);
  const confidenceScore = Number(shortTermScore.total ?? scorecard?.confidenceScore ?? consensus.finalConfidence ?? 0);
  const volumeSpike = Number(input.marketSignals?.volumeSpikeRatio ?? indicators.volumeBoost ?? 1);

  // Trend via MA alignment
  const allCloses = input.klines.map((x) => x.close);
  const computeMA = (period: number) => {
    const slice = allCloses.slice(-period);
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
  };
  const ma7 = computeMA(7);
  const ma25 = computeMA(25);
  const ma99 = computeMA(99);
  const trendLabel =
    input.lastPrice > ma7 && ma7 > ma25 && ma25 > ma99
      ? "Yükseliş"
      : input.lastPrice < ma7 && ma7 < ma25 && ma25 < ma99
        ? "Düşüş"
        : Math.abs(ma7 - ma25) / Math.max(ma25, 0.0001) < 0.005
          ? "Sıkışma"
          : "Yatay";

  const volumeLabel =
    indicators.volumeBoost >= 1.5 || volumeSpike >= 1.5 ? "Güçlü" : indicators.volumeBoost < 0.8 ? "Zayıf" : "Normal";

  const signalLabel =
    confidenceScore >= 70
      ? "AL HAZIRLIĞI"
      : confidenceScore >= 50
        ? "BEKLE"
        : "UZAK DUR";

  const entry = Number(consensus.decisionPayload?.entryPrice ?? input.lastPrice);
  const target = consensus.decisionPayload?.targetPrice ?? null;
  const stop = consensus.decisionPayload?.stopPrice ?? null;

  // Derive a suggested entry if no BUY decision
  const suggestedEntry =
    consensus.finalDecision === "BUY" || consensus.finalDecision === "SELL"
      ? entry
      : input.orderBookSummary.bestBid > 0
        ? input.orderBookSummary.bestBid
        : input.lastPrice;

  const change24h = Number(input.marketSignals?.change24h ?? 0);
  const change24hStr = (change24h >= 0 ? "+" : "") + change24h.toFixed(2);

  const finalScenario =
    consensus.decisionPayload?.consensusEngine?.reasonedFinalReport ??
    consensus.decisionPayload?.noTradeMode?.marketNotSuitableSummary ??
    consensus.explanation ??
    "Teyit bekleniyor.";
  // Keep reasoning concise
  const reasonShort = finalScenario.replace(/^(REJECT|BUY|SELL|NO.TRADE)[:\s]*/i, "").slice(0, 120);

  return [
    `📊 ${input.symbol}`,
    `Fiyat: ${formatPrice(input.lastPrice)} | Değişim: %${change24hStr}`,
    `Trend: ${trendLabel}`,
    `Hacim: ${volumeLabel}`,
    `Sinyal: ${signalLabel}`,
    `Giriş seviyesi: ${formatPrice(suggestedEntry)}`,
    `Stop: ${formatPrice(stop)} | Hedef: ${formatPrice(target)}`,
    `Neden: ${reasonShort}`,
  ].join("\n");
}
