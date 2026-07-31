-- CreateEnum
CREATE TYPE "ExchangeAbstractionJobType" AS ENUM ('HEALTH_CHECK', 'SYMBOL_SYNC', 'BALANCE_SYNC', 'CONNECTION_MONITOR', 'RATE_LIMIT_SYNC', 'RECONNECT', 'LATENCY_PROBE');

-- CreateEnum
CREATE TYPE "ExchangePluginType" AS ENUM ('BINANCE_SPOT', 'BINANCE_FUTURES', 'BYBIT', 'OKX', 'GATE', 'MEXC', 'KUCOIN', 'KRAKEN', 'COINBASE');

-- CreateEnum
CREATE TYPE "ExchangeConnectionMode" AS ENUM ('REST', 'WEBSOCKET', 'BOTH');

-- CreateEnum
CREATE TYPE "CanonicalOrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "CanonicalOrderType" AS ENUM ('MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT');

-- CreateEnum
CREATE TYPE "CanonicalOrderStatusEnum" AS ENUM ('NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'REJECTED', 'EXPIRED', 'UNKNOWN');

CREATE TABLE "ExchangeRegistry" (
    "id" TEXT NOT NULL, "registryKey" TEXT NOT NULL, "pluginType" "ExchangePluginType" NOT NULL,
    "displayName" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true, "isProduction" BOOLEAN NOT NULL DEFAULT false,
    "connectionMode" "ExchangeConnectionMode" NOT NULL DEFAULT 'BOTH', "region" TEXT, "accountLabel" TEXT,
    "apiKeyHint" TEXT, "metadata" JSONB, "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExchangeRegistry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExchangeAbstractionCapability" (
    "id" TEXT NOT NULL, "registryId" TEXT NOT NULL,
    "spot" BOOLEAN NOT NULL DEFAULT false, "margin" BOOLEAN NOT NULL DEFAULT false,
    "futures" BOOLEAN NOT NULL DEFAULT false, "options" BOOLEAN NOT NULL DEFAULT false,
    "funding" BOOLEAN NOT NULL DEFAULT false, "openInterest" BOOLEAN NOT NULL DEFAULT false,
    "orderbook" BOOLEAN NOT NULL DEFAULT true, "websocket" BOOLEAN NOT NULL DEFAULT false,
    "historicalData" BOOLEAN NOT NULL DEFAULT true, "rateLimitPerMin" INTEGER NOT NULL DEFAULT 1200,
    "pricePrecision" INTEGER NOT NULL DEFAULT 8, "qtyPrecision" INTEGER NOT NULL DEFAULT 8,
    "filters" JSONB, "metadata" JSONB, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExchangeAbstractionCapability_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExchangeAbstractionHealth" (
    "id" TEXT NOT NULL, "registryId" TEXT NOT NULL,
    "availability" DOUBLE PRECISION NOT NULL DEFAULT 100, "latencyMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "apiErrorCount" INTEGER NOT NULL DEFAULT 0, "rateLimitHits" INTEGER NOT NULL DEFAULT 0,
    "wsStability" DOUBLE PRECISION NOT NULL DEFAULT 100, "dataFreshness" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "syncStatus" TEXT NOT NULL DEFAULT 'OK', "restConnected" BOOLEAN NOT NULL DEFAULT false,
    "wsConnected" BOOLEAN NOT NULL DEFAULT false, "metadata" JSONB,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExchangeAbstractionHealth_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExchangeAbstractionLatency" (
    "id" TEXT NOT NULL, "registryId" TEXT NOT NULL, "endpoint" TEXT NOT NULL,
    "latencyMs" DOUBLE PRECISION NOT NULL, "success" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB, "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExchangeAbstractionLatency_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CanonicalSymbol" (
    "id" TEXT NOT NULL, "canonicalKey" TEXT NOT NULL, "baseAsset" TEXT NOT NULL, "quoteAsset" TEXT NOT NULL,
    "canonicalSymbol" TEXT NOT NULL, "pluginType" "ExchangePluginType" NOT NULL, "exchangeSymbol" TEXT NOT NULL,
    "tickSize" DOUBLE PRECISION, "stepSize" DOUBLE PRECISION, "minNotional" DOUBLE PRECISION,
    "minQty" DOUBLE PRECISION, "maxQty" DOUBLE PRECISION,
    "pricePrecision" INTEGER NOT NULL DEFAULT 8, "qtyPrecision" INTEGER NOT NULL DEFAULT 8,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE', "metadata" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CanonicalSymbol_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CanonicalBalance" (
    "id" TEXT NOT NULL, "balanceKey" TEXT NOT NULL, "pluginType" "ExchangePluginType" NOT NULL,
    "accountLabel" TEXT, "asset" TEXT NOT NULL, "free" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "locked" DOUBLE PRECISION NOT NULL DEFAULT 0, "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "usdValue" DOUBLE PRECISION, "metadata" JSONB, "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CanonicalBalance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CanonicalOrder" (
    "id" TEXT NOT NULL, "orderKey" TEXT NOT NULL, "pluginType" "ExchangePluginType" NOT NULL,
    "exchangeOrderId" TEXT NOT NULL, "canonicalSymbol" TEXT NOT NULL,
    "side" "CanonicalOrderSide" NOT NULL, "type" "CanonicalOrderType" NOT NULL,
    "status" "CanonicalOrderStatusEnum" NOT NULL DEFAULT 'NEW',
    "quantity" DOUBLE PRECISION NOT NULL, "executedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION, "averagePrice" DOUBLE PRECISION, "fee" DOUBLE PRECISION, "feeAsset" TEXT,
    "dryRun" BOOLEAN NOT NULL DEFAULT false, "metadata" JSONB,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CanonicalOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CanonicalTrade" (
    "id" TEXT NOT NULL, "tradeKey" TEXT NOT NULL, "pluginType" "ExchangePluginType" NOT NULL,
    "exchangeTradeId" TEXT NOT NULL, "canonicalSymbol" TEXT NOT NULL,
    "side" "CanonicalOrderSide" NOT NULL, "price" DOUBLE PRECISION NOT NULL, "quantity" DOUBLE PRECISION NOT NULL,
    "quoteQty" DOUBLE PRECISION, "fee" DOUBLE PRECISION, "feeAsset" TEXT,
    "isMaker" BOOLEAN NOT NULL DEFAULT false, "metadata" JSONB,
    "tradedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CanonicalTrade_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExchangeAbstractionJobState" (
    "id" TEXT NOT NULL, "jobType" "ExchangeAbstractionJobType" NOT NULL,
    "lastProcessedAt" TIMESTAMP(3), "status" TEXT NOT NULL DEFAULT 'IDLE', "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExchangeAbstractionJobState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExchangeRegistry_registryKey_key" ON "ExchangeRegistry"("registryKey");
CREATE UNIQUE INDEX "ExchangeRegistry_pluginType_key" ON "ExchangeRegistry"("pluginType");
CREATE INDEX "ExchangeRegistry_enabled_isProduction_idx" ON "ExchangeRegistry"("enabled", "isProduction");

CREATE UNIQUE INDEX "ExchangeAbstractionCapability_registryId_key" ON "ExchangeAbstractionCapability"("registryId");
CREATE INDEX "ExchangeAbstractionCapability_spot_futures_idx" ON "ExchangeAbstractionCapability"("spot", "futures");

CREATE INDEX "ExchangeAbstractionHealth_registryId_checkedAt_idx" ON "ExchangeAbstractionHealth"("registryId", "checkedAt");
CREATE INDEX "ExchangeAbstractionHealth_availability_checkedAt_idx" ON "ExchangeAbstractionHealth"("availability", "checkedAt");

CREATE INDEX "ExchangeAbstractionLatency_registryId_measuredAt_idx" ON "ExchangeAbstractionLatency"("registryId", "measuredAt");
CREATE INDEX "ExchangeAbstractionLatency_endpoint_measuredAt_idx" ON "ExchangeAbstractionLatency"("endpoint", "measuredAt");

CREATE UNIQUE INDEX "CanonicalSymbol_canonicalKey_key" ON "CanonicalSymbol"("canonicalKey");
CREATE UNIQUE INDEX "CanonicalSymbol_canonicalSymbol_key" ON "CanonicalSymbol"("canonicalSymbol");
CREATE UNIQUE INDEX "CanonicalSymbol_pluginType_exchangeSymbol_key" ON "CanonicalSymbol"("pluginType", "exchangeSymbol");
CREATE INDEX "CanonicalSymbol_baseAsset_quoteAsset_idx" ON "CanonicalSymbol"("baseAsset", "quoteAsset");
CREATE INDEX "CanonicalSymbol_pluginType_status_idx" ON "CanonicalSymbol"("pluginType", "status");

CREATE UNIQUE INDEX "CanonicalBalance_balanceKey_key" ON "CanonicalBalance"("balanceKey");
CREATE INDEX "CanonicalBalance_pluginType_asset_idx" ON "CanonicalBalance"("pluginType", "asset");
CREATE INDEX "CanonicalBalance_syncedAt_idx" ON "CanonicalBalance"("syncedAt");

CREATE UNIQUE INDEX "CanonicalOrder_orderKey_key" ON "CanonicalOrder"("orderKey");
CREATE INDEX "CanonicalOrder_pluginType_status_idx" ON "CanonicalOrder"("pluginType", "status");
CREATE INDEX "CanonicalOrder_canonicalSymbol_placedAt_idx" ON "CanonicalOrder"("canonicalSymbol", "placedAt");
CREATE INDEX "CanonicalOrder_exchangeOrderId_idx" ON "CanonicalOrder"("exchangeOrderId");

CREATE UNIQUE INDEX "CanonicalTrade_tradeKey_key" ON "CanonicalTrade"("tradeKey");
CREATE INDEX "CanonicalTrade_pluginType_canonicalSymbol_tradedAt_idx" ON "CanonicalTrade"("pluginType", "canonicalSymbol", "tradedAt");
CREATE INDEX "CanonicalTrade_exchangeTradeId_idx" ON "CanonicalTrade"("exchangeTradeId");

CREATE UNIQUE INDEX "ExchangeAbstractionJobState_jobType_key" ON "ExchangeAbstractionJobState"("jobType");

ALTER TABLE "ExchangeAbstractionCapability" ADD CONSTRAINT "ExchangeAbstractionCapability_registryId_fkey" FOREIGN KEY ("registryId") REFERENCES "ExchangeRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExchangeAbstractionHealth" ADD CONSTRAINT "ExchangeAbstractionHealth_registryId_fkey" FOREIGN KEY ("registryId") REFERENCES "ExchangeRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExchangeAbstractionLatency" ADD CONSTRAINT "ExchangeAbstractionLatency_registryId_fkey" FOREIGN KEY ("registryId") REFERENCES "ExchangeRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
