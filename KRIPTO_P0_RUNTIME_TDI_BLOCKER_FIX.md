# KRIPTO P0/P1 - Runtime Timeout + TDI Zero-Approval Blocker Fix

## 1) Runtime timeout root cause
- Root cause class: MULTIPLE_WRITERS + TRANSACTION_CONTENTION + CONNECTION_POOL.
- Baseline session: `cmsxrlu1v0009unrkcmzvymcn` showed patch timeout incidents and queue pressure under overlapping writers.
- Primary fix: serialized/coalesced runtime persists, bounded retry, heartbeat timeout downgraded to non-fatal degraded telemetry path.

## 2) DB/transaction evidence
- Post-fix session: `cmsxuaect0009unioi4gvkxcb`
- patchJobActiveRound sample count: 99
- patchJobActiveRound p50/p95/p99 (ms): 21/986/14742
- patchJobActiveRound timeoutCount: 2

## 3) patchJobActiveRound call analysis
- Runtime heartbeat and transition writes previously overlapped on same hot rows (job/run metadata).
- Persist path now enforces queued single-writer behavior in controller scope, reducing write storm contention.

## 4) Multi-writer safety
- Scheduler/runtime/watchdog coexistence is improved by preventing concurrent runtime persist overlap and by safe abort semantics.
- Persistence timeout no longer hard-crashes selection flow at heartbeat boundary.

## 5) Runtime persistence fix
- Added queue-backed persist serialization in round runtime controller.
- Added transient retry wrapper for bounded prisma persistence operations.
- Converted transition timeout to `PERSIST_TIMEOUT` abort code.
- Reduced heartbeat write amplification (coarse structured-log only, slim timeline persistence in non-coarse updates).

## 6) TDI WAIT distribution
- WAIT reason distribution: `{"NEUTRAL":12,"BELOW_THRESHOLD":1}`
- firstBlockingCondition distribution: `{"TECHNICAL":6,"MOMENTUM":6,"CONFIDENCE":1}`

## 7) First blocking condition
- First blocker is now explicitly persisted per WAIT decision (`firstBlockingCondition`) and aggregated in sensitivity artifacts.

## 8) Zero-BUY root cause
- No blind threshold relaxation was applied.
- Evidence indicates strict policy path remains the dominant limiter; observability defects were fixed (REJECTED counting + first blocker trace).

## 9) TDI correctness fixes
- Added `firstBlockingCondition` and `blockingConditions` to TDI decision records.
- Added `firstBlockingDistribution` to TDI sensitivity report.
- Fixed trade evidence script bug: `REJECT` -> `REJECTED` aggregation.

## 10) Regression tests
- Runtime tests pass: heartbeat timeout degrade, transition persist-timeout abort, concurrent persist serialization.
- TDI tests pass: sensitivity reconciliation + first-blocker distribution.

## 11) Controlled 2-round validation
- Job status: COMPLETED (completed=0, failed=2)
- Funnel: scannerCandidates=172, tdiApproved=0, tdiWait=13, executionReady=0, aiCalls=544, orders=0, trades=0

## 12) Remaining blockers
- Selection budget exhaustion can still occur without execution-ready candidate in conservative market states.
- Continue monitoring runtime p99 under scanner+AI heavy rounds before long campaigns.

## Final Verdict
- RUNTIME_STABILITY = FAIL
- TDI_APPROVAL_HEALTH = PARTIAL
- AI_PARITY = PASS
- READY_FOR_5_ROUND = NO
- READY_FOR_30_50_ROUND = NO
