import { REPLAY_HORIZONS, type PriceCandle, type ReplayMetrics } from "@/src/server/replay/replay.types";
import {
  computeAtr,
  computePathExtremes,
  priceAtTime,
  sliceCandlesUntil,
} from "@/src/server/replay/price-path.service";

function pctChange(from: number, to: number) {
  if (!Number.isFinite(from) || from <= 0 || !Number.isFinite(to)) return 0;
  return ((to - from) / from) * 100;
}

function computeVolatilityPct(candles: PriceCandle[]) {
  if (candles.length < 2) return null;
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const prev = candles[i - 1]!.close;
    const cur = candles[i]!.close;
    if (prev > 0) returns.push(((cur - prev) / prev) * 100);
  }
  if (returns.length === 0) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

export function computeReplayMetrics(input: {
  candles: PriceCandle[];
  entryPrice: number;
  decisionTime: Date;
  marketRegimeAfter?: string | null;
  btcCandles?: PriceCandle[];
}): ReplayMetrics {
  const entry = input.entryPrice;
  const allExtremes = computePathExtremes(input.candles, entry);
  const horizonReturns: Record<string, number> = {};
  const historicalOutcomes: Array<{ label: string; returnPct: number; mfePct: number; maePct: number }> = [];

  for (const horizon of REPLAY_HORIZONS) {
    const endMs = input.decisionTime.getTime() + horizon.ms;
    const slice = sliceCandlesUntil(input.candles, endMs);
    const price = priceAtTime(slice, endMs, entry);
    const extremes = computePathExtremes(slice, entry);
    const returnPct = pctChange(entry, price);
    horizonReturns[horizon.label] = Number(returnPct.toFixed(4));
    historicalOutcomes.push({
      label: horizon.label,
      returnPct,
      mfePct: extremes.mfePct,
      maePct: extremes.maePct,
    });
  }

  const firstWindow = sliceCandlesUntil(input.candles, input.decisionTime.getTime() + REPLAY_HORIZONS[0]!.ms);
  const lastWindow = input.candles;
  const firstVol = computeVolatilityPct(firstWindow);
  const lastVol = computeVolatilityPct(lastWindow);
  const volumeStart = firstWindow.reduce((sum, row) => sum + row.volume, 0);
  const volumeEnd = lastWindow.reduce((sum, row) => sum + row.volume, 0);
  const volumeChangePct =
    volumeStart > 0 ? Number((((volumeEnd - volumeStart) / volumeStart) * 100).toFixed(4)) : null;

  const atr = computeAtr(input.candles);
  const moveAbs = Math.abs(allExtremes.mfePct);
  const atrMultiple = atr && entry > 0 ? Number(((moveAbs / 100) * entry / atr).toFixed(4)) : null;

  let relativeStrengthAfter: number | null = null;
  if (input.btcCandles && input.btcCandles.length > 1) {
    const assetReturn = horizonReturns["24h"] ?? 0;
    const btcStart = input.btcCandles[0]!.close;
    const btcEnd = input.btcCandles[input.btcCandles.length - 1]!.close;
    const btcReturn = pctChange(btcStart, btcEnd);
    relativeStrengthAfter = Number((assetReturn - btcReturn).toFixed(4));
  }

  const peakProfitPct = allExtremes.mfePct;
  const maxDrawdownPct = Math.abs(Math.min(0, allExtremes.maePct));

  return {
    mfePct: Number(allExtremes.mfePct.toFixed(4)),
    maePct: Number(allExtremes.maePct.toFixed(4)),
    peakProfitPct: Number(peakProfitPct.toFixed(4)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(4)),
    atrMultiple,
    relativeStrengthAfter,
    volumeChangePct,
    volatilityChangePct:
      firstVol != null && lastVol != null ? Number((lastVol - firstVol).toFixed(4)) : null,
    marketRegimeAfter: input.marketRegimeAfter ?? null,
    highestPrice: allExtremes.highest,
    lowestPrice: allExtremes.lowest,
    horizonReturns,
  };
}
