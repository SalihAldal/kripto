import { createHash } from "node:crypto";

export type CanonicalFillIdentityInput = {
  venue: string;
  exchangeConnectionId: string;
  symbol: string;
  exchangeOrderId: string;
  exchangeTradeId: string;
};

function normalize(value: string) {
  return value.trim();
}

const INVALID_LITERAL_IDS = new Set(["undefined", "null"]);

export function isValidExchangeTradeId(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "number" && Number.isFinite(value)) return true;
  if (typeof value === "bigint") return true;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && !INVALID_LITERAL_IDS.has(trimmed.toLowerCase());
}

export function resolveExchangeTradeIdFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
  fieldPriority: Array<"exchangeTradeId" | "fillId" | "tradeId" | "simulationId"> = [
    "exchangeTradeId",
    "fillId",
    "tradeId",
    "simulationId",
  ],
): string | null {
  if (!metadata) return null;
  for (const field of fieldPriority) {
    const raw = metadata[field];
    if (!isValidExchangeTradeId(raw)) continue;
    return String(raw).trim();
  }
  return null;
}

export function resolveCanonicalFillIdentity(input: {
  venue: string;
  exchangeConnectionId: string;
  symbol: string;
  exchangeOrderId: string;
  metadata?: Record<string, unknown> | null;
  exchangeTradeId?: string | null;
}): { exchangeTradeId: string; settlementFillId: string } | null {
  const exchangeOrderId = input.exchangeOrderId.trim();
  if (!exchangeOrderId) return null;
  const exchangeTradeId =
    input.exchangeTradeId && isValidExchangeTradeId(input.exchangeTradeId)
      ? String(input.exchangeTradeId).trim()
      : resolveExchangeTradeIdFromMetadata(input.metadata ?? null);
  if (!exchangeTradeId) return null;
  return {
    exchangeTradeId,
    settlementFillId: buildCanonicalSettlementFillId({
      venue: input.venue,
      exchangeConnectionId: input.exchangeConnectionId,
      symbol: input.symbol,
      exchangeOrderId,
      exchangeTradeId,
    }),
  };
}

export function buildCanonicalSettlementFillId(input: CanonicalFillIdentityInput) {
  return createHash("sha256")
    .update(
      [
        "fill-v2",
        normalize(input.venue),
        normalize(input.exchangeConnectionId),
        normalize(input.symbol),
        normalize(input.exchangeOrderId),
        normalize(input.exchangeTradeId),
      ].join(":"),
    )
    .digest("hex")
    .slice(0, 40);
}

