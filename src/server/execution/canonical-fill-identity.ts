import { createHash } from "node:crypto";

export type CanonicalFillIdentityInput = {
  venue: string;
  exchangeConnectionId: string;
  symbol: string;
  exchangeOrderId: string;
  exchangeTradeId: string;
};

function normalize(value: string) {
  return value.trim().toUpperCase();
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

