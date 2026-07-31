-- CreateEnum
CREATE TYPE "OnChainIntelligenceJobType" AS ENUM ('BLOCKCHAIN_COLLECT', 'ADDRESS_ANALYZE', 'TX_METRICS', 'EXCHANGE_RESERVE', 'SUPPLY_TRACK', 'STAKING_TRACK', 'DEFI_TRACK', 'BRIDGE_TRACK', 'CONTRACT_TRACK', 'DEVELOPER_TRACK', 'PROTOCOL_HEALTH', 'ONCHAIN_SCORE', 'REPLAY_ANALYZE', 'METRIC_LEARN', 'KNOWLEDGE_BUILD');

-- CreateEnum
CREATE TYPE "OnChainNetwork" AS ENUM ('BITCOIN', 'ETHEREUM', 'BNB', 'SOLANA', 'BASE', 'ARBITRUM', 'OPTIMISM', 'POLYGON', 'AVALANCHE', 'TRON', 'SUI', 'APTOS');

-- CreateEnum
CREATE TYPE "AddressActivityType" AS ENUM ('ACTIVE', 'NEW', 'RETURNING', 'DORMANT', 'WHALE', 'EXCHANGE', 'TREASURY', 'FOUNDATION', 'VC', 'SMART_CONTRACT');

-- CreateEnum
CREATE TYPE "KnowledgeGraphNodeType" AS ENUM ('WALLET', 'PROTOCOL', 'TOKEN', 'NARRATIVE', 'DEVELOPER', 'FUND', 'EXCHANGE', 'WHALE', 'CHAIN');

-- CreateTable
CREATE TABLE "BlockchainSnapshot" (
    "id" TEXT NOT NULL,
    "network" "OnChainNetwork" NOT NULL,
    "blockHeight" INTEGER,
    "activeAddresses" INTEGER NOT NULL DEFAULT 0,
    "txCount" INTEGER NOT NULL DEFAULT 0,
    "gasUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gasPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tps" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "source" TEXT NOT NULL DEFAULT 'simulated',
    "reliability" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "freshness" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "metadata" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BlockchainSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddressActivity" (
    "id" TEXT NOT NULL,
    "network" "OnChainNetwork" NOT NULL,
    "address" TEXT NOT NULL,
    "activityType" "AddressActivityType" NOT NULL,
    "txCount" INTEGER NOT NULL DEFAULT 0,
    "volumeUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastActiveAt" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "source" TEXT NOT NULL DEFAULT 'simulated',
    "reliability" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "historicalAccuracy" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "freshness" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AddressActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionMetrics" (
    "id" TEXT NOT NULL,
    "network" "OnChainNetwork" NOT NULL,
    "asset" TEXT,
    "txCount" INTEGER NOT NULL DEFAULT 0,
    "largeTransfers" INTEGER NOT NULL DEFAULT 0,
    "medianTransferUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "averageTransferUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "txGrowthPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gasUsage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gasTrend" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "transferVelocity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "source" TEXT NOT NULL DEFAULT 'simulated',
    "reliability" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "historicalAccuracy" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "freshness" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TransactionMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeReserve" (
    "id" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "network" "OnChainNetwork" NOT NULL,
    "asset" TEXT NOT NULL,
    "depositsUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "withdrawalsUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netFlowUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hotWalletUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "coldWalletUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reserveChangePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "source" TEXT NOT NULL DEFAULT 'simulated',
    "reliability" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "freshness" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExchangeReserve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyMetrics" (
    "id" TEXT NOT NULL,
    "network" "OnChainNetwork" NOT NULL,
    "asset" TEXT NOT NULL,
    "circulatingSupply" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalSupply" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxSupply" DOUBLE PRECISION,
    "burnEvents" INTEGER NOT NULL DEFAULT 0,
    "mintEvents" INTEGER NOT NULL DEFAULT 0,
    "unlockEvents" INTEGER NOT NULL DEFAULT 0,
    "vestingLocked" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "emissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inflationRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "source" TEXT NOT NULL DEFAULT 'simulated',
    "reliability" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "freshness" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplyMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StakingMetrics" (
    "id" TEXT NOT NULL,
    "network" "OnChainNetwork" NOT NULL,
    "asset" TEXT NOT NULL,
    "totalStaked" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "newStakers" INTEGER NOT NULL DEFAULT 0,
    "unstakingEvents" INTEGER NOT NULL DEFAULT 0,
    "validatorCount" INTEGER NOT NULL DEFAULT 0,
    "stakingYield" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lockedSupplyPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "source" TEXT NOT NULL DEFAULT 'simulated',
    "reliability" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "freshness" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StakingMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeFiMetrics" (
    "id" TEXT NOT NULL,
    "network" "OnChainNetwork" NOT NULL,
    "protocol" TEXT,
    "tvlUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tvlGrowthPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dexVolumeUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "borrowVolumeUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lendVolumeUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "liquidationsUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stablecoinSupply" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "poolCount" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "source" TEXT NOT NULL DEFAULT 'simulated',
    "reliability" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "freshness" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeFiMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BridgeMetrics" (
    "id" TEXT NOT NULL,
    "bridgeName" TEXT NOT NULL,
    "fromNetwork" "OnChainNetwork" NOT NULL,
    "toNetwork" "OnChainNetwork" NOT NULL,
    "inflowUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outflowUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "volumeUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "txCount" INTEGER NOT NULL DEFAULT 0,
    "netMigrationUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "source" TEXT NOT NULL DEFAULT 'simulated',
    "reliability" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "freshness" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BridgeMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeveloperMetrics" (
    "id" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "repoUrl" TEXT,
    "commits" INTEGER NOT NULL DEFAULT 0,
    "contributors" INTEGER NOT NULL DEFAULT 0,
    "releases" INTEGER NOT NULL DEFAULT 0,
    "openIssues" INTEGER NOT NULL DEFAULT 0,
    "pullRequests" INTEGER NOT NULL DEFAULT 0,
    "devVelocity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "source" TEXT NOT NULL DEFAULT 'simulated',
    "reliability" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "freshness" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeveloperMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtocolHealth" (
    "id" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "network" "OnChainNetwork" NOT NULL,
    "networkActivity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "security" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adoption" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "growth" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "developerActivity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tvl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "liquidity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "decentralization" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overallHealth" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "source" TEXT NOT NULL DEFAULT 'simulated',
    "reliability" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "historicalAccuracy" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "freshness" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProtocolHealth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnChainScore" (
    "id" TEXT NOT NULL,
    "protocol" TEXT,
    "network" "OnChainNetwork" NOT NULL,
    "asset" TEXT,
    "accumulationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adoptionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "growthScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "riskScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "protocolScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "networkScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "source" TEXT NOT NULL DEFAULT 'simulated',
    "reliability" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "historicalAccuracy" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "freshness" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "metadata" JSONB,
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OnChainScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeGraphNode" (
    "id" TEXT NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "nodeType" "KnowledgeGraphNodeType" NOT NULL,
    "label" TEXT NOT NULL,
    "network" "OnChainNetwork",
    "metadata" JSONB,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeGraphNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeGraphEdge" (
    "id" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeGraphEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnChainReplay" (
    "id" TEXT NOT NULL,
    "network" "OnChainNetwork" NOT NULL,
    "eventType" TEXT NOT NULL,
    "protocol" TEXT,
    "asset" TEXT,
    "symbol" TEXT,
    "priceAtEvent" DOUBLE PRECISION,
    "maxMovePct" DOUBLE PRECISION,
    "minMovePct" DOUBLE PRECISION,
    "reactionDelayMs" INTEGER,
    "similarEventIds" TEXT[],
    "historicalAccuracy" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "metadata" JSONB,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "replayedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OnChainReplay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnChainIntelligenceJobState" (
    "id" TEXT NOT NULL,
    "jobType" "OnChainIntelligenceJobType" NOT NULL,
    "lastProcessedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OnChainIntelligenceJobState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BlockchainSnapshot_network_capturedAt_idx" ON "BlockchainSnapshot"("network", "capturedAt");
CREATE INDEX "BlockchainSnapshot_capturedAt_idx" ON "BlockchainSnapshot"("capturedAt");
CREATE INDEX "AddressActivity_network_activityType_recordedAt_idx" ON "AddressActivity"("network", "activityType", "recordedAt");
CREATE INDEX "AddressActivity_address_network_idx" ON "AddressActivity"("address", "network");
CREATE INDEX "AddressActivity_recordedAt_idx" ON "AddressActivity"("recordedAt");
CREATE INDEX "TransactionMetrics_network_periodEnd_idx" ON "TransactionMetrics"("network", "periodEnd");
CREATE INDEX "TransactionMetrics_asset_periodEnd_idx" ON "TransactionMetrics"("asset", "periodEnd");
CREATE INDEX "ExchangeReserve_exchange_periodEnd_idx" ON "ExchangeReserve"("exchange", "periodEnd");
CREATE INDEX "ExchangeReserve_network_asset_periodEnd_idx" ON "ExchangeReserve"("network", "asset", "periodEnd");
CREATE INDEX "SupplyMetrics_network_asset_recordedAt_idx" ON "SupplyMetrics"("network", "asset", "recordedAt");
CREATE INDEX "StakingMetrics_network_asset_recordedAt_idx" ON "StakingMetrics"("network", "asset", "recordedAt");
CREATE INDEX "DeFiMetrics_network_periodEnd_idx" ON "DeFiMetrics"("network", "periodEnd");
CREATE INDEX "DeFiMetrics_protocol_periodEnd_idx" ON "DeFiMetrics"("protocol", "periodEnd");
CREATE INDEX "DeFiMetrics_tvlUsd_periodEnd_idx" ON "DeFiMetrics"("tvlUsd", "periodEnd");
CREATE INDEX "BridgeMetrics_bridgeName_periodEnd_idx" ON "BridgeMetrics"("bridgeName", "periodEnd");
CREATE INDEX "BridgeMetrics_fromNetwork_toNetwork_periodEnd_idx" ON "BridgeMetrics"("fromNetwork", "toNetwork", "periodEnd");
CREATE INDEX "DeveloperMetrics_protocol_periodEnd_idx" ON "DeveloperMetrics"("protocol", "periodEnd");
CREATE INDEX "DeveloperMetrics_devVelocity_periodEnd_idx" ON "DeveloperMetrics"("devVelocity", "periodEnd");
CREATE INDEX "ProtocolHealth_protocol_scoredAt_idx" ON "ProtocolHealth"("protocol", "scoredAt");
CREATE INDEX "ProtocolHealth_overallHealth_scoredAt_idx" ON "ProtocolHealth"("overallHealth", "scoredAt");
CREATE INDEX "ProtocolHealth_network_scoredAt_idx" ON "ProtocolHealth"("network", "scoredAt");
CREATE INDEX "OnChainScore_network_scoredAt_idx" ON "OnChainScore"("network", "scoredAt");
CREATE INDEX "OnChainScore_protocol_scoredAt_idx" ON "OnChainScore"("protocol", "scoredAt");
CREATE INDEX "OnChainScore_protocolScore_scoredAt_idx" ON "OnChainScore"("protocolScore", "scoredAt");
CREATE UNIQUE INDEX "KnowledgeGraphNode_nodeKey_key" ON "KnowledgeGraphNode"("nodeKey");
CREATE INDEX "KnowledgeGraphNode_nodeType_weight_idx" ON "KnowledgeGraphNode"("nodeType", "weight");
CREATE INDEX "KnowledgeGraphNode_network_idx" ON "KnowledgeGraphNode"("network");
CREATE INDEX "KnowledgeGraphEdge_fromNodeId_relation_idx" ON "KnowledgeGraphEdge"("fromNodeId", "relation");
CREATE INDEX "KnowledgeGraphEdge_toNodeId_relation_idx" ON "KnowledgeGraphEdge"("toNodeId", "relation");
CREATE INDEX "KnowledgeGraphEdge_relation_weight_idx" ON "KnowledgeGraphEdge"("relation", "weight");
CREATE INDEX "OnChainReplay_network_eventAt_idx" ON "OnChainReplay"("network", "eventAt");
CREATE INDEX "OnChainReplay_protocol_replayedAt_idx" ON "OnChainReplay"("protocol", "replayedAt");
CREATE INDEX "OnChainReplay_symbol_replayedAt_idx" ON "OnChainReplay"("symbol", "replayedAt");
CREATE UNIQUE INDEX "OnChainIntelligenceJobState_jobType_key" ON "OnChainIntelligenceJobState"("jobType");

-- AddForeignKey
ALTER TABLE "KnowledgeGraphEdge" ADD CONSTRAINT "KnowledgeGraphEdge_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "KnowledgeGraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeGraphEdge" ADD CONSTRAINT "KnowledgeGraphEdge_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "KnowledgeGraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
