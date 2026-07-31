let latestRegime: import("@/src/server/trading-core-s2/trading-core-s2.types").MarketRegimeClassification | null = null;
let latestTopSymbols: string[] = [];
let latestScoreMap: Record<string, number> = {};
let latestSnapshotId: string | null = null;
let latestReport: import("@/src/server/trading-core-s2/trading-core-s2.types").DiscoveryV2Report | null = null;
let lastDiscoveryAt: string | null = null;

export function setCachedMarketRegime(regime: import("@/src/server/trading-core-s2/trading-core-s2.types").MarketRegimeClassification) {
  latestRegime = regime;
}

export function getCachedMarketRegime() {
  return latestRegime;
}

export function setCachedDiscoveryResult(input: {
  snapshotId: string;
  topSymbols: string[];
  scoreMap?: Record<string, number>;
  report: import("@/src/server/trading-core-s2/trading-core-s2.types").DiscoveryV2Report;
  scannedAt: string;
}) {
  latestSnapshotId = input.snapshotId;
  latestTopSymbols = input.topSymbols;
  latestScoreMap = input.scoreMap ?? {};
  latestReport = input.report;
  lastDiscoveryAt = input.scannedAt;
}

export function getCachedDiscoveryTopSymbols() {
  return [...latestTopSymbols];
}

export function getCachedDiscoverySnapshotId() {
  return latestSnapshotId;
}

export function getCachedDiscoveryReport() {
  return latestReport;
}

export function getCachedDiscoveryScannedAt() {
  return lastDiscoveryAt;
}

export function getCachedDiscoveryScoreMap() {
  return { ...latestScoreMap };
}

export function getCachedDiscoveryScore(symbol: string) {
  return latestScoreMap[symbol.toUpperCase()];
}
