import type { SharedKv } from "@/src/server/market-data/spine/shared-kv";

export const REST_WEIGHT_BUDGET_PER_MINUTE = 5_500;
const BACKOFF_INITIAL_MS = 3_000;
const BACKOFF_MAX_MS = 120_000;
const BAN_DEFAULT_MS = 15 * 60_000;

export type RestLimiterDecision =
  | { ok: true; estimatedWeight: number; actualWeight: number | null }
  | { ok: false; reason: "RATE_BUDGET_EXCEEDED" | "BACKOFF" | "IP_BAN"; retryAt: number };

export type RestLimiterTelemetry = {
  estimatedWeight: number;
  actualWeight: number | null;
  rateLimited429: number;
  banned418: number;
  backoffUntil: number;
  banUntil: number;
  highPriorityBypassAttempts: number;
};

function minuteBucket(now = Date.now()) {
  return Math.floor(now / 60_000);
}

export class DistributedRestLimiter {
  readonly telemetry: RestLimiterTelemetry = {
    estimatedWeight: 0,
    actualWeight: null,
    rateLimited429: 0,
    banned418: 0,
    backoffUntil: 0,
    banUntil: 0,
    highPriorityBypassAttempts: 0,
  };

  constructor(
    private kv: SharedKv,
    private readonly budget = REST_WEIGHT_BUDGET_PER_MINUTE,
    private readonly prefix = "binance:rest",
  ) {}

  setKv(kv: SharedKv) {
    this.kv = kv;
  }

  async canSpend(estimatedWeight: number, _priority?: string): Promise<RestLimiterDecision> {
    const now = Date.now();
    const banUntil = Number((await this.kv.get(`${this.prefix}:ban_until`)) ?? "0");
    if (banUntil > now) {
      this.telemetry.banUntil = banUntil;
      return { ok: false, reason: "IP_BAN", retryAt: banUntil };
    }
    const backoffUntil = Number((await this.kv.get(`${this.prefix}:backoff_until`)) ?? "0");
    if (backoffUntil > now) {
      this.telemetry.backoffUntil = backoffUntil;
      return { ok: false, reason: "BACKOFF", retryAt: backoffUntil };
    }
    const used = Number((await this.kv.get(this.weightKey(now))) ?? "0");
    const actual = Number((await this.kv.get(this.actualKey(now))) ?? "0");
    const authoritative = actual > 0 ? actual : used;
    if (authoritative + estimatedWeight > this.budget) {
      return { ok: false, reason: "RATE_BUDGET_EXCEEDED", retryAt: (minuteBucket(now) + 1) * 60_000 };
    }
    return {
      ok: true,
      estimatedWeight: used,
      actualWeight: actual > 0 ? actual : null,
    };
  }

  async spend(estimatedWeight: number) {
    const now = Date.now();
    const key = this.weightKey(now);
    const used = await this.kv.incrBy(key, estimatedWeight);
    await this.kv.expire(key, 70);
    this.telemetry.estimatedWeight = used;
    return used;
  }

  noteHighPriorityBypassAttempt() {
    this.telemetry.highPriorityBypassAttempts += 1;
  }

  async reconcileActualWeight(usedWeightHeader: number) {
    if (!Number.isFinite(usedWeightHeader) || usedWeightHeader < 0) return;
    const now = Date.now();
    await this.kv.set(this.actualKey(now), String(Math.floor(usedWeightHeader)), 70);
    this.telemetry.actualWeight = usedWeightHeader;
  }

  async register429(input?: { retryAfterMs?: number }) {
    this.telemetry.rateLimited429 += 1;
    const retryAfter = Math.max(0, input?.retryAfterMs ?? 0);
    const previous = Number((await this.kv.get(`${this.prefix}:backoff_ms`)) ?? "0");
    const base = retryAfter > 0 ? retryAfter : Math.max(BACKOFF_INITIAL_MS, previous * 2 || BACKOFF_INITIAL_MS);
    const jitter = Math.floor(Math.random() * Math.max(250, base * 0.25));
    const wait = Math.min(base + jitter, BACKOFF_MAX_MS);
    const until = Date.now() + wait;
    await this.kv.set(`${this.prefix}:backoff_until`, String(until), Math.ceil(wait / 1000) + 5);
    await this.kv.set(`${this.prefix}:backoff_ms`, String(wait), 300);
    this.telemetry.backoffUntil = until;
    return until;
  }

  async register418(input?: { retryAfterMs?: number; banUntil?: number }) {
    this.telemetry.banned418 += 1;
    const until =
      input?.banUntil && input.banUntil > Date.now()
        ? input.banUntil
        : Date.now() + Math.max(BAN_DEFAULT_MS, input?.retryAfterMs ?? 0);
    const ttl = Math.ceil((until - Date.now()) / 1000) + 5;
    await this.kv.set(`${this.prefix}:ban_until`, String(until), ttl);
    await this.kv.set(`${this.prefix}:backoff_until`, String(until), ttl);
    this.telemetry.banUntil = until;
    this.telemetry.backoffUntil = until;
    return until;
  }

  async snapshot() {
    const now = Date.now();
    return {
      ...this.telemetry,
      estimatedWeight: Number((await this.kv.get(this.weightKey(now))) ?? this.telemetry.estimatedWeight),
      actualWeight: Number((await this.kv.get(this.actualKey(now))) ?? this.telemetry.actualWeight ?? 0) || this.telemetry.actualWeight,
      backoffUntil: Number((await this.kv.get(`${this.prefix}:backoff_until`)) ?? this.telemetry.backoffUntil),
      banUntil: Number((await this.kv.get(`${this.prefix}:ban_until`)) ?? this.telemetry.banUntil),
    };
  }

  private weightKey(now: number) {
    return `${this.prefix}:weight:${minuteBucket(now)}`;
  }

  private actualKey(now: number) {
    return `${this.prefix}:actual:${minuteBucket(now)}`;
  }
}

export function parseRetryAfterMsFromHeaders(headers: { get(name: string): string | null } | Record<string, string>) {
  const value =
    typeof (headers as { get?: (name: string) => string | null }).get === "function"
      ? (headers as { get(name: string): string | null }).get("retry-after")
      : (headers as Record<string, string>)["retry-after"] ?? (headers as Record<string, string>)["Retry-After"];
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

export function parseUsedWeightHeader(headers: { get(name: string): string | null } | Record<string, string>) {
  const read = (name: string) =>
    typeof (headers as { get?: (name: string) => string | null }).get === "function"
      ? (headers as { get(name: string): string | null }).get(name)
      : (headers as Record<string, string>)[name];
  const raw =
    read("x-mbx-used-weight-1m") ??
    read("X-MBX-USED-WEIGHT-1M") ??
    read("x-mbx-used-weight") ??
    read("X-MBX-USED-WEIGHT");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
