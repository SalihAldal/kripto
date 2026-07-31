import { collectBlockchainData } from "@/src/server/onchain-intelligence/blockchain-collector.service";
import { analyzeAddressActivity } from "@/src/server/onchain-intelligence/address-intelligence.service";
import { computeTransactionMetrics } from "@/src/server/onchain-intelligence/transaction-intelligence.service";
import { trackExchangeReserves } from "@/src/server/onchain-intelligence/exchange-intelligence.service";
import { trackSupplyMetrics } from "@/src/server/onchain-intelligence/supply-intelligence.service";
import { trackStakingMetrics } from "@/src/server/onchain-intelligence/staking-intelligence.service";
import { trackDeFiMetrics } from "@/src/server/onchain-intelligence/defi-intelligence.service";
import { trackBridgeMetrics } from "@/src/server/onchain-intelligence/bridge-intelligence.service";
import { trackSmartContractActivity } from "@/src/server/onchain-intelligence/smart-contract-intelligence.service";
import { trackDeveloperActivity } from "@/src/server/onchain-intelligence/developer-intelligence.service";
import { scoreProtocolHealth } from "@/src/server/onchain-intelligence/protocol-health.service";
import { computeOnChainScore, scoreRecentProtocols } from "@/src/server/onchain-intelligence/onchain-score.service";
import { replayOnChainEvent, replayRecentEvents } from "@/src/server/onchain-intelligence/onchain-replay.service";
import { learnFromOnChainMetrics } from "@/src/server/onchain-intelligence/onchain-learning.service";
import { buildKnowledgeGraph } from "@/src/server/onchain-intelligence/knowledge-graph.service";
import type { OnChainIntelligenceJobPayload } from "@/src/server/onchain-intelligence/onchain-intelligence.types";

export async function runOnChainIntelligenceJob(payload: OnChainIntelligenceJobPayload) {
  switch (payload.type) {
    case "BLOCKCHAIN_COLLECT":
      return collectBlockchainData(payload.network, payload.limit);
    case "ADDRESS_ANALYZE":
      return analyzeAddressActivity(payload.network, payload.limit);
    case "TX_METRICS":
      return computeTransactionMetrics(payload.network, payload.limit);
    case "EXCHANGE_RESERVE":
      return trackExchangeReserves(payload.exchange, payload.limit);
    case "SUPPLY_TRACK":
      return trackSupplyMetrics(payload.network, payload.limit);
    case "STAKING_TRACK":
      return trackStakingMetrics(payload.network, payload.limit);
    case "DEFI_TRACK":
      return trackDeFiMetrics(payload.network, payload.limit);
    case "BRIDGE_TRACK":
      return trackBridgeMetrics(payload.limit);
    case "CONTRACT_TRACK":
      return trackSmartContractActivity(payload.network, payload.limit);
    case "DEVELOPER_TRACK":
      return trackDeveloperActivity(payload.limit);
    case "PROTOCOL_HEALTH":
      return scoreProtocolHealth(payload.protocol, payload.limit);
    case "ONCHAIN_SCORE":
      return payload.protocol || payload.network
        ? computeOnChainScore(payload.protocol, payload.network)
        : scoreRecentProtocols(payload.limit);
    case "REPLAY_ANALYZE":
      return payload.eventId ? replayOnChainEvent(payload.eventId) : replayRecentEvents(payload.limit);
    case "METRIC_LEARN":
      return learnFromOnChainMetrics(payload.limit);
    case "KNOWLEDGE_BUILD":
      return buildKnowledgeGraph(payload.limit);
    default:
      return { skipped: true };
  }
}
