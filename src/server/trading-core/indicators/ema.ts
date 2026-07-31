export function calculateEma(values: number[], period: number) {
  if (values.length === 0 || period <= 0) return null;
  const multiplier = 2 / (period + 1);
  let ema = values[0] ?? 0;
  for (let i = 1; i < values.length; i += 1) {
    ema = (values[i] ?? ema) * multiplier + ema * (1 - multiplier);
  }
  return Number(ema.toFixed(8));
}
