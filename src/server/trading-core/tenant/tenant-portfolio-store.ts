import type { ManagedPosition } from "@/src/server/trading-core/executors/position-types";
import type { TenantPortfolioSnapshot } from "@/src/server/trading-core/tenant/tenant-types";

function emptyPortfolio(userId: string): TenantPortfolioSnapshot {
  return {
    userId,
    balances: { USDT: 0 },
    positions: [],
    realizedPnl: 0,
    unrealizedPnl: 0,
    updatedAt: new Date().toISOString(),
  };
}

export class TenantPortfolioStore {
  private readonly portfolios = new Map<string, TenantPortfolioSnapshot>();

  ensure(userId: string) {
    const current = this.portfolios.get(userId);
    if (current) return current;
    const portfolio = emptyPortfolio(userId);
    this.portfolios.set(userId, portfolio);
    return portfolio;
  }

  updateBalances(userId: string, balances: Record<string, number>) {
    const current = this.ensure(userId);
    const next = { ...current, balances: { ...current.balances, ...balances }, updatedAt: new Date().toISOString() };
    this.portfolios.set(userId, next);
    return next;
  }

  syncPositions(userId: string, positions: ManagedPosition[]) {
    const current = this.ensure(userId);
    const ownPositions = positions.filter((position) => String(position.metadata?.userId ?? userId) === userId);
    const unrealizedPnl = ownPositions.reduce((sum, position) => sum + position.unrealizedPnl, 0);
    const realizedPnl = ownPositions.reduce((sum, position) => sum + position.realizedPnl, current.realizedPnl);
    const next = {
      ...current,
      positions: ownPositions,
      unrealizedPnl: Number(unrealizedPnl.toFixed(8)),
      realizedPnl: Number(realizedPnl.toFixed(8)),
      updatedAt: new Date().toISOString(),
    };
    this.portfolios.set(userId, next);
    return next;
  }

  snapshot(userId: string) {
    return this.ensure(userId);
  }

  all() {
    return Array.from(this.portfolios.values());
  }
}

const globalPortfolios = globalThis as typeof globalThis & { __tenantPortfolioStore?: TenantPortfolioStore };
export const tenantPortfolios = globalPortfolios.__tenantPortfolioStore ?? new TenantPortfolioStore();
globalPortfolios.__tenantPortfolioStore = tenantPortfolios;
