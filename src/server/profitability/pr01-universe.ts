import {
  PR01_SCHEMA_VERSION,
  type EligibilityVerdict,
  type PointInTimeUniverseRecord,
} from "@/src/server/profitability/pr01-types";
import {
  resolveCanonicalVenueConfig,
  resolveExecutionVenueEligibility,
  type BinanceVenue,
} from "@/src/server/exchange/venue-config.service";
import { validateOrderPrecision } from "@/src/server/exchange-abstraction/precision-layer.service";

export type SymbolRuleInput = {
  tickSize: number;
  stepSize: number;
  minQty: number;
  minNotional: number;
};

export type PointInTimeUniverseInput = {
  symbol: string;
  asOfMs: number;
  metadataAvailableAtMs?: number | null;
  discoveryVenue?: BinanceVenue;
  executionVenue?: BinanceVenue;
  executableSymbols?: Set<string>;
  symbolRules?: SymbolRuleInput | null;
  intendedQuantity?: number | null;
  intendedPrice?: number | null;
  marketDataFreshnessMs?: number | null;
  bookDepthCoverage?: "MEASURED" | "PARTIAL" | "UNKNOWN";
  historicalListingKnown?: boolean;
  listingStatus?: "LISTED" | "DELISTED" | "UNKNOWN";
  venueMappingQuality?: PointInTimeUniverseRecord["venueMappingQuality"];
  allowedOrderTypes?: string[];
};

function parseSymbolParts(symbol: string) {
  const upper = symbol.toUpperCase();
  for (const quote of ["TRY", "USDT", "USDC", "BTC", "ETH", "BNB"]) {
    if (upper.endsWith(quote) && upper.length > quote.length) {
      return { baseAsset: upper.slice(0, -quote.length), quoteAsset: quote };
    }
  }
  return { baseAsset: upper, quoteAsset: "UNKNOWN" };
}

export function evaluatePointInTimeUniverse(input: PointInTimeUniverseInput): PointInTimeUniverseRecord {
  const venueConfig = resolveCanonicalVenueConfig();
  const discoveryVenue = input.discoveryVenue ?? venueConfig.discoveryVenue;
  const executionVenue = input.executionVenue ?? venueConfig.paperExecutionVenue;
  const symbol = input.symbol.toUpperCase();
  const { baseAsset, quoteAsset } = parseSymbolParts(symbol);
  const reasonCodes: string[] = [];
  let eligibilityVerdict: EligibilityVerdict = "NOT_EXECUTABLE";
  let venueMappingQuality = input.venueMappingQuality ?? "EXACT";

  if (!input.historicalListingKnown && input.listingStatus === undefined) {
    eligibilityVerdict = "HISTORICAL_ELIGIBILITY_UNKNOWN";
    reasonCodes.push("HISTORICAL_ELIGIBILITY_UNKNOWN");
  }

  const executableSymbols = input.executableSymbols ?? new Set<string>();
  const venueEligibility = resolveExecutionVenueEligibility({
    symbol,
    liveExecutionVenue: executionVenue,
    executableSymbols,
  });

  if (venueEligibility.reasonCode === "VENUE_NOT_EXECUTABLE") {
    reasonCodes.push("DISCOVERY_PRESENT_EXECUTION_ABSENT");
    if (eligibilityVerdict !== "HISTORICAL_ELIGIBILITY_UNKNOWN") {
      eligibilityVerdict = "NOT_EXECUTABLE";
    }
  }

  if (input.venueMappingQuality === "UNCERTAIN") {
    eligibilityVerdict = "VENUE_MAPPING_UNCERTAIN";
    reasonCodes.push("VENUE_MAPPING_UNCERTAIN");
    venueMappingQuality = "UNCERTAIN";
  }

  const rules = input.symbolRules ?? null;
  const tickSize = rules?.tickSize ?? null;
  const stepSize = rules?.stepSize ?? null;
  const minQty = rules?.minQty ?? null;
  const minNotional = rules?.minNotional ?? null;

  if (rules && input.intendedQuantity != null && input.intendedPrice != null) {
    const precisionRules = {
      canonicalSymbol: symbol,
      pricePrecision: 8,
      quantityPrecision: 8,
      tickSize: rules.tickSize,
      stepSize: rules.stepSize,
      minNotional: rules.minNotional,
      minQty: rules.minQty,
    };
    const validation = validateOrderPrecision(input.intendedQuantity, input.intendedPrice, precisionRules);
    if (!validation.valid) {
      if (validation.reasons.some((row) => row.includes("minNotional") || row.includes("Notional"))) {
        eligibilityVerdict = "BELOW_MIN_NOTIONAL";
        reasonCodes.push("BELOW_MIN_NOTIONAL");
      } else {
        reasonCodes.push(...validation.reasons);
      }
    }
  }

  if (
    input.marketDataFreshnessMs != null &&
    input.marketDataFreshnessMs > 120_000 &&
    eligibilityVerdict !== "HISTORICAL_ELIGIBILITY_UNKNOWN"
  ) {
    eligibilityVerdict = "STALE_MARKET_DATA";
    reasonCodes.push("STALE_MARKET_DATA");
  }

  if (
    venueEligibility.executionVenueEligible &&
    eligibilityVerdict !== "HISTORICAL_ELIGIBILITY_UNKNOWN" &&
    eligibilityVerdict !== "VENUE_MAPPING_UNCERTAIN" &&
    eligibilityVerdict !== "BELOW_MIN_NOTIONAL" &&
    eligibilityVerdict !== "STALE_MARKET_DATA"
  ) {
    eligibilityVerdict = "EXECUTABLE";
    reasonCodes.push("VENUE_EXECUTABLE");
  }

  const listingStatus =
    input.historicalListingKnown === false
      ? "HISTORICAL_ELIGIBILITY_UNKNOWN"
      : input.listingStatus ?? (venueEligibility.executionVenueEligible ? "LISTED" : "UNKNOWN");

  return {
    schemaVersion: PR01_SCHEMA_VERSION,
    symbol,
    baseAsset,
    quoteAsset,
    discoveryVenue,
    executionVenue,
    marketType: "SPOT",
    asOfMs: input.asOfMs,
    metadataAvailableAtMs: input.metadataAvailableAtMs ?? null,
    listingStatus,
    allowedOrderTypes: input.allowedOrderTypes ?? ["MARKET", "LIMIT"],
    tickSize,
    stepSize,
    minQty,
    minNotional,
    quoteAssetCurrency: quoteAsset,
    marketDataFreshnessMs: input.marketDataFreshnessMs ?? null,
    bookDepthCoverage: input.bookDepthCoverage ?? "UNKNOWN",
    venueMappingQuality,
    eligibilityVerdict,
    reasonCodes: Array.from(new Set(reasonCodes)),
  };
}

export function assertDiscoveryExecutionSeparation(record: PointInTimeUniverseRecord) {
  return {
    discoveryVenue: record.discoveryVenue,
    executionVenue: record.executionVenue,
    usesDiscoveryPriceAsFill: false,
    quoteCurrency: record.quoteAssetCurrency,
  };
}
