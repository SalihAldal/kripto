import { randomUUID } from "node:crypto";
import type { BacktestRequest, BacktestResult, StrategyBacktestResult } from "@/src/server/trading-core/backtest/backtest-types";
import { ExecutionSimulator } from "@/src/server/trading-core/backtest/execution-simulator";
import { MarketReplay } from "@/src/server/trading-core/backtest/market-replay";
import { calculateBacktestMetrics } from "@/src/server/trading-core/backtest/metrics";
import type { MarketCandle, StrategySignal } from "@/src/server/trading-core/core/types";
import { SignalEngine } from "@/src/server/trading-core/signals/signal-engine";
import { StrategyRegistry } from "@/src/server/trading-core/strategies/strategy-registry";
import { RsiMacdStrategy } from "@/src/server/trading-core/strategies/rsi-macd.strategy";
import { VolumeSpikeStrategy } from "@/src/server/trading-core/strategies/volume-spike.strategy";

type BacktestSignalGateResult = {
  side: StrategySignal["side"];
  reasons: string[];
};

export class ProfessionalBacktestEngine {
  async run(request: BacktestRequest): Promise<BacktestResult> {
    const startedAt = new Date().toISOString();
    const strategyResults = await Promise.all(
      request.strategies.filter((strategy) => strategy.enabled).map((strategy) => this.runStrategy(request, strategy.name)),
    );
    const allTrades = strategyResults.flatMap((result) => result.trades);
    const combinedCurve = this.combineEquityCurves(strategyResults, request.initialBalance);
    const metrics = calculateBacktestMetrics(allTrades, request.initialBalance, combinedCurve);
    return {
      id: randomUUID(),
      startedAt,
      finishedAt: new Date().toISOString(),
      config: {
        initialBalance: request.initialBalance,
        leverage: request.leverage,
        futures: request.futures,
        allowShort: request.allowShort,
        positionSizePercent: request.positionSizePercent,
        takeProfitPercent: request.takeProfitPercent,
        stopLossPercent: request.stopLossPercent,
        strategies: request.strategies,
        costModel: request.costModel,
        symbols: request.marketData.map((item) => item.symbol),
      },
      metrics,
      strategyResults,
    };
  }

  private async runStrategy(request: BacktestRequest, strategyName: string): Promise<StrategyBacktestResult> {
    const signalEngine = new SignalEngine(this.registryFor(strategyName), { emit: () => undefined } as never);
    const simulator = new ExecutionSimulator(request.costModel, request.takeProfitPercent, request.stopLossPercent);
    const replay = new MarketReplay(request.marketData);
    const lastCandles = new Map<string, MarketCandle>();
    const trades = [];
    const equityCurve: Array<{ time: number; equity: number }> = [{ time: Date.now(), equity: request.initialBalance }];
    let balance = request.initialBalance;

    for (const snapshot of replay.snapshots()) {
      const latest = snapshot.candles.at(-1);
      if (!latest) continue;
      lastCandles.set(snapshot.symbol, latest);
      const decision = await signalEngine.analyze(snapshot);
      const strategySignal = this.pickStrategySignal(decision.strategySignals, strategyName);
      const gate = this.evaluateBacktestSignalGate({
        strategyName,
        signal: strategySignal,
        signals: decision.strategySignals,
        snapshot,
        request,
      });
      const closedTrades = simulator.onSignal({
        strategy: strategyName,
        symbol: snapshot.symbol,
        side: gate.side,
        candle: latest,
        balance,
        leverage: request.leverage,
        positionSizePercent: request.positionSizePercent,
        allowShort: request.allowShort || request.futures,
      });
      for (const trade of closedTrades) {
        balance += trade.netPnl;
        trades.push(trade);
        equityCurve.push({ time: trade.exitTime, equity: Number(balance.toFixed(8)) });
      }
    }

    for (const trade of simulator.closeAll(lastCandles)) {
      balance += trade.netPnl;
      trades.push(trade);
      equityCurve.push({ time: trade.exitTime, equity: Number(balance.toFixed(8)) });
    }

    return {
      strategy: strategyName,
      metrics: calculateBacktestMetrics(trades, request.initialBalance, equityCurve),
      trades,
      equityCurve,
    };
  }

  private registryFor(strategyName: string) {
    const registry = new StrategyRegistry();
    if (strategyName === "rsi-macd") registry.register(new RsiMacdStrategy(true));
    else if (strategyName === "volume-spike") registry.register(new VolumeSpikeStrategy(true));
    else {
      registry.register(new RsiMacdStrategy(true));
      registry.register(new VolumeSpikeStrategy(true));
    }
    return registry;
  }

  private pickStrategySignal(signals: StrategySignal[], strategyName: string) {
    if (strategyName === "combined") return [...signals].sort((a, b) => b.score - a.score)[0] ?? null;
    return signals.find((signal) => signal.strategy === strategyName) ?? null;
  }

  private evaluateBacktestSignalGate(input: {
    strategyName: string;
    signal: StrategySignal | null;
    signals: StrategySignal[];
    snapshot: { candles: MarketCandle[] };
    request: BacktestRequest;
  }): BacktestSignalGateResult {
    const signal = input.signal;
    if (!signal || signal.side === "HOLD") return { side: "HOLD", reasons: ["no-actionable-signal"] };

    const candles = input.snapshot.candles;
    const latest = candles.at(-1);
    const previous = candles.at(-2);
    if (!latest || !previous || latest.close <= 0 || previous.close <= 0) {
      return { side: "HOLD", reasons: ["insufficient-market-data"] };
    }

    const roundTripCostPercent =
      input.request.costModel.takerFeeRate * 2 * 100 +
      (input.request.costModel.slippageBps * 2) / 100;
    const minTpAfterCostPercent = roundTripCostPercent + 0.25;
    const reasons: string[] = [];
    if (input.request.takeProfitPercent < minTpAfterCostPercent) {
      reasons.push(`tp-edge-low:${input.request.takeProfitPercent.toFixed(3)}<${minTpAfterCostPercent.toFixed(3)}`);
    }

    const minScore = input.strategyName === "volume-spike" ? 72 : input.strategyName === "combined" ? 74 : 70;
    const minConfidence = input.strategyName === "combined" ? 60 : 58;
    if (signal.score < minScore) reasons.push(`score-low:${signal.score.toFixed(2)}<${minScore}`);
    if (signal.confidence < minConfidence) reasons.push(`confidence-low:${signal.confidence.toFixed(2)}<${minConfidence}`);

    const shortReturn = this.returnPercent(candles, 4);
    const midReturn = this.returnPercent(candles, 12);
    const volatility = this.averageAbsoluteReturn(candles, 14);
    const directionAligned =
      signal.side === "BUY"
        ? shortReturn > 0.08 && midReturn > -0.25
        : shortReturn < -0.08 && midReturn < 0.25;
    if (!directionAligned) {
      reasons.push(`direction-not-confirmed:short=${shortReturn.toFixed(3)},mid=${midReturn.toFixed(3)}`);
    }
    if (volatility > Math.max(2.8, input.request.stopLossPercent * 1.8)) {
      reasons.push(`volatility-chaos:${volatility.toFixed(3)}`);
    }

    if (input.strategyName === "rsi-macd") {
      const histogram = Number(signal.indicators.macd?.histogram ?? 0);
      const rsi = Number(signal.indicators.rsi ?? 50);
      const macdAligned = signal.side === "BUY" ? histogram > 0 : histogram < 0;
      const rsiNotLate = signal.side === "BUY" ? rsi < 66 : rsi > 34;
      if (!macdAligned) reasons.push("macd-not-aligned");
      if (!rsiNotLate) reasons.push(`rsi-late:${rsi.toFixed(2)}`);
    }

    if (input.strategyName === "volume-spike") {
      const spikeRatio = Number(signal.indicators.volumeSpike?.ratio ?? 0);
      if (!signal.indicators.volumeSpike?.isSpike || spikeRatio < 2.2) {
        reasons.push(`volume-spike-weak:${spikeRatio.toFixed(2)}`);
      }
      if (Math.abs(shortReturn) < roundTripCostPercent + 0.1) {
        reasons.push(`spike-price-move-weak:${shortReturn.toFixed(3)}`);
      }
    }

    if (input.strategyName === "combined") {
      const actionable = input.signals.filter((item) => item.side === signal.side && item.score >= 65);
      if (actionable.length < 2 && signal.score < 78) {
        reasons.push("combined-needs-consensus-or-very-high-score");
      }
    }

    return reasons.length > 0 ? { side: "HOLD", reasons } : { side: signal.side, reasons: ["accepted"] };
  }

  private returnPercent(candles: MarketCandle[], lookback: number) {
    const latest = candles.at(-1);
    const past = candles.at(-1 - lookback) ?? candles[0];
    if (!latest || !past || past.close <= 0) return 0;
    return ((latest.close - past.close) / past.close) * 100;
  }

  private averageAbsoluteReturn(candles: MarketCandle[], lookback: number) {
    const slice = candles.slice(Math.max(1, candles.length - lookback));
    if (slice.length < 2) return 0;
    let total = 0;
    let count = 0;
    for (let idx = 1; idx < slice.length; idx += 1) {
      const prev = slice[idx - 1];
      const cur = slice[idx];
      if (!prev || !cur || prev.close <= 0) continue;
      total += Math.abs(((cur.close - prev.close) / prev.close) * 100);
      count += 1;
    }
    return count > 0 ? total / count : 0;
  }

  private combineEquityCurves(results: StrategyBacktestResult[], initialBalance: number) {
    const rows = results.flatMap((result) => result.equityCurve).sort((a, b) => a.time - b.time);
    if (rows.length === 0) return [{ time: Date.now(), equity: initialBalance }];
    let equity = initialBalance;
    return rows.map((row) => {
      equity = row.equity;
      return { time: row.time, equity };
    });
  }
}
