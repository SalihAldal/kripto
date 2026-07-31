import { randomUUID } from "node:crypto";
import type { CopyTradeFollower, CopyTradeMaster } from "@/src/server/trading-core/copy-trading/copy-trading-types";

function now() {
  return new Date().toISOString();
}

export class CopyTradingRegistry {
  private readonly masters = new Map<string, CopyTradeMaster>();
  private readonly followers = new Map<string, CopyTradeFollower>();

  upsertMaster(input: { masterId?: string; userId: string; displayName: string; defaultRiskMultiplier?: number; status?: CopyTradeMaster["status"] }) {
    const masterId = input.masterId ?? `master-${input.userId}`;
    const current = this.masters.get(masterId);
    const row: CopyTradeMaster = {
      masterId,
      userId: input.userId,
      displayName: input.displayName,
      status: input.status ?? current?.status ?? "ACTIVE",
      defaultRiskMultiplier: input.defaultRiskMultiplier ?? current?.defaultRiskMultiplier ?? 1,
      createdAt: current?.createdAt ?? now(),
      updatedAt: now(),
    };
    this.masters.set(masterId, row);
    return row;
  }

  upsertFollower(input: {
    followerId?: string;
    userId: string;
    masterId: string;
    accountId?: string;
    allocationPercent?: number;
    riskMultiplier?: number;
    maxSlippageBps?: number;
    maxDelayMs?: number;
    maxLeverage?: number;
    partialCopyMinPercent?: number;
    copyReduceOnly?: boolean;
    status?: CopyTradeFollower["status"];
  }) {
    const followerId = input.followerId ?? randomUUID();
    const current = this.followers.get(followerId);
    const row: CopyTradeFollower = {
      followerId,
      userId: input.userId,
      masterId: input.masterId,
      accountId: input.accountId ?? current?.accountId,
      status: input.status ?? current?.status ?? "ACTIVE",
      allocationPercent: input.allocationPercent ?? current?.allocationPercent ?? 25,
      riskMultiplier: input.riskMultiplier ?? current?.riskMultiplier ?? 1,
      maxSlippageBps: input.maxSlippageBps ?? current?.maxSlippageBps ?? 25,
      maxDelayMs: input.maxDelayMs ?? current?.maxDelayMs ?? 2500,
      maxLeverage: input.maxLeverage ?? current?.maxLeverage ?? 5,
      partialCopyMinPercent: input.partialCopyMinPercent ?? current?.partialCopyMinPercent ?? 30,
      copyReduceOnly: input.copyReduceOnly ?? current?.copyReduceOnly ?? true,
      createdAt: current?.createdAt ?? now(),
      updatedAt: now(),
    };
    this.followers.set(followerId, row);
    return row;
  }

  master(masterId: string) {
    return this.masters.get(masterId) ?? null;
  }

  followersFor(masterId: string) {
    return Array.from(this.followers.values()).filter((row) => row.masterId === masterId && row.status === "ACTIVE");
  }

  snapshot() {
    return {
      masters: Array.from(this.masters.values()),
      followers: Array.from(this.followers.values()),
      updatedAt: now(),
    };
  }
}

const globalRegistry = globalThis as typeof globalThis & { __copyTradingRegistry?: CopyTradingRegistry };
export const copyTradingRegistry = globalRegistry.__copyTradingRegistry ?? new CopyTradingRegistry();
globalRegistry.__copyTradingRegistry = copyTradingRegistry;
