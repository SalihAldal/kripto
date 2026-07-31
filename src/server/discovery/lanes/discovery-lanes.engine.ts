import type { DiscoveryAssetClass, DiscoveryLaneType } from "@prisma/client";
import type { LaneScoreResult, UniverseSymbol } from "@/src/server/discovery/discovery.types";
import type { MarketContext } from "@/src/types/scanner";

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value));
}

function scoreFromMetrics(values: number[], weights?: number[]) {
  if (values.length === 0) return 0;
  const totalWeight = weights?.reduce((sum, w) => sum + w, 0) ?? values.length;
  let weighted = 0;
  for (let i = 0; i < values.length; i += 1) {
    weighted += values[i] * (weights?.[i] ?? 1);
  }
  return clampScore(weighted / totalWeight);
}

type LaneContext = {
  context: MarketContext;
  assetClass: DiscoveryAssetClass;
  universeMeta?: UniverseSymbol;
};

function laneMomentum({ context }: LaneContext): LaneScoreResult {
  const score = scoreFromMetrics(
    [
      Math.abs(context.momentumPercent ?? 0) * 8,
      Math.abs(context.change24h ?? 0) * 5,
      context.shortCandleSignal ?? 0,
    ],
    [1.2, 1, 0.8],
  );
  return { lane: "MOMENTUM", score, reasons: ["momentumPercent", "change24h", "shortCandleSignal"] };
}

function laneBreakout({ context }: LaneContext): LaneScoreResult {
  const score = scoreFromMetrics([
    context.volumeSpikePercent ?? 0,
    Math.max(0, (context.change24h ?? 0) * 6),
    context.shortCandleSignal ?? 0,
  ]);
  return { lane: "BREAKOUT", score, reasons: ["volumeSpike", "priceExpansion", "candleStructure"] };
}

function laneWhale({ context }: LaneContext): LaneScoreResult {
  const score = scoreFromMetrics([
    Math.abs(context.orderBookImbalance ?? 0) * 120,
    context.volume24h > 5_000_000 ? 70 : context.volume24h / 100_000,
    context.buyPressure ?? 0,
  ]);
  return { lane: "WHALE", score, reasons: ["orderBookImbalance", "volume24h", "buyPressure"] };
}

function laneVolumeExplosion({ context }: LaneContext): LaneScoreResult {
  const score = clampScore(context.volumeSpikePercent ?? 0);
  return { lane: "VOLUME_EXPLOSION", score, reasons: ["volumeSpikePercent"] };
}

function laneSmartMoney({ context }: LaneContext): LaneScoreResult {
  const score = scoreFromMetrics([
    context.buyPressure ?? 0,
    Math.max(0, 100 - (context.fakeSpikeScore ?? 0)),
    Math.abs(context.orderBookImbalance ?? 0) * 80,
  ]);
  return { lane: "SMART_MONEY", score, reasons: ["buyPressure", "fakeSpikeInverse", "bookImbalance"] };
}

function laneTrend({ context }: LaneContext): LaneScoreResult {
  const score = scoreFromMetrics([
    Math.max(0, (context.change24h ?? 0) * 8),
    Math.max(0, (context.momentumPercent ?? 0) * 10),
  ]);
  return { lane: "TREND", score, reasons: ["change24h", "momentumPercent"] };
}

function laneRelativeStrength({ context }: LaneContext): LaneScoreResult {
  const btcChange = Number(context.metadata?.btcChange24h ?? 0);
  const rel = (context.change24h ?? 0) - btcChange;
  const score = clampScore(Math.max(0, rel * 10 + 50));
  return { lane: "RELATIVE_STRENGTH", score, reasons: ["vsBtcChange24h"] };
}

function laneNews({ context }: LaneContext): LaneScoreResult {
  const sentiment = String(context.metadata?.newsSentiment ?? "NEUTRAL").toUpperCase();
  const social = Number(context.metadata?.socialSentimentScore ?? 50);
  const score =
    sentiment === "POSITIVE" ? clampScore(60 + social * 0.4) : sentiment === "NEGATIVE" ? clampScore(40 - social * 0.2) : clampScore(social);
  return { lane: "NEWS", score, reasons: ["newsSentiment", "socialSentimentScore"] };
}

function laneFunding({ context }: LaneContext): LaneScoreResult {
  const funding = Math.abs(Number(context.metadata?.fundingRate ?? 0));
  const score = clampScore(funding * 8000);
  return { lane: "FUNDING", score, reasons: ["fundingRate"] };
}

function laneOpenInterest({ context }: LaneContext): LaneScoreResult {
  const oiChange = Number(context.metadata?.openInterestChangePct ?? 0);
  const score = clampScore(Math.abs(oiChange) * 4);
  return { lane: "OPEN_INTEREST", score, reasons: ["openInterestChangePct"] };
}

function laneLiquidation({ context }: LaneContext): LaneScoreResult {
  const liq = Number(context.metadata?.liquidationVolume24h ?? 0);
  const score = clampScore(Math.log10(Math.max(1, liq)) * 20);
  return { lane: "LIQUIDATION", score, reasons: ["liquidationVolume24h"] };
}

function laneOrderbook({ context }: LaneContext): LaneScoreResult {
  const score = scoreFromMetrics([
    Math.abs(context.orderBookImbalance ?? 0) * 100,
    Math.max(0, 100 - context.spreadPercent * 400),
  ]);
  return { lane: "ORDERBOOK", score, reasons: ["orderBookImbalance", "spreadPercent"] };
}

function laneLowCap({ context }: LaneContext): LaneScoreResult {
  const mcap = Number(context.metadata?.marketCapUsd ?? context.volume24h * 10);
  const score = mcap <= 0 ? 0 : clampScore(100 - Math.log10(Math.max(1, mcap)) * 12);
  return { lane: "LOW_CAP", score, reasons: ["marketCapUsd"] };
}

function laneHighVolume({ context }: LaneContext): LaneScoreResult {
  const score = clampScore(Math.log10(Math.max(1, context.volume24h)) * 18);
  return { lane: "HIGH_VOLUME", score, reasons: ["volume24h"] };
}

function laneNewListing({ universeMeta }: LaneContext): LaneScoreResult {
  const score = universeMeta?.isNewListing ? 85 : universeMeta?.zone === "NEW_LISTING" ? 70 : 20;
  return { lane: "NEW_LISTING", score, reasons: ["isNewListing", "zone"] };
}

function laneMeme({ assetClass, context }: LaneContext): LaneScoreResult {
  const score = assetClass === "MEME" ? clampScore(70 + (context.pumpIntensity ?? 0) * 0.3) : clampScore((context.pumpIntensity ?? 0) * 0.5);
  return { lane: "MEME", score, reasons: ["assetClass", "pumpIntensity"] };
}

function laneAiCoin({ assetClass, context }: LaneContext): LaneScoreResult {
  const score =
    assetClass === "AI" || assetClass === "AI_AGENT"
      ? clampScore(65 + (context.momentumPercent ?? 0) * 5)
      : clampScore((context.momentumPercent ?? 0) * 3);
  return { lane: "AI_COIN", score, reasons: ["assetClass", "momentumPercent"] };
}

function laneRwa({ assetClass }: LaneContext): LaneScoreResult {
  const score = assetClass === "RWA" ? 75 : 15;
  return { lane: "RWA", score, reasons: ["assetClass"] };
}

function laneDepin({ assetClass }: LaneContext): LaneScoreResult {
  const score = assetClass === "DEPIN" ? 72 : 15;
  return { lane: "DEPIN", score, reasons: ["assetClass"] };
}

function laneArbitrage({ context }: LaneContext): LaneScoreResult {
  const spotFuturesSpread = Math.abs(Number(context.metadata?.spotFuturesSpreadPct ?? 0));
  const score = clampScore(spotFuturesSpread * 400);
  return { lane: "ARBITRAGE", score, reasons: ["spotFuturesSpreadPct"] };
}

function laneAnomaly({ context }: LaneContext): LaneScoreResult {
  const score = scoreFromMetrics([
    context.volumeSpikePercent ?? 0,
    context.fakeSpikeScore ?? 0,
    Math.abs(context.change24h ?? 0) * 6,
  ]);
  return { lane: "ANOMALY", score, reasons: ["volumeSpike", "fakeSpike", "change24h"] };
}

const LANE_SCORERS: Record<DiscoveryLaneType, (input: LaneContext) => LaneScoreResult> = {
  MOMENTUM: laneMomentum,
  BREAKOUT: laneBreakout,
  WHALE: laneWhale,
  VOLUME_EXPLOSION: laneVolumeExplosion,
  SMART_MONEY: laneSmartMoney,
  TREND: laneTrend,
  RELATIVE_STRENGTH: laneRelativeStrength,
  NEWS: laneNews,
  FUNDING: laneFunding,
  OPEN_INTEREST: laneOpenInterest,
  LIQUIDATION: laneLiquidation,
  ORDERBOOK: laneOrderbook,
  LOW_CAP: laneLowCap,
  HIGH_VOLUME: laneHighVolume,
  NEW_LISTING: laneNewListing,
  MEME: laneMeme,
  AI_COIN: laneAiCoin,
  RWA: laneRwa,
  DEPIN: laneDepin,
  ARBITRAGE: laneArbitrage,
  ANOMALY: laneAnomaly,
};

export function scoreAllDiscoveryLanes(input: LaneContext): LaneScoreResult[] {
  return (Object.keys(LANE_SCORERS) as DiscoveryLaneType[]).map((lane) => LANE_SCORERS[lane](input));
}

export function scoreDiscoveryLane(lane: DiscoveryLaneType, input: LaneContext): LaneScoreResult {
  return LANE_SCORERS[lane](input);
}
