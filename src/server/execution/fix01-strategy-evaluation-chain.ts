import type { DeepMarketState } from "@/src/server/market-data/spine/events";
import type { RegimeSnapshot, StrategyInput } from "@/src/server/forensics/p4-regime-strategy-shadow";
import { routeStrategiesWithDetails } from "@/src/server/forensics/p4-regime-strategy-shadow";
import {
  buildSelectedStrategySignal,
  type SelectedStrategySignal,
} from "@/src/server/execution/fix01-selected-signal";
import {
  buildStrategyEvaluationContexts,
  type StrategyContextBuildResult,
} from "@/src/server/execution/fix01-strategy-context-builder";
import { buildPr04ExitMetadataFromSelectedSignal } from "@/src/server/profitability/pr04-exit-bridge";

export type Fix01StrategyEvaluationChainInput = {
  symbol: string;
  venue?: string | null;
  candidateId: string;
  lifecycleId: string;
  featureSnapshotId: string;
  decisionAtMs: number;
  strategyInput: StrategyInput;
  regime: RegimeSnapshot;
  deepState?: DeepMarketState | null;
  baselinePrice?: number | null;
  firstDetectionPrice?: number | null;
};

export type Fix01StrategyEvaluationChainResult = {
  contexts: StrategyContextBuildResult;
  routerInput: StrategyInput;
  router: ReturnType<typeof routeStrategiesWithDetails>;
  selectedSignal: SelectedStrategySignal | null;
  entryMetadata: ReturnType<typeof buildPr04ExitMetadataFromSelectedSignal> | null;
};

export function runFix01StrategyEvaluationChain(
  input: Fix01StrategyEvaluationChainInput,
): Fix01StrategyEvaluationChainResult {
  const contexts = buildStrategyEvaluationContexts({
    symbol: input.symbol,
    venue: input.venue,
    candidateId: input.candidateId,
    lifecycleId: input.lifecycleId,
    featureSnapshotId: input.featureSnapshotId,
    decisionAtMs: input.decisionAtMs,
    baselinePrice: input.baselinePrice,
    firstDetectionPrice: input.firstDetectionPrice,
    deepState: input.deepState,
  });
  const routerInput: StrategyInput = {
    ...input.strategyInput,
    earlyContext: contexts.earlyContext,
    strategyContext: contexts.strategyContext,
  };
  const router = routeStrategiesWithDetails(routerInput, input.regime);
  const selectedSignal = buildSelectedStrategySignal(router.preferredStrategy, router);
  const entryMetadata = selectedSignal
    ? buildPr04ExitMetadataFromSelectedSignal({
        positionId: `pos-${input.candidateId}`,
        selectedSignal,
      })
    : null;
  return { contexts, routerInput, router, selectedSignal, entryMetadata };
}
