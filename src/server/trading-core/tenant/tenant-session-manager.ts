import { randomUUID } from "node:crypto";
import type { TenantContext, TenantStatus } from "@/src/server/trading-core/tenant/tenant-types";

export class TenantSessionManager {
  private readonly sessions = new Map<string, TenantContext>();

  start(input: { userId: string; symbols: string[] }) {
    const now = new Date().toISOString();
    const current = this.sessions.get(input.userId);
    const session: TenantContext = {
      tenantId: current?.tenantId ?? `tenant-${input.userId}`,
      userId: input.userId,
      sessionId: current?.sessionId ?? randomUUID(),
      status: "ACTIVE",
      symbols: input.symbols.map((symbol) => symbol.toUpperCase()),
      startedAt: current?.startedAt ?? now,
      updatedAt: now,
    };
    this.sessions.set(input.userId, session);
    return session;
  }

  stop(userId: string) {
    return this.setStatus(userId, "STOPPED");
  }

  pause(userId: string) {
    return this.setStatus(userId, "PAUSED");
  }

  setError(userId: string) {
    return this.setStatus(userId, "ERROR");
  }

  get(userId: string) {
    return this.sessions.get(userId) ?? null;
  }

  all() {
    return Array.from(this.sessions.values());
  }

  private setStatus(userId: string, status: TenantStatus) {
    const current = this.sessions.get(userId);
    if (!current) return null;
    const next = { ...current, status, updatedAt: new Date().toISOString() };
    this.sessions.set(userId, next);
    return next;
  }
}

const globalSessions = globalThis as typeof globalThis & { __tenantSessionManager?: TenantSessionManager };
export const tenantSessions = globalSessions.__tenantSessionManager ?? new TenantSessionManager();
globalSessions.__tenantSessionManager = tenantSessions;
