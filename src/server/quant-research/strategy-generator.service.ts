import type { StrategyArchetype } from "@prisma/client";
import { persistStrategyGenome } from "@/src/server/quant-research/quant-research.repository";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";
import type { StrategyGenomeSpec } from "@/src/server/quant-research/quant-research.types";

const ARCHETYPES: StrategyArchetype[] = [
  "TREND_FOLLOWING",
  "BREAKOUT",
  "MOMENTUM",
  "MEAN_REVERSION",
  "VWAP",
  "VOLUME_PROFILE",
  "MARKET_STRUCTURE",
  "LIQUIDITY_SWEEP",
  "ORDER_BLOCK",
  "FVG",
  "SMC",
  "MULTI_TIMEFRAME",
  "HYBRID",
  "AI_GENERATED",
];

const ARCHETYPE_INDICATORS: Record<StrategyArchetype, string[]> = {
  TREND_FOLLOWING: ["EMA_21", "EMA_50", "ADX"],
  BREAKOUT: ["ATR", "VOLUME", "RANGE_HIGH"],
  MOMENTUM: ["RSI", "MACD", "MOMENTUM"],
  MEAN_REVERSION: ["RSI", "BOLLINGER", "VWAP"],
  VWAP: ["VWAP", "VOLUME", "DELTA"],
  VOLUME_PROFILE: ["VOLUME", "POC", "VAH", "VAL"],
  MARKET_STRUCTURE: ["SWING_HIGH", "SWING_LOW", "BOS"],
  LIQUIDITY_SWEEP: ["LIQUIDITY", "WICK", "ORDERBOOK"],
  ORDER_BLOCK: ["OB", "FVG", "IMBALANCE"],
  FVG: ["FVG", "FAIR_VALUE", "IMBALANCE"],
  SMC: ["ORDER_BLOCK", "LIQUIDITY", "FVG"],
  MULTI_TIMEFRAME: ["EMA_4H", "RSI_1H", "VOLUME_15M"],
  HYBRID: ["EMA", "RSI", "VOLUME", "VWAP"],
  AI_GENERATED: ["RSI", "MACD", "FUNDING", "OI", "WHALE"],
  BASELINE: ["EMA_20"],
  RANDOM: ["RANDOM"],
};

const ARCHETYPE_PARAMS: Record<StrategyArchetype, Record<string, number>> = {
  TREND_FOLLOWING: { emaFast: 21, emaSlow: 50, adxMin: 25 },
  BREAKOUT: { atrMult: 1.5, volumeSpike: 2.0, rangeLookback: 20 },
  MOMENTUM: { rsiMin: 55, macdThreshold: 0, momentumMin: 0.5 },
  MEAN_REVERSION: { rsiOversold: 30, rsiOverbought: 70, vwapDev: 1.5 },
  VWAP: { vwapDevPct: 0.5, volumeMin: 1.2, deltaMin: 0.3 },
  VOLUME_PROFILE: { pocDistPct: 0.3, volumeSpike: 1.8 },
  MARKET_STRUCTURE: { swingLookback: 10, bosConfirm: 2 },
  LIQUIDITY_SWEEP: { sweepWickPct: 0.2, reclaimBars: 3 },
  ORDER_BLOCK: { obLookback: 20, fvgMinPct: 0.1 },
  FVG: { fvgMinPct: 0.15, fillPct: 0.5 },
  SMC: { liquiditySweep: 1, obConfirm: 2, fvgMin: 0.1 },
  MULTI_TIMEFRAME: { htfEma: 50, ltfRsi: 45, alignScore: 0.7 },
  HYBRID: { ema: 21, rsi: 50, volume: 1.5, vwap: 0.5 },
  AI_GENERATED: { rsi: 52, funding: 0.01, oiDelta: 2.0, whaleMin: 100000 },
  BASELINE: { ema: 20 },
  RANDOM: { threshold: 0.5 },
};

export async function generateStrategies(count = 10, archetypes?: StrategyArchetype[]) {
  return researchDbOnly(async () => {
    const targets = archetypes?.length ? archetypes : ARCHETYPES;
    const generated: StrategyGenomeSpec[] = [];
    for (let i = 0; i < count; i++) {
      const archetype = targets[i % targets.length]!;
      const spec = buildGenomeSpec(archetype, i);
      generated.push(spec);
      await persistStrategyGenome(spec);
    }
    return { generated: generated.length, strategies: generated };
  });
}

export function buildGenomeSpec(archetype: StrategyArchetype, index: number, generation = 1, parentGenome?: string): StrategyGenomeSpec {
  const genomeKey = `${archetype.toLowerCase()}_g${generation}_${Date.now()}_${index}`;
  return {
    genomeKey,
    name: `${archetype.replace(/_/g, " ")} v${generation}.${index}`,
    archetype,
    generation,
    indicators: ARCHETYPE_INDICATORS[archetype] ?? ["EMA", "RSI"],
    parameters: { ...ARCHETYPE_PARAMS[archetype] },
    rules: {
      entry: `Enter on ${archetype} signal confirmation`,
      exit: "ATR trailing stop + take profit 2R",
      filters: ["volume", "spread", "regime"],
    },
    parentGenome,
  };
}

export async function generateAiStrategy(name?: string) {
  const spec = buildGenomeSpec("AI_GENERATED", 0);
  if (name) spec.name = name;
  spec.parameters = {
    ...spec.parameters,
    rsi: 48 + Math.random() * 10,
    funding: 0.005 + Math.random() * 0.02,
    oiDelta: 1 + Math.random() * 3,
  };
  await persistStrategyGenome(spec);
  return spec;
}
