import type { HotPathStageDefinition, LegacyWorkerDefinition } from "@/src/server/hot-path/hot-path.types";

export const HOT_PATH_STAGES: HotPathStageDefinition[] = [
  {
    id: "MARKET_DATA",
    label: "Market Data",
    description: "Real-time and polled market inputs feeding discovery and decisions.",
    modulePaths: [
      "src/server/market-data/spine/market-data-daemon.ts",
      "src/server/market-data/market-data-gateway.ts",
      "src/server/scanner/market-context-builder.ts",
      "src/server/scanner/scanner-worker.service.ts",
      "src/server/scanner/pump-early-catcher.service.ts",
      "src/server/discovery/discovery-pipeline.engine.ts",
    ],
    integrationPaths: [
      "src/server/scanner/scanner.service.ts",
      "src/server/scanner/fast-entry.service.ts",
    ],
  },
  {
    id: "DISCOVERY",
    label: "Discovery",
    description: "Universe scan, candidate ranking, and opportunity queue.",
    modulePaths: [
      "src/server/opportunity/opportunity-engine.ts",
      "src/server/microstructure/microstructure-engine.ts",
      "src/server/discovery/discovery-pipeline.engine.ts",
      "src/server/discovery/master-scanner.service.ts",
      "src/server/scanner/scanner.service.ts",
      "src/server/scanner/candidate-ranking.service.ts",
    ],
    integrationPaths: [
      "src/server/scanner/scanner.service.ts",
    ],
  },
  {
    id: "DECISION",
    label: "Decision",
    description: "AI consensus and master decision engine producing trade verdicts.",
    modulePaths: [
      "src/server/ai/analysis-orchestrator.ts",
      "src/server/ai/hybrid-decision-engine.ts",
      "src/server/decision-engine/master-decision-engine.service.ts",
      "src/server/observability/decision-observability.service.ts",
    ],
    integrationPaths: [
      "src/server/ai/analysis-orchestrator.ts",
      "src/server/execution/execution-orchestrator.service.ts",
    ],
  },
  {
    id: "ENTRY",
    label: "Entry",
    description: "Signal quality, smart entry, and pre-order validation.",
    modulePaths: [
      "src/server/execution/signal-quality-gate.service.ts",
      "src/server/execution/smart-entry-engine.service.ts",
      "src/server/execution/execution-orchestrator.service.ts",
    ],
    integrationPaths: [
      "src/server/execution/execution-orchestrator.service.ts",
    ],
  },
  {
    id: "SAFETY",
    label: "Execution Safety",
    description: "Pre-trade safety validation before exchange submission.",
    modulePaths: [
      "src/server/execution-safety/pre-trade-validator.service.ts",
      "src/server/execution-management/execution-management-workers.ts",
    ],
    integrationPaths: [
      "src/server/execution/execution-orchestrator.service.ts",
    ],
  },
  {
    id: "EXECUTION",
    label: "Execution",
    description: "Order submission, fill handling, and exchange adapter.",
    modulePaths: [
      "src/server/execution/execution-orchestrator.service.ts",
      "src/server/repositories/execution.repository.ts",
      "services/trading-engine.service.ts",
    ],
    integrationPaths: [
      "app/api/trades/fast-entry/route.ts",
      "app/api/trades/open/route.ts",
    ],
  },
  {
    id: "EXIT",
    label: "Exit",
    description: "Position monitoring, smart exit, and settlement.",
    modulePaths: [
      "src/server/execution/position-monitor.service.ts",
      "src/server/execution/smart-exit-engine.service.ts",
      "src/server/execution/post-trade-settlement.service.ts",
    ],
    integrationPaths: [
      "src/server/execution/position-monitor.service.ts",
    ],
  },
  {
    id: "PNL",
    label: "PnL",
    description: "Profit and loss recording and reporting.",
    modulePaths: [
      "src/server/reports/pnl-report.service.ts",
      "src/server/execution/post-trade-settlement.service.ts",
      "src/server/shadow-outcome/shadow-outcome-engine.ts",
    ],
    integrationPaths: [
      "src/server/execution/post-trade-settlement.service.ts",
    ],
  },
];

export const LEGACY_WORKER_REGISTRY: LegacyWorkerDefinition[] = [
  { id: "market-data-daemon", label: "Market Data Daemon", tier: "CRITICAL", queueName: "market-data", profitImpact: "direct", runtimeClass: "CANONICAL", ownership: "MARKET_DATA" },
  { id: "scanner", label: "Scanner Worker", tier: "CRITICAL", queueName: "scanner", profitImpact: "direct", runtimeClass: "CANONICAL", ownership: "MARKET_SCANNING+CANDIDATE_RANKING" },
  { id: "pump-early-catcher", label: "Pump Early Catcher", tier: "SUPPORTING", profitImpact: "indirect", runtimeClass: "SHADOW_ONLY", ownership: "scanner" },
  { id: "discovery", label: "Discovery Engine", tier: "SUPPORTING", queueName: "discovery", profitImpact: "indirect", runtimeClass: "SHADOW_ONLY" },
  { id: "execution-management", label: "Execution Management", tier: "SUPPORTING", queueName: "execution-management", profitImpact: "indirect", runtimeClass: "LEGACY" },
  { id: "execution-engine-v2", label: "Execution Engine V2", tier: "CRITICAL", queueName: "execution-engine-v2", profitImpact: "direct", runtimeClass: "CANONICAL", ownership: "EXECUTION" },
  { id: "execution-safety", label: "Execution Safety", tier: "SUPPORTING", queueName: "execution-safety", profitImpact: "indirect", runtimeClass: "LEGACY" },
  { id: "decision-replay", label: "Decision Replay", tier: "SUPPORTING", queueName: "decision-replay", profitImpact: "indirect", runtimeClass: "RESEARCH_ONLY" },
  { id: "market-intelligence", label: "Market Intelligence", tier: "SUPPORTING", queueName: "market-intelligence", profitImpact: "indirect", runtimeClass: "RESEARCH_ONLY" },
  { id: "decision-engine", label: "Decision Engine Workers", tier: "SUPPORTING", queueName: "decision-engine", profitImpact: "indirect", runtimeClass: "LEGACY" },
  { id: "shadow-outcome", label: "Shadow Outcome Engine", tier: "SUPPORTING", profitImpact: "none", runtimeClass: "SHADOW_ONLY" },
  { id: "shadow-validation", label: "Shadow Validation", tier: "SUPPORTING", queueName: "shadow-validation", profitImpact: "indirect", runtimeClass: "SHADOW_ONLY" },
  { id: "exchange-simulator", label: "Exchange Simulator", tier: "SUPPORTING", queueName: "exchange-simulator", profitImpact: "indirect", runtimeClass: "RESEARCH_ONLY" },
  { id: "learning-engine", label: "Learning Engine", tier: "SUPPORTING", queueName: "learning-engine", profitImpact: "indirect", runtimeClass: "RESEARCH_ONLY" },
  { id: "learning-platform", label: "Learning Platform", tier: "SUPPORTING", queueName: "learning-platform", profitImpact: "indirect", runtimeClass: "RESEARCH_ONLY" },
  { id: "quant-research", label: "Quant Research", tier: "SUPPORTING", queueName: "quant-research", profitImpact: "indirect", runtimeClass: "RESEARCH_ONLY" },
  { id: "paper-validation", label: "Paper Validation", tier: "SUPPORTING", queueName: "paper-validation", profitImpact: "indirect", runtimeClass: "RESEARCH_ONLY" },
  { id: "live-trading", label: "Live Trading Production", tier: "SUPPORTING", queueName: "live-trading", profitImpact: "indirect", runtimeClass: "LEGACY" },
  { id: "entry-timing", label: "Entry Timing", tier: "SUPPORTING", queueName: "entry-timing", profitImpact: "indirect", runtimeClass: "SHADOW_ONLY" },
  { id: "exit-timing", label: "Exit Timing", tier: "SUPPORTING", queueName: "exit-timing", profitImpact: "indirect", runtimeClass: "SHADOW_ONLY" },
  { id: "strategy-selector", label: "Strategy Selector", tier: "SUPPORTING", queueName: "strategy-selector", profitImpact: "indirect", runtimeClass: "RESEARCH_ONLY" },
  { id: "performance-optimizer", label: "Performance Optimizer", tier: "SUPPORTING", queueName: "performance-optimizer", profitImpact: "indirect", runtimeClass: "RESEARCH_ONLY" },
  { id: "aoc", label: "Autonomous Operations Center", tier: "SUPPORTING", queueName: "aoc", profitImpact: "indirect", runtimeClass: "RESEARCH_ONLY" },
  { id: "ai-governance", label: "AI Governance", tier: "OBSERVE_ONLY", queueName: "ai-governance", profitImpact: "none", runtimeClass: "RESEARCH_ONLY" },
  { id: "news-intelligence", label: "News Intelligence", tier: "OBSERVE_ONLY", queueName: "news-intelligence", profitImpact: "none", runtimeClass: "RESEARCH_ONLY" },
  { id: "whale-intelligence", label: "Whale Intelligence", tier: "OBSERVE_ONLY", queueName: "whale-intelligence", profitImpact: "none", runtimeClass: "RESEARCH_ONLY" },
  { id: "onchain-intelligence", label: "OnChain Intelligence", tier: "OBSERVE_ONLY", queueName: "onchain-intelligence", profitImpact: "none", runtimeClass: "RESEARCH_ONLY" },
  { id: "engineering-intelligence", label: "Engineering Intelligence", tier: "OBSERVE_ONLY", queueName: "engineering-intelligence", profitImpact: "none", runtimeClass: "RESEARCH_ONLY" },
  { id: "meta-intelligence", label: "Meta Intelligence", tier: "OBSERVE_ONLY", queueName: "meta-intelligence", profitImpact: "none", runtimeClass: "RESEARCH_ONLY" },
  { id: "intelligence-fusion", label: "Intelligence Fusion", tier: "OBSERVE_ONLY", queueName: "intelligence-fusion", profitImpact: "none", runtimeClass: "RESEARCH_ONLY" },
  { id: "exchange-abstraction", label: "Exchange Abstraction", tier: "OBSERVE_ONLY", queueName: "exchange-abstraction", profitImpact: "none", runtimeClass: "LEGACY" },
  { id: "event-platform", label: "Event Platform", tier: "OBSERVE_ONLY", queueName: "event-platform", profitImpact: "none", runtimeClass: "RESEARCH_ONLY" },
];

export const HOT_PATH_INTEGRATION_PATTERNS: Array<{ id: string; path: string; pattern: string; stageId: HotPathStageDefinition["id"] }> = [
  { id: "discovery-in-scanner", path: "src/server/scanner/scanner.service.ts", pattern: "runDiscoveryBatch", stageId: "DISCOVERY" },
  { id: "ai-in-execution", path: "src/server/execution/execution-orchestrator.service.ts", pattern: "runAIConsensusFromInput", stageId: "DECISION" },
  { id: "master-decision-return", path: "src/server/ai/analysis-orchestrator.ts", pattern: "adjudicateWithMasterDecisionEngine", stageId: "DECISION" },
  { id: "safety-in-execution", path: "src/server/execution/execution-orchestrator.service.ts", pattern: "runPreTradeSafetyValidation", stageId: "SAFETY" },
  { id: "quality-gate-in-execution", path: "src/server/execution/execution-orchestrator.service.ts", pattern: "evaluateSignalQualityGate", stageId: "ENTRY" },
  { id: "position-monitor-exit", path: "src/server/execution/position-monitor.service.ts", pattern: "evaluateSmartExitEngine", stageId: "EXIT" },
  { id: "entry-timing-wired", path: "src/server/execution/execution-orchestrator.service.ts", pattern: "evaluateEntryForBuyCandidate", stageId: "ENTRY" },
  { id: "exit-timing-wired", path: "src/server/execution/position-monitor.service.ts", pattern: "evaluateExitForOpenPosition", stageId: "EXIT" },
  { id: "execution-engine-v2-wired", path: "src/server/execution/execution-orchestrator.service.ts", pattern: "executeApprovedSpotOrder", stageId: "EXECUTION" },
  { id: "strategy-selector-not-wired", path: "src/server/execution/execution-orchestrator.service.ts", pattern: "strategy-selector", stageId: "DECISION" },
];
