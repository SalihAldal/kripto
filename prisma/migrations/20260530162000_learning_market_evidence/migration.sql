CREATE TABLE "LearningMarketEvidence" (
  "id" TEXT NOT NULL,
  "learningTradeId" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "futuresSymbol" TEXT,
  "snapshotType" TEXT NOT NULL DEFAULT 'POST_TRADE_CLOSE',
  "source" TEXT NOT NULL DEFAULT 'BINANCE',
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "spotLastPrice" DOUBLE PRECISION,
  "spotBidPrice" DOUBLE PRECISION,
  "spotAskPrice" DOUBLE PRECISION,
  "spotSpreadPercent" DOUBLE PRECISION,
  "spotVolume24h" DOUBLE PRECISION,
  "orderBookBidDepth" DOUBLE PRECISION,
  "orderBookAskDepth" DOUBLE PRECISION,
  "orderBookImbalance" DOUBLE PRECISION,
  "recentBuyVolume" DOUBLE PRECISION,
  "recentSellVolume" DOUBLE PRECISION,
  "buySellRatio" DOUBLE PRECISION,
  "volumeSpikeRatio" DOUBLE PRECISION,
  "markPrice" DOUBLE PRECISION,
  "indexPrice" DOUBLE PRECISION,
  "fundingRate" DOUBLE PRECISION,
  "nextFundingTime" TIMESTAMP(3),
  "openInterest" DOUBLE PRECISION,
  "liquidationBuyQty" DOUBLE PRECISION,
  "liquidationSellQty" DOUBLE PRECISION,
  "liquidationBuyNotional" DOUBLE PRECISION,
  "liquidationSellNotional" DOUBLE PRECISION,
  "liquidationImbalance" DOUBLE PRECISION,
  "newsSentiment" TEXT,
  "macroHighImpactNews" BOOLEAN NOT NULL DEFAULT false,
  "macroUncertaintyLevel" DOUBLE PRECISION,
  "rawSpot" JSONB,
  "rawFutures" JSONB,
  "rawNews" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LearningMarketEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LearningMarketEvidence_learningTradeId_capturedAt_idx" ON "LearningMarketEvidence"("learningTradeId", "capturedAt");
CREATE INDEX "LearningMarketEvidence_symbol_capturedAt_idx" ON "LearningMarketEvidence"("symbol", "capturedAt");
CREATE INDEX "LearningMarketEvidence_futuresSymbol_capturedAt_idx" ON "LearningMarketEvidence"("futuresSymbol", "capturedAt");
CREATE INDEX "LearningMarketEvidence_fundingRate_openInterest_idx" ON "LearningMarketEvidence"("fundingRate", "openInterest");

ALTER TABLE "LearningMarketEvidence" ADD CONSTRAINT "LearningMarketEvidence_learningTradeId_fkey" FOREIGN KEY ("learningTradeId") REFERENCES "LearningTrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
