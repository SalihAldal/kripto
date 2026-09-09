import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  safeMode: { enabled: false, reason: null, requireManualAck: false, updatedAt: null },
  breaker: { state: "CLOSED", openUntil: null, blockedUntil: null, lastFailureMessage: null, lastFailureCode: null },
}));

vi.mock("@/src/server/recovery/failsafe-recovery.service", () => ({
  getSafeModeState: vi.fn(async () => mocks.safeMode),
  setSafeModeState: vi.fn(async (input: unknown) => ({ ...mocks.safeMode, ...(input as object), enabled: false })),
}));

vi.mock("@/src/server/repositories/risk.repository", () => ({
  getApiFailureStateByDomain: vi.fn(async () => mocks.breaker),
}));

import {
  assessSafeModeExecutionGate,
  acknowledgeSafeModeThroughPolicy,
  formatSafeModeTerminalReason,
} from "@/src/server/recovery/paper-safe-mode-policy.service";

beforeEach(() => {
  mocks.safeMode = { enabled: false, reason: null, requireManualAck: false, updatedAt: null };
  mocks.breaker = { state: "CLOSED", openUntil: null, blockedUntil: null, lastFailureMessage: null, lastFailureCode: null };
});

describe("paper safe mode policy", () => {
  it("blocks execution when safe mode flag is enabled", async () => {
    mocks.safeMode = {
      enabled: true,
      reason: "Binance API failure breaker",
      requireManualAck: true,
      updatedAt: "2026-08-30T00:00:00.000Z",
    };
    const gate = await assessSafeModeExecutionGate("user-1");
    expect(gate.blocked).toBe(true);
    expect(gate.failureDomain).toBe("SAFE_MODE");
    expect(gate.failureCode).toBe("SAFE_MODE_ACTIVE");
    expect(formatSafeModeTerminalReason(gate)).toBe("SAFE_MODE:SAFE_MODE_ACTIVE");
  });

  it("blocks execution when execution API breaker is open", async () => {
    mocks.breaker = {
      state: "OPEN",
      openUntil: new Date(Date.now() + 60_000).toISOString(),
      blockedUntil: null,
      lastFailureMessage: "HTTP 503",
      lastFailureCode: "HTTP_503",
    };
    const gate = await assessSafeModeExecutionGate("user-1");
    expect(gate.blocked).toBe(true);
    expect(gate.failureDomain).toBe("EXECUTION");
    expect(gate.failureCode).toBe("API_FAILURE_BREAKER_OPEN");
  });

  it("rejects manual ack while breaker is still open", async () => {
    mocks.safeMode = { enabled: true, reason: "stale", requireManualAck: true, updatedAt: null };
    mocks.breaker = { state: "OPEN", openUntil: new Date(Date.now() + 60_000).toISOString(), blockedUntil: null, lastFailureMessage: null, lastFailureCode: null };
    const ack = await acknowledgeSafeModeThroughPolicy({ userId: "user-1", reason: "verified" });
    expect(ack.acknowledged).toBe(false);
    expect(ack.reason).toBe("API_FAILURE_BREAKER_STILL_OPEN");
  });

  it("accepts manual ack when breaker is closed", async () => {
    mocks.safeMode = { enabled: true, reason: "stale", requireManualAck: true, updatedAt: null };
    const ack = await acknowledgeSafeModeThroughPolicy({ userId: "user-1", reason: "verified" });
    expect(ack.acknowledged).toBe(true);
  });
});
