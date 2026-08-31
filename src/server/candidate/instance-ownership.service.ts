import { getMarketDataDaemon } from "@/src/server/market-data/spine/market-data-daemon";
import { getOpportunityEngine } from "@/src/server/opportunity/opportunity-engine";
import { getMicrostructureEngine } from "@/src/server/microstructure/microstructure-engine";
import { getCanonicalCandidateStore } from "@/src/server/candidate/candidate-store.service";
import { getShadowOutcomeEngine } from "@/src/server/shadow-outcome/shadow-outcome-engine";
import { createRuntimeInstanceId } from "@/src/server/runtime/instance-id";

const riskEngineInstanceId = createRuntimeInstanceId("risk-engine");
const paperExecutionAdapterInstanceId = createRuntimeInstanceId("paper-execution-adapter");

export function getCanonicalInstanceOwnership() {
  const market = getMarketDataDaemon();
  const opportunity = getOpportunityEngine();
  const micro = getMicrostructureEngine();
  const store = getCanonicalCandidateStore();
  const shadow = getShadowOutcomeEngine();
  return {
    processId: process.pid,
    marketDataDaemonInstanceId: market.instanceId,
    dynamicSubscriptionManagerInstanceId: market.subscriptions.instanceId,
    opportunityEngineInstanceId: opportunity.instanceId,
    candidateStoreInstanceId: store.instanceId,
    microstructureEngineInstanceId: micro.instanceId,
    finalRankerInstanceId: micro.finalRankerInstanceId,
    riskEngineInstanceId,
    paperExecutionAdapterInstanceId,
    shadowOutcomeEngineInstanceId: shadow.instanceId,
  };
}
