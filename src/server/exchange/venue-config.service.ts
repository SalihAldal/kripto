import { env } from "@/lib/config";

export type BinanceVenue = "BINANCE_TR" | "BINANCE_GLOBAL";

export type CanonicalVenueConfig = {
  platform: "tr" | "global";
  discoveryVenue: BinanceVenue;
  marketDataVenue: BinanceVenue;
  microstructureVenue: BinanceVenue;
  metadataVenue: BinanceVenue;
  paperExecutionVenue: BinanceVenue;
  liveExecutionVenue: BinanceVenue;
  allowCrossVenueFallback: boolean;
  lightSocketRole: "LIGHT_MARKET_CONNECTION";
  deepSocketRole: "DEEP_MARKET_CONNECTION";
  officialMaxControlCommandsPerSec: number;
  maxControlCommandsPerSec: number;
};

const OFFICIAL_BINANCE_CONTROL_LIMIT_PER_SEC = 5;
const SAFE_INTERNAL_CONTROL_LIMIT_PER_SEC = 3;

function venueFromPlatform(platform: "tr" | "global"): BinanceVenue {
  return platform === "tr" ? "BINANCE_TR" : "BINANCE_GLOBAL";
}

export function resolveCanonicalVenueConfig(): CanonicalVenueConfig {
  const platform = env.BINANCE_PLATFORM === "tr" ? "tr" : "global";
  const venue = venueFromPlatform(platform);
  return {
    platform,
    discoveryVenue: venue,
    marketDataVenue: venue,
    microstructureVenue: venue,
    metadataVenue: venue,
    paperExecutionVenue: venue,
    liveExecutionVenue: venue,
    // FIX-2 kurali: implicit provider hopping kapali.
    allowCrossVenueFallback: false,
    lightSocketRole: "LIGHT_MARKET_CONNECTION",
    deepSocketRole: "DEEP_MARKET_CONNECTION",
    officialMaxControlCommandsPerSec: OFFICIAL_BINANCE_CONTROL_LIMIT_PER_SEC,
    maxControlCommandsPerSec: SAFE_INTERNAL_CONTROL_LIMIT_PER_SEC,
  };
}

export function assertVenueConfigConsistency(config = resolveCanonicalVenueConfig()) {
  const issues: string[] = [];
  const all = [
    config.discoveryVenue,
    config.marketDataVenue,
    config.microstructureVenue,
    config.metadataVenue,
    config.paperExecutionVenue,
  ];
  const sameVenue = all.every((item) => item === all[0]);
  if (!sameVenue) {
    issues.push("CROSS_VENUE_RUNTIME_DISABLED");
  }
  if (config.maxControlCommandsPerSec <= 0 || config.maxControlCommandsPerSec >= config.officialMaxControlCommandsPerSec) {
    issues.push("INVALID_CONTROL_COMMAND_RATE_LIMIT");
  }
  return {
    ok: issues.length === 0,
    issues,
  };
}

export function resolveExecutionVenueEligibility(input: {
  symbol: string;
  liveExecutionVenue?: BinanceVenue;
  executableSymbols: Set<string>;
}) {
  const symbol = input.symbol.toUpperCase();
  const venue = input.liveExecutionVenue ?? resolveCanonicalVenueConfig().liveExecutionVenue;
  const executable = input.executableSymbols.has(symbol);
  return {
    symbol,
    executionVenue: venue,
    executionVenueEligible: executable,
    reasonCode: executable ? "VENUE_EXECUTABLE" : "VENUE_NOT_EXECUTABLE",
  };
}
