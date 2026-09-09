import { buildCanonicalSettlementFillId } from "@/src/server/execution/canonical-fill-identity";

export const TDC_IDEMPOTENCY_PREFIX = "tdc" as const;

export function buildSignalIdempotencyKey(signalId: string) {
  return `${TDC_IDEMPOTENCY_PREFIX}:signal:${signalId.trim()}`;
}

export function buildEntryOrderIdempotencyKey(input: {
  mode: string;
  symbol: string;
  signalId: string | null | undefined;
  fallbackKey: string;
}) {
  const signalId = typeof input.signalId === "string" ? input.signalId.trim() : "";
  if (signalId) return buildSignalIdempotencyKey(signalId);
  return input.fallbackKey;
}

export function buildExitIntentIdempotencyKey(activeExitIntentId: string) {
  return `${TDC_IDEMPOTENCY_PREFIX}:exit:${activeExitIntentId.trim()}`;
}

export function buildFillIdempotencyKey(settlementFillId: string) {
  return `${TDC_IDEMPOTENCY_PREFIX}:fill:${settlementFillId.trim()}`;
}

export function buildFillIdempotencyKeyFromExchange(input: {
  venue: string;
  exchangeConnectionId: string;
  symbol: string;
  exchangeOrderId: string;
  exchangeTradeId: string;
}) {
  return buildFillIdempotencyKey(
    buildCanonicalSettlementFillId({
      venue: input.venue,
      exchangeConnectionId: input.exchangeConnectionId,
      symbol: input.symbol,
      exchangeOrderId: input.exchangeOrderId,
      exchangeTradeId: input.exchangeTradeId,
    }),
  );
}
