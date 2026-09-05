# KRIPTO P5 Paper Launch Runbook (Do Not Execute In This Prompt)

## Preconditions
1. `ENGINEERING_GATE=PASS`
2. `SAFETY_GATE=PASS`
3. `PAPER_PREFLIGHT=GO`
4. Launch mode only `PAPER`
5. `LIVE_TRADING_ENABLED=false` and `liveSubmitCount` hard lock = `0`

## Required Environment Variable Names
- `DATABASE_URL`
- `EXECUTION_MODE`
- `EXCHANGE_MODE`
- `LIVE_TRADING_ENABLED`
- `BINANCE_PLATFORM`
- `BINANCE_TR_API_KEY` (optional for paper infra checks, value loglanmaz)
- `BINANCE_TR_SECRET_KEY` (optional for paper infra checks, value loglanmaz)

## Immutable Campaign Inputs
- `campaignId`: `cmp:p5:<timestamp>`
- `durationHours`: `6`
- `maxWaitSec`: `21600`
- `totalRounds`: `1`
- `coinSelectionMode`: `scanner_best`
- `aiMode`: `learning`
- `mode`: `auto`

## Exact Launch Command (Step-6, DO NOT RUN NOW)
```bash
node -r ./scripts/load-dotenv.cjs ./node_modules/tsx/dist/cli.mjs scripts/p5-paper-launch.ts "cmp:p5:$([int][double]::Parse((Get-Date -UFormat %s)))" 6
```

## Expected Runtime Safety Assertions
- Preflight `overallVerdict` must be non-blocking.
- Duplicate running job must be blocked.
- Restart must reconcile stale/zombie rounds.
- Kill switch, exposure caps, loss cap, stale-data fail-closed must remain active.
- Strategy router remains shadow-only; production canonical decision unchanged.

## Post-Run Collection (After 6h, Not In This Prompt)
- Campaign forensics export
- Fill/position/settlement telemetry
- Dataset quality and attribution refresh
- Updated evidence gate evaluation
