export const MARKET_DATA_UNAVAILABLE_CODE = "DATA_UNAVAILABLE" as const;
export const MARKET_DATA_STALE_CODE = "DATA_STALE" as const;
export const MARKET_DATA_NOT_READY_CODE = "DATA_NOT_READY" as const;
export const MARKET_DATA_RATE_BUDGET_CODE = "RATE_BUDGET_EXCEEDED" as const;

export class MarketDataUnavailableError extends Error {
  readonly code: string;
  readonly symbol?: string;
  readonly kind?: string;

  constructor(message: string, input?: { code?: string; symbol?: string; kind?: string }) {
    super(message);
    this.name = "MarketDataUnavailableError";
    this.code = input?.code ?? MARKET_DATA_UNAVAILABLE_CODE;
    this.symbol = input?.symbol;
    this.kind = input?.kind;
  }
}

export function isMarketDataUnavailableError(error: unknown): error is MarketDataUnavailableError {
  return error instanceof MarketDataUnavailableError;
}
