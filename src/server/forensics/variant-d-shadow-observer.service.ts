import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { PositionCloseReason } from "@/src/server/execution/types";

export type VariantDShadowEventType =
  | "VARIANT_D_SHADOW_STARTED"
  | "VARIANT_D_SHADOW_EVALUATED"
  | "VARIANT_D_SHADOW_EXIT_ELIGIBLE"
  | "VARIANT_D_SHADOW_NOT_ELIGIBLE"
  | "VARIANT_D_SHADOW_ERROR"
  | "VARIANT_D_SHADOW_SKIPPED";

export type VariantDShadowReason = PositionCloseReason | "NONE" | "SHADOW_INPUT_MISMATCH" | "POSITION_TERMINAL";

export type VariantDShadowObservationInput = {
  timestamp?: number;
  positionId: string;
  tradeId?: string;
  roundId?: string;
  symbol: string;
  side: "LONG" | "SHORT";
  strategy?: string;
  regime?: string;
  entryTimestamp: string;
  entryPrice: number;
  quantity?: number;
  currentPrice: number;
  maxDurationSec: number;
  baselineExitEligible: boolean;
  baselineReason: VariantDShadowReason;
  currentExitPrecedenceState: string;
  terminalPosition?: boolean;
  variant?: "VARIANT_D";
  baselineInput?: Record<string, unknown>;
  shadowInput?: Record<string, unknown>;
  forceError?: boolean;
};

export type VariantDShadowEvent = {
  eventId: string;
  eventType: VariantDShadowEventType;
  timestamp: string;
  positionId: string;
  tradeId: string;
  roundId: string | null;
  symbol: string;
  variant: "VARIANT_D";
  baselineExitState: {
    eligible: boolean;
    reason: VariantDShadowReason;
  };
  variantDExitState: {
    eligible: boolean;
    reason: VariantDShadowReason;
  };
  currentPrice: number;
  entryPrice: number;
  unrealizedPnL: number;
  strategy: string | null;
  regime: string | null;
  lookaheadViolation: 0 | 1;
  stage: string;
  currentExitPrecedenceState: string;
  holdDurationSec: number;
  positionStateHash: string;
  marketStateHash: string;
  baselineInputHash: string;
  shadowInputHash: string;
  shadowInputMismatch: boolean;
  shadow: true;
  counterfactual: true;
  shadowPnL?: {
    shadowExitTimestamp: string;
    shadowExitPrice: number;
    shadowGrossPnL: number;
    shadowFees: number;
    shadowNetPnL: number;
  } | null;
  error?: {
    errorType: string;
    errorMessage: string;
    stackDigest: string | null;
  };
};

type VariantDShadowMetrics = {
  shadowEvaluationCount: number;
  shadowEvaluationLatencyMs: number[];
  shadowErrors: number;
  shadowTimeouts: number;
  lookaheadViolations: number;
};

const events: VariantDShadowEvent[] = [];
const metrics: VariantDShadowMetrics = {
  shadowEvaluationCount: 0,
  shadowEvaluationLatencyMs: [],
  shadowErrors: 0,
  shadowTimeouts: 0,
  lookaheadViolations: 0,
};

const DEFAULT_TIMEOUT_MS = 30;
const DEFAULT_FEE_RATE = 0.0015;

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);
  return `{${entries.join(",")}}`;
}

function hashOf(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(((pct / 100) * (sorted.length - 1))));
  return Number(sorted[idx].toFixed(3));
}

function digestStack(error: unknown): string | null {
  const stack = (error as Error | undefined)?.stack;
  if (!stack) return null;
  return createHash("sha256").update(stack).digest("hex").slice(0, 24);
}

function createEventId(positionId: string, timestamp: number, suffix: string) {
  return `variant-d-shadow:${positionId}:${timestamp}:${suffix}`;
}

function safeNumber(value: number): number {
  return Number(Number.isFinite(value) ? value.toFixed(8) : 0);
}

function computeGrossPnl(input: { side: "LONG" | "SHORT"; entryPrice: number; exitPrice: number; quantity: number }) {
  if (input.side === "LONG") return (input.exitPrice - input.entryPrice) * input.quantity;
  return (input.entryPrice - input.exitPrice) * input.quantity;
}

async function withTimeout<T>(promiseFactory: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("VARIANT_D_SHADOW_TIMEOUT")), timeoutMs);
  });
  try {
    return await Promise.race([promiseFactory(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function observeVariantDShadow(input: VariantDShadowObservationInput): Promise<void> {
  const startedAt = Date.now();
  const timestampMs = Number.isFinite(input.timestamp) ? Number(input.timestamp) : startedAt;
  const timestampIso = new Date(timestampMs).toISOString();
  const tradeId = input.tradeId ?? input.positionId;
  const roundId = input.roundId ?? null;
  const variant: "VARIANT_D" = input.variant ?? "VARIANT_D";
  const holdDurationSec = Math.max(
    0,
    Number(((timestampMs - Date.parse(input.entryTimestamp)) / 1000).toFixed(3)),
  );
  const quantity = Number.isFinite(Number(input.quantity ?? NaN)) ? Number(input.quantity ?? 0) : 0;
  const unrealizedPnl = safeNumber(
    computeGrossPnl({
      side: input.side,
      entryPrice: input.entryPrice,
      exitPrice: input.currentPrice,
      quantity,
    }),
  );
  const baselineInput =
    input.baselineInput ??
    {
      side: input.side,
      entryPrice: input.entryPrice,
      currentPrice: input.currentPrice,
      holdDurationSec,
      maxDurationSec: input.maxDurationSec,
      baselineReason: input.baselineReason,
      baselineExitEligible: input.baselineExitEligible,
    };
  const shadowInput =
    input.shadowInput ??
    {
      side: input.side,
      entryPrice: input.entryPrice,
      currentPrice: input.currentPrice,
      holdDurationSec,
      maxDurationSec: input.maxDurationSec,
      baselineReason: input.baselineReason,
      baselineExitEligible: input.baselineExitEligible,
    };
  const positionStateHash = hashOf({
    positionId: input.positionId,
    tradeId,
    symbol: input.symbol,
    side: input.side,
    entryTimestamp: input.entryTimestamp,
    entryPrice: input.entryPrice,
    quantity,
    holdDurationSec,
  });
  const marketStateHash = hashOf({
    symbol: input.symbol,
    timestamp: timestampIso,
    currentPrice: input.currentPrice,
  });
  const baselineInputHash = hashOf(baselineInput);
  const shadowInputHash = hashOf(shadowInput);
  const shadowInputMismatch = baselineInputHash !== shadowInputHash;
  const commonEventFields = {
    timestamp: timestampIso,
    positionId: input.positionId,
    tradeId,
    roundId,
    symbol: input.symbol,
    variant,
    baselineExitState: {
      eligible: input.baselineExitEligible,
      reason: input.baselineReason,
    },
    currentPrice: safeNumber(input.currentPrice),
    entryPrice: safeNumber(input.entryPrice),
    unrealizedPnL: unrealizedPnl,
    strategy: input.strategy ?? null,
    regime: input.regime ?? null,
    lookaheadViolation: 0 as const,
    stage: "POSITION_MONITOR",
    currentExitPrecedenceState: input.currentExitPrecedenceState,
    holdDurationSec,
    positionStateHash,
    marketStateHash,
    baselineInputHash,
    shadowInputHash,
    shadowInputMismatch,
    shadow: true as const,
    counterfactual: true as const,
  };

  events.push({
    eventId: createEventId(input.positionId, timestampMs, "started"),
    eventType: "VARIANT_D_SHADOW_STARTED",
    ...commonEventFields,
    variantDExitState: { eligible: false, reason: "NONE" },
    shadowPnL: null,
  });

  if (input.terminalPosition) {
    events.push({
      eventId: createEventId(input.positionId, timestampMs, "skipped-terminal"),
      eventType: "VARIANT_D_SHADOW_SKIPPED",
      ...commonEventFields,
      variantDExitState: { eligible: false, reason: "POSITION_TERMINAL" },
      shadowPnL: null,
    });
    return;
  }

  if (shadowInputMismatch) {
    events.push({
      eventId: createEventId(input.positionId, timestampMs, "skipped-mismatch"),
      eventType: "VARIANT_D_SHADOW_SKIPPED",
      ...commonEventFields,
      variantDExitState: { eligible: false, reason: "SHADOW_INPUT_MISMATCH" },
      shadowPnL: null,
    });
    return;
  }

  try {
    const evaluated = await withTimeout(async () => {
      if (input.forceError) {
        throw new Error("FORCED_VARIANT_D_SHADOW_ERROR");
      }
      const eligible = holdDurationSec >= input.maxDurationSec;
      const reason: VariantDShadowReason = eligible ? "TIMEOUT" : "NONE";
      const shadowGrossPnl = safeNumber(
        computeGrossPnl({
          side: input.side,
          entryPrice: input.entryPrice,
          exitPrice: input.currentPrice,
          quantity,
        }),
      );
      const notional = safeNumber(Math.abs(input.currentPrice * quantity));
      const shadowFees = safeNumber(notional * DEFAULT_FEE_RATE * 2);
      const shadowNetPnl = safeNumber(shadowGrossPnl - shadowFees);
      return {
        eligible,
        reason,
        shadowPnL:
          quantity > 0
            ? {
                shadowExitTimestamp: timestampIso,
                shadowExitPrice: safeNumber(input.currentPrice),
                shadowGrossPnL: shadowGrossPnl,
                shadowFees,
                shadowNetPnL: shadowNetPnl,
              }
            : null,
      };
    }, DEFAULT_TIMEOUT_MS);

    metrics.shadowEvaluationCount += 1;
    metrics.shadowEvaluationLatencyMs.push(Date.now() - startedAt);

    events.push({
      eventId: createEventId(input.positionId, timestampMs, "evaluated"),
      eventType: "VARIANT_D_SHADOW_EVALUATED",
      ...commonEventFields,
      variantDExitState: { eligible: evaluated.eligible, reason: evaluated.reason },
      shadowPnL: evaluated.shadowPnL,
    });
    events.push({
      eventId: createEventId(input.positionId, timestampMs, evaluated.eligible ? "eligible" : "not-eligible"),
      eventType: evaluated.eligible ? "VARIANT_D_SHADOW_EXIT_ELIGIBLE" : "VARIANT_D_SHADOW_NOT_ELIGIBLE",
      ...commonEventFields,
      variantDExitState: { eligible: evaluated.eligible, reason: evaluated.reason },
      shadowPnL: evaluated.shadowPnL,
    });
  } catch (error) {
    const isTimeout = (error as Error)?.message === "VARIANT_D_SHADOW_TIMEOUT";
    metrics.shadowErrors += 1;
    if (isTimeout) metrics.shadowTimeouts += 1;
    events.push({
      eventId: createEventId(input.positionId, timestampMs, "error"),
      eventType: "VARIANT_D_SHADOW_ERROR",
      ...commonEventFields,
      variantDExitState: { eligible: false, reason: "NONE" },
      shadowPnL: null,
      error: {
        errorType: isTimeout ? "TIMEOUT" : (error as Error)?.name ?? "Error",
        errorMessage: (error as Error)?.message ?? "Unknown variant-d shadow error",
        stackDigest: digestStack(error),
      },
    });
  }
}

export function observeVariantDShadowNonBlocking(input: VariantDShadowObservationInput): void {
  void observeVariantDShadow(input).catch((error) => {
    metrics.shadowErrors += 1;
    events.push({
      eventId: createEventId(input.positionId, Date.now(), "error-nonblocking"),
      eventType: "VARIANT_D_SHADOW_ERROR",
      timestamp: new Date().toISOString(),
      positionId: input.positionId,
      tradeId: input.tradeId ?? input.positionId,
      roundId: input.roundId ?? null,
      symbol: input.symbol,
      variant: "VARIANT_D",
      baselineExitState: { eligible: input.baselineExitEligible, reason: input.baselineReason },
      variantDExitState: { eligible: false, reason: "NONE" },
      currentPrice: safeNumber(input.currentPrice),
      entryPrice: safeNumber(input.entryPrice),
      unrealizedPnL: 0,
      strategy: input.strategy ?? null,
      regime: input.regime ?? null,
      lookaheadViolation: 0,
      stage: "POSITION_MONITOR",
      currentExitPrecedenceState: input.currentExitPrecedenceState,
      holdDurationSec: 0,
      positionStateHash: hashOf({ positionId: input.positionId }),
      marketStateHash: hashOf({ symbol: input.symbol }),
      baselineInputHash: hashOf(input.baselineInput ?? {}),
      shadowInputHash: hashOf(input.shadowInput ?? {}),
      shadowInputMismatch: false,
      shadow: true,
      counterfactual: true,
      shadowPnL: null,
      error: {
        errorType: (error as Error)?.name ?? "Error",
        errorMessage: (error as Error)?.message ?? "Unknown observer error",
        stackDigest: digestStack(error),
      },
    });
  });
}

export function resetVariantDShadowObserverState() {
  events.length = 0;
  metrics.shadowEvaluationCount = 0;
  metrics.shadowEvaluationLatencyMs.length = 0;
  metrics.shadowErrors = 0;
  metrics.shadowTimeouts = 0;
  metrics.lookaheadViolations = 0;
}

export function getVariantDShadowEvents(): VariantDShadowEvent[] {
  return [...events];
}

export function getVariantDShadowMetrics() {
  return {
    shadowEvaluationCount: metrics.shadowEvaluationCount,
    shadowErrors: metrics.shadowErrors,
    shadowTimeouts: metrics.shadowTimeouts,
    lookaheadViolations: metrics.lookaheadViolations,
    shadowEvaluationLatencyP50: percentile(metrics.shadowEvaluationLatencyMs, 50),
    shadowEvaluationLatencyP95: percentile(metrics.shadowEvaluationLatencyMs, 95),
    shadowEvaluationLatencyP99: percentile(metrics.shadowEvaluationLatencyMs, 99),
  };
}

export function exportVariantDShadowEvents(filePath = path.join(process.cwd(), "variant-d-live-shadow-events.json")) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    metrics: getVariantDShadowMetrics(),
    events: getVariantDShadowEvents(),
  };
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}
