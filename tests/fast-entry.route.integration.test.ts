import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const openTradeMock = vi.fn();
const getBestFastEntryMock = vi.fn();
const publishExecutionEventMock = vi.fn();

vi.mock("@/lib/api", () => ({
  apiError: (message: string, status = 400) => new Response(JSON.stringify({ ok: false, message }), { status }),
  apiErrorFromUnknown: (error: unknown) =>
    new Response(JSON.stringify({ ok: false, message: (error as Error).message }), { status: 500 }),
  apiOkFromRequest: (_request: unknown, data: unknown) => new Response(JSON.stringify(data), { status: 200 }),
  enforceRateLimit: () => null,
}));

vi.mock("@/lib/auth", () => ({
  checkApiToken: () => true,
}));

vi.mock("@/lib/request-locale", () => ({
  getRequestLocale: () => "tr",
}));

vi.mock("@/services/trading-engine.service", () => ({
  openTrade: openTradeMock,
}));

vi.mock("@/src/server/scanner", () => ({
  getBestFastEntry: getBestFastEntryMock,
}));

vi.mock("@/src/server/execution/execution-event-bus", () => ({
  publishExecutionEvent: publishExecutionEventMock,
}));

vi.mock("@/src/server/security/request-security", () => ({
  secureRoute: () => ({ ok: true, user: { id: "test-user", role: "TRADER" } }),
  sanitizePayload: (payload: unknown) => payload,
}));

vi.mock("@/src/server/security/idempotency", () => ({
  getIdempotencyKey: () => null,
  readIdempotentResponse: vi.fn().mockResolvedValue(null),
  writeIdempotentResponse: vi.fn().mockResolvedValue(undefined),
}));

describe("fast-entry route integration", () => {
  it("analiz -> coin secim -> alim akisinda basarili doner", async () => {
    getBestFastEntryMock.mockResolvedValueOnce({
      selected: {
        context: {
          symbol: "BTCTRY",
          metadata: { shortMomentumPercent: 0.2, shortFlowImbalance: 0.1 },
        },
        ai: {
          finalDecision: "BUY",
          finalConfidence: 93,
          roleScores: [],
          decisionPayload: { openTrade: true },
          explanation: "strong setup",
        },
        score: { score: 88 },
      },
      scannedAt: new Date().toISOString(),
      evaluated: 20,
      diagnostics: { tradableCount: 5, candidateCount: 20 },
    });
    openTradeMock.mockResolvedValueOnce({
      opened: true,
      rejected: false,
      executionId: "exec-route-1",
      positionId: "pos-route-1",
    });
    const { POST } = await import("../app/api/trades/fast-entry/route");
    const req = new NextRequest("http://localhost/api/trades/fast-entry", {
      method: "POST",
      body: JSON.stringify({ execute: true, amountTry: 1000 }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.selected.symbol).toBe("BTCTRY");
    expect(openTradeMock).toHaveBeenCalled();
    expect(publishExecutionEventMock).toHaveBeenCalled();
  });

  it("uygun coin yoksa no-trade doner", async () => {
    getBestFastEntryMock.mockResolvedValueOnce({
      selected: null,
      reason: "No suitable candidate",
      scannedAt: new Date().toISOString(),
      evaluated: 15,
      diagnostics: { tradableCount: 0, candidateCount: 15 },
    });
    const { POST } = await import("../app/api/trades/fast-entry/route");
    const req = new NextRequest("http://localhost/api/trades/fast-entry", {
      method: "POST",
      body: JSON.stringify({ execute: true }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(String(json.reason)).toContain("Uygun");
  });
});
