import { env } from "@/lib/config";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function resolveSmartTakeProfitPercent(input: {
  baseTpPercent: number;
  volatilityPercent: number;
  confidencePercent: number;
  expectedProfitPercent?: number;
}) {
  if (!env.EXECUTION_SMART_TP_ENABLED) {
    return Number(Math.max(0.1, input.baseTpPercent).toFixed(4));
  }
  const volatilityBoost = clamp(input.volatilityPercent * env.EXECUTION_SMART_TP_VOL_MULTIPLIER, -0.4, 1.8);
  const confidenceBoost = clamp((input.confidencePercent - 70) * 0.02, -0.4, 0.8);
  const expectedBase = Number.isFinite(input.expectedProfitPercent ?? NaN) ? Number(input.expectedProfitPercent ?? 0) : input.baseTpPercent;
  const blended = expectedBase * 0.55 + input.baseTpPercent * 0.45;
  const smart = blended + volatilityBoost + confidenceBoost;
  return Number(clamp(smart, 0.25, env.EXECUTION_TARGET_MAX_PROFIT_PERCENT).toFixed(4));
}

export function resolvePartialTakeProfitPlan(input: {
  takeProfitPercent: number;
  stopLossPercent: number;
}) {
  if (!env.EXECUTION_PARTIAL_TP_ENABLED) {
    return {
      enabled: false,
      firstTargetPercent: 0,
      trailingDrawdownPercent: env.EXECUTION_TRAILING_DRAWDOWN_PERCENT,
    };
  }
  const firstTargetPercent = clamp(
    Math.min(input.takeProfitPercent * 0.65, env.EXECUTION_PARTIAL_TP_FIRST_TARGET_PERCENT),
    0.25,
    Math.max(0.3, input.takeProfitPercent - 0.2),
  );
  // Kademeli kar alma opsiyonu: ilk hedefte daha sıkı trailing ile kazanimi koru.
  const trailingDrawdownPercent = clamp(
    Math.min(env.EXECUTION_TRAILING_DRAWDOWN_PERCENT, env.EXECUTION_PARTIAL_TP_TRAIL_DRAWDOWN_PERCENT),
    0.1,
    1,
  );
  return {
    enabled: true,
    firstTargetPercent: Number(firstTargetPercent.toFixed(4)),
    trailingDrawdownPercent: Number(trailingDrawdownPercent.toFixed(4)),
  };
}
