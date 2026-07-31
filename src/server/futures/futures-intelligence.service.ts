import { env } from "@/lib/config";
import { toGlobalLeverageSymbol } from "@/services/binance-global.service";

export type FuturesIntent =
  | "CONTINUATION_SUPPORT"
  | "LATE_LONG_TRAP"
  | "LATE_SHORT_TRAP"
  | "LONG_SQUEEZE_RISK"
  | "SHORT_SQUEEZE_RISK"
  | "MANIPULATION_SQUEEZE_RISK"
  | "NEUTRAL";

export type FuturesIntelligenceSnapshot = {
  symbol: string;
  futuresSymbol: string;
  capturedAt: string;
  degraded: boolean;
  fundingRate?: number;
  fundingDelta?: number;
  openInterest?: number;
  openInterestDelta?: number;
  longShortRatio?: number;
  longShortRatioDelta?: number;
  topLongShortPositionRatio?: number;
  liquidationBuyNotional?: number;
  liquidationSellNotional?: number;
  liquidationImbalance?: number;
  nearestLiquidationMagnetPrice?: number;
  liquidationMagnetDistancePercent?: number;
  aggressivePositioningScore: number;
  positioningPressure: number;
  leverageStressScore: number;
  squeezeProbability: number;
  leveragedTrapProbability: number;
  oiPriceDivergenceScore: number;
  overcrowdedLongScore: number;
  overcrowdedShortScore: number;
  manipulationPressureScore: number;
  futuresRiskScore: number;
  futuresIntent: FuturesIntent;
  summary: string;
  reasons: string[];
  raw?: Record<string, unknown>;
};

function finite(value: unknown): number | undefined;
function finite(value: unknown, fallback: number): number;
function finite(value: unknown, fallback?: number) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number | undefined, digits = 6) {
  return value === undefined ? undefined : Number(value.toFixed(digits));
}

function sigmoidScore(value: number, scale: number) {
  return clamp(50 + 50 * Math.tanh(value / Math.max(scale, 0.0001)));
}

async function fetchJson(url: string, timeoutMs = Math.max(2500, env.BINANCE_TIMEOUT_MS)) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

function firstLastDelta(rows: Array<Record<string, unknown>>, key: string) {
  if (rows.length < 2) return undefined;
  const first = finite(rows[0]?.[key]);
  const last = finite(rows[rows.length - 1]?.[key]);
  if (first === undefined || last === undefined || first === 0) return undefined;
  return ((last - first) / Math.abs(first)) * 100;
}

function latestNumber(rows: Array<Record<string, unknown>>, key: string) {
  return finite(rows[rows.length - 1]?.[key]);
}

function liquidationStats(rows: Array<Record<string, unknown>>, markPrice?: number) {
  let buyNotional = 0;
  let sellNotional = 0;
  let nearestPrice: number | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const qty = finite(row.origQty ?? row.executedQty) ?? 0;
    const price = finite(row.averagePrice ?? row.price) ?? 0;
    const notional = qty * price;
    const side = String(row.side ?? "").toUpperCase();
    if (side === "BUY") buyNotional += notional;
    if (side === "SELL") sellNotional += notional;
    if (markPrice && price > 0) {
      const distance = Math.abs((price - markPrice) / markPrice) * 100;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPrice = price;
      }
    }
  }
  const total = buyNotional + sellNotional;
  return {
    buyNotional,
    sellNotional,
    imbalance: total > 0 ? (buyNotional - sellNotional) / total : undefined,
    nearestPrice,
    nearestDistance: Number.isFinite(nearestDistance) ? nearestDistance : undefined,
  };
}

function degradedSnapshot(symbol: string, futuresSymbol: string, reason: string): FuturesIntelligenceSnapshot {
  return {
    symbol,
    futuresSymbol,
    capturedAt: new Date().toISOString(),
    degraded: true,
    aggressivePositioningScore: 50,
    positioningPressure: 50,
    leverageStressScore: 0,
    squeezeProbability: 0,
    leveragedTrapProbability: 0,
    oiPriceDivergenceScore: 0,
    overcrowdedLongScore: 0,
    overcrowdedShortScore: 0,
    manipulationPressureScore: 0,
    futuresRiskScore: 0,
    futuresIntent: "NEUTRAL",
    summary: `Futures intelligence degraded: ${reason}`,
    reasons: [reason],
  };
}

export async function collectPreTradeFuturesIntelligence(input: {
  symbol: string;
  lastPrice?: number;
  priceChangePercent?: number;
  shortMomentumPercent?: number;
}): Promise<FuturesIntelligenceSnapshot> {
  const symbol = input.symbol.toUpperCase();
  const futuresSymbol = toGlobalLeverageSymbol(symbol);
  const capturedAt = new Date().toISOString();
  const base = env.BINANCE_GLOBAL_HTTP_BASE.replace("api.binance.com", "fapi.binance.com").replace(/\/$/, "");
  const dataBase = `${base}/futures/data`;
  const query = encodeURIComponent(futuresSymbol);
  const [premium, oi, oiHist, fundingHist, longShort, topLongShort, liquidations] = await Promise.allSettled([
    fetchJson(`${base}/fapi/v1/premiumIndex?symbol=${query}`),
    fetchJson(`${base}/fapi/v1/openInterest?symbol=${query}`),
    fetchJson(`${dataBase}/openInterestHist?symbol=${query}&period=5m&limit=12`),
    fetchJson(`${base}/fapi/v1/fundingRate?symbol=${query}&limit=8`),
    fetchJson(`${dataBase}/globalLongShortAccountRatio?symbol=${query}&period=5m&limit=12`),
    fetchJson(`${dataBase}/topLongShortPositionRatio?symbol=${query}&period=5m&limit=12`),
    fetchJson(`${base}/fapi/v1/allForceOrders?symbol=${query}&limit=50`),
  ]);

  const errors = [premium, oi, oiHist, fundingHist, longShort, topLongShort, liquidations]
    .flatMap((row) => row.status === "rejected" ? [row.reason instanceof Error ? row.reason.message : String(row.reason)] : []);
  const premiumRow = premium.status === "fulfilled" ? premium.value as Record<string, unknown> : {};
  const oiRow = oi.status === "fulfilled" ? oi.value as Record<string, unknown> : {};
  const oiRows = oiHist.status === "fulfilled" && Array.isArray(oiHist.value) ? oiHist.value as Array<Record<string, unknown>> : [];
  const fundingRows = fundingHist.status === "fulfilled" && Array.isArray(fundingHist.value) ? fundingHist.value as Array<Record<string, unknown>> : [];
  const longShortRows = longShort.status === "fulfilled" && Array.isArray(longShort.value) ? longShort.value as Array<Record<string, unknown>> : [];
  const topLongShortRows = topLongShort.status === "fulfilled" && Array.isArray(topLongShort.value) ? topLongShort.value as Array<Record<string, unknown>> : [];
  const liquidationRows = liquidations.status === "fulfilled" && Array.isArray(liquidations.value) ? liquidations.value as Array<Record<string, unknown>> : [];

  if (!premiumRow.markPrice && !oiRow.openInterest && oiRows.length === 0 && longShortRows.length === 0) {
    return degradedSnapshot(symbol, futuresSymbol, errors[0] ?? "futures data unavailable");
  }

  const markPrice = finite(premiumRow.markPrice) ?? input.lastPrice;
  const fundingRate = finite(premiumRow.lastFundingRate);
  const fundingDelta = firstLastDelta(fundingRows, "fundingRate");
  const openInterest = finite(oiRow.openInterest) ?? latestNumber(oiRows, "sumOpenInterest");
  const openInterestDelta = firstLastDelta(oiRows, "sumOpenInterest");
  const longShortRatio = latestNumber(longShortRows, "longShortRatio");
  const longShortRatioDelta = firstLastDelta(longShortRows, "longShortRatio");
  const topLongShortPositionRatio = latestNumber(topLongShortRows, "longShortRatio");
  const liquidationsSummary = liquidationStats(liquidationRows, markPrice);
  const priceChange = finite(input.priceChangePercent) ?? finite(input.shortMomentumPercent) ?? 0;
  const oiDelta = finite(openInterestDelta, 0);
  const funding = finite(fundingRate, 0);
  const fundingDeltaValue = finite(fundingDelta, 0);
  const lsRatio = finite(longShortRatio, 1);
  const topRatio = finite(topLongShortPositionRatio, lsRatio);
  const longCrowdingRaw = Math.max(0, lsRatio - 1) + Math.max(0, topRatio - 1) * 0.75 + Math.max(0, funding) * 1800;
  const shortCrowdingRaw = Math.max(0, 1 - lsRatio) + Math.max(0, 1 - topRatio) * 0.75 + Math.max(0, -funding) * 1800;
  const overcrowdedLongScore = sigmoidScore(longCrowdingRaw, 1.6);
  const overcrowdedShortScore = sigmoidScore(shortCrowdingRaw, 1.6);
  const aggressivePositioningScore = sigmoidScore(Math.abs(oiDelta) + Math.abs(fundingDeltaValue) * 80 + Math.abs(lsRatio - 1) * 18, 8);
  const oiPriceDivergenceScore = sigmoidScore(
    Math.abs(oiDelta) * (Math.sign(oiDelta) !== Math.sign(priceChange) || Math.abs(priceChange) < 0.18 ? 1.4 : 0.65),
    7,
  );
  const liquidationImbalance = finite(liquidationsSummary.imbalance, 0);
  const liquidationPressure = sigmoidScore(Math.abs(liquidationImbalance) * 100 + (liquidationsSummary.nearestDistance !== undefined ? Math.max(0, 3 - liquidationsSummary.nearestDistance) * 8 : 0), 45);
  const longTrapRaw =
    Math.max(0, priceChange) * 8 +
    Math.max(0, oiDelta) * 1.2 +
    Math.max(0, funding) * 2400 +
    Math.max(0, lsRatio - 1) * 24;
  const shortTrapRaw =
    Math.max(0, -priceChange) * 8 +
    Math.max(0, oiDelta) * 1.2 +
    Math.max(0, -funding) * 2400 +
    Math.max(0, 1 - lsRatio) * 24;
  const leveragedTrapProbability = Math.max(
    sigmoidScore(longTrapRaw, 42),
    sigmoidScore(shortTrapRaw, 42),
    oiPriceDivergenceScore * 0.78,
  );
  const squeezeProbability = clamp(
    aggressivePositioningScore * 0.24 +
      liquidationPressure * 0.24 +
      Math.max(overcrowdedLongScore, overcrowdedShortScore) * 0.22 +
      oiPriceDivergenceScore * 0.18 +
      Math.min(100, Math.abs(funding) * 120_000) * 0.12,
  );
  const manipulationPressureScore = clamp(
    oiPriceDivergenceScore * 0.34 +
      squeezeProbability * 0.3 +
      liquidationPressure * 0.2 +
      (Math.abs(priceChange) < 0.2 && Math.abs(oiDelta) > 2 ? 16 : 0),
  );
  const positioningPressure = clamp(50 + (overcrowdedLongScore - overcrowdedShortScore) * 0.45 + oiDelta * 0.7);
  const leverageStressScore = clamp(
    Math.max(overcrowdedLongScore, overcrowdedShortScore) * 0.22 +
      aggressivePositioningScore * 0.22 +
      squeezeProbability * 0.26 +
      Math.min(100, Math.abs(funding) * 100_000) * 0.16 +
      liquidationPressure * 0.14,
  );
  const futuresRiskScore = clamp(
    leverageStressScore * 0.36 +
      leveragedTrapProbability * 0.26 +
      manipulationPressureScore * 0.22 +
      oiPriceDivergenceScore * 0.16,
  );
  const futuresIntent: FuturesIntent =
    manipulationPressureScore >= 68
      ? "MANIPULATION_SQUEEZE_RISK"
      : longTrapRaw > shortTrapRaw && leveragedTrapProbability >= 64
        ? "LATE_LONG_TRAP"
        : shortTrapRaw > longTrapRaw && leveragedTrapProbability >= 64
          ? "LATE_SHORT_TRAP"
          : overcrowdedLongScore >= 68 && squeezeProbability >= 58
            ? "LONG_SQUEEZE_RISK"
            : overcrowdedShortScore >= 68 && squeezeProbability >= 58
              ? "SHORT_SQUEEZE_RISK"
              : Math.sign(oiDelta) === Math.sign(priceChange) && Math.abs(priceChange) > 0.25 && futuresRiskScore < 58
                ? "CONTINUATION_SUPPORT"
                : "NEUTRAL";
  const reasons = [
    `intent=${futuresIntent}`,
    `funding=${round(fundingRate, 8) ?? "n/a"}`,
    `fundingDelta=${round(fundingDelta, 4) ?? "n/a"}`,
    `oiDelta=${round(openInterestDelta, 4) ?? "n/a"}`,
    `longShort=${round(longShortRatio, 4) ?? "n/a"}`,
    `liqImbalance=${round(liquidationsSummary.imbalance, 4) ?? "n/a"}`,
    `trap=${round(leveragedTrapProbability, 2)}`,
    `squeeze=${round(squeezeProbability, 2)}`,
  ];
  return {
    symbol,
    futuresSymbol,
    capturedAt,
    degraded: errors.length >= 4,
    fundingRate: round(fundingRate, 8),
    fundingDelta: round(fundingDelta, 4),
    openInterest: round(openInterest, 6),
    openInterestDelta: round(openInterestDelta, 4),
    longShortRatio: round(longShortRatio, 6),
    longShortRatioDelta: round(longShortRatioDelta, 4),
    topLongShortPositionRatio: round(topLongShortPositionRatio, 6),
    liquidationBuyNotional: round(liquidationsSummary.buyNotional, 2),
    liquidationSellNotional: round(liquidationsSummary.sellNotional, 2),
    liquidationImbalance: round(liquidationsSummary.imbalance, 6),
    nearestLiquidationMagnetPrice: round(liquidationsSummary.nearestPrice, 8),
    liquidationMagnetDistancePercent: round(liquidationsSummary.nearestDistance, 4),
    aggressivePositioningScore: round(aggressivePositioningScore, 2) ?? 50,
    positioningPressure: round(positioningPressure, 2) ?? 50,
    leverageStressScore: round(leverageStressScore, 2) ?? 0,
    squeezeProbability: round(squeezeProbability, 2) ?? 0,
    leveragedTrapProbability: round(leveragedTrapProbability, 2) ?? 0,
    oiPriceDivergenceScore: round(oiPriceDivergenceScore, 2) ?? 0,
    overcrowdedLongScore: round(overcrowdedLongScore, 2) ?? 0,
    overcrowdedShortScore: round(overcrowdedShortScore, 2) ?? 0,
    manipulationPressureScore: round(manipulationPressureScore, 2) ?? 0,
    futuresRiskScore: round(futuresRiskScore, 2) ?? 0,
    futuresIntent,
    summary: `Futures intent=${futuresIntent}, risk=${round(futuresRiskScore, 2)}, stress=${round(leverageStressScore, 2)}, trap=${round(leveragedTrapProbability, 2)}`,
    reasons,
    raw: {
      errors,
      premium: premium.status === "fulfilled" ? premium.value : undefined,
      openInterest: oi.status === "fulfilled" ? oi.value : undefined,
      openInterestHist: oiHist.status === "fulfilled" ? oiHist.value : undefined,
      funding: fundingHist.status === "fulfilled" ? fundingHist.value : undefined,
      longShort: longShort.status === "fulfilled" ? longShort.value : undefined,
      topLongShort: topLongShort.status === "fulfilled" ? topLongShort.value : undefined,
      liquidations: liquidations.status === "fulfilled" ? liquidations.value : undefined,
    },
  };
}
