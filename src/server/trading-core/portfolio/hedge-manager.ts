import type { ExposureBucket, HedgeRecommendation } from "@/src/server/trading-core/portfolio/portfolio-types";

export class PortfolioHedgeManager {
  recommend(symbolExposure: ExposureBucket[], hedgeThresholdPercent: number): HedgeRecommendation[] {
    return symbolExposure
      .filter((bucket) => bucket.exposurePercent >= hedgeThresholdPercent && Math.abs(bucket.netNotionalUsd) > 0)
      .map((bucket) => {
        const hedgeNotionalUsd = Math.abs(bucket.netNotionalUsd) * 0.35;
        return {
          symbol: bucket.key,
          side: bucket.netNotionalUsd > 0 ? "SELL" : "BUY",
          hedgeNotionalUsd: Number(hedgeNotionalUsd.toFixed(2)),
          reason: `${bucket.key} net exposure ${bucket.exposurePercent.toFixed(2)}% exceeds hedge threshold`,
        };
      });
  }
}
