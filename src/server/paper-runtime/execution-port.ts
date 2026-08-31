import { executePaperOrderViaExchangeSimulator } from "@/src/server/exchange-simulator/paper-exchange-adapter.service";

export type ExecutionPortOrderInput = {
  userId: string;
  executionId: string;
  executionIntentId: string;
  candidateId: string;
  lane: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  quoteOrderQty?: number;
  priceHint: number;
  quoteAsset: string;
  baseAsset: string;
  bidDepth?: number;
  askDepth?: number;
  spreadPercent?: number;
  atr?: number;
  volatilityPercent?: number;
  volumeQuote?: number;
  aggressiveBuyPct?: number;
  aggressiveSellPct?: number;
  marketDataVenue?: string;
  executionVenue?: string;
  riskDecisionId?: string;
  decisionAt?: string;
  riskAllowedAt?: string;
  configHash?: string;
};

export type ExecutionPortOrderState = "CREATED" | "SUBMITTED" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED" | "UNKNOWN";

export type ExecutionPortOrderResult = {
  orderId: string;
  state: ExecutionPortOrderState;
  executedQty: number;
  avgFillPrice: number;
  fee: number;
  metadata?: Record<string, unknown>;
};

export type ExecutionPort = {
  kind: "PAPER" | "LIVE";
  submitEntry(intent: ExecutionPortOrderInput): Promise<ExecutionPortOrderResult>;
  submitExit(intent: ExecutionPortOrderInput): Promise<ExecutionPortOrderResult>;
  cancelOrder(input: { orderId: string; reason?: string }): Promise<{ ok: boolean }>;
  getOrderState(input: { orderId: string }): Promise<{ state: ExecutionPortOrderState; metadata?: Record<string, unknown> }>;
  reconcile(input?: { symbol?: string }): Promise<{ ok: boolean; details?: Record<string, unknown> }>;
};

function mapOrderState(status: string): ExecutionPortOrderState {
  const upper = String(status).toUpperCase();
  if (upper.includes("PARTIALLY")) return "PARTIALLY_FILLED";
  if (upper.includes("FILLED") || upper.includes("SIMULATED")) return "FILLED";
  if (upper.includes("CANCELED")) return "CANCELED";
  if (upper.includes("EXPIRED")) return "EXPIRED";
  if (upper.includes("REJECT")) return "REJECTED";
  if (upper.includes("SUBMIT")) return "SUBMITTED";
  return "UNKNOWN";
}

export class CanonicalPaperExecutionAdapter implements ExecutionPort {
  readonly kind = "PAPER" as const;

  async submitEntry(intent: ExecutionPortOrderInput): Promise<ExecutionPortOrderResult> {
    const result = await executePaperOrderViaExchangeSimulator(intent);
    return {
      orderId: result.orderId,
      state: mapOrderState(result.status),
      executedQty: Number(result.executedQty ?? 0),
      avgFillPrice: Number(result.price ?? 0),
      fee: Number(result.fee ?? 0),
      metadata: result.metadata as Record<string, unknown> | undefined,
    };
  }

  async submitExit(intent: ExecutionPortOrderInput): Promise<ExecutionPortOrderResult> {
    const result = await executePaperOrderViaExchangeSimulator(intent);
    return {
      orderId: result.orderId,
      state: mapOrderState(result.status),
      executedQty: Number(result.executedQty ?? 0),
      avgFillPrice: Number(result.price ?? 0),
      fee: Number(result.fee ?? 0),
      metadata: result.metadata as Record<string, unknown> | undefined,
    };
  }

  async cancelOrder(_input: { orderId: string; reason?: string }) {
    return { ok: true };
  }

  async getOrderState(_input: { orderId: string }) {
    return { state: "UNKNOWN" as const };
  }

  async reconcile(_input?: { symbol?: string }) {
    return { ok: true };
  }
}

export class BinanceLiveExecutionAdapter implements ExecutionPort {
  readonly kind = "LIVE" as const;
  async submitEntry(_intent: ExecutionPortOrderInput): Promise<ExecutionPortOrderResult> {
    throw new Error("LIVE_ADAPTER_HARD_LOCKED");
  }
  async submitExit(_intent: ExecutionPortOrderInput): Promise<ExecutionPortOrderResult> {
    throw new Error("LIVE_ADAPTER_HARD_LOCKED");
  }
  async cancelOrder(_input: { orderId: string; reason?: string }): Promise<{ ok: boolean }> {
    throw new Error("LIVE_ADAPTER_HARD_LOCKED");
  }
  async getOrderState(_input: { orderId: string }): Promise<{ state: ExecutionPortOrderState; metadata?: Record<string, unknown> }> {
    throw new Error("LIVE_ADAPTER_HARD_LOCKED");
  }
  async reconcile(_input?: { symbol?: string }): Promise<{ ok: boolean; details?: Record<string, unknown> }> {
    throw new Error("LIVE_ADAPTER_HARD_LOCKED");
  }
}

export function resolveExecutionAdapter(mode: string): ExecutionPort {
  if (mode === "live") return new BinanceLiveExecutionAdapter();
  return new CanonicalPaperExecutionAdapter();
}
