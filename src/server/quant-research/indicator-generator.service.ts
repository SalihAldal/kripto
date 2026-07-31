import { persistStrategyGenome } from "@/src/server/quant-research/quant-research.repository";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";

const BASE_INDICATORS = ["EMA", "RSI", "MACD", "VWAP", "ATR", "VOLUME", "OBV", "FUNDING", "OI", "LIQUIDITY", "WHALE", "MOMENTUM", "DELTA"] as const;

const PAIR_TEMPLATES: Array<[string, string]> = [
  ["EMA", "RSI"],
  ["EMA", "MACD"],
  ["VWAP", "DELTA"],
  ["ATR", "MOMENTUM"],
  ["OBV", "VOLUME"],
  ["FUNDING", "OI"],
  ["LIQUIDITY", "WHALE"],
  ["RSI", "MACD"],
  ["EMA", "VWAP"],
  ["ATR", "VOLUME"],
  ["BOLLINGER", "RSI"],
  ["EMA", "ATR"],
  ["VWAP", "VOLUME"],
  ["MACD", "MOMENTUM"],
  ["FUNDING", "WHALE"],
];

export async function generateIndicatorCombinations(count = 50) {
  return researchDbOnly(async () => {
    const combinations: Array<{ key: string; indicators: string[]; parameters: Record<string, number> }> = [];
    for (let i = 0; i < count; i++) {
      const combo = buildCombination(i);
      combinations.push(combo);
      await persistStrategyGenome({
        genomeKey: combo.key,
        name: `Indicator Combo ${i + 1}`,
        archetype: "HYBRID",
        generation: 1,
        indicators: combo.indicators,
        parameters: combo.parameters,
        rules: { type: "indicator_combo", entryThreshold: 0.6 },
      });
    }
    return { generated: combinations.length, combinations: combinations.slice(0, 20) };
  });
}

function buildCombination(index: number) {
  if (index < PAIR_TEMPLATES.length) {
    const [a, b] = PAIR_TEMPLATES[index]!;
    return {
      key: `combo_${a.toLowerCase()}_${b.toLowerCase()}_${index}`,
      indicators: [a, b],
      parameters: randomParams([a, b]),
    };
  }
  const size = 2 + (index % 3);
  const picked = shuffle([...BASE_INDICATORS]).slice(0, size);
  return {
    key: `combo_multi_${index}_${picked.join("_").toLowerCase()}`,
    indicators: picked,
    parameters: randomParams(picked),
  };
}

function randomParams(indicators: string[]) {
  const params: Record<string, number> = {};
  for (const ind of indicators) {
    if (ind === "RSI") params.rsiPeriod = 7 + Math.floor(Math.random() * 14);
    if (ind === "EMA") params.emaPeriod = 9 + Math.floor(Math.random() * 40);
    if (ind === "ATR") params.atrMult = 1 + Math.random() * 2;
    if (ind === "MACD") params.macdFast = 8 + Math.floor(Math.random() * 4);
    if (ind === "VOLUME") params.volumeSpike = 1.2 + Math.random() * 2;
    if (ind === "MOMENTUM") params.momentumMin = 0.3 + Math.random() * 0.7;
  }
  return params;
}

function shuffle<T>(arr: T[]) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
