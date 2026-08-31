/**
 * Phase 1 canonical production trading pipeline.
 *
 * MARKET DATA → OPPORTUNITY / SIGNAL → DETERMINISTIC RISK → EXECUTION → POSITION → TELEMETRY
 *
 * Parallel V1/V2/S2/legacy engines remain in the repo but must not enter this path.
 */

export const CANONICAL_PIPELINE_STAGES = [
  "MARKET_DATA",
  "OPPORTUNITY_SIGNAL",
  "DETERMINISTIC_RISK",
  "EXECUTION",
  "POSITION_MANAGEMENT",
  "OUTCOME_TELEMETRY",
] as const;

export type CanonicalPipelineStage = (typeof CANONICAL_PIPELINE_STAGES)[number];

export type RuntimeServiceClass = "CANONICAL" | "LEGACY" | "SHADOW_ONLY" | "RESEARCH_ONLY" | "DISABLED";

export type CanonicalAuthority =
  | "MARKET_DATA"
  | "MARKET_SCANNING"
  | "CANDIDATE_RANKING"
  | "SIGNAL_SCORING"
  | "OPPORTUNITY"
  | "MICROSTRUCTURE"
  | "RISK"
  | "EXECUTION"
  | "POSITION_MONITORING";

export const CANONICAL_ENTRY_POINT = "src/server/execution/execution-orchestrator.service.ts::executeAnalyzeAndTrade";

export const CANONICAL_CALL_CHAIN = [
  "src/server/market-data/spine/market-data-daemon.ts",
  "src/server/market-data/market-data-gateway.ts",
  "src/server/opportunity/opportunity-engine.ts",
  "src/server/microstructure/microstructure-engine.ts",
  "src/server/microstructure/final-ranker.ts",
  "src/server/scanner/scanner.service.ts",
  "src/server/scanner/signal-scoring.engine.ts",
  "src/server/scanner/candidate-ranking.service.ts",
  "src/server/scanner/fast-entry.service.ts",
  "src/server/risk/canonical-risk-decision.service.ts",
  "src/server/execution/execution-orchestrator.service.ts",
  "src/server/execution-engine-v2",
  "src/server/execution/position-monitor.service.ts",
  "src/server/hot-path/candidate-pipeline-trace.service.ts",
  "src/server/shadow-outcome/shadow-outcome-engine.ts",
  "src/server/paper-runtime/paper-engine.ts",
] as const;

export const SERVICE_RUNTIME_CLASS: Record<string, RuntimeServiceClass> = {
  "opportunity-engine": "CANONICAL",
  "microstructure-engine": "CANONICAL",
  "final-ranker": "CANONICAL",
  "scanner.service": "CANONICAL",
  "signal-scoring.engine": "CANONICAL",
  "candidate-ranking.service": "CANONICAL",
  "fast-entry.service": "CANONICAL",
  "market-data-gateway": "CANONICAL",
  "market-data-daemon": "CANONICAL",
  "canonical-risk-decision": "CANONICAL",
  "execution-orchestrator": "CANONICAL",
  "execution-engine-v2": "CANONICAL",
  "position-monitor": "CANONICAL",
  "analysis-orchestrator": "SHADOW_ONLY",
  "hybrid-decision-engine": "SHADOW_ONLY",
  "ai-execution-gate": "SHADOW_ONLY",
  "tdi": "SHADOW_ONLY",
  "shadow-outcome-engine": "SHADOW_ONLY",
  "paper-runtime": "CANONICAL",
  "paper-execution-adapter": "CANONICAL",
  "binance-live-execution-adapter": "DISABLED",
  "decision-engine": "LEGACY",
  "decision-engine-v2": "SHADOW_ONLY",
  "trading-core-s2": "SHADOW_ONLY",
  "discovery": "SHADOW_ONLY",
  "pump-early-catcher-worker": "SHADOW_ONLY",
  "top-gainer-discovery": "SHADOW_ONLY",
  "intelligence-fusion": "RESEARCH_ONLY",
  "learning-engine": "RESEARCH_ONLY",
  "learning-platform": "RESEARCH_ONLY",
  "quant-research": "RESEARCH_ONLY",
  "execution-management-worker": "LEGACY",
  "execution-safety-worker": "LEGACY",
  "live-trading-worker": "LEGACY",
};

export const CANONICAL_AUTHORITY_OWNERS: Record<CanonicalAuthority, string> = {
  MARKET_DATA: "market-data-daemon",
  MARKET_SCANNING: "opportunity-engine",
  CANDIDATE_RANKING: "final-ranker",
  SIGNAL_SCORING: "signal-scoring.engine",
  OPPORTUNITY: "opportunity-engine",
  MICROSTRUCTURE: "microstructure-engine",
  RISK: "canonical-risk-decision",
  EXECUTION: "execution-engine-v2",
  POSITION_MONITORING: "position-monitor",
};

export const PRODUCTION_FORBIDDEN_HOT_PATH_MODULES = [
  "src/server/decision-engine-v2",
  "src/server/trading-core-s2",
  "src/server/intelligence-fusion",
  "src/server/learning-engine",
  "src/server/learning-platform",
  "src/server/quant-research",
] as const;

export function getServiceRuntimeClass(id: string): RuntimeServiceClass {
  return SERVICE_RUNTIME_CLASS[id] ?? "LEGACY";
}

export function isCanonicalProductionService(id: string): boolean {
  return getServiceRuntimeClass(id) === "CANONICAL";
}

export function isProductionHotPathForbidden(modulePath: string): boolean {
  const normalized = modulePath.replaceAll("\\", "/");
  return PRODUCTION_FORBIDDEN_HOT_PATH_MODULES.some((prefix) => normalized.includes(prefix));
}
