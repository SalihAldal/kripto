import type { StrategyMarketplaceListing, StrategyVerificationResult } from "@/src/server/trading-core/marketplace/marketplace-types";

export class StrategyVerifier {
  verify(listing: StrategyMarketplaceListing): StrategyVerificationResult {
    const checks = [
      {
        name: "metadata",
        passed: Boolean(listing.metadata.name && listing.metadata.version),
        message: "Strategy metadata must include name and version",
      },
      {
        name: "pricing",
        passed: listing.priceUsd >= 0 && (listing.monthlyPriceUsd ?? 0) >= 0,
        message: "Pricing values must be non-negative",
      },
      {
        name: "risk-profile",
        passed: Boolean(listing.metadata.riskProfile),
        message: "Strategy must declare a risk profile",
      },
      {
        name: "revenue-share",
        passed: listing.revenueSharePercent >= 50 && listing.revenueSharePercent <= 95,
        message: "Creator revenue share must be between 50 and 95 percent",
      },
      {
        name: "description",
        passed: listing.description.trim().length >= 20,
        message: "Description must be detailed enough for marketplace review",
      },
    ];
    const passed = checks.filter((check) => check.passed).length;
    return {
      verified: passed === checks.length,
      score: Number(((passed / checks.length) * 100).toFixed(2)),
      checks,
      verifiedAt: new Date().toISOString(),
    };
  }
}
