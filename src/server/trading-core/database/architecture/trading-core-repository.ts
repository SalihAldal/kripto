import { prisma } from "@/src/server/db/prisma";
import type { TradingCoreEvent } from "@/src/server/trading-core/database/architecture/database-types";
import { TradingCoreEventStore } from "@/src/server/trading-core/database/architecture/event-store";

export class TradingCoreRepository {
  private readonly events = new TradingCoreEventStore();

  async recordSignal(input: {
    signalKey: string;
    strategy: string;
    symbol: string;
    side: "BUY" | "SELL" | "HOLD";
    score: number;
    confidence: number;
    botId?: string;
    riskLevel?: string;
    marketRegime?: string;
    accepted?: boolean;
    reasons?: unknown[];
    features?: Record<string, unknown>;
  }) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO trading_core.signals (
        signal_key, bot_id, strategy, symbol, side, score, confidence,
        risk_level, market_regime, accepted, reasons, features
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)
      ON CONFLICT (signal_key) DO NOTHING
      `,
      input.signalKey,
      input.botId ?? null,
      input.strategy,
      input.symbol,
      input.side,
      input.score,
      input.confidence,
      input.riskLevel ?? null,
      input.marketRegime ?? null,
      input.accepted ?? false,
      JSON.stringify(input.reasons ?? []),
      JSON.stringify(input.features ?? {}),
    );
    await this.appendEvent({
      aggregateType: "signals",
      aggregateId: input.signalKey,
      eventType: "signal.recorded",
      payload: input,
    });
  }

  async recordRiskLog(input: {
    riskKey: string;
    symbol: string;
    side: string;
    score: number;
    level: string;
    allowed: boolean;
    adjustedNotional?: number;
    breakdown?: Record<string, unknown>;
    reasons?: unknown[];
  }) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO trading_core.risk_logs (
        risk_key, symbol, side, score, level, allowed, adjusted_notional, breakdown, reasons
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
      ON CONFLICT (risk_key) DO NOTHING
      `,
      input.riskKey,
      input.symbol,
      input.side,
      input.score,
      input.level,
      input.allowed,
      input.adjustedNotional ?? null,
      JSON.stringify(input.breakdown ?? {}),
      JSON.stringify(input.reasons ?? []),
    );
    await this.appendEvent({
      aggregateType: "risk_logs",
      aggregateId: input.riskKey,
      eventType: "risk.evaluated",
      payload: input,
    });
  }

  async recordMarketRegime(input: {
    regimeKey: string;
    symbol: string;
    regime: string;
    trendDirection: string;
    strategyMode: string;
    tradeAllowed: boolean;
    confidence: number;
    metrics?: Record<string, unknown>;
    detectedAt?: Date;
  }) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO trading_core.market_regimes (
        regime_key, symbol, regime, trend_direction, strategy_mode,
        trade_allowed, confidence, metrics, detected_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
      ON CONFLICT (regime_key) DO NOTHING
      `,
      input.regimeKey,
      input.symbol,
      input.regime,
      input.trendDirection,
      input.strategyMode,
      input.tradeAllowed,
      input.confidence,
      JSON.stringify(input.metrics ?? {}),
      input.detectedAt ?? new Date(),
    );
    await this.appendEvent({
      aggregateType: "market_regimes",
      aggregateId: input.regimeKey,
      eventType: "market_regime.detected",
      payload: input,
    });
  }

  async appendEvent(event: TradingCoreEvent) {
    await this.events.append(event);
  }
}
