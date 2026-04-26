-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'TRADER', 'VIEWER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED', 'LOCKED');

-- CreateEnum
CREATE TYPE "ExchangeType" AS ENUM ('BINANCE', 'BYBIT', 'OKX', 'KRAKEN', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('CONNECTED', 'DEGRADED', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "AiProviderType" AS ENUM ('OPENAI', 'ANTHROPIC', 'GEMINI', 'LOCAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ERROR');

-- CreateEnum
CREATE TYPE "ModelStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "TradingPairStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DELISTED');

-- CreateEnum
CREATE TYPE "SnapshotInterval" AS ENUM ('S1', 'S5', 'M1', 'M5', 'M15', 'H1');

-- CreateEnum
CREATE TYPE "ScannerResultStatus" AS ENUM ('NEW', 'QUALIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SignalSide" AS ENUM ('BUY', 'SELL', 'HOLD');

-- CreateEnum
CREATE TYPE "SignalSource" AS ENUM ('AI_MODEL', 'SCANNER', 'RISK_ENGINE', 'MANUAL');

-- CreateEnum
CREATE TYPE "SignalStatus" AS ENUM ('NEW', 'APPROVED', 'REJECTED', 'EXPIRED', 'EXECUTED');

-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT', 'TAKE_PROFIT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "PositionSide" AS ENUM ('LONG', 'SHORT');

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('OPEN', 'CLOSED', 'LIQUIDATED');

-- CreateEnum
CREATE TYPE "RiskProfile" AS ENUM ('CONSERVATIVE', 'MODERATE', 'AGGRESSIVE');

-- CreateEnum
CREATE TYPE "ConfigStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DRAFT');

-- CreateEnum
CREATE TYPE "StrategyMode" AS ENUM ('AUTO', 'MANUAL', 'SEMI_AUTO');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXECUTE');

-- CreateEnum
CREATE TYPE "AppSettingScope" AS ENUM ('GLOBAL', 'USER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'TRADER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "lastLoginAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exchange" "ExchangeType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "apiKeyMasked" TEXT NOT NULL,
    "apiSecretEncrypted" TEXT NOT NULL,
    "passphraseEncrypted" TEXT,
    "isSandbox" BOOLEAN NOT NULL DEFAULT true,
    "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 1200,
    "lastSyncAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "providerMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AiProviderType" NOT NULL,
    "status" "ProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "baseUrl" TEXT,
    "modelCatalog" JSONB,
    "authMetadata" JSONB,
    "lastHealthAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiModelConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "aiProviderId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "ModelStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" TEXT,
    "confidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "maxTokens" INTEGER,
    "retryCount" INTEGER NOT NULL DEFAULT 1,
    "timeoutMs" INTEGER NOT NULL DEFAULT 1500,
    "providerModelName" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingPair" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "baseAsset" TEXT NOT NULL,
    "quoteAsset" TEXT NOT NULL,
    "status" "TradingPairStatus" NOT NULL DEFAULT 'ACTIVE',
    "pricePrecision" INTEGER NOT NULL DEFAULT 2,
    "quantityPrecision" INTEGER NOT NULL DEFAULT 4,
    "tickSize" DOUBLE PRECISION,
    "lotSize" DOUBLE PRECISION,
    "minNotional" DOUBLE PRECISION,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingPair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" TEXT NOT NULL,
    "tradingPairId" TEXT NOT NULL,
    "interval" "SnapshotInterval" NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "bidPrice" DOUBLE PRECISION NOT NULL,
    "askPrice" DOUBLE PRECISION NOT NULL,
    "lastPrice" DOUBLE PRECISION NOT NULL,
    "markPrice" DOUBLE PRECISION,
    "indexPrice" DOUBLE PRECISION,
    "volumeBase" DOUBLE PRECISION,
    "volumeQuote" DOUBLE PRECISION,
    "openInterest" DOUBLE PRECISION,
    "fundingRate" DOUBLE PRECISION,
    "source" "ExchangeType" NOT NULL DEFAULT 'BINANCE',
    "sourceLatencyMs" INTEGER,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScannerResult" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "tradingPairId" TEXT NOT NULL,
    "marketSnapshotId" TEXT,
    "scannerName" TEXT NOT NULL,
    "status" "ScannerResultStatus" NOT NULL DEFAULT 'NEW',
    "score" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER,
    "reason" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScannerResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeSignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "tradingPairId" TEXT NOT NULL,
    "aiProviderId" TEXT,
    "aiModelConfigId" TEXT,
    "scannerResultId" TEXT,
    "marketSnapshotId" TEXT,
    "side" "SignalSide" NOT NULL,
    "source" "SignalSource" NOT NULL,
    "status" "SignalStatus" NOT NULL DEFAULT 'NEW',
    "confidence" DOUBLE PRECISION NOT NULL,
    "triggerPrice" DOUBLE PRECISION,
    "stopLossPrice" DOUBLE PRECISION,
    "takeProfitPrice" DOUBLE PRECISION,
    "reason" TEXT,
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exchangeConnectionId" TEXT NOT NULL,
    "tradingPairId" TEXT NOT NULL,
    "tradeSignalId" TEXT,
    "positionId" TEXT,
    "side" "OrderSide" NOT NULL,
    "type" "OrderType" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
    "clientOrderId" TEXT,
    "exchangeOrderId" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION,
    "stopPrice" DOUBLE PRECISION,
    "takeProfitPrice" DOUBLE PRECISION,
    "timeInForce" TEXT,
    "fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feeCurrency" TEXT,
    "slippage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgExecutionPrice" DOUBLE PRECISION,
    "rejectReason" TEXT,
    "errorMessage" TEXT,
    "submittedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeExecution" (
    "id" TEXT NOT NULL,
    "tradeOrderId" TEXT NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "executionPrice" DOUBLE PRECISION NOT NULL,
    "executedQty" DOUBLE PRECISION NOT NULL,
    "quoteQty" DOUBLE PRECISION,
    "fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "slippage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "liquidityType" TEXT,
    "executionRef" TEXT,
    "errorMessage" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exchangeConnectionId" TEXT NOT NULL,
    "tradingPairId" TEXT NOT NULL,
    "side" "PositionSide" NOT NULL,
    "status" "PositionStatus" NOT NULL DEFAULT 'OPEN',
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "markPrice" DOUBLE PRECISION,
    "closePrice" DOUBLE PRECISION,
    "quantity" DOUBLE PRECISION NOT NULL,
    "leverage" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "marginUsed" DOUBLE PRECISION,
    "liquidationPrice" DOUBLE PRECISION,
    "realizedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unrealizedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feeTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfitLossRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradingPairId" TEXT NOT NULL,
    "positionId" TEXT,
    "tradeOrderId" TEXT,
    "realizedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unrealizedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grossPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feeTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "slippageCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "roePercent" DOUBLE PRECISION,
    "notes" TEXT,
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfitLossRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ConfigStatus" NOT NULL DEFAULT 'ACTIVE',
    "profile" "RiskProfile" NOT NULL DEFAULT 'MODERATE',
    "maxLeverage" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "maxOpenPositions" INTEGER NOT NULL DEFAULT 5,
    "maxOrderNotional" DOUBLE PRECISION NOT NULL DEFAULT 50000,
    "maxDailyLossPercent" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "maxDrawdownPercent" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "stopLossRequired" BOOLEAN NOT NULL DEFAULT true,
    "takeProfitRequired" BOOLEAN NOT NULL DEFAULT false,
    "emergencyBrakeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 30,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "StrategyMode" NOT NULL DEFAULT 'AUTO',
    "status" "ConfigStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "confidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    "riskWeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "aiWeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "executionCooldownSec" INTEGER NOT NULL DEFAULT 5,
    "allowShort" BOOLEAN NOT NULL DEFAULT true,
    "allowLong" BOOLEAN NOT NULL DEFAULT true,
    "maxConcurrentTrades" INTEGER NOT NULL DEFAULT 3,
    "pairWhitelist" JSONB,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemLog" (
    "id" TEXT NOT NULL,
    "level" "LogLevel" NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "errorCode" TEXT,
    "stackTrace" TEXT,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValues" JSONB,
    "newValues" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" "AppSettingScope" NOT NULL DEFAULT 'GLOBAL',
    "userId" TEXT,
    "value" JSONB NOT NULL,
    "valueType" TEXT NOT NULL DEFAULT 'json',
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "status" "ConfigStatus" NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_status_role_idx" ON "User"("status", "role");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "ExchangeConnection_status_idx" ON "ExchangeConnection"("status");

-- CreateIndex
CREATE INDEX "ExchangeConnection_exchange_idx" ON "ExchangeConnection"("exchange");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeConnection_userId_exchange_name_key" ON "ExchangeConnection"("userId", "exchange", "name");

-- CreateIndex
CREATE UNIQUE INDEX "AiProvider_name_key" ON "AiProvider"("name");

-- CreateIndex
CREATE INDEX "AiProvider_status_type_idx" ON "AiProvider"("status", "type");

-- CreateIndex
CREATE INDEX "AiModelConfig_status_idx" ON "AiModelConfig"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AiModelConfig_aiProviderId_key_key" ON "AiModelConfig"("aiProviderId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "TradingPair_symbol_key" ON "TradingPair"("symbol");

-- CreateIndex
CREATE INDEX "TradingPair_status_baseAsset_quoteAsset_idx" ON "TradingPair"("status", "baseAsset", "quoteAsset");

-- CreateIndex
CREATE INDEX "MarketSnapshot_tradingPairId_snapshotAt_idx" ON "MarketSnapshot"("tradingPairId", "snapshotAt");

-- CreateIndex
CREATE INDEX "MarketSnapshot_interval_source_idx" ON "MarketSnapshot"("interval", "source");

-- CreateIndex
CREATE INDEX "ScannerResult_tradingPairId_scannedAt_idx" ON "ScannerResult"("tradingPairId", "scannedAt");

-- CreateIndex
CREATE INDEX "ScannerResult_status_scannerName_idx" ON "ScannerResult"("status", "scannerName");

-- CreateIndex
CREATE INDEX "TradeSignal_tradingPairId_decidedAt_idx" ON "TradeSignal"("tradingPairId", "decidedAt");

-- CreateIndex
CREATE INDEX "TradeSignal_status_source_idx" ON "TradeSignal"("status", "source");

-- CreateIndex
CREATE INDEX "TradeSignal_aiModelConfigId_idx" ON "TradeSignal"("aiModelConfigId");

-- CreateIndex
CREATE INDEX "TradeOrder_userId_createdAt_idx" ON "TradeOrder"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeOrder_status_side_type_idx" ON "TradeOrder"("status", "side", "type");

-- CreateIndex
CREATE INDEX "TradeOrder_tradingPairId_exchangeOrderId_idx" ON "TradeOrder"("tradingPairId", "exchangeOrderId");

-- CreateIndex
CREATE INDEX "TradeExecution_tradeOrderId_executedAt_idx" ON "TradeExecution"("tradeOrderId", "executedAt");

-- CreateIndex
CREATE INDEX "TradeExecution_status_idx" ON "TradeExecution"("status");

-- CreateIndex
CREATE INDEX "Position_userId_status_openedAt_idx" ON "Position"("userId", "status", "openedAt");

-- CreateIndex
CREATE INDEX "Position_tradingPairId_status_idx" ON "Position"("tradingPairId", "status");

-- CreateIndex
CREATE INDEX "ProfitLossRecord_userId_recordedAt_idx" ON "ProfitLossRecord"("userId", "recordedAt");

-- CreateIndex
CREATE INDEX "ProfitLossRecord_tradingPairId_idx" ON "ProfitLossRecord"("tradingPairId");

-- CreateIndex
CREATE INDEX "ProfitLossRecord_positionId_idx" ON "ProfitLossRecord"("positionId");

-- CreateIndex
CREATE UNIQUE INDEX "RiskConfig_userId_key" ON "RiskConfig"("userId");

-- CreateIndex
CREATE INDEX "StrategyConfig_userId_status_idx" ON "StrategyConfig"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyConfig_userId_name_key" ON "StrategyConfig"("userId", "name");

-- CreateIndex
CREATE INDEX "SystemLog_level_createdAt_idx" ON "SystemLog"("level", "createdAt");

-- CreateIndex
CREATE INDEX "SystemLog_source_createdAt_idx" ON "SystemLog"("source", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_key_key" ON "AppSetting"("key");

-- CreateIndex
CREATE INDEX "AppSetting_scope_status_idx" ON "AppSetting"("scope", "status");

-- CreateIndex
CREATE INDEX "AppSetting_userId_idx" ON "AppSetting"("userId");

-- AddForeignKey
ALTER TABLE "ExchangeConnection" ADD CONSTRAINT "ExchangeConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiModelConfig" ADD CONSTRAINT "AiModelConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiModelConfig" ADD CONSTRAINT "AiModelConfig_aiProviderId_fkey" FOREIGN KEY ("aiProviderId") REFERENCES "AiProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSnapshot" ADD CONSTRAINT "MarketSnapshot_tradingPairId_fkey" FOREIGN KEY ("tradingPairId") REFERENCES "TradingPair"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScannerResult" ADD CONSTRAINT "ScannerResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScannerResult" ADD CONSTRAINT "ScannerResult_tradingPairId_fkey" FOREIGN KEY ("tradingPairId") REFERENCES "TradingPair"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScannerResult" ADD CONSTRAINT "ScannerResult_marketSnapshotId_fkey" FOREIGN KEY ("marketSnapshotId") REFERENCES "MarketSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeSignal" ADD CONSTRAINT "TradeSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeSignal" ADD CONSTRAINT "TradeSignal_tradingPairId_fkey" FOREIGN KEY ("tradingPairId") REFERENCES "TradingPair"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeSignal" ADD CONSTRAINT "TradeSignal_aiProviderId_fkey" FOREIGN KEY ("aiProviderId") REFERENCES "AiProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeSignal" ADD CONSTRAINT "TradeSignal_aiModelConfigId_fkey" FOREIGN KEY ("aiModelConfigId") REFERENCES "AiModelConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeSignal" ADD CONSTRAINT "TradeSignal_scannerResultId_fkey" FOREIGN KEY ("scannerResultId") REFERENCES "ScannerResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeSignal" ADD CONSTRAINT "TradeSignal_marketSnapshotId_fkey" FOREIGN KEY ("marketSnapshotId") REFERENCES "MarketSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOrder" ADD CONSTRAINT "TradeOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOrder" ADD CONSTRAINT "TradeOrder_exchangeConnectionId_fkey" FOREIGN KEY ("exchangeConnectionId") REFERENCES "ExchangeConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOrder" ADD CONSTRAINT "TradeOrder_tradingPairId_fkey" FOREIGN KEY ("tradingPairId") REFERENCES "TradingPair"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOrder" ADD CONSTRAINT "TradeOrder_tradeSignalId_fkey" FOREIGN KEY ("tradeSignalId") REFERENCES "TradeSignal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOrder" ADD CONSTRAINT "TradeOrder_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeExecution" ADD CONSTRAINT "TradeExecution_tradeOrderId_fkey" FOREIGN KEY ("tradeOrderId") REFERENCES "TradeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_exchangeConnectionId_fkey" FOREIGN KEY ("exchangeConnectionId") REFERENCES "ExchangeConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_tradingPairId_fkey" FOREIGN KEY ("tradingPairId") REFERENCES "TradingPair"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitLossRecord" ADD CONSTRAINT "ProfitLossRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitLossRecord" ADD CONSTRAINT "ProfitLossRecord_tradingPairId_fkey" FOREIGN KEY ("tradingPairId") REFERENCES "TradingPair"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitLossRecord" ADD CONSTRAINT "ProfitLossRecord_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitLossRecord" ADD CONSTRAINT "ProfitLossRecord_tradeOrderId_fkey" FOREIGN KEY ("tradeOrderId") REFERENCES "TradeOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskConfig" ADD CONSTRAINT "RiskConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyConfig" ADD CONSTRAINT "StrategyConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
