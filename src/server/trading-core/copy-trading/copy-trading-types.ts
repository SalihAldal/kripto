import type { SmartOrderPlan, SmartOrderSide, SmartOrderType } from "@/src/server/trading-core/smart-execution/execution-types";

export type CopyTradeStatus = "ACTIVE" | "PAUSED" | "DISABLED";

export type CopyTradeMaster = {
  masterId: string;
  userId: string;
  displayName: string;
  status: CopyTradeStatus;
  defaultRiskMultiplier: number;
  createdAt: string;
  updatedAt: string;
};

export type CopyTradeFollower = {
  followerId: string;
  userId: string;
  masterId: string;
  accountId?: string;
  status: CopyTradeStatus;
  allocationPercent: number;
  riskMultiplier: number;
  maxSlippageBps: number;
  maxDelayMs: number;
  maxLeverage: number;
  partialCopyMinPercent: number;
  copyReduceOnly: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MasterTradeSignal = {
  signalId: string;
  masterId: string;
  symbol: string;
  side: SmartOrderSide;
  type: SmartOrderType;
  quantity: number;
  price?: number;
  leverage?: number;
  reduceOnly?: boolean;
  filledQuantity?: number;
  sourceCreatedAt: string;
  receivedAt?: string;
  metadata?: Record<string, unknown>;
};

export type CopyTradeIntent = {
  followerId: string;
  userId: string;
  masterSignalId: string;
  symbol: string;
  side: SmartOrderSide;
  type: SmartOrderType;
  quantity: number;
  price?: number;
  leverage: number;
  maxSlippageBps: number;
  reduceOnly?: boolean;
  reason: string;
};

export type CopyTradeResult = {
  followerId: string;
  userId: string;
  copied: boolean;
  skippedReason?: string;
  intent?: CopyTradeIntent;
  plan?: SmartOrderPlan;
  latencyMs: number;
  createdAt: string;
};
