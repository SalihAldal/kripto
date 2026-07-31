import type {
  AddressActivityType,
  KnowledgeGraphNodeType,
  OnChainIntelligenceJobType,
  OnChainNetwork,
} from "@prisma/client";

export type OnChainIntelligenceJobPayload =
  | { type: "BLOCKCHAIN_COLLECT"; network?: OnChainNetwork; limit?: number }
  | { type: "ADDRESS_ANALYZE"; network?: OnChainNetwork; limit?: number }
  | { type: "TX_METRICS"; network?: OnChainNetwork; limit?: number }
  | { type: "EXCHANGE_RESERVE"; exchange?: string; limit?: number }
  | { type: "SUPPLY_TRACK"; network?: OnChainNetwork; limit?: number }
  | { type: "STAKING_TRACK"; network?: OnChainNetwork; limit?: number }
  | { type: "DEFI_TRACK"; network?: OnChainNetwork; limit?: number }
  | { type: "BRIDGE_TRACK"; limit?: number }
  | { type: "CONTRACT_TRACK"; network?: OnChainNetwork; limit?: number }
  | { type: "DEVELOPER_TRACK"; limit?: number }
  | { type: "PROTOCOL_HEALTH"; protocol?: string; limit?: number }
  | { type: "ONCHAIN_SCORE"; protocol?: string; network?: OnChainNetwork; limit?: number }
  | { type: "REPLAY_ANALYZE"; eventId?: string; limit?: number }
  | { type: "METRIC_LEARN"; limit?: number }
  | { type: "KNOWLEDGE_BUILD"; limit?: number };

export type MetricQuality = {
  confidence: number;
  source: string;
  reliability: number;
  historicalAccuracy?: number;
  freshness: number;
};

export type OnChainScoreResult = {
  accumulationScore: number;
  adoptionScore: number;
  growthScore: number;
  riskScore: number;
  protocolScore: number;
  networkScore: number;
  confidence: number;
};

export const SUPPORTED_NETWORKS: OnChainNetwork[] = [
  "BITCOIN", "ETHEREUM", "BNB", "SOLANA", "BASE", "ARBITRUM",
  "OPTIMISM", "POLYGON", "AVALANCHE", "TRON", "SUI", "APTOS",
];

export const DEFAULT_PROTOCOLS = [
  { protocol: "Uniswap", network: "ETHEREUM" as OnChainNetwork, asset: "UNI" },
  { protocol: "Aave", network: "ETHEREUM" as OnChainNetwork, asset: "AAVE" },
  { protocol: "Lido", network: "ETHEREUM" as OnChainNetwork, asset: "LDO" },
  { protocol: "PancakeSwap", network: "BNB" as OnChainNetwork, asset: "CAKE" },
  { protocol: "Jupiter", network: "SOLANA" as OnChainNetwork, asset: "JUP" },
  { protocol: "Arbitrum", network: "ARBITRUM" as OnChainNetwork, asset: "ARB" },
  { protocol: "Optimism", network: "OPTIMISM" as OnChainNetwork, asset: "OP" },
  { protocol: "Polygon", network: "POLYGON" as OnChainNetwork, asset: "MATIC" },
  { protocol: "Avalanche", network: "AVALANCHE" as OnChainNetwork, asset: "AVAX" },
  { protocol: "Sui", network: "SUI" as OnChainNetwork, asset: "SUI" },
];

export const DEFAULT_EXCHANGES = ["BINANCE", "COINBASE", "KRAKEN", "OKX", "BYBIT"] as const;

export const DEFAULT_BRIDGES = [
  { name: "Wormhole", from: "ETHEREUM" as OnChainNetwork, to: "SOLANA" as OnChainNetwork },
  { name: "Stargate", from: "ETHEREUM" as OnChainNetwork, to: "ARBITRUM" as OnChainNetwork },
  { name: "Across", from: "ETHEREUM" as OnChainNetwork, to: "BASE" as OnChainNetwork },
  { name: "LayerZero", from: "BNB" as OnChainNetwork, to: "AVALANCHE" as OnChainNetwork },
];

export const ONCHAIN_EVENT = {
  SNAPSHOT_CAPTURED: "BlockchainSnapshotCaptured",
  ADDRESS_ANALYZED: "AddressActivityAnalyzed",
  TX_METRICS_COMPUTED: "TransactionMetricsComputed",
  EXCHANGE_RESERVE_UPDATED: "ExchangeReserveUpdated",
  SUPPLY_TRACKED: "SupplyMetricsTracked",
  STAKING_TRACKED: "StakingMetricsTracked",
  DEFI_TRACKED: "DeFiMetricsTracked",
  BRIDGE_TRACKED: "BridgeMetricsTracked",
  PROTOCOL_HEALTH_SCORED: "ProtocolHealthScored",
  ONCHAIN_SCORE_COMPUTED: "OnChainScoreComputed",
  REPLAY_COMPLETED: "OnChainReplayCompleted",
  KNOWLEDGE_UPDATED: "KnowledgeGraphUpdated",
} as const;

export type { AddressActivityType, KnowledgeGraphNodeType, OnChainIntelligenceJobType, OnChainNetwork };
