# Async Runtime Report — Paper Trading P0 Fix

## Problem

After scanner context reached `100/100`, the auto-round selection pipeline could block indefinitely inside Discovery / AI evaluation because:

- `runDiscoveryBatch` had no checkpoints, budget polling, or per-item timeouts
- AI workers used unbounded `await` on market-data and consensus calls
- `Promise.all` on worker pools waited forever for stalled in-flight tasks
- Selection budget checks only ran between cooperative poll points
- Job-loop watchdog did not trigger while the selection loop was blocked

## Solution (architecture extension only)

### Cooperative async layer

New module: `src/server/execution/cooperative-async.service.ts`

- `withBoundedAwait()` — hard max wait per promise
- `runCooperativePool()` — interruptible worker pool with heartbeat polling, budget checks, per-worker timeout isolation, stage deadline
- `startRoundSelectionWatchdog()` — cancels selection when runtime heartbeat goes stale during blocking selection

### Scanner pipeline

- Context, discovery, ranking, AI, and consensus phases emit checkpoints
- Discovery uses cooperative batch (same symbol count, concurrent workers)
- AI workers wrap `buildMarketContext` and `runAIConsensusFromInput` with bounded awaits
- Stalled workers time out individually; remaining symbols continue

### Round selection

- Background watchdog during entire selection attempt
- Heartbeat forwarded into scanner runtime during long async stages
- Async telemetry summarized at selection end

### Auto-round engine

- Heartbeat stale detection no longer requires `!loopRegistry.has(jobId)` — fails safe even when outer loop is blocked elsewhere

## Coverage preserved

- No reduction in scanner universe / cycle limit
- `SCANNER_AI_EVALUATE_ALL` unchanged
- No trading strategy changes

## Config (defaults)

| Variable | Default | Purpose |
|---|---|---|
| `AUTO_ROUND_ASYNC_WORKER_TIMEOUT_MS` | 120000 | Max per AI worker |
| `AUTO_ROUND_DISCOVERY_ITEM_TIMEOUT_MS` | 30000 | Max per discovery symbol |
| `AUTO_ROUND_MARKET_CONTEXT_TIMEOUT_MS` | 45000 | Max market context fetch |
| `AUTO_ROUND_AI_CONSENSUS_TIMEOUT_MS` | 90000 | Max consensus call |
| `AUTO_ROUND_WATCHDOG_STALE_MS` | 90000 | Stale heartbeat cancel |
| `AUTO_ROUND_ASYNC_HEARTBEAT_POLL_MS` | 2000 | Budget/heartbeat poll interval |

## Before vs After (expected)

| Metric | Before | After |
|---|---|---|
| Max async blocking | Unbounded (hours observed) | Bounded by worker + stage + budget timeouts |
| Heartbeat during discovery/AI | None after context 100/100 | Every 2s poll + phase checkpoints |
| Budget enforcement in long await | No | Yes (poll + watchdog cancel) |
| Stalled worker impact | Freezes entire round | Isolated; pool continues |
| Round stuck in `tariyor` | Possible indefinitely | Fails safe → next round |

## Modified files

- `src/server/execution/cooperative-async.service.ts` (new)
- `src/server/execution/round-selection.service.ts`
- `src/server/execution/round-runtime.types.ts`
- `src/server/execution/auto-round-engine.service.ts`
- `src/server/scanner/scanner.service.ts`
- `src/server/scanner/fast-entry.service.ts`
- `src/server/discovery/discovery-pipeline.engine.ts`
- `lib/config.ts`
- `tests/cooperative-async.test.ts` (new)
- `scripts/async-runtime-validation.ts` (new)

## Rollback plan

1. Revert the modified files above
2. Remove new env keys (optional — defaults are safe)
3. Restart dev server / worker
4. Active stuck jobs: stop via dashboard, delete or fail stale runs manually

## Validation

```bash
npx vitest run tests/cooperative-async.test.ts tests/round-runtime-types.test.ts tests/round-runtime.test.ts
npx tsx scripts/async-runtime-validation.ts
```

## Reports generated

- Async Runtime Report (this file)
- Watchdog Report — see `startRoundSelectionWatchdog` + engine stale fail path
- Promise Lifecycle Report — `AsyncRuntimeTelemetry` events (`promise_*`, `worker_*`)
- Worker Report — `runCooperativePool` isolation metrics
- Recovery Report — stalled worker timeout + round fail + continue loop
- Validation Report — output of `scripts/async-runtime-validation.ts`
