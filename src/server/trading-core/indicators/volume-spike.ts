import { average } from "@/src/server/trading-core/indicators/math";

export function calculateVolumeSpike(volumes: number[], lookback = 20, threshold = 2) {
  if (volumes.length < lookback + 1) return null;
  const currentVolume = volumes[volumes.length - 1] ?? 0;
  const baseline = volumes.slice(-lookback - 1, -1);
  const averageVolume = average(baseline);
  const ratio = averageVolume > 0 ? currentVolume / averageVolume : 0;

  return {
    ratio: Number(ratio.toFixed(4)),
    isSpike: ratio >= threshold,
    currentVolume,
    averageVolume: Number(averageVolume.toFixed(8)),
  };
}
