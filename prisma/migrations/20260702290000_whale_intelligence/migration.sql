-- CreateEnum
CREATE TYPE "WhaleIntelligenceJobType" AS ENUM ('WHALE_DETECT', 'WALLET_MONITOR', 'EXCHANGE_FLOW', 'STABLECOIN_FLOW', 'FLOW_CALCULATE', 'WHALE_SCORE', 'LIQUIDITY_ROTATION', 'PATTERN_DETECT', 'REPLAY_ANALYZE', 'INSTITUTIONAL_LEARN', 'ALERT_GENERATE');

-- CreateEnum
CREATE TYPE "ChainType" AS ENUM ('ETHEREUM', 'BNB', 'SOLANA', 'BASE', 'ARBITRUM', 'OPTIMISM', 'AVALANCHE', 'POLYGON', 'TRON', 'BITCOIN');

-- CreateEnum
CREATE TYPE "WalletTagType" AS ENUM ('EXCHANGE', 'WHALE', 'SMART_MONEY', 'FUND', 'FOUNDATION', 'TREASURY', 'VC', 'TEAM', 'MARKET_MAKER');

-- CreateEnum
CREATE TYPE "WhaleTransactionType" AS ENUM ('SPOT_ORDER', 'FUTURES_ORDER', 'WALLET_TRANSFER', 'EXCHANGE_DEPOSIT', 'EXCHANGE_WITHDRAWAL', 'STABLECOIN_MOVEMENT', 'ETF_FLOW', 'INSTITUTIONAL');

-- CreateEnum
CREATE TYPE "FlowDirection" AS ENUM ('INFLOW', 'OUTFLOW');

-- CreateEnum
CREATE TYPE "WhaleAlertType" AS ENUM ('MASSIVE_BUY', 'MASSIVE_SELL', 'EXCHANGE_DRAIN', 'EXCHANGE_DEPOSIT', 'STABLECOIN_SURGE', 'WHALE_ROTATION', 'INSTITUTIONAL_ENTRY', 'POTENTIAL_DISTRIBUTION');

-- CreateEnum
CREATE TYPE "SmartMoneyPatternType" AS ENUM ('STEALTH_ACCUMULATION', 'DISTRIBUTION', 'FAKE_PUMP', 'LIQUIDITY_SWEEP', 'ABSORPTION', 'SPOOFING', 'ICEBERG', 'REPEATED_INSTITUTIONAL_ENTRY');

-- CreateEnum
CREATE TYPE "RotationType" AS ENUM ('LIQUIDITY', 'CAPITAL', 'SECTOR', 'NARRATIVE', 'EXCHANGE');

-- CreateTable
CREATE TABLE "WhaleWallet" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chain" "ChainType" NOT NULL,
    "label" TEXT,
    "tagType" "WalletTagType" NOT NULL DEFAULT 'WHALE',
    "exchange" TEXT,
    "entityName" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "totalVolumeUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "activityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhaleWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTag" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "tagType" "WalletTagType" NOT NULL,
    "label" TEXT NOT NULL,
    "source" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "metadata" JSONB,
    "taggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhaleTransaction" (
    "id" TEXT NOT NULL,
    "txKey" TEXT NOT NULL,
    "walletId" TEXT,
    "chain" "ChainType" NOT NULL,
    "txType" "WhaleTransactionType" NOT NULL,
    "direction" "FlowDirection" NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "amountUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "exchange" TEXT,
    "fromAddress" TEXT,
    "toAddress" TEXT,
    "blockNumber" INTEGER,
    "txHash" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "sourceReliability" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "estimatedImpact" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "falseSignalProb" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "metadata" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhaleTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeFlow" (
    "id" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "chain" "ChainType" NOT NULL DEFAULT 'ETHEREUM',
    "asset" TEXT NOT NULL,
    "direction" "FlowDirection" NOT NULL,
    "inflowUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outflowUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netFlowUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "txCount" INTEGER NOT NULL DEFAULT 0,
    "whaleTxCount" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StablecoinFlow" (
    "id" TEXT NOT NULL,
    "stablecoin" TEXT NOT NULL,
    "chain" "ChainType" NOT NULL,
    "direction" "FlowDirection" NOT NULL,
    "exchange" TEXT,
    "amountUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "txCount" INTEGER NOT NULL DEFAULT 0,
    "netFlowUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StablecoinFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhaleScore" (
    "id" TEXT NOT NULL,
    "walletId" TEXT,
    "asset" TEXT,
    "exchange" TEXT,
    "whaleActivityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "accumulationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "distributionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "expectedImpact" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceReliability" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "historicalAccuracy" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "falseSignalProb" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "metadata" JSONB,
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhaleScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhaleReplay" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "priceAtEvent" DOUBLE PRECISION,
    "maxMovePct" DOUBLE PRECISION,
    "minMovePct" DOUBLE PRECISION,
    "reactionDelayMs" INTEGER,
    "similarTxIds" TEXT[],
    "historicalAccuracy" DOUBLE PRECISION,
    "metadata" JSONB,
    "replayedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhaleReplay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhaleAlert" (
    "id" TEXT NOT NULL,
    "alertType" "WhaleAlertType" NOT NULL,
    "walletId" TEXT,
    "transactionId" TEXT,
    "asset" TEXT NOT NULL,
    "exchange" TEXT,
    "chain" "ChainType",
    "amountUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "severity" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "message" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhaleAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstitutionalFlow" (
    "id" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "entityType" "WalletTagType" NOT NULL DEFAULT 'FUND',
    "asset" TEXT NOT NULL,
    "chain" "ChainType" NOT NULL,
    "direction" "FlowDirection" NOT NULL,
    "amountUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "exchange" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "metadata" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstitutionalFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiquidityRotation" (
    "id" TEXT NOT NULL,
    "rotationType" "RotationType" NOT NULL,
    "fromAsset" TEXT,
    "toAsset" TEXT,
    "fromExchange" TEXT,
    "toExchange" TEXT,
    "fromSector" TEXT,
    "toSector" TEXT,
    "fromNarrative" TEXT,
    "toNarrative" TEXT,
    "amountUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "metadata" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiquidityRotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhaleIntelligenceJobState" (
    "id" TEXT NOT NULL,
    "jobType" "WhaleIntelligenceJobType" NOT NULL,
    "lastProcessedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhaleIntelligenceJobState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhaleWallet_address_chain_key" ON "WhaleWallet"("address", "chain");

-- CreateIndex
CREATE INDEX "WhaleWallet_tagType_activityScore_idx" ON "WhaleWallet"("tagType", "activityScore");

-- CreateIndex
CREATE INDEX "WhaleWallet_exchange_chain_idx" ON "WhaleWallet"("exchange", "chain");

-- CreateIndex
CREATE INDEX "WhaleWallet_lastActiveAt_idx" ON "WhaleWallet"("lastActiveAt");

-- CreateIndex
CREATE INDEX "WalletTag_walletId_tagType_idx" ON "WalletTag"("walletId", "tagType");

-- CreateIndex
CREATE INDEX "WalletTag_tagType_taggedAt_idx" ON "WalletTag"("tagType", "taggedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhaleTransaction_txKey_key" ON "WhaleTransaction"("txKey");

-- CreateIndex
CREATE INDEX "WhaleTransaction_chain_detectedAt_idx" ON "WhaleTransaction"("chain", "detectedAt");

-- CreateIndex
CREATE INDEX "WhaleTransaction_txType_detectedAt_idx" ON "WhaleTransaction"("txType", "detectedAt");

-- CreateIndex
CREATE INDEX "WhaleTransaction_exchange_detectedAt_idx" ON "WhaleTransaction"("exchange", "detectedAt");

-- CreateIndex
CREATE INDEX "WhaleTransaction_asset_detectedAt_idx" ON "WhaleTransaction"("asset", "detectedAt");

-- CreateIndex
CREATE INDEX "WhaleTransaction_walletId_detectedAt_idx" ON "WhaleTransaction"("walletId", "detectedAt");

-- CreateIndex
CREATE INDEX "ExchangeFlow_exchange_periodEnd_idx" ON "ExchangeFlow"("exchange", "periodEnd");

-- CreateIndex
CREATE INDEX "ExchangeFlow_asset_periodEnd_idx" ON "ExchangeFlow"("asset", "periodEnd");

-- CreateIndex
CREATE INDEX "ExchangeFlow_netFlowUsd_periodEnd_idx" ON "ExchangeFlow"("netFlowUsd", "periodEnd");

-- CreateIndex
CREATE INDEX "StablecoinFlow_stablecoin_periodEnd_idx" ON "StablecoinFlow"("stablecoin", "periodEnd");

-- CreateIndex
CREATE INDEX "StablecoinFlow_exchange_periodEnd_idx" ON "StablecoinFlow"("exchange", "periodEnd");

-- CreateIndex
CREATE INDEX "StablecoinFlow_netFlowUsd_periodEnd_idx" ON "StablecoinFlow"("netFlowUsd", "periodEnd");

-- CreateIndex
CREATE INDEX "WhaleScore_whaleActivityScore_scoredAt_idx" ON "WhaleScore"("whaleActivityScore", "scoredAt");

-- CreateIndex
CREATE INDEX "WhaleScore_walletId_scoredAt_idx" ON "WhaleScore"("walletId", "scoredAt");

-- CreateIndex
CREATE INDEX "WhaleScore_asset_scoredAt_idx" ON "WhaleScore"("asset", "scoredAt");

-- CreateIndex
CREATE INDEX "WhaleReplay_transactionId_symbol_idx" ON "WhaleReplay"("transactionId", "symbol");

-- CreateIndex
CREATE INDEX "WhaleReplay_symbol_replayedAt_idx" ON "WhaleReplay"("symbol", "replayedAt");

-- CreateIndex
CREATE INDEX "WhaleAlert_alertType_triggeredAt_idx" ON "WhaleAlert"("alertType", "triggeredAt");

-- CreateIndex
CREATE INDEX "WhaleAlert_isActive_triggeredAt_idx" ON "WhaleAlert"("isActive", "triggeredAt");

-- CreateIndex
CREATE INDEX "WhaleAlert_asset_triggeredAt_idx" ON "WhaleAlert"("asset", "triggeredAt");

-- CreateIndex
CREATE INDEX "InstitutionalFlow_entityType_detectedAt_idx" ON "InstitutionalFlow"("entityType", "detectedAt");

-- CreateIndex
CREATE INDEX "InstitutionalFlow_asset_detectedAt_idx" ON "InstitutionalFlow"("asset", "detectedAt");

-- CreateIndex
CREATE INDEX "InstitutionalFlow_amountUsd_detectedAt_idx" ON "InstitutionalFlow"("amountUsd", "detectedAt");

-- CreateIndex
CREATE INDEX "LiquidityRotation_rotationType_detectedAt_idx" ON "LiquidityRotation"("rotationType", "detectedAt");

-- CreateIndex
CREATE INDEX "LiquidityRotation_amountUsd_detectedAt_idx" ON "LiquidityRotation"("amountUsd", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhaleIntelligenceJobState_jobType_key" ON "WhaleIntelligenceJobState"("jobType");

-- AddForeignKey
ALTER TABLE "WalletTag" ADD CONSTRAINT "WalletTag_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "WhaleWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhaleTransaction" ADD CONSTRAINT "WhaleTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "WhaleWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhaleScore" ADD CONSTRAINT "WhaleScore_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "WhaleWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhaleReplay" ADD CONSTRAINT "WhaleReplay_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "WhaleTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhaleAlert" ADD CONSTRAINT "WhaleAlert_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "WhaleWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhaleAlert" ADD CONSTRAINT "WhaleAlert_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "WhaleTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
