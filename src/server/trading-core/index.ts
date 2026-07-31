export { createTradingCoreService } from "@/src/server/trading-core/modules/default-modules";
export { StrategyEvolutionEngine, strategyEvolutionEngine } from "@/src/server/trading-core/strategy-evolution";
export type {
  StrategyEvolutionPatch,
  StrategyEvolutionRequest,
  StrategyEvolutionResult,
  StrategyEvolutionStage,
} from "@/src/server/trading-core/strategy-evolution";
export { ExperienceMemoryEngine, experienceMemoryEngine, ExperienceMemoryStore, experienceMemoryStore, ExperienceSimilarityEngine } from "@/src/server/trading-core/experience-memory";
export type {
  ConfidenceMemoryResult,
  ExperienceEntryConditions,
  ExperienceMarketContext,
  ExperienceMemoryInput,
  ExperienceMemorySnapshot,
  ExperienceOutcome,
  ExperienceQueryInput,
  ExperienceRiskFlag,
  HistoricalTradeMatch,
  TradeExperienceRecord,
} from "@/src/server/trading-core/experience-memory";
export { FeedbackLoopEngine, feedbackLoopEngine, FeedbackStore } from "@/src/server/trading-core/feedback-loop";
export type {
  FeedbackCloseTradeInput,
  FeedbackLoopReport,
  FeedbackLoopSnapshot,
  FeedbackMarketSnapshot,
  FeedbackOpenTradeInput,
  FeedbackSetupStats,
  FeedbackSetupStatus,
  FeedbackStrategySnapshot,
  FeedbackTradeRecord,
  FeedbackTradeStatus,
} from "@/src/server/trading-core/feedback-loop";
export { NoTradeZoneEngine, noTradeZoneEngine } from "@/src/server/trading-core/no-trade-zone";
export type {
  BotPausePlan,
  NoTradeSeverity,
  NoTradeZone,
  NoTradeZoneDecision,
  NoTradeZoneInput,
  NoTradeZoneType,
} from "@/src/server/trading-core/no-trade-zone";
export { DynamicPositionSizingEngine, dynamicPositionSizingEngine, getDynamicPositionSizingConfig } from "@/src/server/trading-core/dynamic-position-sizing";
export type {
  DynamicPositionSizingConfig,
  DynamicPositionSizingDecision,
  DynamicPositionSizingInput,
  PositionSizingFactor,
  PositionSizingRiskLevel,
} from "@/src/server/trading-core/dynamic-position-sizing";
export { PatternMemory, SelfLearningEngine, selfLearningEngine } from "@/src/server/trading-core/self-learning";
export type {
  IndicatorImpact,
  LearnedPattern,
  LearnedPatternStatus,
  LearningOutcome,
  SelfLearningSnapshot,
  StrategyLearningPatch,
  TradeLearningInput,
  TradeLearningReport,
} from "@/src/server/trading-core/self-learning";
export { TradeQualityEngine, tradeQualityEngine } from "@/src/server/trading-core/trade-quality";
export type {
  TradeQualityAction,
  TradeQualityDecision,
  TradeQualityFilterResult,
  TradeQualityFilterType,
  TradeQualityInput,
  TradeQualityLevel,
} from "@/src/server/trading-core/trade-quality";
export { AdaptiveSwitchingEngine, adaptiveSwitchingEngine, botAllowedForMarket, confidenceForMarket, resolveAdaptiveMarketType } from "@/src/server/trading-core/adaptive-switching";
export type {
  AdaptiveBotDecision,
  AdaptiveMarketType,
  AdaptiveSwitchAction,
  AdaptiveSwitchingInput,
  AdaptiveSwitchingPlan,
} from "@/src/server/trading-core/adaptive-switching";
export { MarketEdgeConditionClassifier, MarketEdgeDiscoveryEngine, marketEdgeDiscoveryEngine, MarketEdgeSampleBuilder } from "@/src/server/trading-core/market-edge";
export type {
  EdgeConditionType,
  EdgeRiskLevel,
  MarketEdgeCondition,
  MarketEdgeDiscoveryReport,
  MarketEdgeDiscoveryRequest,
  MarketEdgeSample,
  MarketInefficiency,
  StrategyCompatibility,
} from "@/src/server/trading-core/market-edge";
export { CapitalAllocationEngine, capitalAllocationEngine, getCapitalAllocationConfig } from "@/src/server/trading-core/capital-allocation";
export type {
  BotCapitalAllocation,
  BotCapitalTarget,
  CapitalAllocationConfig,
  CapitalAllocationExposureCheck,
  CapitalAllocationMode,
  CapitalAllocationPlan,
  CapitalAllocationRequest,
  CapitalRiskProfile,
} from "@/src/server/trading-core/capital-allocation";
export { BotLeaderboardEngine, botLeaderboardEngine, BotLeaderboardFakePnlGuard } from "@/src/server/trading-core/bot-leaderboard";
export type {
  BotLeaderboardPeriod,
  BotLeaderboardRow,
  BotLeaderboardSnapshot,
  BotLeaderboardVerificationStatus,
  BotLeaderboardVerifiedStats,
} from "@/src/server/trading-core/bot-leaderboard";
export { defaultFusionWeights, SignalFusionEngine, signalFusionEngine } from "@/src/server/trading-core/signal-fusion";
export type {
  FundingRateSignalInput,
  FusionSourceScore,
  FusionSourceType,
  OrderbookSignalInput,
  SignalFusionInput,
  SignalFusionOutput,
} from "@/src/server/trading-core/signal-fusion";
export { BotBehaviorEngine, botBehaviorEngine, BotBehaviorRegistry, botBehaviorRegistry } from "@/src/server/trading-core/bot-behavior";
export type {
  BotBehaviorContext,
  BotBehaviorDecision,
  BotBehaviorProfile,
  BotBehaviorType,
  BotRiskAppetite,
  BotTradePace,
  DcaPlanStep,
} from "@/src/server/trading-core/bot-behavior";
export {
  ProviderPerformanceStore,
  providerPerformanceStore,
  ProviderPriorityEngine,
  SignalProviderManager,
  signalProviderManager,
  SignalProviderRegistry,
  signalProviderRegistry,
  SignalVerifier,
} from "@/src/server/trading-core/signal-providers";
export type {
  ProviderConsensus,
  ProviderPerformanceSample,
  ProviderSignal,
  ProviderSignalInput,
  ProviderSignalVerification,
  SignalProviderConfig,
  SignalProviderPerformance,
  SignalProviderRiskRating,
  SignalProviderSnapshot,
  SignalProviderStatus,
  SignalProviderType,
  SignalVerificationStatus,
} from "@/src/server/trading-core/signal-providers";
export { BotProfileStore, botProfileStore } from "@/src/server/trading-core/bot-profiles";
export type {
  BotPerformancePoint,
  BotProfileListSnapshot,
  BotProfileRating,
  BotProfileRiskLevel,
  BotProfileUpsertInput,
  BotStrategyType,
  BotTradeFrequency,
  TradingBotProfile,
} from "@/src/server/trading-core/bot-profiles";
export { getPortfolioConfig, PortfolioCorrelationAnalyzer, PortfolioExposureAnalyzer, PortfolioHedgeManager, PortfolioStrategyAllocationEngine, SmartPortfolioManager, smartPortfolioManager } from "@/src/server/trading-core/portfolio";
export type {
  CorrelationExposure,
  ExposureBucket,
  HedgeRecommendation,
  PortfolioAction,
  PortfolioAnalysis,
  PortfolioConfig,
  PortfolioDecision,
  PortfolioIntent,
  PortfolioPositionInput,
  PortfolioRiskLevel,
} from "@/src/server/trading-core/portfolio";
export { HeatmapRiskScorer, LiquidationClusterDetector, LiquidationHeatmapService, liquidationHeatmapService } from "@/src/server/trading-core/liquidation-heatmap";
export type {
  FundingPoint,
  HeatmapRiskLevel,
  LeverageZone,
  LiquidationCluster,
  LiquidationHeatmapAnalysis,
  LiquidationHeatmapInput,
  LiquidationLevel,
  LiquidationSide,
  OpenInterestPoint,
  SqueezeDirection,
  StopHuntZone,
} from "@/src/server/trading-core/liquidation-heatmap";
export { StrategyMarketplacePerformance, strategyMarketplacePerformance, StrategyMarketplaceStore, strategyMarketplaceStore, StrategyVerifier } from "@/src/server/trading-core/marketplace";
export type {
  MarketplacePricingType,
  MarketplaceStatus,
  MarketplaceSubscriptionStatus,
  StrategyLeaderboardRow,
  StrategyMarketplaceListing,
  StrategyPerformanceHistory,
  StrategyRating,
  StrategyRevenueShare,
  StrategySubscription,
  StrategyVerificationResult,
} from "@/src/server/trading-core/marketplace";
export { copyTradingEngine, CopyTradingEngine, copyTradingRegistry, CopyTradingRegistry, CopyRiskPolicy, CopySizingEngine } from "@/src/server/trading-core/copy-trading";
export type {
  CopyTradeFollower,
  CopyTradeIntent,
  CopyTradeMaster,
  CopyTradeResult,
  CopyTradeStatus,
  MasterTradeSignal,
} from "@/src/server/trading-core/copy-trading";
export { botPerformanceTracker, BotPerformanceTracker } from "@/src/server/trading-core/bots/bot-performance-tracker";
export type { BotPerformanceMetrics, BotTradeSample } from "@/src/server/trading-core/bots/bot-performance-types";
export { MarketDataNormalizer, marketDataNormalizer, MissingCandleRepair, marketDataSourceAdapters } from "@/src/server/trading-core/market-data";
export { AdaptiveParameterTuner, OverfittingGuard, StrategyOptimizer, strategyOptimizer, StrategyParameterSearch, WalkForwardAnalysis } from "@/src/server/trading-core/optimization";
export type {
  StrategyOptimizationCandidate,
  StrategyOptimizationParams,
  StrategyOptimizationRequest,
  StrategyOptimizationResult,
  WalkForwardResult,
  WalkForwardWindow,
} from "@/src/server/trading-core/optimization";
export type {
  MarketDataNormalizationStats,
  MarketDataQualityIssue,
  MarketDataSource,
  NormalizedMarketCandle,
  NormalizedMarketTick,
  RawMarketCandle,
  RawMarketTick,
} from "@/src/server/trading-core/market-data";
export { tradingConfig, TradingConfigStore } from "@/src/server/trading-core/config";
export {
  tenantConfigEngine,
  TenantConfigEngine,
  tenantPortfolios,
  TenantPortfolioStore,
  tenantRuntimeManager,
  TenantRuntimeManager,
  tenantSessions,
  TenantSessionManager,
} from "@/src/server/trading-core/tenant";
export type { TenantContext, TenantPortfolioSnapshot, TenantRuntimeSnapshot, TenantStatus } from "@/src/server/trading-core/tenant";
export { ApiWeightTracker, PriorityRequestQueue, ProtectedExchangeClient, protectedExchangeClient } from "@/src/server/trading-core/exchange-protection";
export type {
  ExchangeProtectionSnapshot,
  ExchangeQueueSnapshot,
  ExchangeRequestKind,
  ExchangeRequestPriority,
  ExchangeWeightSnapshot,
  ProtectedExchangeRequest,
} from "@/src/server/trading-core/exchange-protection";
export { tradingConfigPatchSchema, tradingRuntimeConfigSchema } from "@/src/server/trading-core/config";
export type {
  BotRuntimeConfig,
  StrategyRuntimeConfig,
  TradingConfigRecord,
  TradingConfigScope,
  TradingRiskLevel,
  TradingRuntimeConfig,
  UserTradingConfig,
} from "@/src/server/trading-core/config";
export { BotOrchestrator } from "@/src/server/trading-core/bots/bot-orchestrator";
export { BotRegistry } from "@/src/server/trading-core/bots/bot-registry";
export type { BotAllocation, BotConfig, BotMemoryState, BotPerformanceUpdate, BotStatus } from "@/src/server/trading-core/bots/bot-types";
export { ProfessionalBacktestEngine } from "@/src/server/trading-core/backtest/backtest-engine";
export { BacktestOverfittingDetector, backtestOverfittingDetector } from "@/src/server/trading-core/backtest/overfitting";
export { monteCarloCandles, randomizeCandles, regimeVariants, splitOutOfSample } from "@/src/server/trading-core/backtest/overfitting";
export type {
  OverfittingCheckResult,
  OverfittingDetectionReport,
  OverfittingDetectionRequest,
  OverfittingRiskLevel,
} from "@/src/server/trading-core/backtest/overfitting";
export { SmartExecutionService } from "@/src/server/trading-core/smart-execution/smart-execution-service";
export { getSmartExecutionService } from "@/src/server/trading-core/smart-execution/singleton";
export { LivePaperEngine } from "@/src/server/trading-core/paper/live-paper-engine";
export { getLivePaperEngine, resetLivePaperEngine } from "@/src/server/trading-core/paper/singleton";
export { tradingLogger, TradingCentralLogger } from "@/src/server/trading-core/observability/central-logger";
export { tradingDomainLogger } from "@/src/server/trading-core/observability/domain-logger";
export { tradingPerformanceMetrics, PerformanceMetricsCollector } from "@/src/server/trading-core/observability/performance-metrics";
export { createTraceContext, childTrace, traceLatency } from "@/src/server/trading-core/observability/request-tracer";
export { getTradingObservabilitySnapshot } from "@/src/server/trading-core/observability/live-monitoring";
export { getTradingTimeline } from "@/src/server/trading-core/observability/trade-timeline";
export type {
  PerformanceMetric,
  TraceContext,
  TradingLogCategory,
  TradingLogEvent,
  TradingLogLevel,
  TradingLogStatus,
} from "@/src/server/trading-core/observability/observability-types";
export type {
  LivePaperEngineOptions,
  PaperAccountState,
  PaperBalances,
  PaperClosedPosition,
  PaperCloseReason,
  PaperFill,
  PaperMode,
  PaperOrderRequest,
  PaperPosition,
  PaperPositionUpdate,
  PaperSide,
} from "@/src/server/trading-core/paper/live-paper-types";
export { TradingCoreDatabaseArchitecture } from "@/src/server/trading-core/database/architecture/database-architecture-service";
export { TradingCoreRepository } from "@/src/server/trading-core/database/architecture/trading-core-repository";
export { TradingCoreEventStore } from "@/src/server/trading-core/database/architecture/event-store";
export { TradingCoreCache } from "@/src/server/trading-core/database/architecture/redis-cache";
export { TradingCorePubSub } from "@/src/server/trading-core/database/architecture/redis-pubsub";
export { HighFrequencyWriteBuffer } from "@/src/server/trading-core/database/architecture/write-buffer";
export type {
  CacheOptions,
  PubSubMessage,
  TradingCoreEvent,
  TradingCoreTable,
  WriteBufferItem,
} from "@/src/server/trading-core/database/architecture/database-types";
export type {
  ExchangeVenue,
  SmartOrderExecution,
  SmartOrderPlan,
  SmartOrderRequest,
  SmartOrderSide,
  SmartOrderSlice,
  SmartOrderStatus,
  SmartOrderType,
} from "@/src/server/trading-core/smart-execution/execution-types";
export type {
  BacktestCostModel,
  BacktestMarketData,
  BacktestMetrics,
  BacktestRequest,
  BacktestResult,
  BacktestTrade,
  StrategyBacktestResult,
} from "@/src/server/trading-core/backtest/backtest-types";
export type {
  ExecutionResult,
  IndicatorSnapshot,
  MarketCandle,
  MarketSnapshot,
  MarketTick,
  RiskVerdict,
  SignalDecision,
  StrategySignal,
  TradeSide,
} from "@/src/server/trading-core/core/types";
export { tradingCoreFlags, tradingFeatureFlags, TradingFeatureFlagStore } from "@/src/server/trading-core/core/feature-flags";
export type { FeatureFlagScope, RuntimeFlagValue, TradingCoreFlagKey, TradingCoreFlags } from "@/src/server/trading-core/core/feature-flags";
export { tradingFailsafeGuard, FailsafeGuard } from "@/src/server/trading-core/protection/failsafe-guard";
export { tradingFailsafeState, FailsafeStateStore } from "@/src/server/trading-core/protection/failsafe-state";
export type {
  ProtectionDecision,
  ProtectionIntent,
  ProtectionLevel,
  ProtectionState,
  ProtectionViolation,
  ProtectionViolationType,
} from "@/src/server/trading-core/protection/protection-types";
export {
  defineTradingStrategy,
  exampleScalpingStrategy,
  installTradingStrategyPlugins,
  registerTradingStrategy,
  StrategySdkAdapter,
  StrategySdkPluginRegistry,
  tradingStrategySdkRegistry,
} from "@/src/server/trading-core/strategy-sdk";
export type {
  StrategyRiskInput,
  StrategyRiskResult,
  StrategySdkContext,
  StrategySdkMetadata,
  StrategySdkMode,
  StrategySdkSignal,
  StrategyTradeInput,
  StrategyTradeResult,
  TradingStrategySdk,
} from "@/src/server/trading-core/strategy-sdk";
export { MarketDataBuffer } from "@/src/server/trading-core/websocket/market-data-buffer";
export { BinanceMarketStream } from "@/src/server/trading-core/websocket/binance-market-stream";
export { SignalEngineRunner } from "@/src/server/trading-core/services/signal-engine-runner";
export { SignalEngine } from "@/src/server/trading-core/signals/signal-engine";
export { toSignalJson, type SignalEngineJsonOutput } from "@/src/server/trading-core/signals/json-output";
export { MarketAnalysisClient } from "@/src/server/trading-core/ai-engine/market-analysis-client";
export type { MarketAnalysisClientInput, MarketAnalysisClientOutput } from "@/src/server/trading-core/ai-engine/market-analysis-client";
export { MarketRegimeService } from "@/src/server/trading-core/market-regime/market-regime-service";
export { MarketRegimeDetector } from "@/src/server/trading-core/market-regime/market-regime-detector";
export { StrategyRegimePolicy } from "@/src/server/trading-core/market-regime/strategy-regime-policy";
export type {
  MarketRegimeDecision,
  MarketRegimeType,
  StrategyMode,
  StrategyRegimeRule,
  TrendDirection,
} from "@/src/server/trading-core/market-regime/market-regime.types";
export { RiskEngine } from "@/src/server/trading-core/risk-engine/risk-engine";
export { RiskScorer } from "@/src/server/trading-core/risk-engine/risk-scorer";
export { PositionSizer } from "@/src/server/trading-core/risk-engine/position-sizing";
export type { RiskDecision, RiskLevel, RiskTradeInput, RiskScoreBreakdown } from "@/src/server/trading-core/risk-engine/risk-types";
export { PositionManager } from "@/src/server/trading-core/executors/position-manager";
export type {
  ManagedPosition,
  OpenPositionRequest,
  PartialTakeProfitTarget,
  PositionManagerConfig,
  PositionOpenResult,
  PositionSide,
  PositionStatus,
  PositionUpdateResult,
  TrailingStopState,
} from "@/src/server/trading-core/executors/position-types";
export { StrategyRegistry } from "@/src/server/trading-core/strategies/strategy-registry";
export type { SignalStrategy } from "@/src/server/trading-core/strategies/strategy";
