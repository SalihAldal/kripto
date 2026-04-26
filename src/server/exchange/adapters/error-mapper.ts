import type { ExchangeAdapterError, NormalizedOrderStatus } from "@/src/types/exchange-adapter";

const STATUS_MAP: Record<string, NormalizedOrderStatus> = {
  NEW: "NEW",
  PARTIALLY_FILLED: "PARTIALLY_FILLED",
  FILLED: "FILLED",
  CANCELED: "CANCELED",
  CANCELLED: "CANCELED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
  SIMULATED: "SIMULATED",
};

export function normalizeOrderStatus(raw: unknown): NormalizedOrderStatus {
  const value = String(raw ?? "").toUpperCase();
  if (STATUS_MAP[value]) return STATUS_MAP[value];
  if (value.includes("PARTIALLY")) return "PARTIALLY_FILLED";
  if (value.includes("FILLED")) return "FILLED";
  if (value.includes("CANCEL")) return "CANCELED";
  if (value.includes("REJECT")) return "REJECTED";
  if (value.includes("EXPIRE")) return "EXPIRED";
  return "UNKNOWN";
}

export function mapBinanceAdapterError(error: unknown): ExchangeAdapterError {
  const message = (error as Error)?.message ?? "Unknown exchange error";
  const lowered = message.toLowerCase();
  const providerCode = message.match(/code[=:]\s*(-?\d+)/i)?.[1];

  if (providerCode === "-2015" || providerCode === "3701" || lowered.includes("invalid api-key")) {
    return {
      code: "AUTH_INVALID",
      message: "API key/secret dogrulanamadi.",
      retryable: false,
      providerCode,
      providerMessage: message,
      raw: error,
    };
  }
  if (lowered.includes("permission") || lowered.includes("trade izni") || lowered.includes("yetki")) {
    return {
      code: "PERMISSION_DENIED",
      message: "API key gerekli izinlere sahip degil.",
      retryable: false,
      providerCode,
      providerMessage: message,
      raw: error,
    };
  }
  if (providerCode === "3210" || lowered.includes("notional below min")) {
    return {
      code: "MIN_NOTIONAL",
      message: "Emir tutari minimum notional altinda.",
      retryable: false,
      providerCode,
      providerMessage: message,
      raw: error,
    };
  }
  if (lowered.includes("minqty") || lowered.includes("lot_size") || lowered.includes("invalid quantity")) {
    return {
      code: "MIN_QTY",
      message: "Emir miktari minimum miktar veya step-size kurallarina uymuyor.",
      retryable: false,
      providerCode,
      providerMessage: message,
      raw: error,
    };
  }
  if (lowered.includes("symbol not found") || lowered.includes("status") || lowered.includes("halted")) {
    return {
      code: "SYMBOL_HALTED",
      message: "Parite aktif degil veya isleme kapali.",
      retryable: false,
      providerCode,
      providerMessage: message,
      raw: error,
    };
  }
  if (lowered.includes("429") || lowered.includes("too many requests")) {
    return {
      code: "RATE_LIMIT",
      message: "Borsa rate limit tetiklendi.",
      retryable: true,
      providerCode,
      providerMessage: message,
      raw: error,
    };
  }
  if (
    lowered.includes("network") ||
    lowered.includes("econn") ||
    lowered.includes("aborted") ||
    lowered.includes("timed out")
  ) {
    return {
      code: "NETWORK",
      message: "Borsa ag hatasi olustu.",
      retryable: true,
      providerCode,
      providerMessage: message,
      raw: error,
    };
  }
  if (lowered.includes("validation")) {
    return {
      code: "VALIDATION",
      message: "Emir dogrulama hatasi.",
      retryable: false,
      providerCode,
      providerMessage: message,
      raw: error,
    };
  }
  return {
    code: "UNKNOWN",
    message: "Borsa hatasi olustu.",
    retryable: false,
    providerCode,
    providerMessage: message,
    raw: error,
  };
}
