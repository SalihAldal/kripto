import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const ensureTradeMonitorsMock = vi.fn().mockResolvedValue(undefined);
const listTradeLifecycleEventsMock = vi.fn().mockResolvedValue([]);
const listTradeExecutionEventsMock = vi.fn().mockReturnValue([]);
const subscribeExecutionEventsMock = vi.fn().mockReturnValue(() => undefined);

vi.mock("@/services/trading-engine.service", () => ({
  ensureTradeMonitors: ensureTradeMonitorsMock,
  listTradeLifecycleEvents: listTradeLifecycleEventsMock,
  listTradeExecutionEvents: listTradeExecutionEventsMock,
}));

vi.mock("@/src/server/execution/execution-event-bus", () => ({
  subscribeExecutionEvents: subscribeExecutionEventsMock,
}));

vi.mock("@/lib/api", () => ({
  enforceRateLimit: () => null,
}));

vi.mock("@/lib/request-locale", () => ({
  getRequestLocale: () => "tr",
}));

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/config");
  vi.doUnmock("@/lib/auth");
});

describe("trades stream route", () => {
  it("local dev EventSource istegini header token olmadan kabul eder", async () => {
    vi.doMock("@/lib/config", () => ({ isProd: false }));
    vi.doMock("@/lib/auth", () => ({ checkApiToken: () => false }));
    const { GET } = await import("../app/api/trades/stream/route");

    const res = await GET(new NextRequest("http://localhost/api/trades/stream", {
      headers: {
        "x-forwarded-for": "::1",
        "sec-fetch-site": "same-origin",
      },
    }));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });

  it("production ortaminda tokensiz stream istegini reddeder", async () => {
    vi.doMock("@/lib/config", () => ({ isProd: true }));
    vi.doMock("@/lib/auth", () => ({ checkApiToken: () => false }));
    const { GET } = await import("../app/api/trades/stream/route");

    const res = await GET(new NextRequest("https://app.example.com/api/trades/stream", {
      headers: {
        "x-forwarded-for": "203.0.113.10",
        "sec-fetch-site": "same-origin",
      },
    }));

    expect(res.status).toBe(401);
  });
});
