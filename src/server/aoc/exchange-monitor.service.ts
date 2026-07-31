import { persistExchangeHealthHistory } from "@/src/server/aoc/aoc.repository";

export async function monitorExchange() {
  let restHealthy = true;
  let wsHealthy = true;
  let latencyMs = 0;
  let apiErrorCount = 0;
  let rateLimitHits = 0;

  try {
    const { getProductionAdapter } = await import("@/src/server/exchange-abstraction/plugin-registry.service");
    const adapter = getProductionAdapter();
    const start = Date.now();
    const health = await adapter.health();
    latencyMs = Date.now() - start;
    restHealthy = health.restConnected;
    wsHealthy = health.wsConnected;
    apiErrorCount = health.apiErrorCount;
    rateLimitHits = health.rateLimitHits;
  } catch {
    restHealthy = false;
    wsHealthy = false;
    apiErrorCount = 1;
  }

  const overallScore = restHealthy && wsHealthy ? Math.max(30, 100 - latencyMs / 10 - apiErrorCount * 5) : 30;

  return persistExchangeHealthHistory({
    exchange: "BINANCE_SPOT",
    restHealthy,
    wsHealthy,
    latencyMs,
    heartbeatOk: restHealthy,
    reconnectCount: 0,
    rateLimitHits,
    apiErrorCount,
    missingCandles: 0,
    missingTrades: 0,
    orderFailures: 0,
    overallScore: Number(overallScore.toFixed(1)),
  });
}
