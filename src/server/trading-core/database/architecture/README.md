# Trading Core Database Architecture

This module adds a safe, isolated PostgreSQL + Redis architecture for high-frequency crypto trading workflows.

## PostgreSQL

All new tables live under the `trading_core` schema to avoid breaking existing Prisma models:

- `trading_core.trades`
- `trading_core.positions`
- `trading_core.signals`
- `trading_core.bot_stats`
- `trading_core.risk_logs`
- `trading_core.ai_predictions`
- `trading_core.market_regimes`
- `trading_core.events`

## Event Sourcing

`trading_core.events` is the append-only source of truth for high-frequency domain events. Write-heavy modules can append events first, then project into read tables asynchronously.

## High-Frequency Writes

Use `HighFrequencyWriteBuffer` for bursty writes. It batches writes into the event store, avoiding per-tick projection pressure.

## Redis

`TradingCoreCache` provides Redis-backed caching with memory fallback.

`TradingCorePubSub` provides Redis pub/sub channels for websocket scaling:

- `trading-core:market.ticks`
- `trading-core:signals`
- `trading-core:positions`
- `trading-core:risk`
- `trading-core:orders`

## Migration

Run with the existing Prisma flow:

```bash
npm run prisma:migrate:deploy
```
