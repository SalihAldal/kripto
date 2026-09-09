import { afterEach, expect, it, vi } from "vitest";
import { DynamicSubscriptionManager } from "@/src/server/market-data/spine/dynamic-subscription-manager";
afterEach(() => vi.useRealTimers());
it("renews repeated scanner reads once and expires without touching position owners", () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const m = new DynamicSubscriptionManager();
  m.subscribe("BTCTRY", ["aggTrade"], "position-monitor");
  for (let i = 0; i < 100; i++) m.ensureLease("BTCTRY", ["aggTrade"], "scanner-context");
  expect(m.refCount("BTCTRY", "aggTrade")).toBe(2);
  vi.setSystemTime(60000); m.ensureLease("BTCTRY", ["aggTrade"], "scanner-context");
  vi.setSystemTime(120001); expect(m.expireLeases()).toEqual([]);
  expect(m.refCount("BTCTRY", "aggTrade")).toBe(2);
  vi.setSystemTime(180001); expect(m.expireLeases()).toEqual([]);
  expect(m.refCount("BTCTRY", "aggTrade")).toBe(1);
  expect(m.unsubscribe("BTCTRY", ["aggTrade"], "position-monitor")).toEqual(["btctry@aggTrade"]);
});
it("limits scanner subscriptions and recovers capacity after expiry", () => {
  vi.useFakeTimers(); vi.setSystemTime(0); const m = new DynamicSubscriptionManager();
  for (let i = 0; i < 1024; i++) m.ensureLease(`COIN${i}TRY`, ["aggTrade"], "scanner-context");
  expect(m.ensureLease("EXTRATRY", ["aggTrade"], "scanner-context")).toEqual([]);
  expect(m.desiredStreams()).toHaveLength(1024);
  vi.setSystemTime(120001); expect(m.expireLeases()).toHaveLength(1024);
  expect(m.ensureLease("EXTRATRY", ["aggTrade"], "scanner-context")).toEqual(["extratry@aggTrade"]);
});
