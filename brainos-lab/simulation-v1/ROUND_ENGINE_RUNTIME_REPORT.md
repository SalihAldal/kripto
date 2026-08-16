# Round Engine Runtime Report

## Summary

The Auto Round Engine selection pipeline was refactored into a **non-blocking state machine** with continuous heartbeat persistence, cooperative timeouts, pump fail-fast behavior, and scanner attach coordination.

## Verified Root Cause (Before)

- Single `tariyor` state hid multi-minute blocking inside `getPumpFastEntry` → `getBestFastEntry` → `runScannerPipeline`.
- Selection budget was checked only between attempts, not during long scanner/AI calls.
- Background scanner and round engine could block each other indefinitely via shared `runState.pending`.
- Pump `NO_TRADE` triggered redundant full scanner restart.

## Architecture (After)

### Fine-Grained Runtime Steps

Persisted in `job.metadata.runtime` and `run.metadata.runtime`:

`ROUND_CREATED` → `SCANNER_STARTING` → `PUMP_SCAN` → `PUMP_CONFIRMATION` → `AI_ANALYSIS` → `CANDIDATE_REJECTED` → `NEXT_CANDIDATE` → `FULL_SCAN` → `SCANNING` → `SYMBOL_SELECTED` → `EXECUTING` → …

Coarse DB states (`tariyor`, `coin_secildi`, …) remain for compatibility.

### Heartbeat

- Interval: `AUTO_ROUND_HEARTBEAT_INTERVAL_MS` (default 2000ms)
- Persists: `updatedAt`, `step`, `message`, `roundProgressPct`, candidate/pipeline fields, timeline entries
- UI reads `active.runtime` from `/api/trades/rounds/status`

### Non-Blocking / Cooperative Timeouts

- `RoundRuntimeController.checkBudget()` invoked throughout pump/scanner hooks
- Scanner attach max wait: `AUTO_ROUND_SCANNER_ATTACH_MAX_WAIT_MS` (default 15s)
- Round-attached scanner cycle cap: `AUTO_ROUND_SCANNER_MAX_CYCLE_SEC` (default 90s)

### Fail-Fast Pump Path

- Rejects move to next pump candidate without full rescan
- Full scanner only after pump lanes exhausted (`skipInitialPumpPass: true`)

### Cancellation

- `registerRoundCancellation` / `cancelRoundSelection` on stop/budget/job shutdown

## Before vs After

| Metric | Before | After |
|--------|--------|-------|
| Max blocking duration (selection) | Up to 300s+ single call | Capped 90s scan + 15s attach wait |
| Heartbeat frequency | None during selection | ~2s |
| Selection budget enforcement | Between attempts only | Continuous via hooks |
| Pump NO_TRADE → full rescan | Yes (duplicate pump + full scan) | No (next candidate / deferred full scan) |
| Scanner coordination | Indefinite `pending` await | Attach with timeout + stale reuse |
| Runtime visibility | Frozen `tariyor` | Granular step + progress % |

## Modified Files

- `src/server/execution/round-runtime.types.ts` (new)
- `src/server/execution/round-runtime.service.ts` (new)
- `src/server/execution/round-selection.service.ts` (new)
- `src/server/execution/auto-round-engine.service.ts`
- `src/server/scanner/scanner.service.ts`
- `src/server/scanner/fast-entry.service.ts`
- `src/types/platform.ts`
- `src/features/dashboard/components/auto-round-control-panel.tsx`
- `lib/config.ts`
- `tests/round-runtime.test.ts` (new)
- `tests/round-runtime-types.test.ts` (new)
- `tests/auto-round-engine.integration.test.ts`
- `scripts/round-engine-runtime-validation.ts` (new)

## Validation

```bash
npx vitest run tests/round-runtime.test.ts tests/round-runtime-types.test.ts tests/auto-round-engine.integration.test.ts
npx tsx scripts/round-engine-runtime-validation.ts
```

## Rollback Plan

1. Revert commits touching files above.
2. Remove env keys: `AUTO_ROUND_HEARTBEAT_INTERVAL_MS`, `AUTO_ROUND_SCANNER_ATTACH_MAX_WAIT_MS`, `AUTO_ROUND_SCANNER_MAX_CYCLE_SEC`.
3. Restart app/worker processes.

## Remaining Risks

- Full scanner path still bounded by `AUTO_ROUND_SCANNER_MAX_CYCLE_SEC`; very large watchlists may need tuning without reducing coverage.
- Heartbeat DB writes increase update frequency during active selection (acceptable for observability).
