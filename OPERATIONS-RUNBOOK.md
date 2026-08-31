# OPERATIONS RUNBOOK

## Startup

1. `EXECUTION_MODE=dry-run` or `paper` (never live without ACK).
2. Postgres + Redis healthy.
3. MarketDataDaemon WS connected (`telemetry` UP).
4. Scanner worker + opportunity 1s tick.
5. Health: `GET /api/health`, `GET /api/opportunity/status`, `GET /api/microstructure/status`, `GET /api/shadow-outcome/status`.

## Shutdown

Pause scanner (`pauseScannerWorkerUntilResume`), allow exits, do not submit new entries, drain workers.

## Health checks

- WS: daemon telemetry `connected`, dataAge
- Redis: ping / shared lock
- DB: `SELECT 1`
- Risk: not paused, daily loss under cap

## WebSocket failure

New entries **disabled**. Positions may exit on last known safe path. After reconnect: wait `wsStabilizationMs` (default 8s) before entries.

## Redis failure

New entries **disabled** (duplicate-worker / split-brain). Local open positions keep exit logic if market data still local.

## DB failure

New entries **disabled** if intent/position cannot be persisted safely. Do not duplicate-submit.

## 429

Stop execution REST. Do not retry storm. Public WS continues. Operator-visible `RATE_LIMIT_429`.

## 418 / IP ban

No blind retry. Operator-visible `IP_BAN_418`. Manual recover.

## Kill switch

Daily loss / drawdown / BTC shock / stale / WS / Redis / DB → `NEW_ENTRIES_DISABLED`. Exits remain allowed.

## Position reconciliation

On restart restore paper snapshot (`equity`, `open`, `intents`, `dailyPnl`). Same `candidateId` cannot open twice.

## Live lock

Do not set `EXECUTION_MODE=live` without `LIVE_TRADING_ENABLED=true` and `LIVE_TRADING_ACK=I_UNDERSTAND_LIVE_FUNDS`. Phase 6 does **not** enable live.
