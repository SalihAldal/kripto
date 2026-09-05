import { rmSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildExecutionBreakerKey,
  classifyExecutionFailure,
  normalizeExecutionTerminalReason,
  preserveExecutionFailure,
  redactExecutionError,
  resolveExecutionFailure,
} from "@/src/server/execution/execution-failure-contract";
import {
  getCircuitSnapshot,
  hydrateCircuitSnapshotForTests,
  listBreakerEvents,
  resetCircuitBreakerForTests,
  withCircuitBreaker,
} from "@/src/server/resilience/circuit-breaker";
import { selectExecutionRelevantCircuits } from "@/src/server/execution-safety/api-health-validation.service";
import { resolveExecutionAdapter } from "@/src/server/paper-runtime/execution-port";
import { assertLiveOrderSubmissionAllowed } from "@/src/server/paper-runtime/live-lock";

describe("P0 execution failure and breaker contract", () => {
  beforeEach(() => {
    process.env.KRIPTO_BREAKER_PERSIST = "0";
    delete process.env.KRIPTO_BREAKER_STATE_PATH;
    resetCircuitBreakerForTests();
    vi.useRealTimers();
  });

  it("valid paper mode resolves the simulated adapter, not live", () => {
    expect(resolveExecutionAdapter("paper").kind).toBe("PAPER");
    expect(resolveExecutionAdapter("live").kind).toBe("LIVE");
  });

  it("paper mode excludes live balance, clock and AI circuits", () => {
    const rows = [
      { state: "OPEN", domain: "AI_PROVIDER", venue: "default" },
      { state: "OPEN", domain: "BALANCE", venue: "BINANCE_TR" },
      { state: "OPEN", domain: "CLOCK_SYNC", venue: "BINANCE_TR" },
      { state: "OPEN", domain: "MARKET_DATA", venue: "BINANCE_TR" },
    ] as Parameters<typeof selectExecutionRelevantCircuits>[1];
    expect(selectExecutionRelevantCircuits({ mode: "paper", venue: "BINANCE_TR" }, rows)).toHaveLength(1);
    expect(selectExecutionRelevantCircuits({ mode: "live", venue: "BINANCE_TR" }, rows)).toHaveLength(3);
  });

  it("symbol filter validation reject is candidate-local and breaker-ineligible", () => {
    const failure = classifyExecutionFailure(new Error("LOT_SIZE validation failed"), {
      operation: "validate_symbol",
      dependency: "symbol:HEMIUSDT",
      domainHint: "SYMBOL_FILTER",
    });
    expect(failure.failureCode).toBe("VALIDATION_REJECT");
    expect(failure.retryable).toBe(false);
    expect(failure.breakerEligible).toBe(false);
  });

  it("one symbol validation error does not open or block another symbol", async () => {
    await expect(
      withCircuitBreaker(
        "symbol-filter",
        async () => {
          throw new Error("MIN_NOTIONAL validation failed");
        },
        {
          threshold: 1,
          domain: "SYMBOL_FILTER",
          operation: "validate_symbol",
          dependency: "symbol:HEMIUSDT",
          venue: "BINANCE_TR",
        },
      ),
    ).rejects.toThrow("MIN_NOTIONAL");
    expect(getCircuitSnapshot()[0]?.state).toBe("CLOSED");
    await expect(
      withCircuitBreaker("symbol-filter", async () => "ok", {
        threshold: 1,
        domain: "SYMBOL_FILTER",
        operation: "validate_symbol",
        dependency: "symbol:ADAUSDT",
        venue: "BINANCE_TR",
      }),
    ).resolves.toBe("ok");
  });

  it("AI provider failure is isolated from Binance market data", async () => {
    await expect(
      withCircuitBreaker(
        "ai:technical",
        async () => {
          throw new Error("OpenAI network timeout");
        },
        {
          threshold: 1,
          domain: "AI_PROVIDER",
          operation: "technical_specialist",
          dependency: "openai",
        },
      ),
    ).rejects.toThrow();
    expect(getCircuitSnapshot()[0]?.domain).toBe("AI_PROVIDER");
  });

  it("database error is classified as DATABASE", () => {
    const failure = classifyExecutionFailure(new Error("Prisma P1001 database unreachable"), {
      operation: "persist_order",
      dependency: "postgres",
    });
    expect(`${failure.failureDomain}:${failure.failureCode}`).toBe("DATABASE:DATABASE_FAILURE");
  });

  it("redis error is classified as REDIS", () => {
    expect(
      classifyExecutionFailure(new Error("ioredis ECONNREFUSED"), {
        operation: "idempotency",
        dependency: "redis",
      }).failureDomain,
    ).toBe("REDIS");
  });

  it("market-data timeout is retryable and breaker eligible", () => {
    const failure = classifyExecutionFailure(new Error("ticker request timeout"), {
      operation: "get_ticker",
      dependency: "binance_tr",
    });
    expect(failure.failureDomain).toBe("MARKET_DATA");
    expect(failure.retryable).toBe(true);
    expect(failure.breakerEligible).toBe(true);
  });

  it("HTTP 429 preserves rate-limit code", () => {
    const failure = classifyExecutionFailure(new Error("HTTP 429 too many requests"), {
      operation: "get_ticker",
      dependency: "binance_tr",
      domainHint: "MARKET_DATA",
    });
    expect(failure.statusCode).toBe(429);
    expect(failure.failureCode).toBe("RATE_LIMIT_429");
  });

  it("HTTP 418 preserves IP-ban code", () => {
    const failure = classifyExecutionFailure(new Error("HTTP 418 IP banned"), {
      operation: "get_ticker",
      dependency: "binance_tr",
      domainHint: "MARKET_DATA",
    });
    expect(failure.statusCode).toBe(418);
    expect(failure.failureCode).toBe("IP_BAN_418");
  });

  it("HTTP 5xx is breaker eligible", () => {
    const failure = classifyExecutionFailure(new Error("HTTP 503 upstream unavailable"), {
      operation: "get_depth",
      dependency: "binance_tr",
      domainHint: "ORDER_BOOK",
    });
    expect(failure.failureCode).toBe("UPSTREAM_503");
    expect(failure.breakerEligible).toBe(true);
  });

  it("validation HTTP 4xx is not an outage", () => {
    const failure = classifyExecutionFailure(new Error("HTTP 400 invalid quantity validation"), {
      operation: "validate_order",
      dependency: "binance_tr",
      domainHint: "SYMBOL_FILTER",
    });
    expect(failure.failureCode).toBe("VALIDATION_REJECT");
    expect(failure.breakerEligible).toBe(false);
  });

  it("successful half-open probe closes the isolated breaker", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    const options = {
      threshold: 1,
      cooldownMs: 1_000,
      domain: "MARKET_DATA" as const,
      operation: "get_ticker",
      dependency: "binance_tr",
      venue: "BINANCE_TR",
    };
    await expect(withCircuitBreaker("ticker", async () => Promise.reject(new Error("network timeout")), options)).rejects.toThrow();
    vi.setSystemTime(new Date("2026-09-01T00:00:01.001Z"));
    await expect(withCircuitBreaker("ticker", async () => "ok", options)).resolves.toBe("ok");
    expect(getCircuitSnapshot()[0]?.state).toBe("CLOSED");
    expect(getCircuitSnapshot()[0]?.halfOpenSuccess).toBe(1);
    expect(listBreakerEvents().map((event) => event.type)).toContain("BREAKER_RECOVERED");
  });

  it("failed half-open probe reopens only that dependency", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    const options = {
      threshold: 1,
      cooldownMs: 1_000,
      domain: "MARKET_DATA" as const,
      operation: "get_ticker",
      dependency: "binance_tr",
      venue: "BINANCE_TR",
    };
    await expect(withCircuitBreaker("ticker", async () => Promise.reject(new Error("network timeout")), options)).rejects.toThrow();
    vi.setSystemTime(new Date("2026-09-01T00:00:01.001Z"));
    await expect(withCircuitBreaker("ticker", async () => Promise.reject(new Error("HTTP 503")), options)).rejects.toThrow();
    const target = getCircuitSnapshot()[0]!;
    expect(target.state).toBe("OPEN");
    expect(target.halfOpenFailure).toBe(1);
  });

  it("breaker key includes domain operation dependency and venue", () => {
    expect(
      buildExecutionBreakerKey({
        failureDomain: "PRICE",
        operation: "get_ticker",
        dependency: "binance_tr",
        venue: "BINANCE_TR",
      }),
    ).toBe("PRICE:get_ticker:binance_tr:binance_tr");
  });

  it("paper data stale is PAPER_EXECUTION and not live execution", () => {
    const failure = classifyExecutionFailure(new Error("PAPER_EXECUTION_DATA_STALE"), {
      operation: "simulate_order",
      dependency: "paper_exchange_simulator",
      executionMode: "paper",
    });
    expect(failure.failureDomain).toBe("PAPER_EXECUTION");
    expect(failure.failureCode).toBe("PAPER_DATA_STALE");
  });

  it("legacy generic breaker text cannot be a new terminal reason", () => {
    expect(normalizeExecutionTerminalReason({ rejectReason: "Binance API failure breaker" })).toBe(
      "UNKNOWN:GENERIC_TERMINAL_REASON_DETAIL_MISSING",
    );
  });

  it.each([
    "Binance API failure breaker",
    "Unknown execution failure",
    "Execution failed",
    "Pre-check failed",
  ])("generic terminal reason is rejected: %s", (rejectReason) => {
    expect(normalizeExecutionTerminalReason({ rejectReason })).toBe(
      "UNKNOWN:GENERIC_TERMINAL_REASON_DETAIL_MISSING",
    );
  });

  it("non-canonical fallback is prefixed with a canonical terminal code", () => {
    expect(normalizeExecutionTerminalReason({ fallback: "Alim acilisi basarisiz" })).toBe(
      "UNKNOWN:UNCLASSIFIED_TERMINAL_REASON Alim acilisi basarisiz",
    );
  });

  it("failure details override a generic terminal message", () => {
    expect(
      normalizeExecutionTerminalReason({
        rejectReason: "Binance API failure breaker",
        details: { failureDomain: "DATABASE", failureCode: "P1001" },
      }),
    ).toBe("DATABASE:P1001");
  });

  it("live lock remains enabled", () => {
    const result = assertLiveOrderSubmissionAllowed({ executionMode: "live" });
    expect(result.allowed).toBe(false);
  });

  it("duplicate order is non-retryable", () => {
    const failure = classifyExecutionFailure(new Error("Duplicate order blocked by idempotency"), {
      operation: "submit_order",
      dependency: "idempotency",
      executionMode: "paper",
    });
    expect(failure.failureCode).toBe("DUPLICATE_ORDER");
    expect(failure.retryable).toBe(false);
  });

  it("secret redaction removes API key, token and bearer values", () => {
    const safe = redactExecutionError(
      "api_key=abc123 token:xyz Authorization=secret Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
    );
    expect(safe).not.toContain("abc123");
    expect(safe).not.toContain("xyz");
    expect(safe).not.toContain("eyJ");
    expect(safe).toContain("[REDACTED]");
  });

  it("canonical failure survives nested dependency-to-terminal propagation", () => {
    const nested = preserveExecutionFailure(new Error("ticker request timeout"), {
      domainHint: "MARKET_DATA",
      operation: "execution-precheck-price",
      dependency: "binance_tr",
      executionMode: "paper",
    });
    const terminal = resolveExecutionFailure(nested, {
      domainHint: "UNKNOWN",
      operation: "execute_analyze_and_trade",
      dependency: "orchestrator",
    });
    expect(terminal).toMatchObject({
      failureDomain: "MARKET_DATA",
      failureCode: "TIMEOUT",
      operation: "execution-precheck-price",
      dependency: "binance_tr",
      retryable: true,
    });
  });

  it.each([
    ["ticker timeout", "ticker request timeout", "MARKET_DATA", true, null],
    ["book unavailable", "order book unavailable", "ORDER_BOOK", false, null],
    ["stale price", "stale price", "PRICE", false, null],
    ["invalid price", "invalid price", "PRICE", false, null],
    ["websocket degraded", "websocket degraded", "MARKET_DATA", true, null],
    ["REST fallback failure", "REST fallback network failure", "MARKET_DATA", true, null],
    ["symbol not found", "symbol not found", "EXCHANGE_INFO", false, null],
    ["invalid step size", "LOT_SIZE step size validation failed", "SYMBOL_FILTER", false, null],
    ["invalid tick size", "PRICE_FILTER tick size validation failed", "SYMBOL_FILTER", false, null],
    ["min notional", "MIN_NOTIONAL validation failed", "SYMBOL_FILTER", false, null],
    ["filter cache stale", "filter cache stale", "EXCHANGE_INFO", false, null],
    ["exchange info timeout", "exchange-info timeout", "EXCHANGE_INFO", true, null],
    ["database connection", "Prisma P1001 connection timeout", "DATABASE", true, null],
    ["transaction rollback", "database transaction rollback", "DATABASE", false, null],
    ["unique collision", "Prisma P2002 duplicate idempotency collision", "DATABASE", false, null],
    ["persistence failure", "database persistence failure", "DATABASE", false, null],
    ["redis unavailable", "ioredis ECONNREFUSED", "REDIS", true, null],
    ["redis timeout", "redis timeout", "REDIS", true, null],
    ["redis stale lock", "redis stale lock", "REDIS", false, null],
    ["redis ownership", "redis lock ownership mismatch", "REDIS", false, null],
    ["clock skew", "clock skew excessive", "CLOCK_SYNC", false, null],
    ["clock timeout", "clock sync timeout", "CLOCK_SYNC", true, null],
    ["AI timeout", "OpenAI provider timeout", "AI_PROVIDER", true, null],
    ["AI degraded", "all AI providers degraded", "AI_PROVIDER", false, null],
    ["AI malformed", "malformed provider response", "AI_PROVIDER", false, null],
    ["paper reject", "paper simulated order rejected", "PAPER_EXECUTION", false, null],
    ["paper zero fill", "paper zero fill", "PAPER_EXECUTION", false, null],
    ["paper fill timeout", "paper fill timeout", "PAPER_EXECUTION", true, null],
    ["paper balance", "insufficient simulated balance", "PAPER_EXECUTION", false, null],
    ["live permission", "live trading permission missing", "LIVE_EXECUTION", false, null],
    ["live endpoint", "live order endpoint HTTP 503", "LIVE_EXECUTION", true, 503],
    ["live confirmation", "exchange confirmation missing", "LIVE_EXECUTION", false, null],
  ] as const)(
    "failure matrix preserves canonical fields: %s",
    (_name, message, domainHint, retryable, statusCode) => {
      const failure = classifyExecutionFailure(new Error(message), {
        domainHint,
        operation: `verify_${domainHint.toLowerCase()}`,
        dependency: domainHint === "DATABASE" ? "postgres" : domainHint.toLowerCase(),
      });
      expect(failure).toMatchObject({
        failureDomain: domainHint,
        operation: `verify_${domainHint.toLowerCase()}`,
        dependency: domainHint === "DATABASE" ? "postgres" : domainHint.toLowerCase(),
        retryable,
        statusCode,
        breakerState: "CLOSED",
        openUntil: null,
      });
      expect(failure.failureCode).toMatch(/^[A-Z0-9_]+$/);
      expect(failure.safeMessage.length).toBeGreaterThan(0);
      expect(failure.safeMessage).not.toBe("Binance API failure breaker");
    },
  );

  it("threshold, fail-fast and single half-open probe semantics are isolated", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    const options = {
      threshold: 2,
      cooldownMs: 1_000,
      domain: "REDIS" as const,
      operation: "acquire_lock",
      dependency: "redis",
      venue: "default",
    };
    await expect(withCircuitBreaker("lock", async () => Promise.reject(new Error("redis timeout")), options)).rejects.toThrow();
    expect(getCircuitSnapshot()[0]?.state).toBe("CLOSED");
    await expect(withCircuitBreaker("lock", async () => Promise.reject(new Error("redis timeout")), options)).rejects.toThrow();
    expect(getCircuitSnapshot()[0]?.state).toBe("OPEN");

    const blocked = vi.fn(async () => "unexpected");
    await expect(withCircuitBreaker("lock", blocked, options)).rejects.toThrow("Circuit is open");
    expect(blocked).not.toHaveBeenCalled();

    vi.setSystemTime(new Date("2026-09-01T00:00:02.001Z"));
    let releaseProbe!: () => void;
    const probeGate = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    const probe = withCircuitBreaker("lock", async () => {
      await probeGate;
      return "ok";
    }, options);
    await expect(withCircuitBreaker("lock", async () => "second", options)).rejects.toThrow("half_open_probe_busy");
    releaseProbe();
    await expect(probe).resolves.toBe("ok");
    expect(getCircuitSnapshot()[0]).toMatchObject({
      state: "CLOSED",
      halfOpenProbeCount: 1,
      halfOpenSuccess: 1,
    });
  });

  it("circuit state survives process restart via persisted snapshot hydration", async () => {
    const statePath = path.join(process.cwd(), "artifacts", "runtime", "breaker-restart-test.json");
    process.env.KRIPTO_BREAKER_PERSIST = "1";
    process.env.KRIPTO_BREAKER_STATE_PATH = statePath;
    resetCircuitBreakerForTests();
    await expect(
      withCircuitBreaker(
        "ticker",
        async () => {
          throw new Error("HTTP 429 too many requests");
        },
        {
          threshold: 1,
          cooldownMs: 60_000,
          domain: "MARKET_DATA",
          operation: "get_ticker",
          dependency: "binance_tr",
          venue: "BINANCE_TR",
        },
      ),
    ).rejects.toThrow();
    expect(getCircuitSnapshot()[0]?.state).toBe("OPEN");
    resetCircuitBreakerForTests({ keepPersistedState: true });
    expect(getCircuitSnapshot()[0]?.state).toBe("OPEN");
    rmSync(statePath, { force: true });
  });

  it("hydrated snapshot preserves open circuit metadata contract", () => {
    hydrateCircuitSnapshotForTests([
      {
        key: "MARKET_DATA:get_ticker:binance_tr:binance_tr",
        domain: "MARKET_DATA",
        operation: "get_ticker",
        dependency: "binance_tr",
        venue: "binance_tr",
        state: "OPEN",
        failureCount: 3,
        consecutiveFailures: 3,
        threshold: 3,
        cooldownMs: 60000,
        openedAt: "2026-09-01T00:00:00.000Z",
        openUntil: "2026-09-01T00:05:00.000Z",
        lastFailureAt: "2026-09-01T00:00:00.000Z",
        lastSuccessAt: null,
        resetCount: 0,
        lastFailureCode: "RATE_LIMIT_429",
        lastFailureMessage: "HTTP 429 too many requests",
        openCount: 1,
        halfOpenProbeCount: 0,
        halfOpenSuccess: 0,
        halfOpenFailure: 0,
      },
    ]);
    expect(getCircuitSnapshot()[0]).toMatchObject({
      state: "OPEN",
      failureCount: 3,
      lastFailureCode: "RATE_LIMIT_429",
      dependency: "binance_tr",
    });
  });
});
