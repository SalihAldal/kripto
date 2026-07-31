import { randomUUID } from "node:crypto";
import type {
  MarketplacePricingType,
  StrategyMarketplaceListing,
  StrategyRating,
  StrategyRevenueShare,
  StrategySubscription,
} from "@/src/server/trading-core/marketplace/marketplace-types";
import { StrategyVerifier } from "@/src/server/trading-core/marketplace/strategy-verifier";
import type { StrategySdkMetadata } from "@/src/server/trading-core/strategy-sdk";

function now() {
  return new Date().toISOString();
}

export class StrategyMarketplaceStore {
  private readonly listings = new Map<string, StrategyMarketplaceListing>();
  private readonly ratings = new Map<string, StrategyRating>();
  private readonly subscriptions = new Map<string, StrategySubscription>();
  private readonly verifier = new StrategyVerifier();

  upload(input: {
    creatorUserId: string;
    title: string;
    description: string;
    metadata: StrategySdkMetadata;
    pricingType: MarketplacePricingType;
    priceUsd?: number;
    monthlyPriceUsd?: number;
    botRentalMonthlyUsd?: number;
    revenueSharePercent?: number;
    tags?: string[];
  }) {
    const listingId = randomUUID();
    const listing: StrategyMarketplaceListing = {
      listingId,
      strategyId: input.metadata.name,
      creatorUserId: input.creatorUserId,
      title: input.title,
      description: input.description,
      metadata: input.metadata,
      status: "PENDING_VERIFICATION",
      pricingType: input.pricingType,
      priceUsd: input.priceUsd ?? 0,
      monthlyPriceUsd: input.monthlyPriceUsd,
      botRentalMonthlyUsd: input.botRentalMonthlyUsd,
      revenueSharePercent: input.revenueSharePercent ?? 70,
      tags: input.tags ?? [],
      ratingAverage: 0,
      ratingCount: 0,
      subscriberCount: 0,
      totalRevenueUsd: 0,
      createdAt: now(),
      updatedAt: now(),
    };
    const verification = this.verifier.verify(listing);
    const verifiedListing = {
      ...listing,
      status: verification.verified ? "VERIFIED" : "REJECTED",
      verification,
      updatedAt: now(),
    } satisfies StrategyMarketplaceListing;
    this.listings.set(listingId, verifiedListing);
    return verifiedListing;
  }

  list(input?: { status?: StrategyMarketplaceListing["status"]; creatorUserId?: string }) {
    return Array.from(this.listings.values())
      .filter((listing) => (input?.status ? listing.status === input.status : true))
      .filter((listing) => (input?.creatorUserId ? listing.creatorUserId === input.creatorUserId : true));
  }

  get(listingId: string) {
    return this.listings.get(listingId) ?? null;
  }

  rate(input: { listingId: string; userId: string; stars: number; comment?: string }) {
    const listing = this.requireListing(input.listingId);
    const rating: StrategyRating = {
      ratingId: randomUUID(),
      listingId: input.listingId,
      userId: input.userId,
      stars: Math.max(1, Math.min(5, Math.round(input.stars))),
      comment: input.comment,
      createdAt: now(),
    };
    this.ratings.set(rating.ratingId, rating);
    const listingRatings = Array.from(this.ratings.values()).filter((row) => row.listingId === listing.listingId);
    const ratingAverage = listingRatings.reduce((sum, row) => sum + row.stars, 0) / Math.max(1, listingRatings.length);
    this.listings.set(listing.listingId, {
      ...listing,
      ratingAverage: Number(ratingAverage.toFixed(2)),
      ratingCount: listingRatings.length,
      updatedAt: now(),
    });
    return rating;
  }

  subscribe(input: { listingId: string; userId: string; pricingType?: MarketplacePricingType }) {
    const listing = this.requireListing(input.listingId);
    if (listing.status !== "VERIFIED") throw new Error("Strategy listing is not verified");
    const pricingType = input.pricingType ?? listing.pricingType;
    const amountUsd =
      pricingType === "SUBSCRIPTION"
        ? listing.monthlyPriceUsd ?? listing.priceUsd
        : pricingType === "BOT_RENTAL"
          ? listing.botRentalMonthlyUsd ?? listing.monthlyPriceUsd ?? listing.priceUsd
          : pricingType === "FREE"
            ? 0
            : listing.priceUsd;
    const subscription: StrategySubscription = {
      subscriptionId: randomUUID(),
      listingId: listing.listingId,
      userId: input.userId,
      status: "ACTIVE",
      pricingType,
      amountUsd,
      startedAt: now(),
      expiresAt: pricingType === "ONE_TIME" || pricingType === "FREE" ? undefined : new Date(Date.now() + 30 * 86_400_000).toISOString(),
    };
    this.subscriptions.set(subscription.subscriptionId, subscription);
    this.listings.set(listing.listingId, {
      ...listing,
      subscriberCount: listing.subscriberCount + 1,
      totalRevenueUsd: Number((listing.totalRevenueUsd + amountUsd).toFixed(2)),
      updatedAt: now(),
    });
    return subscription;
  }

  revenue(listingId: string): StrategyRevenueShare {
    const listing = this.requireListing(listingId);
    const grossRevenueUsd = listing.totalRevenueUsd;
    const creatorRevenueUsd = grossRevenueUsd * (listing.revenueSharePercent / 100);
    return {
      listingId,
      creatorUserId: listing.creatorUserId,
      grossRevenueUsd: Number(grossRevenueUsd.toFixed(2)),
      creatorRevenueUsd: Number(creatorRevenueUsd.toFixed(2)),
      platformRevenueUsd: Number((grossRevenueUsd - creatorRevenueUsd).toFixed(2)),
      revenueSharePercent: listing.revenueSharePercent,
      updatedAt: now(),
    };
  }

  subscriptionsFor(userId: string) {
    return Array.from(this.subscriptions.values()).filter((row) => row.userId === userId);
  }

  snapshot() {
    return {
      listings: this.list(),
      ratings: Array.from(this.ratings.values()),
      subscriptions: Array.from(this.subscriptions.values()),
      updatedAt: now(),
    };
  }

  private requireListing(listingId: string) {
    const listing = this.get(listingId);
    if (!listing) throw new Error("Strategy listing not found");
    return listing;
  }
}

const globalStore = globalThis as typeof globalThis & { __strategyMarketplaceStore?: StrategyMarketplaceStore };
export const strategyMarketplaceStore = globalStore.__strategyMarketplaceStore ?? new StrategyMarketplaceStore();
globalStore.__strategyMarketplaceStore = strategyMarketplaceStore;
