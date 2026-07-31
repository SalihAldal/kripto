import type { ExposureBucket } from "@/src/server/trading-core/portfolio/portfolio-types";

export class PortfolioStrategyAllocationEngine {
  recommend(strategyExposure: ExposureBucket[], maxStrategyExposurePercent: number): Record<string, number> {
    if (strategyExposure.length === 0) return {};
    const totalInverseRisk = strategyExposure.reduce((sum, bucket) => sum + this.inverseRisk(bucket.exposurePercent, maxStrategyExposurePercent), 0);
    return strategyExposure.reduce<Record<string, number>>((acc, bucket) => {
      const weight = totalInverseRisk > 0 ? this.inverseRisk(bucket.exposurePercent, maxStrategyExposurePercent) / totalInverseRisk * 100 : 0;
      acc[bucket.key] = Number(weight.toFixed(2));
      return acc;
    }, {});
  }

  private inverseRisk(exposurePercent: number, maxStrategyExposurePercent: number) {
    return Math.max(0.05, 1 - exposurePercent / Math.max(maxStrategyExposurePercent, 1));
  }
}
