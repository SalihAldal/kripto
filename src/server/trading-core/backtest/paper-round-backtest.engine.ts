import { randomUUID } from "node:crypto";
import { env } from "@/lib/config";
import { calculateBacktestMetrics } from "@/src/server/trading-core/backtest/metrics";
import { buildMarketContextFromKlines } from "@/src/server/trading-core/backtest/paper-round-context";
import {
  buildPaperRoundAiProxy,
  evaluatePaperRoundGate,
  rankPaperRoundCandidate,
  resolvePaperRoundLane,
  type PaperRoundLearningMemory,
} from "@/src/server/trading-core/backtest/paper-round-gates";
import type {
  BacktestMetrics,
  BacktestResult,
  BacktestTrade,
  PaperRoundGateRejectionSample,
  PaperRoundStrategyDiagnostics,
  StrategyBacktestResult,
} from "@/src/server/trading-core/backtest/backtest-types";
import { calculateTakerFee } from "@/src/server/execution/fee-profile";
import { calculateNetProfitPercent, classifyNetExitOutcome, isSuccessfulNetExit } from "@/src/server/execution/profit-thresholds";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";
import type { KlineItem } from "@/src/types/exchange";

export type PaperRoundBacktestRequest = {
  initialBalance: number;
  positionSizePercent: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  maxWaitSec: number;
  costModel: {
    takerFeeRate: number;
    slippageBps: number;
  };
  symbols: string[];
  marketData: Array<{ symbol: string; klines: KlineItem[] }>;
  lanes: Array<"steady-gain" | "pump-lane" | "paper-round">;
};

type OpenPosition = {
  symbol: string;
  entryPrice: number;
  entryTime: number;
  entryIndex: number;
  quantity: number;
  notional: number;
  isPump: boolean;
  lane: string;
  laneTag: string;
  entryGateReason: string;
};

type ExitReason = BacktestTrade["exitReason"];

function bucketGateReason(reason: string) {
  const first = reason.split(" | ")[0]?.trim() ?? reason;
  const colonIdx = first.indexOf(":");
  if (colonIdx > 0 && colonIdx <= 48) return first.slice(0, colonIdx).trim();
  return first.slice(0, 80);
}

function isCooldownRejection(reason: string) {
  return reason.startsWith("same-symbol-loss-cooldown");
}

function recordGateRejection(input: {
  rejectionCounts: Map<string, number>;
  rejectionSamples: PaperRoundGateRejectionSample[];
  cooldownRejections: { count: number };
  symbol: string;
  time: number;
  laneTag: string;
  reason: string;
}) {
  if (isCooldownRejection(input.reason)) {
    input.cooldownRejections.count += 1;
    return;
  }
  const bucket = bucketGateReason(input.reason);
  input.rejectionCounts.set(bucket, (input.rejectionCounts.get(bucket) ?? 0) + 1);
  if (input.rejectionSamples.length < 48) {
    input.rejectionSamples.push({
      symbol: input.symbol,
      time: input.time,
      laneTag: input.laneTag,
      reason: input.reason.slice(0, 220),
    });
  }
}

function applySlippage(price: number, side: "BUY" | "SELL", slippageBps: number) {
  const factor = slippageBps / 10_000;
  return side === "BUY" ? price * (1 + factor) : price * (1 - factor);
}

function closeTrade(input: {
  position: OpenPosition;
  exitPrice: number;
  exitTime: number;
  exitReason: ExitReason;
  strategy: string;
  takerFeeRate: number;
  slippageBps: number;
}): BacktestTrade {
  const exitSide = "SELL";
  const filledExit = applySlippage(input.exitPrice, exitSide, input.slippageBps);
  const exitFee = calculateTakerFee(filledExit * input.position.quantity);
  const entryFee = calculateTakerFee(input.position.notional);
  const grossPnl = (filledExit - input.position.entryPrice) * input.position.quantity;
  const netPnl = grossPnl - entryFee - exitFee;
  const returnPercent = calculateNetProfitPercent({
    side: "LONG",
    entryPrice: input.position.entryPrice,
    exitPrice: filledExit,
  });
  const holdSec = Math.max(1, Math.floor((input.exitTime - input.position.entryTime) / 1000));

  return {
    id: randomUUID(),
    strategy: input.strategy,
    symbol: input.position.symbol,
    side: "BUY",
    entryTime: input.position.entryTime,
    exitTime: input.exitTime,
    entryPrice: Number(input.position.entryPrice.toFixed(8)),
    exitPrice: Number(filledExit.toFixed(8)),
    quantity: Number(input.position.quantity.toFixed(8)),
    notional: Number(input.position.notional.toFixed(8)),
    fee: Number((entryFee + exitFee).toFixed(8)),
    slippage: Number(((input.slippageBps / 10_000) * input.position.notional * 2).toFixed(8)),
    grossPnl: Number(grossPnl.toFixed(8)),
    netPnl: Number(netPnl.toFixed(8)),
    returnPercent,
    exitReason: input.exitReason,
    holdSec,
    laneTag: input.position.laneTag,
    entryGateReason: input.position.entryGateReason,
    outcome: classifyNetExitOutcome(returnPercent).toLowerCase() as BacktestTrade["outcome"],
  };
}

function shouldPaperLossCapCut(input: {
  profitPercent: number;
  ageSec: number;
  isPumpTrade: boolean;
  momentumDead: boolean;
}) {
  const holdSec = input.isPumpTrade
    ? Math.max(env.EXECUTION_PAPER_PUMP_MAX_LOSS_CUT_HOLD_SEC, env.EXECUTION_PAPER_MAX_LOSS_CUT_HOLD_SEC)
    : env.EXECUTION_PAPER_MAX_LOSS_CUT_HOLD_SEC;
  const lossCap = input.isPumpTrade ? env.EXECUTION_PAPER_PUMP_MAX_LOSS_CUT_PERCENT : env.EXECUTION_PAPER_MAX_LOSS_CUT_PERCENT;
  if (input.ageSec < holdSec) return false;
  if (input.profitPercent > -lossCap) return false;
  return input.momentumDead || input.profitPercent <= -lossCap;
}

function simulateLane(request: PaperRoundBacktestRequest, lane: PaperRoundBacktestRequest["lanes"][number]): StrategyBacktestResult {
  const trades: BacktestTrade[] = [];
  const equityCurve: Array<{ time: number; equity: number }> = [{ time: Date.now(), equity: request.initialBalance }];
  let balance = request.initialBalance;
  let open: OpenPosition | null = null;
  const symbolLosses = new Map<string, number>();
  const rejectionCounts = new Map<string, number>();
  const rejectionSamples: PaperRoundGateRejectionSample[] = [];
  const cooldownRejections = { count: 0 };
  let barsScanned = 0;
  let candidateScans = 0;
  let gatePasses = 0;
  const minBars = Math.min(...request.marketData.map((item) => item.klines.length).filter((len) => len >= 80));
  const startIndex = 60;

  for (let idx = startIndex; idx < minBars; idx += 1) {
    if (open) {
      const rows = request.marketData.find((item) => item.symbol === open!.symbol)?.klines ?? [];
      const candle = rows[idx];
      if (!candle) continue;
      const ageSec = Math.max(0, Math.floor((candle.closeTime - open.entryTime) / 1000));
      const tpPrice = open.entryPrice * (1 + request.takeProfitPercent / 100);
      const slPrice = open.entryPrice * (1 - request.stopLossPercent / 100);
      const hitTp = candle.high >= tpPrice;
      const hitSl = candle.low <= slPrice;
      const timedOut = ageSec >= request.maxWaitSec;
      const context = buildMarketContextFromKlines({ symbol: open.symbol, klines: rows, idx });
      const shortMomentum = Number(context?.metadata.shortMomentumPercent ?? 0);
      const profitPercent = open.entryPrice > 0 ? ((candle.close - open.entryPrice) / open.entryPrice) * 100 : 0;
      const momentumDead = shortMomentum <= -0.04 || profitPercent <= -0.12;
      const lossCap = shouldPaperLossCapCut({
        profitPercent,
        ageSec,
        isPumpTrade: open.isPump,
        momentumDead,
      });

      let exitReason: ExitReason | null = null;
      let exitPrice = candle.close;
      if (hitTp) {
        exitReason = "TAKE_PROFIT";
        exitPrice = tpPrice;
      } else if (hitSl) {
        exitReason = "STOP_LOSS";
        exitPrice = slPrice;
      } else if (lossCap) {
        exitReason = "MOMENTUM_FADE";
        exitPrice = candle.close;
      } else if (timedOut) {
        exitReason = "TIMEOUT";
        exitPrice = candle.close;
      }

      if (!exitReason) continue;

      const trade = closeTrade({
        position: open,
        exitPrice,
        exitTime: candle.closeTime,
        exitReason,
        strategy: lane,
        takerFeeRate: request.costModel.takerFeeRate,
        slippageBps: request.costModel.slippageBps,
      });
      balance += trade.netPnl;
      trades.push(trade);
      equityCurve.push({ time: trade.exitTime, equity: Number(balance.toFixed(8)) });
      if (!isSuccessfulNetExit(trade.returnPercent)) {
        symbolLosses.set(open.symbol, (symbolLosses.get(open.symbol) ?? 0) + 1);
      } else {
        symbolLosses.delete(open.symbol);
      }
      open = null;
      continue;
    }

    barsScanned += 1;
    const candidates: Array<{
      symbol: string;
      context: NonNullable<ReturnType<typeof buildMarketContextFromKlines>>;
      score: ReturnType<typeof scoreContext>;
      ai: ReturnType<typeof buildPaperRoundAiProxy>;
      laneTag: ReturnType<typeof resolvePaperRoundLane>;
      rank: number;
      gateReason: string;
    }> = [];

    for (const item of request.marketData) {
      const candle = item.klines[idx];
      if (!candle) continue;
      const context = buildMarketContextFromKlines({ symbol: item.symbol, klines: item.klines, idx });
      if (!context) continue;
      candidateScans += 1;
      const score = scoreContext(context);
      const ai = buildPaperRoundAiProxy(context, score);
      const laneTag = resolvePaperRoundLane(context, ai);

      if (lane !== "paper-round" && laneTag !== lane) {
        recordGateRejection({
          rejectionCounts,
          rejectionSamples,
          cooldownRejections,
          symbol: item.symbol,
          time: candle.closeTime,
          laneTag,
          reason: `lane-mismatch: beklenen=${lane}, aday=${laneTag}`,
        });
        continue;
      }

      const learningMemory: PaperRoundLearningMemory = {
        hardBlock: false,
        minConfidenceDelta: (symbolLosses.get(item.symbol) ?? 0) >= 1 ? 6 : 0,
        sameSymbolLossCount: symbolLosses.get(item.symbol) ?? 0,
      };
      const gate = evaluatePaperRoundGate({
        context,
        score,
        ai,
        maxWaitSec: request.maxWaitSec,
        targetProfitPct: request.takeProfitPercent,
        learningMemory,
      });
      if (!gate.ok) {
        recordGateRejection({
          rejectionCounts,
          rejectionSamples,
          cooldownRejections,
          symbol: item.symbol,
          time: candle.closeTime,
          laneTag,
          reason: gate.reason,
        });
        continue;
      }

      gatePasses += 1;
      candidates.push({
        symbol: item.symbol,
        context,
        score,
        ai,
        laneTag,
        rank: rankPaperRoundCandidate({ context, score, ai }),
        gateReason: gate.reason,
      });
    }

    if (candidates.length === 0) continue;

    let selected = [...candidates].sort((a, b) => b.rank - a.rank)[0];
    if (lane === "paper-round") {
      const pumpCandidates = candidates.filter((row) => row.laneTag === "pump-lane").sort((a, b) => b.rank - a.rank);
      const steadyCandidates = candidates.filter((row) => row.laneTag === "steady-gain").sort((a, b) => b.rank - a.rank);
      selected = pumpCandidates[0] ?? steadyCandidates[0] ?? selected;
    }

    const candle = request.marketData.find((item) => item.symbol === selected.symbol)?.klines[idx];
    if (!candle) continue;
    const entryPrice = applySlippage(candle.close, "BUY", request.costModel.slippageBps);
    const notional = balance * (request.positionSizePercent / 100);
    if (notional <= 0 || entryPrice <= 0) continue;
    const quantity = notional / entryPrice;
    open = {
      symbol: selected.symbol,
      entryPrice,
      entryTime: candle.closeTime,
      entryIndex: idx,
      quantity,
      notional,
      isPump: selected.laneTag === "pump-lane",
      lane,
      laneTag: selected.laneTag,
      entryGateReason: selected.gateReason,
    };
  }

  if (open) {
    const rows = request.marketData.find((item) => item.symbol === open!.symbol)?.klines ?? [];
    const candle = rows[rows.length - 1];
    if (candle) {
      const trade = closeTrade({
        position: open,
        exitPrice: candle.close,
        exitTime: candle.closeTime,
        exitReason: "END_OF_DATA",
        strategy: lane,
        takerFeeRate: request.costModel.takerFeeRate,
        slippageBps: request.costModel.slippageBps,
      });
      balance += trade.netPnl;
      trades.push(trade);
      equityCurve.push({ time: trade.exitTime, equity: Number(balance.toFixed(8)) });
    }
  }

  const exitReasonBreakdown = Array.from(
    trades.reduce((map, trade) => {
      map.set(trade.exitReason, (map.get(trade.exitReason) ?? 0) + 1);
      return map;
    }, new Map<string, number>()),
  )
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  const qualityRejections = Array.from(rejectionCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
  const gateRejections = [...qualityRejections];
  if (cooldownRejections.count > 0) {
    gateRejections.push({ reason: "same-symbol-loss-cooldown (tekrarlayan)", count: cooldownRejections.count });
  }

  const diagnostics: PaperRoundStrategyDiagnostics = {
    barsScanned,
    candidateScans,
    gatePasses,
    gateRejections,
    qualityRejections,
    cooldownRejections: cooldownRejections.count,
    rejectionSamples,
    exitReasonBreakdown,
  };

  return {
    strategy: lane,
    metrics: calculateBacktestMetrics(trades, request.initialBalance, equityCurve),
    trades,
    equityCurve,
    diagnostics,
  };
}

export class PaperRoundBacktestEngine {
  run(request: PaperRoundBacktestRequest): BacktestResult {
    const startedAt = new Date().toISOString();
    const strategyResults = request.lanes.map((lane) => simulateLane(request, lane));
    const primary = strategyResults.find((row) => row.strategy === "paper-round") ?? strategyResults[0];
    const allTrades = primary?.trades ?? [];
    const combinedCurve = primary?.equityCurve ?? [{ time: Date.now(), equity: request.initialBalance }];
    const metrics = calculateBacktestMetrics(allTrades, request.initialBalance, combinedCurve);

    return {
      id: randomUUID(),
      startedAt,
      finishedAt: new Date().toISOString(),
      config: {
        initialBalance: request.initialBalance,
        leverage: 1,
        futures: false,
        allowShort: false,
        positionSizePercent: request.positionSizePercent,
        takeProfitPercent: request.takeProfitPercent,
        stopLossPercent: request.stopLossPercent,
        strategies: request.lanes.map((name) => ({ name, enabled: true })),
        costModel: {
          makerFeeRate: request.costModel.takerFeeRate,
          takerFeeRate: request.costModel.takerFeeRate,
          slippageBps: request.costModel.slippageBps,
          latencyMs: 0,
        },
        symbols: request.symbols,
        mode: "paper-round",
        dataSource: "real-klines",
        maxWaitSec: request.maxWaitSec,
      },
      metrics,
      strategyResults,
    };
  }
}

export async function fetchPaperRoundMarketData(symbols: string[], interval = "1m", limit = 1000) {
  const { getExchangeProvider } = await import("@/src/server/exchange");
  const provider = getExchangeProvider();
  const rows = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const klines = await provider.getKlines(symbol.toUpperCase(), interval, limit);
        return { symbol: symbol.toUpperCase(), klines };
      } catch {
        return { symbol: symbol.toUpperCase(), klines: [] as KlineItem[] };
      }
    }),
  );
  return rows.filter((row) => row.klines.length >= 80);
}

export function summarizePaperRoundDiagnostics(result: BacktestResult) {
  const primary = result.strategyResults.find((row) => row.strategy === "paper-round") ?? result.strategyResults[0];
  const diagnostics = primary?.diagnostics;
  const topRejections = diagnostics?.qualityRejections.slice(0, 8) ?? [];
  const topExits = diagnostics?.exitReasonBreakdown ?? [];
  const passRate =
    diagnostics && diagnostics.candidateScans > 0
      ? Number(((diagnostics.gatePasses / diagnostics.candidateScans) * 100).toFixed(2))
      : 0;

  return {
    mode: "paper-round",
    dataSource: "real-klines",
    primaryStrategy: primary?.strategy ?? "paper-round",
    totalTrades: primary?.metrics.tradeCount ?? 0,
    barsScanned: diagnostics?.barsScanned ?? 0,
    candidateScans: diagnostics?.candidateScans ?? 0,
    gatePasses: diagnostics?.gatePasses ?? 0,
    gatePassRatePercent: passRate,
    cooldownRejections: diagnostics?.cooldownRejections ?? 0,
    gateRejections: topRejections,
    exitReasonBreakdown: topExits,
    rejectionSamples: diagnostics?.rejectionSamples.slice(0, 12) ?? [],
    trades: (primary?.trades ?? []).map((trade) => ({
      symbol: trade.symbol,
      laneTag: trade.laneTag,
      entryTime: trade.entryTime,
      exitTime: trade.exitTime,
      holdSec: trade.holdSec,
      netPnl: trade.netPnl,
      returnPercent: trade.returnPercent,
      exitReason: trade.exitReason,
      outcome: trade.outcome,
      entryGateReason: trade.entryGateReason,
    })),
    note:
      (primary?.metrics.tradeCount ?? 0) === 0
        ? "Gate'ler cok siki veya veri yetersiz; red ozetine bak."
        : "Ust metrikler yalnizca paper-round lane'inden (cift sayim yok).",
  };
}

export type { BacktestMetrics };
