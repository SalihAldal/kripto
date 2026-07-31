import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/config");
});

describe("checkApiToken", () => {
  it("local live modda read-only internal UI isteklerine izin verir", async () => {
    vi.doMock("@/lib/config", () => ({
      env: {
        APP_TOKEN: undefined,
        APP_TOKEN_NEXT: undefined,
        EXECUTION_MODE: "live",
      },
      isProd: false,
    }));
    const { checkApiToken } = await import("@/lib/auth");
    const request = new NextRequest("http://localhost/api/exchange/balance?force=1", {
      method: "GET",
      headers: {
        "x-kinetic-internal": "1",
        "sec-fetch-site": "same-origin",
      },
    });

    expect(checkApiToken(request)).toBe(true);
  });

  it("local live modda same-origin dashboard mutation isteklerine izin verir", async () => {
    vi.doMock("@/lib/config", () => ({
      env: {
        APP_TOKEN: undefined,
        APP_TOKEN_NEXT: undefined,
        EXECUTION_MODE: "live",
      },
      isProd: false,
    }));
    const { checkApiToken } = await import("@/lib/auth");
    const request = new NextRequest("http://localhost/api/trades/open", {
      method: "POST",
      headers: {
        "x-kinetic-internal": "1",
        "sec-fetch-site": "same-origin",
      },
    });

    expect(checkApiToken(request)).toBe(true);
  });

  it("production ortaminda internal isteklerde de token ister", async () => {
    vi.doMock("@/lib/config", () => ({
      env: {
        APP_TOKEN: "secret-token",
        APP_TOKEN_NEXT: undefined,
        EXECUTION_MODE: "live",
      },
      isProd: true,
    }));
    const { checkApiToken } = await import("@/lib/auth");
    const request = new NextRequest("https://app.example.com/api/exchange/balance", {
      method: "GET",
      headers: {
        "x-kinetic-internal": "1",
        "sec-fetch-site": "same-origin",
      },
    });

    expect(checkApiToken(request)).toBe(false);
  });
});
