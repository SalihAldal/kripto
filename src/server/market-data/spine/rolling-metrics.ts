import type { RollingMetrics } from "@/src/server/market-data/spine/events";
import { ROLLING_WINDOW_MS } from "@/src/server/market-data/spine/events";
import type { BoundedRingBuffer } from "@/src/server/market-data/spine/ring-buffer";

function pctReturn(nowPrice: number, thenPrice: number | null) {
  if (!thenPrice || thenPrice <= 0 || !Number.isFinite(nowPrice) || nowPrice <= 0) return null;
  return Number((((nowPrice - thenPrice) / thenPrice) * 100).toFixed(6));
}

export function computeRollingMetrics(buffer: BoundedRingBuffer, now = Date.now()): RollingMetrics {
  const latest = buffer.latest();
  if (!latest) {
    return {
      return1s: null,
      return5s: null,
      return15s: null,
      return30s: null,
      return1m: null,
      return3m: null,
      return5m: null,
      return15m: null,
      volumeDelta: null,
      quoteVolumeDelta: null,
    };
  }

  const priceNow = latest.price;
  const oneMinuteAgo = buffer.sampleAtOrBefore(now - ROLLING_WINDOW_MS["1m"]);
  return {
    return1s: pctReturn(priceNow, buffer.priceAtOrBefore(now - ROLLING_WINDOW_MS["1s"])),
    return5s: pctReturn(priceNow, buffer.priceAtOrBefore(now - ROLLING_WINDOW_MS["5s"])),
    return15s: pctReturn(priceNow, buffer.priceAtOrBefore(now - ROLLING_WINDOW_MS["15s"])),
    return30s: pctReturn(priceNow, buffer.priceAtOrBefore(now - ROLLING_WINDOW_MS["30s"])),
    return1m: pctReturn(priceNow, buffer.priceAtOrBefore(now - ROLLING_WINDOW_MS["1m"])),
    return3m: pctReturn(priceNow, buffer.priceAtOrBefore(now - ROLLING_WINDOW_MS["3m"])),
    return5m: pctReturn(priceNow, buffer.priceAtOrBefore(now - ROLLING_WINDOW_MS["5m"])),
    return15m: pctReturn(priceNow, buffer.priceAtOrBefore(now - ROLLING_WINDOW_MS["15m"])),
    volumeDelta:
      oneMinuteAgo && Number.isFinite(latest.baseVolume) && Number.isFinite(oneMinuteAgo.baseVolume)
        ? Number((latest.baseVolume - oneMinuteAgo.baseVolume).toFixed(8))
        : null,
    quoteVolumeDelta:
      oneMinuteAgo && Number.isFinite(latest.quoteVolume) && Number.isFinite(oneMinuteAgo.quoteVolume)
        ? Number((latest.quoteVolume - oneMinuteAgo.quoteVolume).toFixed(4))
        : null,
  };
}
