import type { PaperAccountState, PaperBalances, PaperClosedPosition, PaperFill } from "@/src/server/trading-core/paper/live-paper-types";

function normalizeAsset(asset: string) {
  return asset.trim().toUpperCase();
}

function safe(value: number) {
  return Number(value.toFixed(8));
}

export class PaperBalanceLedger {
  private balances: PaperBalances;
  private realizedPnl = 0;
  private updatedAt = new Date().toISOString();

  constructor(initialBalances: PaperBalances = { USDT: 2500, TRY: 100_000 }) {
    this.balances = Object.fromEntries(Object.entries(initialBalances).map(([asset, amount]) => [normalizeAsset(asset), safe(Number(amount) || 0)]));
  }

  reserveMargin(fill: PaperFill, quoteAsset = "USDT") {
    const quote = normalizeAsset(quoteAsset);
    const required = fill.margin + fill.fee;
    this.requireBalance(quote, required);
    this.balances[quote] = safe((this.balances[quote] ?? 0) - required);
    this.touch();
  }

  settleClose(closed: PaperClosedPosition, quoteAsset = "USDT") {
    const quote = normalizeAsset(quoteAsset);
    const credit = closed.margin + closed.realizedPnl - closed.closeFee;
    this.balances[quote] = safe((this.balances[quote] ?? 0) + credit);
    this.realizedPnl = safe(this.realizedPnl + closed.realizedPnl - closed.closeFee);
    this.touch();
  }

  reset(initialBalances: PaperBalances = { USDT: 2500, TRY: 100_000 }) {
    this.balances = Object.fromEntries(Object.entries(initialBalances).map(([asset, amount]) => [normalizeAsset(asset), safe(Number(amount) || 0)]));
    this.realizedPnl = 0;
    this.touch();
  }

  snapshot(unrealizedPnl = 0): PaperAccountState {
    const free = Object.values(this.balances).reduce((sum, amount) => sum + amount, 0);
    return {
      balances: { ...this.balances },
      equity: safe(free + unrealizedPnl),
      realizedPnl: this.realizedPnl,
      updatedAt: this.updatedAt,
    };
  }

  private requireBalance(asset: string, required: number) {
    const free = this.balances[asset] ?? 0;
    if (free + 1e-8 < required) {
      throw new Error(`Paper bakiye yetersiz: ${asset} (gerekli=${required.toFixed(8)}, mevcut=${free.toFixed(8)})`);
    }
  }

  private touch() {
    this.updatedAt = new Date().toISOString();
  }
}
