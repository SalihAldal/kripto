import { TradingCoreEventBus } from "@/src/server/trading-core/core/event-bus";
import { BotOrchestrator } from "@/src/server/trading-core/bots/bot-orchestrator";
import { tradingConfig } from "@/src/server/trading-core/config";
import { tradingCoreFlags } from "@/src/server/trading-core/core/feature-flags";
import { HealthRegistry } from "@/src/server/trading-core/core/health-registry";
import { ModuleManager } from "@/src/server/trading-core/core/module-manager";
import { OptionalAiEngine } from "@/src/server/trading-core/ai-engine/ai-module";
import { SignalStore } from "@/src/server/trading-core/database/signal-store";
import { ExchangeExecutor } from "@/src/server/trading-core/executors/exchange-executor";
import { PositionManager } from "@/src/server/trading-core/executors/position-manager";
import { RiskEngine } from "@/src/server/trading-core/risk-engine/risk-engine";
import { SignalEngine } from "@/src/server/trading-core/signals/signal-engine";
import { SignalEngineRunner } from "@/src/server/trading-core/services/signal-engine-runner";
import { RsiMacdStrategy } from "@/src/server/trading-core/strategies/rsi-macd.strategy";
import { StrategyRegistry } from "@/src/server/trading-core/strategies/strategy-registry";
import { VolumeSpikeStrategy } from "@/src/server/trading-core/strategies/volume-spike.strategy";
import { TradingCoreService } from "@/src/server/trading-core/services/trading-core-service";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { BinanceMarketStream } from "@/src/server/trading-core/websocket/binance-market-stream";
import { MarketDataBuffer } from "@/src/server/trading-core/websocket/market-data-buffer";
import { isStrategyEnabled } from "@/src/server/trading-core/strategy";
import { MarketRegimeService } from "@/src/server/trading-core/market-regime/market-regime-service";
import { installTradingStrategyPlugins } from "@/src/server/trading-core/strategy-sdk";

export function createTradingCoreService() {
  const events = new TradingCoreEventBus();
  const health = new HealthRegistry();
  const modules = new ModuleManager(events);
  const strategies = new StrategyRegistry();
  strategies.register(new RsiMacdStrategy(isStrategyEnabled("rsi-macd", true)));
  strategies.register(new VolumeSpikeStrategy(isStrategyEnabled("volume-spike", true)));
  installTradingStrategyPlugins(strategies);

  const signalEngine = new SignalEngine(strategies, events);
  const riskEngine = new RiskEngine(events);
  const aiEngine = new OptionalAiEngine();
  const positions = new PositionManager();
  const bots = new BotOrchestrator();
  const marketRegime = new MarketRegimeService();
  const executor = new ExchangeExecutor(riskEngine, positions, events);
  const store = new SignalStore();
  const marketStream = new BinanceMarketStream(tradingConfig.getGlobal("coinWhitelist"), events);
  const marketBuffer = new MarketDataBuffer();
  const queue = new TradingJobQueue("signals", tradingCoreFlags.queueConcurrency, tradingCoreFlags.useRedisQueue);

  health.register(aiEngine);
  health.register(marketStream);
  health.register(positions);
  health.register(bots);
  health.register(marketRegime);
  modules.register(aiEngine);

  const service = new TradingCoreService(signalEngine, riskEngine, aiEngine, executor, store, health, modules, positions, marketRegime, bots);
  const runner = new SignalEngineRunner(marketStream, marketBuffer, queue, service, positions);
  health.register(service);
  health.register(runner);
  modules.register(runner);
  return { service, runner, events, strategies, positions, bots, marketRegime, store, marketStream, marketBuffer, queue };
}
