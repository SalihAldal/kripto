import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const secureRouteMock = vi.fn();
const sanitizePayloadMock = vi.fn((payload: unknown) => payload);
const getIdempotencyKeyMock = vi.fn();
const readIdempotentResponseMock = vi.fn();
const writeIdempotentResponseMock = vi.fn();
const acquireUserActionLockMock = vi.fn();
const addAuditLogMock = vi.fn();
const enqueueMock = vi.fn();
const emergencyCancelMock = vi.fn();
const healthMock = vi.fn();
const startMock = vi.fn();

vi.mock("@/lib/api", () => ({
  apiError: (error: string, status = 400) => Response.json({ ok: false, error }, { status }),
  apiErrorFromUnknown: (error: unknown) =>
    Response.json({ ok: false, error: (error as Error).message }, { status: 500 }),
  apiOkFromRequest: (_request: unknown, data: unknown, status = 200) => Response.json({ ok: true, data }, { status }),
  enforceRateLimit: () => null,
}));

vi.mock("@/lib/request-locale", () => ({
  getRequestLocale: () => "tr",
}));

vi.mock("@/src/server/security/request-security", () => ({
  secureRoute: secureRouteMock,
  sanitizePayload: sanitizePayloadMock,
}));

vi.mock("@/src/server/security/idempotency", () => ({
  getIdempotencyKey: getIdempotencyKeyMock,
  readIdempotentResponse: readIdempotentResponseMock,
  writeIdempotentResponse: writeIdempotentResponseMock,
  acquireUserActionLock: acquireUserActionLockMock,
}));

vi.mock("@/src/server/repositories/audit.repository", () => ({
  addAuditLog: addAuditLogMock,
}));

vi.mock("@/src/server/trading-core/smart-execution/singleton", () => ({
  getSmartExecutionService: () => ({
    start: startMock,
    enqueue: enqueueMock,
    emergencyCancel: emergencyCancelMock,
    health: healthMock,
  }),
}));

function smartOrderRequest(headers?: HeadersInit) {
  return new NextRequest("http://localhost/api/trading-core/execution/smart-order", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: 1,
      maxSlippageBps: 25,
    }),
  });
}

function emergencyCancelRequest(headers?: HeadersInit) {
  return new NextRequest("http://localhost/api/trading-core/execution/emergency-cancel", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify({ symbol: "BTCUSDT" }),
  });
}

describe("trading-core smart execution routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TRADING_CORE_LIVE_EXECUTION;
    secureRouteMock.mockResolvedValue({ ok: true, user: { id: "user-1", role: "TRADER" } });
    getIdempotencyKeyMock.mockReturnValue("idem-1");
    readIdempotentResponseMock.mockResolvedValue(null);
    writeIdempotentResponseMock.mockResolvedValue(undefined);
    acquireUserActionLockMock.mockResolvedValue(vi.fn().mockResolvedValue(undefined));
    addAuditLogMock.mockResolvedValue(undefined);
    startMock.mockResolvedValue(undefined);
    enqueueMock.mockResolvedValue({ planId: "plan-1" });
    emergencyCancelMock.mockResolvedValue([{ planId: "plan-1", status: "CANCELED" }]);
    healthMock.mockResolvedValue({ name: "smart-execution-service", status: "healthy" });
  });

  it("smart-order yetkisiz erisimde secureRoute response'unu doner", async () => {
    secureRouteMock.mockResolvedValueOnce({
      ok: false,
      response: Response.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
    });
    const { POST } = await import("../app/api/trading-core/execution/smart-order/route");
    const res = await POST(smartOrderRequest());
    expect(res.status).toBe(401);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("smart-order idempotency key yoksa 428 doner", async () => {
    getIdempotencyKeyMock.mockReturnValueOnce(null);
    const { POST } = await import("../app/api/trading-core/execution/smart-order/route");
    const res = await POST(smartOrderRequest());
    const json = await res.json();
    expect(res.status).toBe(428);
    expect(json.ok).toBe(false);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("smart-order ayni idempotency key icin cached response doner", async () => {
    readIdempotentResponseMock.mockResolvedValueOnce({ plan: { planId: "cached-plan" } });
    const { POST } = await import("../app/api/trading-core/execution/smart-order/route");
    const res = await POST(smartOrderRequest());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.plan.planId).toBe("cached-plan");
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("smart-order valid requestte enqueue cagirir ve response cache yazar", async () => {
    const { POST } = await import("../app/api/trading-core/execution/smart-order/route");
    const res = await POST(smartOrderRequest());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.plan.planId).toBe("plan-1");
    expect(enqueueMock).toHaveBeenCalledOnce();
    expect(writeIdempotentResponseMock).toHaveBeenCalledWith("user-1", "smart-order", "idem-1", { plan: { planId: "plan-1" } });
  });

  it("live execution acikken smart-order confirmation ister", async () => {
    process.env.TRADING_CORE_LIVE_EXECUTION = "true";
    const { POST } = await import("../app/api/trading-core/execution/smart-order/route");
    await POST(smartOrderRequest({ "x-confirm-action": "CONFIRM" }));
    expect(secureRouteMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      tr: true,
      roles: ["ADMIN", "TRADER"],
      requireConfirmation: true,
    });
  });

  it("emergency-cancel confirmation zorunlulugunu secureRoute ile uygular", async () => {
    const { POST } = await import("../app/api/trading-core/execution/emergency-cancel/route");
    await POST(emergencyCancelRequest());
    expect(secureRouteMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      tr: true,
      roles: ["ADMIN"],
      requireConfirmation: true,
    });
  });

  it("emergency-cancel valid requestte cancel cagirir", async () => {
    const { POST } = await import("../app/api/trading-core/execution/emergency-cancel/route");
    const res = await POST(emergencyCancelRequest({ "x-confirm-action": "CONFIRM" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.canceled).toHaveLength(1);
    expect(emergencyCancelMock).toHaveBeenCalledWith("BTCUSDT");
  });
});
