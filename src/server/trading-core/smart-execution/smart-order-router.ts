import type { ExchangeVenue, SmartOrderRequest } from "@/src/server/trading-core/smart-execution/execution-types";
import { LatencyMonitor } from "@/src/server/trading-core/smart-execution/latency-monitor";

const venues: ExchangeVenue[] = [
  {
    name: "binance-futures",
    enabled: true,
    priority: 100,
    latencyMs: 80,
    failureRate: 0,
    takerFeeRate: 0.0004,
    makerFeeRate: 0.0002,
  },
  {
    name: "binance-spot",
    enabled: true,
    priority: 70,
    latencyMs: 120,
    failureRate: 0,
    takerFeeRate: 0.001,
    makerFeeRate: 0.0009,
  },
  {
    name: "fallback-paper",
    enabled: true,
    priority: 10,
    latencyMs: 5,
    failureRate: 0,
    takerFeeRate: 0,
    makerFeeRate: 0,
  },
];

export class SmartOrderRouter {
  constructor(private readonly latency: LatencyMonitor) {}

  selectVenue(request: SmartOrderRequest) {
    return venues
      .filter((venue) => venue.enabled)
      .map((venue) => {
        const observedLatency = this.latency.average(venue.name) || venue.latencyMs;
        const futuresBonus = request.leverage && request.leverage > 1 && venue.name === "binance-futures" ? 25 : 0;
        const score = venue.priority + futuresBonus - observedLatency * 0.08 - venue.failureRate * 100;
        return { venue, score };
      })
      .sort((a, b) => b.score - a.score)[0]?.venue ?? venues[venues.length - 1];
  }

  failover(current: ExchangeVenue) {
    return venues
      .filter((venue) => venue.enabled && venue.name !== current.name)
      .sort((a, b) => b.priority - a.priority)[0] ?? current;
  }
}
