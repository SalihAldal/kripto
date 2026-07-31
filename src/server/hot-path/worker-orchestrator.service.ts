import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { ensureScannerWorkerStarted, getScannerWorkerState } from "@/src/server/scanner/scanner-worker.service";
import { ensurePumpEarlyCatcherStarted, getPumpEarlyCatcherState } from "@/src/server/scanner/pump-early-catcher.service";
import { ensureDecisionReplayWorkersStarted, getDecisionReplayWorkerState } from "@/src/server/replay/decision-replay-workers";
import { ensureMarketIntelWorkersStarted, getMarketIntelWorkerState } from "@/src/server/market-intelligence/market-intelligence-workers";
import { ensureDiscoveryWorkersStarted, getDiscoveryWorkerState } from "@/src/server/discovery/discovery-workers";
import { ensureDecisionEngineWorkersStarted, getDecisionEngineWorkerState } from "@/src/server/decision-engine/decision-engine-workers";
import { ensureShadowValidationWorkersStarted, getShadowValidationWorkerState } from "@/src/server/shadow-validation/shadow-validation-workers";
import { ensureExecutionMgmtWorkersStarted, getExecutionMgmtWorkerState } from "@/src/server/execution-management/execution-management-workers";
import { ensureExecutionEngineV2WorkersStarted, getExecutionEngineV2WorkerState } from "@/src/server/execution-engine-v2/execution-engine-v2.workers";
import { ensureExchangeSimulatorWorkersStarted, getExchangeSimulatorWorkerState } from "@/src/server/exchange-simulator/exchange-simulator-workers";
import { ensureExecutionSafetyWorkersStarted, getExecutionSafetyWorkerState } from "@/src/server/execution-safety/execution-safety-workers";
import { ensureLearningEngineWorkersStarted, getLearningEngineWorkerState } from "@/src/server/learning-engine/learning-engine-workers";
import { ensureLearningPlatformWorkersStarted, getLearningPlatformWorkerState } from "@/src/server/learning-platform/learning-platform.workers";
import { ensureQuantResearchWorkersStarted, getQuantResearchWorkerState } from "@/src/server/quant-research/quant-research-workers";
import { ensurePaperValidationWorkersStarted, getPaperValidationWorkerState } from "@/src/server/paper-validation/paper-validation.workers";
import { ensureLiveTradingWorkersStarted, getLiveTradingWorkerState } from "@/src/server/live-trading/live-trading.workers";
import { ensureAiGovernanceWorkersStarted, getAiGovernanceWorkerState } from "@/src/server/ai-governance/ai-governance-workers";
import { ensureNewsIntelligenceWorkersStarted, getNewsIntelligenceWorkerState } from "@/src/server/news-intelligence/news-intelligence-workers";
import { ensureWhaleIntelligenceWorkersStarted, getWhaleIntelligenceWorkerState } from "@/src/server/whale-intelligence/whale-intelligence-workers";
import { ensureOnChainIntelligenceWorkersStarted, getOnChainIntelligenceWorkerState } from "@/src/server/onchain-intelligence/onchain-intelligence-workers";
import { ensureEngineeringIntelligenceWorkersStarted, getEngineeringIntelligenceWorkerState } from "@/src/server/engineering-intelligence/engineering-intelligence-workers";
import { ensureMetaIntelligenceWorkersStarted, getMetaIntelligenceWorkerState } from "@/src/server/meta-intelligence/meta-intelligence-workers";
import { ensureIntelligenceFusionWorkersStarted, getIntelligenceFusionWorkerState } from "@/src/server/intelligence-fusion/intelligence-fusion-workers";
import { ensureExchangeAbstractionWorkersStarted, getExchangeAbstractionWorkerState } from "@/src/server/exchange-abstraction/exchange-abstraction-workers";
import { ensureEventPlatformWorkersStarted, getEventPlatformWorkerState } from "@/src/server/event-platform/event-platform-workers";
import { ensureAocWorkersStarted, getAocWorkerState } from "@/src/server/aoc/aoc-workers";
import { ensureEntryTimingWorkersStarted, getEntryTimingWorkerState } from "@/src/server/entry-timing/entry-timing-workers";
import { ensureExitTimingWorkersStarted, getExitTimingWorkerState } from "@/src/server/exit-timing/exit-timing-workers";
import { ensureStrategySelectorWorkersStarted, getStrategySelectorWorkerState } from "@/src/server/strategy-selector/strategy-selector-workers";
import { ensurePerfOptWorkersStarted, getPerfOptWorkerState } from "@/src/server/performance-optimizer/performance-optimizer-workers";
import { runHotPathAudit } from "@/src/server/hot-path/hot-path-audit.service";
import {
  buildWorkerSnapshot,
  getWorkerPolicySummary,
  isLegacyWorkerEnabled,
  validateCriticalWorkerBudget,
} from "@/src/server/hot-path/legacy-worker-freeze.service";
import { LEGACY_WORKER_REGISTRY } from "@/src/server/hot-path/hot-path.registry";
import type { HotPathWorkerBootResult, WorkerRuntimeSnapshot } from "@/src/server/hot-path/hot-path.types";

type WorkerStarter = { id: string; start: () => { running: boolean }; getState: () => { running: boolean } };

const WORKER_STARTERS: WorkerStarter[] = [
  { id: "scanner", start: ensureScannerWorkerStarted, getState: getScannerWorkerState },
  { id: "pump-early-catcher", start: ensurePumpEarlyCatcherStarted, getState: getPumpEarlyCatcherState },
  { id: "discovery", start: ensureDiscoveryWorkersStarted, getState: getDiscoveryWorkerState },
  { id: "execution-management", start: ensureExecutionMgmtWorkersStarted, getState: getExecutionMgmtWorkerState },
  { id: "execution-engine-v2", start: ensureExecutionEngineV2WorkersStarted, getState: getExecutionEngineV2WorkerState },
  { id: "execution-safety", start: ensureExecutionSafetyWorkersStarted, getState: getExecutionSafetyWorkerState },
  { id: "decision-replay", start: ensureDecisionReplayWorkersStarted, getState: getDecisionReplayWorkerState },
  { id: "market-intelligence", start: ensureMarketIntelWorkersStarted, getState: getMarketIntelWorkerState },
  { id: "decision-engine", start: ensureDecisionEngineWorkersStarted, getState: getDecisionEngineWorkerState },
  { id: "shadow-validation", start: ensureShadowValidationWorkersStarted, getState: getShadowValidationWorkerState },
  { id: "exchange-simulator", start: ensureExchangeSimulatorWorkersStarted, getState: getExchangeSimulatorWorkerState },
  { id: "learning-engine", start: ensureLearningEngineWorkersStarted, getState: getLearningEngineWorkerState },
  { id: "learning-platform", start: ensureLearningPlatformWorkersStarted, getState: getLearningPlatformWorkerState },
  { id: "quant-research", start: ensureQuantResearchWorkersStarted, getState: getQuantResearchWorkerState },
  { id: "paper-validation", start: ensurePaperValidationWorkersStarted, getState: getPaperValidationWorkerState },
  { id: "live-trading", start: ensureLiveTradingWorkersStarted, getState: getLiveTradingWorkerState },
  { id: "entry-timing", start: ensureEntryTimingWorkersStarted, getState: getEntryTimingWorkerState },
  { id: "exit-timing", start: ensureExitTimingWorkersStarted, getState: getExitTimingWorkerState },
  { id: "strategy-selector", start: ensureStrategySelectorWorkersStarted, getState: getStrategySelectorWorkerState },
  { id: "performance-optimizer", start: ensurePerfOptWorkersStarted, getState: getPerfOptWorkerState },
  { id: "aoc", start: ensureAocWorkersStarted, getState: getAocWorkerState },
  { id: "ai-governance", start: ensureAiGovernanceWorkersStarted, getState: getAiGovernanceWorkerState },
  { id: "news-intelligence", start: ensureNewsIntelligenceWorkersStarted, getState: getNewsIntelligenceWorkerState },
  { id: "whale-intelligence", start: ensureWhaleIntelligenceWorkersStarted, getState: getWhaleIntelligenceWorkerState },
  { id: "onchain-intelligence", start: ensureOnChainIntelligenceWorkersStarted, getState: getOnChainIntelligenceWorkerState },
  { id: "engineering-intelligence", start: ensureEngineeringIntelligenceWorkersStarted, getState: getEngineeringIntelligenceWorkerState },
  { id: "meta-intelligence", start: ensureMetaIntelligenceWorkersStarted, getState: getMetaIntelligenceWorkerState },
  { id: "intelligence-fusion", start: ensureIntelligenceFusionWorkersStarted, getState: getIntelligenceFusionWorkerState },
  { id: "exchange-abstraction", start: ensureExchangeAbstractionWorkersStarted, getState: getExchangeAbstractionWorkerState },
  { id: "event-platform", start: ensureEventPlatformWorkersStarted, getState: getEventPlatformWorkerState },
];

let lastBootResult: HotPathWorkerBootResult | null = null;
let lastWorkerSnapshots: WorkerRuntimeSnapshot[] = [];

export function getHotPathWorkerSnapshots() {
  return [...lastWorkerSnapshots];
}

export function getHotPathWorkerBootResult() {
  return lastBootResult;
}

export async function bootHotPathWorkers(): Promise<HotPathWorkerBootResult> {
  const workers: WorkerRuntimeSnapshot[] = [];

  for (const starter of WORKER_STARTERS) {
    const definition = LEGACY_WORKER_REGISTRY.find((w) => w.id === starter.id);
    if (!definition) continue;

    if (!isLegacyWorkerEnabled(definition)) {
      workers.push(buildWorkerSnapshot(starter.id, false));
      continue;
    }

    const state = starter.start();
    workers.push(buildWorkerSnapshot(starter.id, state.running));
  }

  const activeCount = workers.filter((w) => w.enabled && w.running).length;
  const frozenCount = workers.filter((w) => !w.enabled).length;
  const criticalActive = workers.filter((w) => w.enabled && w.running && w.tier === "CRITICAL").length;

  const budget = validateCriticalWorkerBudget(criticalActive);
  if (!budget.ok) {
    logger.warn({ message: budget.message }, "Hot path critical worker budget exceeded");
  }

  const result: HotPathWorkerBootResult = {
    workers,
    activeCount,
    frozenCount,
    freezeEnabled: env.HOT_PATH_V2_FREEZE_ENABLED,
    legacyWorkersEnabled: env.HOT_PATH_LEGACY_WORKERS_ENABLED,
  };

  lastBootResult = result;
  lastWorkerSnapshots = workers;

  logger.info(
    {
      appEnv: env.APP_ENV,
      appRole: env.APP_ROLE,
      hotPathFreezeEnabled: env.HOT_PATH_V2_FREEZE_ENABLED,
      legacyWorkersEnabled: env.HOT_PATH_LEGACY_WORKERS_ENABLED,
      activeWorkerCount: activeCount,
      frozenWorkerCount: frozenCount,
      criticalActive,
      workers: workers.map((w) => ({ id: w.id, enabled: w.enabled, running: w.running, tier: w.tier })),
    },
    "Hot path worker orchestrator booted",
  );

  void runHotPathAudit(workers).catch((error) => {
    logger.warn({ error: (error as Error).message }, "Hot path boot audit failed");
  });

  return result;
}

export function collectWorkerHeartbeatSnapshots(): WorkerRuntimeSnapshot[] {
  return WORKER_STARTERS.map((starter) => {
    const state = starter.getState();
    return buildWorkerSnapshot(starter.id, state.running);
  });
}

export function getHotPathStatusPayload() {
  return {
    policy: getWorkerPolicySummary(),
    boot: lastBootResult,
    workers: lastWorkerSnapshots.length > 0 ? lastWorkerSnapshots : collectWorkerHeartbeatSnapshots(),
  };
}
