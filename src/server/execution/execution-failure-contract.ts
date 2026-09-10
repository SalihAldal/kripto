export const EXECUTION_FAILURE_DOMAINS = [
  "MARKET_DATA",
  "EXCHANGE_INFO",
  "SYMBOL_FILTER",
  "PRICE",
  "ORDER_BOOK",
  "BALANCE",
  "DATABASE",
  "REDIS",
  "CLOCK_SYNC",
  "AI_PROVIDER",
  "PAPER_EXECUTION",
  "LIVE_EXECUTION",
  "SAFE_MODE",
  "EXECUTION",
  "UNKNOWN",
] as const;

export type ExecutionFailureDomain = (typeof EXECUTION_FAILURE_DOMAINS)[number];
export type ExecutionBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export type CanonicalExecutionFailure = {
  failureDomain: ExecutionFailureDomain;
  failureCode: string;
  operation: string;
  dependency: string;
  statusCode: number | null;
  retryable: boolean;
  breakerEligible: boolean;
  breakerState: ExecutionBreakerState;
  openUntil: string | null;
  originalErrorClass: string;
  safeMessage: string;
};

export type ExecutionFailureContext = {
  operation?: string;
  dependency?: string;
  venue?: string;
  executionMode?: "paper" | "live" | "dry-run";
  domainHint?: ExecutionFailureDomain;
  breakerState?: ExecutionBreakerState;
  openUntil?: string | null;
  appErrorCode?: string;
};

export class CanonicalExecutionError extends Error {
  readonly failure: CanonicalExecutionFailure;

  constructor(failure: CanonicalExecutionFailure, options?: { cause?: unknown }) {
    super(formatCanonicalExecutionReason(failure), options);
    this.name = "CanonicalExecutionError";
    this.failure = failure;
  }
}

const SECRET_PATTERNS = [
  /((?:api[-_ ]?key|secret|token|password|authorization)\s*[:=]\s*)[^\s,;]+/gi,
  /\b(?:sk|pk)_(?:live|test)_[a-z0-9_-]+\b/gi,
  /\bBearer\s+[a-z0-9._~+/-]+=*\b/gi,
];

export function redactExecutionError(value: unknown): string {
  let message = String((value as Error)?.message ?? value ?? "UNKNOWN_ERROR");
  for (const pattern of SECRET_PATTERNS) {
    message = message.replace(pattern, (_match, prefix?: unknown) =>
      typeof prefix === "string" ? `${prefix}[REDACTED]` : "[REDACTED]",
    );
  }
  return message.slice(0, 500);
}

function parseStatusCode(message: string): number | null {
  const match = message.match(/\b(?:http|status(?:code)?)?[\s:=_-]*(418|429|[45]\d{2})\b/i);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeOperation(operation?: string) {
  return String(operation ?? "unknown").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_") || "unknown";
}

function normalizeDependency(dependency?: string) {
  return String(dependency ?? "unknown").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_") || "unknown";
}

function inferDomain(message: string, context: ExecutionFailureContext): ExecutionFailureDomain {
  if (context.domainHint) return context.domainHint;
  const haystack = `${message} ${context.operation ?? ""} ${context.dependency ?? ""}`.toLowerCase();
  if (/p1001|p1002|prisma|postgres|database|sqlstate/.test(haystack)) return "DATABASE";
  if (/redis|ioredis/.test(haystack)) return "REDIS";
  if (/openai|anthropic|gemini|ai provider|technical_specialist|momentum_specialist|risk_specialist/.test(haystack)) {
    return "AI_PROVIDER";
  }
  if (/clock|server time|timestamp skew|recvwindow/.test(haystack)) return "CLOCK_SYNC";
  if (/exchangeinfo|open symbols|symbol metadata/.test(haystack)) return "EXCHANGE_INFO";
  if (/lot_size|min_notional|step size|tick size|symbol filter|invalid symbol|venue_mismatch/.test(haystack)) {
    return "SYMBOL_FILTER";
  }
  if (/orderbook|order book|depth|liquidity/.test(haystack)) return "ORDER_BOOK";
  if (/ticker|kline|market data|websocket|ws stale/.test(haystack)) return "MARKET_DATA";
  if (/price|quote unavailable/.test(haystack)) return "PRICE";
  if (/balance|account permission|account readiness/.test(haystack)) return "BALANCE";
  if (context.executionMode === "paper" || /paper|simulation|simulated/.test(haystack)) return "PAPER_EXECUTION";
  if (context.executionMode === "live" || /placeorder|order submit|live execution|exchange confirmation/.test(haystack)) {
    return "LIVE_EXECUTION";
  }
  return "UNKNOWN";
}

function isValidationReject(message: string, statusCode: number | null) {
  return (
    /validation|invalid quantity|invalid symbol|lot_size|min_notional|step size|tick size|venue_mismatch|insufficient paper balance|risk gate|not executable/i.test(
      message,
    ) ||
    (statusCode != null && statusCode >= 400 && statusCode < 500 && statusCode !== 418 && statusCode !== 429)
  );
}

function resolveFailureCode(input: {
  message: string;
  domain: ExecutionFailureDomain;
  statusCode: number | null;
  timeout: boolean;
  network: boolean;
  validationReject: boolean;
}) {
  if (input.statusCode === 429) return "RATE_LIMIT_429";
  if (input.statusCode === 418) return "IP_BAN_418";
  if (input.statusCode != null && input.statusCode >= 500) return `UPSTREAM_${input.statusCode}`;
  if (input.validationReject) return "VALIDATION_REJECT";
  if (input.timeout) return "TIMEOUT";
  if (input.network) return "NETWORK_FAILURE";
  if (/circuit is open|circuit_open/i.test(input.message)) return "CIRCUIT_OPEN";
  if (/paper_execution_data_stale/i.test(input.message)) return "PAPER_DATA_STALE";
  if (/duplicate|idempot/i.test(input.message)) return "DUPLICATE_ORDER";
  return `${input.domain}_FAILURE`;
}

export function classifyExecutionFailure(
  error: unknown,
  context: ExecutionFailureContext = {},
): CanonicalExecutionFailure {
  const safeMessage = redactExecutionError(error);
  const statusCode = parseStatusCode(safeMessage);
  const timeout = /timeout|timed out|etimedout|abort/i.test(safeMessage);
  const network = /econn|enotfound|socket|network|fetch failed/i.test(safeMessage);
  const domain = inferDomain(safeMessage, context);
  const validationReject = isValidationReject(safeMessage, statusCode);
  const retryable =
    !validationReject &&
    (timeout || network || statusCode === 418 || statusCode === 429 || (statusCode != null && statusCode >= 500));
  const breakerEligible = retryable && domain !== "UNKNOWN";
  return {
    failureDomain: domain,
    failureCode: resolveFailureCode({
      message: safeMessage,
      domain,
      statusCode,
      timeout,
      network,
      validationReject,
    }),
    operation: normalizeOperation(context.operation),
    dependency: normalizeDependency(context.dependency),
    statusCode,
    retryable,
    breakerEligible,
    breakerState: context.breakerState ?? "CLOSED",
    openUntil: context.openUntil ?? null,
    originalErrorClass:
      error && typeof error === "object" && "constructor" in error
        ? String((error as { constructor?: { name?: string } }).constructor?.name ?? "Error")
        : "Error",
    safeMessage,
  };
}

export function preserveExecutionFailure(
  error: unknown,
  context: ExecutionFailureContext = {},
): CanonicalExecutionError {
  if (error instanceof CanonicalExecutionError) return error;
  return new CanonicalExecutionError(classifyExecutionFailure(error, context), { cause: error });
}

export function resolveExecutionFailure(
  error: unknown,
  fallbackContext: ExecutionFailureContext = {},
): CanonicalExecutionFailure {
  if (error instanceof CanonicalExecutionError) return error.failure;
  if (
    error &&
    typeof error === "object" &&
    "failure" in error &&
    (error as { failure?: unknown }).failure &&
    typeof (error as { failure: unknown }).failure === "object"
  ) {
    return (error as { failure: CanonicalExecutionFailure }).failure;
  }
  return classifyExecutionFailure(error, fallbackContext);
}

export function buildExecutionBreakerKey(input: {
  failureDomain: ExecutionFailureDomain;
  operation: string;
  dependency: string;
  venue?: string;
}) {
  const venue = normalizeDependency(input.venue ?? "default");
  return [
    input.failureDomain,
    normalizeOperation(input.operation),
    normalizeDependency(input.dependency),
    venue,
  ].join(":");
}

export function formatCanonicalExecutionReason(failure: CanonicalExecutionFailure) {
  return `${failure.failureDomain}:${failure.failureCode}`;
}

export function normalizeExecutionTerminalReason(input: {
  rejectReason?: string;
  details?: Record<string, unknown> | null;
  fallback?: string;
}) {
  const details = input.details ?? {};
  const failureDomain = String(details.failureDomain ?? "").trim().toUpperCase();
  const failureCode = String(details.failureCode ?? "").trim().toUpperCase();
  if (failureDomain && failureCode) return `${failureDomain}:${failureCode}`;
  const base = String(input.rejectReason ?? input.fallback ?? "UNKNOWN:EXECUTION_REJECTED").trim();
  if (/^SAFE_MODE:[A-Z0-9_]+$/.test(base)) return base;
  if (/^EXECUTION:API_FAILURE_BREAKER_OPEN$/.test(base)) return base;
  const lower = base.toLowerCase();
  if (lower.includes("safe mode")) return "SAFE_MODE:SAFE_MODE_ACTIVE";
  const generic = new Set([
    "unknown execution failure",
    "execution failed",
    "pre-check failed",
  ]);
  if (lower === "binance api failure breaker") return "SAFE_MODE:SAFE_MODE_STALE_REASON";
  if (generic.has(lower)) return "UNKNOWN:GENERIC_TERMINAL_REASON_DETAIL_MISSING";
  if (/^(AI_NO_TRADE|LEARNING_LANE_HARD_REJECT|LOW_CONFIDENCE):/.test(base)) {
    return `STRATEGY:${redactExecutionError(base)}`;
  }
  if (/^[A-Z][A-Z0-9_]*:[A-Z0-9_]+/.test(base)) return base;
  if (!base) return "UNKNOWN:EXECUTION_REJECTED";
  const inferred = classifyExecutionFailure(base);
  if (inferred.failureDomain !== "UNKNOWN" || inferred.failureCode !== "UNKNOWN_FAILURE") {
    return `${formatCanonicalExecutionReason(inferred)} ${inferred.safeMessage}`;
  }
  return `UNKNOWN:UNCLASSIFIED_TERMINAL_REASON ${redactExecutionError(base)}`;
}
