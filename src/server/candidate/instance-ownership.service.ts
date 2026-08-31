import { getMarketDataDaemon } from "@/src/server/market-data/spine/market-data-daemon";
import { getOpportunityEngine } from "@/src/server/opportunity/opportunity-engine";
import { getMicrostructureEngine } from "@/src/server/microstructure/microstructure-engine";
import { getCanonicalCandidateStore } from "@/src/server/candidate/candidate-store.service";
import { getShadowOutcomeEngine } from "@/src/server/shadow-outcome/shadow-outcome-engine";
import { createRuntimeInstanceId } from "@/src/server/runtime/instance-id";
import { getCanonicalAuthorityCounters } from "@/src/server/execution/authority-counters.service";

const riskEngineInstanceId = createRuntimeInstanceId("risk-engine");
const paperExecutionAdapterInstanceId = createRuntimeInstanceId("paper-execution-adapter");

export function getCanonicalInstanceOwnership() {
  const market = getMarketDataDaemon();
  const opportunity = getOpportunityEngine();
  const micro = getMicrostructureEngine();
  const store = getCanonicalCandidateStore();
  const shadow = getShadowOutcomeEngine();
  const counters = getCanonicalAuthorityCounters();
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
    candidateAuthority: `CandidateStore:${store.instanceId}`,
    microAuthority: `MicrostructureEngine:${micro.instanceId}`,
    rankAuthority: `FinalRanker:${micro.finalRankerInstanceId}`,
    riskAuthority: `RiskEngine:${riskEngineInstanceId}`,
    executionAuthority: `PaperExecutionAdapter:${paperExecutionAdapterInstanceId}`,
    counters,
  };
}
