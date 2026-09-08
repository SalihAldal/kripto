import type { DataAvailabilityState, DataKind } from "./types";

export function resolveDataState(input: {
  required: boolean;
  available: boolean;
  stale?: boolean;
  degraded?: boolean;
}): DataAvailabilityState {
  if (!input.required) return "AVAILABLE";
  if (!input.available) return "UNAVAILABLE";
  if (input.stale) return "STALE";
  if (input.degraded) return "DEGRADED";
  return "AVAILABLE";
}

export function allRequiredAvailable(
  states: Record<DataKind, DataAvailabilityState>,
  required: DataKind[],
): boolean {
  return required.every((kind) => states[kind] === "AVAILABLE" || states[kind] === "DEGRADED");
}

export function emptyDataStates(): Record<DataKind, DataAvailabilityState> {
  return {
    OHLCV: "UNAVAILABLE",
    FUNDING: "UNAVAILABLE",
    BASIS: "UNAVAILABLE",
    OPEN_INTEREST: "UNAVAILABLE",
    TAKER_FLOW: "UNAVAILABLE",
    AGG_TRADES: "UNAVAILABLE",
    ORDER_BOOK: "UNAVAILABLE",
    LIQUIDATION: "UNAVAILABLE",
    MARK_PRICE: "UNAVAILABLE",
    INDEX_PRICE: "UNAVAILABLE",
    BTC_CONTEXT: "UNAVAILABLE",
    CROSS_SECTIONAL: "UNAVAILABLE",
  };
}
