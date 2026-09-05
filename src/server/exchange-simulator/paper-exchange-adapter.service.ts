import { AppSettingScope, ConfigStatus, Prisma } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";
import type { PlaceOrderResult } from "@/src/types/exchange";
import { getPaperAccount } from "@/src/server/simulation/paper-trading.service";
import { simulateMarketExecution } from "@/src/server/exchange-simulator/exchange-simulator.service";
import { emitExchangeSimulatorEvent } from "@/src/server/exchange-simulator/exchange-simulator.events";
import { bridgePaperFill } from "@/src/server/forensics/forensic-bridge.service";
import { resolveCanonicalVenueConfig } from "@/src/server/exchange/venue-config.service";

type PaperSimulatorOrderInput = {
  userId: string;
  campaignId?: string;
  jobId?: string;
  sessionId?: string;
  runId?: string;
  roundId?: string;
  executionId?: string;
  lane?: string;
  executionVenue?: string;
  riskDecisionId?: string;
  decisionAt?: string;
  riskAllowedAt?: string;
  configHash?: string;
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
  candidateId?: string;
  executionIntentId?: string;
  marketDataVenue?: string;
};

const PAPER_SETTING_PREFIX = "paper.account.";

function normalizeAsset(asset: string) {
  return asset.trim().toUpperCase();
}

function safeNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

async function writePaperBalances(userId: string, balances: Record<string, number>) {
  const key = `${PAPER_SETTING_PREFIX}${userId}`;
  const updatedAt = new Date().toISOString();
  await prisma.appSetting.upsert({
    where: { key },
    create: {
      key,
      scope: AppSettingScope.USER,
      userId,
      valueType: "json",
      status: ConfigStatus.ACTIVE,
      description: "Paper trading virtual account",
      value: { balances, updatedAt } as Prisma.InputJsonValue,
    },
    update: {
      value: { balances, updatedAt } as Prisma.InputJsonValue,
      status: ConfigStatus.ACTIVE,
    },
  });
  return updatedAt;
}

function requireBalance(balances: Record<string, number>, asset: string, required: number) {
  const free = safeNumber(balances[normalizeAsset(asset)], 0);
  if (free + 1e-8 < required) {
    throw new Error(`Paper balance insufficient: ${asset} (required=${required.toFixed(8)}, available=${free.toFixed(8)})`);
  }
}

export async function executePaperOrderViaExchangeSimulator(
  input: PaperSimulatorOrderInput,
): Promise<PlaceOrderResult & { fee: number; accountUpdatedAt: string; simulationId: string }> {
  const venue = resolveCanonicalVenueConfig();
  if (input.marketDataVenue && input.marketDataVenue !== venue.paperExecutionVenue) {
    throw new Error("VENUE_MISMATCH_PAPER_EXECUTION");
  }
  const simulation = await simulateMarketExecution({
    executionId: input.executionId,
    userId: input.userId,
    symbol: input.symbol,
    side: input.side,
    quantity: input.quantity,
    quoteOrderQty: input.quoteOrderQty,
    priceHint: input.priceHint,
    quoteAsset: input.quoteAsset,
    baseAsset: input.baseAsset,
    bidDepth: input.bidDepth,
    askDepth: input.askDepth,
    spreadPercent: input.spreadPercent,
    atr: input.atr,
    volatilityPercent: input.volatilityPercent,
    volumeQuote: input.volumeQuote,
    aggressiveBuyPct: input.aggressiveBuyPct,
    aggressiveSellPct: input.aggressiveSellPct,
    decisionAt: input.decisionAt,
    riskAllowedAt: input.riskAllowedAt,
    executionIntentId: input.executionIntentId,
    marketDataVenue: input.marketDataVenue,
    executionVenue: input.executionVenue,
  });

  if (!simulation.ok || simulation.executedQty <= 0) {
    throw new Error(simulation.rejectReason ?? "Exchange simulation rejected order");
  }

  const quote = normalizeAsset(input.quoteAsset);
  const base = normalizeAsset(input.baseAsset);
  const account = await getPaperAccount(input.userId);
  const balances = { ...account.balances };
  const executedQty = simulation.executedQty;
  const avgPrice = simulation.avgFillPrice;
  const notional = executedQty * avgPrice;
  const fee = simulation.totalFees;

  if (input.side === "BUY") {
    requireBalance(balances, quote, notional + fee);
    balances[quote] = Number((safeNumber(balances[quote]) - (notional + fee)).toFixed(8));
    balances[base] = Number((safeNumber(balances[base]) + executedQty).toFixed(8));
  } else {
    requireBalance(balances, base, executedQty);
    balances[base] = Number((safeNumber(balances[base]) - executedQty).toFixed(8));
    balances[quote] = Number((safeNumber(balances[quote]) + (notional - fee)).toFixed(8));
  }

  const accountUpdatedAt = await writePaperBalances(input.userId, balances);
  const status = simulation.status === "PARTIALLY_FILLED" ? "PARTIALLY_FILLED" : "FILLED";

  emitExchangeSimulatorEvent("paper.order.executed", {
    userId: input.userId,
    campaignId: input.campaignId,
    jobId: input.jobId,
    sessionId: input.sessionId,
    runId: input.runId,
    roundId: input.roundId,
    candidateId: input.candidateId,
    simulationId: simulation.simulationId,
    executionId: input.executionId,
    symbol: input.symbol,
    side: input.side,
    executedQty,
    avgFillPrice: avgPrice,
    fee,
    fillCount: simulation.fillCount,
  });

  bridgePaperFill({
    candidateId: input.candidateId,
    symbol: input.symbol,
    side: input.side,
    entryPrice: avgPrice,
    quantity: executedQty,
    fees: fee,
    orderId: simulation.orderId,
    fillId: simulation.simulationId,
    sessionId: input.executionIntentId ?? input.executionId,
    reconciled: true,
  });

  return {
    orderId: simulation.orderId,
    clientOrderId: simulation.orderId,
    symbol: input.symbol,
    status,
    side: input.side,
    type: "MARKET",
    executedQty,
    price: avgPrice,
    dryRun: true,
    fee,
    accountUpdatedAt,
    simulationId: simulation.simulationId,
    metadata: {
      simulationId: simulation.simulationId,
      candidateId: input.candidateId,
      executionIntentId: input.executionIntentId ?? input.executionId,
      lane: input.lane ?? null,
      executionVenue: input.executionVenue ?? null,
      marketDataVenue: input.marketDataVenue ?? null,
      riskDecisionId: input.riskDecisionId ?? null,
      decisionAt: input.decisionAt ?? null,
      riskAllowedAt: input.riskAllowedAt ?? null,
      firstFillAt: simulation.fills[0]?.filledAt ?? null,
      filledAt: simulation.fills[simulation.fills.length - 1]?.filledAt ?? null,
      orderLifecycle: simulation.metadata?.orderLifecycle ?? null,
      spreadCostQuote: simulation.metadata?.spreadCostQuote ?? null,
      fillCount: simulation.fillCount,
      slippagePct: simulation.totalSlippagePct,
      executionDurationMs: simulation.executionDurationMs,
      fills: simulation.fills,
      quality: simulation.quality,
      comparison: simulation.comparison,
    },
  };
}

export async function executePaperOpenOrderViaSimulator(input: PaperSimulatorOrderInput) {
  return executePaperOrderViaExchangeSimulator(input);
}

export async function executePaperCloseOrderViaSimulator(input: PaperSimulatorOrderInput) {
  return executePaperOrderViaExchangeSimulator(input);
}
