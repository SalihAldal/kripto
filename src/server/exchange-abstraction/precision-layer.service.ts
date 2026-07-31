import type { PrecisionRules } from "@/src/server/exchange-abstraction/exchange-abstraction.types";

function countPrecision(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 8;
  const text = step.toString();
  if (!text.includes(".")) return 0;
  return text.split(".")[1]?.replace(/0+$/, "").length ?? 0;
}

function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.floor(value / step) * step;
}

export function buildPrecisionRules(input: {
  canonicalSymbol: string;
  tickSize: number;
  stepSize: number;
  minNotional: number;
  minQty: number;
  maxQty?: number;
}): PrecisionRules {
  return {
    canonicalSymbol: input.canonicalSymbol,
    pricePrecision: countPrecision(input.tickSize),
    quantityPrecision: countPrecision(input.stepSize),
    tickSize: input.tickSize,
    stepSize: input.stepSize,
    minNotional: input.minNotional,
    minQty: input.minQty,
    maxQty: input.maxQty,
  };
}

export function normalizePrice(price: number, rules: PrecisionRules): number {
  const normalized = roundToStep(price, rules.tickSize);
  return Number(normalized.toFixed(rules.pricePrecision));
}

export function normalizeQuantity(quantity: number, rules: PrecisionRules): number {
  const normalized = roundToStep(quantity, rules.stepSize);
  return Number(normalized.toFixed(rules.quantityPrecision));
}

export function validateOrderPrecision(
  quantity: number,
  price: number | undefined,
  rules: PrecisionRules,
): { valid: boolean; reasons: string[]; normalizedQuantity: number; normalizedPrice?: number } {
  const reasons: string[] = [];
  const normalizedQuantity = normalizeQuantity(quantity, rules);
  const normalizedPrice = price !== undefined ? normalizePrice(price, rules) : undefined;

  if (normalizedQuantity < rules.minQty) reasons.push(`Quantity ${normalizedQuantity} below minQty ${rules.minQty}`);
  if (rules.maxQty && normalizedQuantity > rules.maxQty) reasons.push(`Quantity exceeds maxQty ${rules.maxQty}`);

  const notional = normalizedPrice ? normalizedQuantity * normalizedPrice : 0;
  if (normalizedPrice && notional < rules.minNotional) {
    reasons.push(`Notional ${notional} below minNotional ${rules.minNotional}`);
  }

  return { valid: reasons.length === 0, reasons, normalizedQuantity, normalizedPrice };
}
