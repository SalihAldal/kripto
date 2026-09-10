import { describe, expect, it } from "vitest";
import { DynamicSubscriptionManager } from "@/src/server/market-data/spine/dynamic-subscription-manager";
import { SubscriptionCommandQueue } from "@/src/server/market-data/spine/subscription-command-queue";
import { FakeMarketSocket } from "@/src/server/market-data/spine/ws-connection";
import { MarketDataDaemon } from "@/src/server/market-data/spine/market-data-daemon";
import { MemoryKv } from "@/src/server/market-data/spine/shared-kv";
import {
  getCircuitSnapshot,
  resetCircuitBreakerForTests,
  withCircuitBreaker,
} from "@/src/server/resilience/circuit-breaker";
import {
  assertVenueConfigConsistency,
  resolveCanonicalVenueConfig,
  resolveExecutionVenueEligibility,
} from "@/src/server/exchange/venue-config.service";

describe("fix2 binance runtime hardening", () => {
  it("subscription queue batches and respects control-message headroom", () => {
    const queue = new SubscriptionCommandQueue(3);
    const streams = Array.from({ length: 100 }).map((_, i) => `s${i}@aggTrade`);
    queue.enqueue("SUBSCRIBE", streams);
    const first = queue.dequeueBatch(1000);
    const second = queue.dequeueBatch(1001);
    expect(first?.method).toBe("SUBSCRIBE");
    expect(first?.params.length).toBe(100);
    expect(second).toBeNull();
    expect(queue.telemetry(1001).commandsLast1s).toBeLessThanOrEqual(3);
    expect(queue.telemetry(1001).controlRateViolation).toBe(0);
  });

  it("dedupe + refcount keeps one subscribe for many consumers", () => {
    const manager = new DynamicSubscriptionManager();
    const first = manager.subscribe("BTCUSDT", ["aggTrade"], "owner-1");
    for (let i = 2; i <= 10; i += 1) {
      manager.subscribe("BTCUSDT", ["aggTrade"], `owner-${i}`);
    }
    expect(first.length).toBe(1);
    expect(manager.refCount("BTCUSDT", "aggTrade")).toBe(10);
    expect(manager.desiredStreams().length).toBe(1);
  });

  it("refcount unsubscribe closes only last owner", () => {
    const manager = new DynamicSubscriptionManager();
    for (let i = 1; i <= 10; i += 1) {
      manager.subscribe("BTCUSDT", ["bookTicker"], `owner-${i}`);
    }
    for (let i = 1; i <= 9; i += 1) {
      const removed = manager.unsubscribe("BTCUSDT", ["bookTicker"], `owner-${i}`);
      expect(removed.length).toBe(0);
    }
    expect(manager.refCount("BTCUSDT", "bookTicker")).toBe(1);
  });

  it("deep socket 1008 does not kill light socket", async () => {
    const sockets: FakeMarketSocket[] = [];
    const daemon = new MarketDataDaemon({
      autoConnect: false,
      kv: new MemoryKv(),
      socketFactory: () => {
        const socket = new FakeMarketSocket();
        sockets.push(socket);
        queueMicrotask(() => socket.open());
        return socket;
      },
    });
    daemon.connectStreams();
    await Promise.resolve();
    daemon.subscribeDeep("BTCUSDT", "micro");
    daemon.flushCommandQueue();
    const light = sockets[0];
    const deep = sockets[1];
    deep.close(1008, "Too many requests");
    const telemetry = daemon.telemetry();
    expect(light.closed).toBe(false);
    expect(telemetry.count1008).toBeGreaterThanOrEqual(1);
    expect(telemetry.deepCloseCount).toBeGreaterThanOrEqual(1);
  });

  it("breaker supports CLOSED->OPEN->HALF_OPEN->CLOSED", async () => {
    resetCircuitBreakerForTests();
    const key = "market-data:ws";
    await expect(
      withCircuitBreaker(
        key,
        async () => {
          throw new Error("HTTP 429 Retry-After: 1");
        },
        { threshold: 1, cooldownMs: 10 },
      ),
    ).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 1_100));
    await expect(withCircuitBreaker(key, async () => "ok", { threshold: 1, cooldownMs: 10 })).resolves.toBe("ok");
    // Circuit keys are now isolated by domain/dependency/venue; operation preserves
    // the caller's identifier. Check the actual circuit instead of a missing row.
    const snapshot = getCircuitSnapshot().find((row) => row.operation === key);
    expect(snapshot?.state).toBe("CLOSED");
    expect(snapshot?.halfOpenProbeCount).toBeGreaterThanOrEqual(1);
    expect(snapshot?.halfOpenSuccess).toBeGreaterThanOrEqual(1);
  });

  it("half-open allows only one probe owner", async () => {
    resetCircuitBreakerForTests();
    const key = "execution:place";
    await expect(
      withCircuitBreaker(
        key,
        async () => {
          throw new Error("HTTP 500");
        },
        { threshold: 1, cooldownMs: 10 },
      ),
    ).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    const first = withCircuitBreaker(
      key,
      async () => {
        await new Promise((r) => setTimeout(r, 40));
        return "probe-ok";
      },
      { threshold: 1, cooldownMs: 10 },
    );
    const second = withCircuitBreaker(key, async () => "second", { threshold: 1, cooldownMs: 10 });
    const secondExpectation = expect(second).rejects.toThrow(/Circuit is open/);
    await expect(first).resolves.toBe("probe-ok");
    await secondExpectation;
  });

  it("venue eligibility blocks non-executable live symbols", () => {
    const result = resolveExecutionVenueEligibility({
      symbol: "XYZUSDT",
      executableSymbols: new Set(["BTCUSDT", "ETHUSDT"]),
    });
    expect(result.executionVenueEligible).toBe(false);
    expect(result.reasonCode).toBe("VENUE_NOT_EXECUTABLE");
  });

  it("canonical venue config is explicit and internally consistent", () => {
    const venue = resolveCanonicalVenueConfig();
    const check = assertVenueConfigConsistency(venue);
    expect(check.ok).toBe(true);
    expect(venue.discoveryVenue).toBe(venue.marketDataVenue);
    expect(venue.marketDataVenue).toBe(venue.microstructureVenue);
    expect(venue.paperExecutionVenue).toBe(venue.marketDataVenue);
  });
});
