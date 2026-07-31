import type { SmartOrderExecution, SmartOrderSlice, SmartOrderStatus } from "@/src/server/trading-core/smart-execution/execution-types";

export class OrderStateStore {
  private readonly executions = new Map<string, SmartOrderExecution>();
  private readonly idempotencyKeys = new Map<string, number>();

  hasDuplicate(key: string) {
    const until = this.idempotencyKeys.get(key) ?? 0;
    if (until <= Date.now()) {
      this.idempotencyKeys.delete(key);
      return false;
    }
    return true;
  }

  remember(key: string, ttlMs = 60_000) {
    this.idempotencyKeys.set(key, Date.now() + ttlMs);
  }

  create(planId: string, slices: SmartOrderSlice[]): SmartOrderExecution {
    const now = new Date().toISOString();
    const execution: SmartOrderExecution = {
      planId,
      status: "QUEUED",
      submitted: 0,
      filled: 0,
      canceled: 0,
      failed: 0,
      avgLatencyMs: 0,
      reasons: [],
      slices,
      createdAt: now,
      updatedAt: now,
    };
    this.executions.set(planId, execution);
    return execution;
  }

  updateSlice(planId: string, sliceId: string, status: SmartOrderStatus) {
    const current = this.executions.get(planId);
    if (!current) return null;
    const slices = current.slices.map((slice) => (slice.sliceId === sliceId ? { ...slice, status } : slice));
    const execution = {
      ...current,
      slices,
      status: this.resolveStatus(slices),
      submitted: slices.filter((slice) => ["SUBMITTED", "PARTIALLY_FILLED", "FILLED"].includes(slice.status)).length,
      filled: slices.filter((slice) => slice.status === "FILLED").length,
      canceled: slices.filter((slice) => slice.status === "CANCELED").length,
      failed: slices.filter((slice) => slice.status === "FAILED").length,
      updatedAt: new Date().toISOString(),
    };
    this.executions.set(planId, execution);
    return execution;
  }

  markStuck(maxAgeMs: number) {
    const stuck: SmartOrderExecution[] = [];
    for (const execution of this.executions.values()) {
      if (!["QUEUED", "SUBMITTED", "PARTIALLY_FILLED"].includes(execution.status)) continue;
      if (Date.now() - Date.parse(execution.updatedAt) < maxAgeMs) continue;
      const next = { ...execution, status: "STUCK" as const, reasons: [...execution.reasons, "Stuck order timeout exceeded"] };
      this.executions.set(execution.planId, next);
      stuck.push(next);
    }
    return stuck;
  }

  cancelAll(reason: string) {
    const canceled: SmartOrderExecution[] = [];
    for (const execution of this.executions.values()) {
      if (["FILLED", "CANCELED", "FAILED"].includes(execution.status)) continue;
      const next = {
        ...execution,
        status: "CANCELED" as const,
        canceled: execution.slices.length,
        slices: execution.slices.map((slice) => ({ ...slice, status: "CANCELED" as const })),
        reasons: [...execution.reasons, reason],
        updatedAt: new Date().toISOString(),
      };
      this.executions.set(execution.planId, next);
      canceled.push(next);
    }
    return canceled;
  }

  snapshot() {
    return Array.from(this.executions.values());
  }

  private resolveStatus(slices: SmartOrderSlice[]): SmartOrderStatus {
    if (slices.every((slice) => slice.status === "FILLED")) return "FILLED";
    if (slices.some((slice) => slice.status === "FAILED")) return "FAILED";
    if (slices.some((slice) => slice.status === "PARTIALLY_FILLED")) return "PARTIALLY_FILLED";
    if (slices.some((slice) => slice.status === "SUBMITTED")) return "SUBMITTED";
    if (slices.every((slice) => slice.status === "CANCELED")) return "CANCELED";
    return "QUEUED";
  }
}
