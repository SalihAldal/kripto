import { prisma } from "@/src/server/db/prisma";
import type { AdaptiveRegimeLabel } from "@prisma/client";
import type { RegimeDetectionResult } from "@/src/server/strategy-selector/strategy-selector.types";
import { persistMarketRegime } from "@/src/server/strategy-selector/strategy-selector.repository";
import { emitStrategySelectorEvent, STRATEGY_SELECTOR_EVENT } from "@/src/server/strategy-selector/strategy-selector.events";

function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

function num(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function detectMarketRegime(symbol?: string): Promise<RegimeDetectionResult & { id: string }> {
  const sym = symbol?.toUpperCase();
  const snapshot = sym
    ? await prisma.marketSnapshot.findFirst({ where: { symbol: sym }, orderBy: { snapshotAt: "desc" }, include: { trend: true, momentum: true } })
    : await prisma.marketSnapshot.findFirst({ orderBy: { snapshotAt: "desc" }, include: { trend: true, momentum: true } });

  const [newsImpact, whaleScore] = await Promise.all([
    sym ? prisma.newsImpact.findFirst({ where: { affectedCoins: { has: sym } }, orderBy: { impactScore: "desc" } }).catch(() => null) : null,
    sym ? prisma.whaleScore.findFirst({ where: { asset: sym }, orderBy: { whaleActivityScore: "desc" } }).catch(() => null) : null,
  ]);

  const trendDir = String(snapshot?.trend?.primaryTrend ?? "NEUTRAL");
  const trendStrength = num(snapshot?.trend?.trendStrength, 50);
  const momentum = num(snapshot?.momentum?.momentumScore, 50);
  const volatility = num(snapshot?.volatility ?? snapshot?.realizedVolatility, 2);
  const relativeVolume = num(snapshot?.relativeVolume, 1);
  const newsImpactScore = num(newsImpact?.impactScore, 0);
  const whaleActivity = num(whaleScore?.whaleActivityScore, 0);
  const whaleDist = num(whaleScore?.distributionScore, 0);

  const bullScore = clamp(trendDir.includes("BULL") ? trendStrength : trendDir.includes("BEAR") ? 20 : 45);
  const bearScore = clamp(trendDir.includes("BEAR") ? trendStrength : trendDir.includes("BULL") ? 20 : 30);
  const rangeScore = clamp(100 - Math.abs(bullScore - bearScore) - Math.abs(momentum - 50));
  const volatilityScore = clamp(volatility * 15);
  const newsScore = clamp(newsImpactScore);
  const whaleScoreVal = clamp(whaleActivity);

  let regimeLabel: AdaptiveRegimeLabel = "RANGE";
  if (newsImpactScore > 70) regimeLabel = "NEWS_RALLY";
  else if (whaleActivity > 75 && whaleDist < 40) regimeLabel = "WHALE_DRIVEN";
  else if (relativeVolume > 3 && momentum > 80) regimeLabel = "FLASH_PUMP";
  else if (relativeVolume > 3 && momentum < 20) regimeLabel = "FLASH_DUMP";
  else if (volatility > 8) regimeLabel = "HIGH_VOLATILITY";
  else if (volatility < 1) regimeLabel = "LOW_VOLATILITY";
  else if (whaleDist > 65) regimeLabel = "DISTRIBUTION";
  else if (whaleActivity > 60 && whaleDist < 30) regimeLabel = "ACCUMULATION";
  else if (momentum > 70 && num(snapshot?.momentum?.breakoutProbability) > 60) regimeLabel = "BREAKOUT";
  else if (momentum > 65 && relativeVolume < 0.8) regimeLabel = "FAKE_BREAKOUT";
  else if (bearScore > 65 && whaleDist > 50) regimeLabel = "LIQUIDITY_TRAP";
  else if (bullScore > 70) regimeLabel = "STRONG_BULL";
  else if (bullScore > 55) regimeLabel = "WEAK_BULL";
  else if (bearScore > 70) regimeLabel = "STRONG_BEAR";
  else if (bearScore > 55) regimeLabel = "WEAK_BEAR";

  const regimeConfidence = clamp(
    Math.max(bullScore, bearScore, rangeScore) * 0.4 + momentum * 0.3 + (100 - Math.abs(volatilityScore - 50)) * 0.15 + newsScore * 0.15,
  );

  const evidence = { trendDir, trendStrength, momentum, volatility, relativeVolume, newsImpactScore, whaleActivity, whaleDist };

  const record = await persistMarketRegime({
    symbol: sym,
    regimeLabel,
    regimeConfidence: Number(regimeConfidence.toFixed(1)),
    bullScore, bearScore, rangeScore, volatilityScore, newsScore: newsScore, whaleScore: whaleScoreVal,
    evidence,
  });

  emitStrategySelectorEvent(STRATEGY_SELECTOR_EVENT.REGIME_DETECTED, { regimeKey: record.regimeKey, regimeLabel, symbol: sym });
  return { id: record.id, regimeLabel, regimeConfidence, bullScore, bearScore, rangeScore, volatilityScore, newsScore, whaleScore: whaleScoreVal, evidence };
}
