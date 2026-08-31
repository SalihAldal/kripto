/** Outlier-safe signed map into [-100, +100]. */
export function signedScore(value: number, scale: number): number {
  if (!Number.isFinite(value) || scale <= 0) return 0;
  return Number(((100 * value) / (scale + Math.abs(value))).toFixed(4));
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export function nz(value: number | null | undefined): number {
  return Number.isFinite(value as number) ? Number(value) : 0;
}
