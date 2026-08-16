# Scheduler Integrity Sprint — Phase 5 Report

> **Date:** 06.08.2026  
> **Scope:** Recovery, Watchdog & Self-Healing (repository / execution layer only)  
> **Prerequisite:** Phase 1–3 scheduler integrity + Phase 4 runtime isolation  
> **Out of scope:** Trading strategy, AI logic, scanner quality, symbol universe

---

## Executive Summary

Phase 5 completes production-grade resilience by introducing a **centralized Recovery Manager** and **exclusive Scheduler Watchdog**, wired as the sole recovery authority for auto-round jobs.

```
One Job
  ↓
One Scheduler          (Phase 1)
  ↓
One Watchdog           (Phase 5 — new)
  ↓
One Recovery Manager   (Phase 5 — new)
  ↓
One Active Round       (Phase 2 + 3)
  ↓
One Owner
  ↓
One Runtime            (Phase 4)
  ↓
Consistent Recovery    (Phase 5 audit trail)
```

**Validation:** 26/26 tests passed across Phases 1–5 suites, including fault injection (25 concurrent recovery requests → ≤1 spawn, 50 concurrent watchdog starts → 1 watchdog).

---

## Recovery Manager Report

### New module: `scheduler-recovery.service.ts`

| Export | Role |
|--------|------|
| `configureSchedulerRecovery(deps)` | Inject spawn/reconcile/registry/stop dependencies (wired from engine) |
| `evaluateJobHealth(jobId)` | Detect scheduler, runtime, heartbeat, registry, DB issues |
| `decideRecoveryPolicy(...)` | Deterministic action selection with escalation |
| `executeSchedulerRecovery(...)` | **Single recovery authority** — serialized per job |
| `executeSchedulerRecoveryForRunningJobs(...)` | Batch recovery on startup / dashboard poll |
| `getProductionHealthSnapshot(userId?)` | Production health dashboard data |
| `getRecoveryTimeline(jobId)` | Audit trail reader |
| `performSelfHealingCheck(jobId)` | Evaluate + recover in one call |

### Recovery policy actions

| Action | When |
|--------|------|
| `RESUME` | Scheduler crash / stale lease — respawn loop, reuse repository evidence |
| `RETRY` | Transient DB/network or first runtime stall |
| `RESTART_CURRENT_STAGE` | Repeated scanner/AI/discovery stall (escalation ≥ 2) |
| `RECONCILE` | Registry integrity or overdue waiting runs |
| `FAIL_CURRENT_ROUND` | Escalation ≥ 4 on runtime failures |
| `STOP_JOB` | Escalation level 5 — recovery limit exceeded |
| `NO_ACTION` | Healthy, peer lease, or already running locally |

Every decision includes a **persisted reason** via audit repository.

### Safe resume

Recovery never recreates completed work:

- `recoverRoundRegistryFromRuns()` rebuilds in-memory ownership from DB runs
- `reconcileStaleWaitingRunsForJob()` handles overdue sell-wait only
- `transactionallyBeginRound()` attach path (Phase 3) reused on scheduler respawn
- Runtime progress preserved in `run.metadata.runtime` — job receives pointer only

### Recovery limits

Stored in `AutoRoundJob.metadata.recoveryState`:

| Field | Purpose |
|-------|---------|
| `recoveryCount` | Attempts in rolling 1h window |
| `recoverySuccess` / `recoveryFailure` | Outcome counters |
| `escalationLevel` | 0–5 computed from window |
| `lastCause` / `lastDurationMs` | Last event metadata |

Max **12 recoveries per hour** → escalation level 5 → `STOP_JOB`.

---

## Watchdog Report

### New module: `scheduler-watchdog.service.ts`

| Export | Role |
|--------|------|
| `atomicStartSchedulerWatchdog(jobId, intervalMs?)` | Exclusive watchdog per job (serialized queue) |
| `stopSchedulerWatchdog(jobId)` | Stop on job stop/finalize |
| `getWatchdogRegistrySnapshot()` | Health dashboard + tests |

### Ownership invariant

```
One Scheduler Loop  →  One Watchdog  →  One Recovery Manager tick chain
```

- Default interval: **15s**
- Each tick calls `executeSchedulerRecovery({ trigger: "watchdog" })`
- Concurrent start requests: **1 started**, remainder **attached** (stress tested at 50)

### Engine wiring

| Event | Watchdog |
|-------|----------|
| `startAutoRoundJob` | `atomicStartSchedulerWatchdog(jobId)` |
| `stopAutoRoundJob` | `stopSchedulerWatchdog(jobId)` |
| `finalizeStoppedAutoRoundJob` | `stopSchedulerWatchdog(jobId)` |

---

## Self-Healing Report

### Continuous verification (`evaluateJobHealth`)

| Component | Detects |
|-----------|---------|
| Scheduler | Crash, stale lease, missing loop |
| Runtime | Missing/stale heartbeat on active run |
| Heartbeat | Monotonic stall vs `AUTO_ROUND_WATCHDOG_STALE_MS` |
| Scanner / AI | Stage-specific stall hints from runtime step |
| Registry | Duplicate active rounds, orphan `activeRunId` |
| Database | `SELECT 1` connectivity ping |
| Lease | Peer ownership (`LEASE_HELD_BY_PEER` — no cross-process takeover) |

### Self-healing flow

1. Watchdog tick or manual/startup trigger
2. `evaluateJobHealth` → issues list
3. `decideRecoveryPolicy` → deterministic action
4. `applyRecoveryAction` → spawn / reconcile / stop
5. `appendRecoveryAuditEvent` → persisted trail

Fail safely only when escalation reaches `STOP_JOB` or peer holds lease.

---

## Recovery Timeline / Audit Trail

### Repository: `scheduler-recovery-audit.repository.ts`

Persisted in `AutoRoundJob.metadata`:

| Key | Content |
|-----|---------|
| `recoveryAudit` | Up to 100 events (newest first) |
| `recoveryState` | Rolling counters + escalation |

### Event schema

| Field | Description |
|-------|-------------|
| `timestamp` | ISO time |
| `component` | scheduler, runtime, registry, etc. |
| `failure` | Failure kind |
| `decision` | Full policy decision object |
| `action` | Executed action |
| `result` | success / failure / skipped / partial |
| `durationMs` | Recovery duration |
| `operator` | automatic / manual |
| `trigger` | watchdog / manual / startup / fault_injection |

### API exposure

| Route | Method | Returns |
|-------|--------|---------|
| `/api/trades/rounds/recovery` | GET | `health`, `recovery`, `timeline` |
| `/api/trades/rounds/recovery` | POST | Manual recovery trigger |

---

## Fault Injection Results

### `tests/scheduler-recovery.test.ts`

| Scenario | Expected | Result |
|----------|----------|--------|
| Crashed scheduler detection | RESUME policy | ✅ Pass |
| 25 concurrent `executeSchedulerRecovery` | ≤1 spawn, all audited | ✅ Pass |
| 50 concurrent watchdog starts | 1 started, 49 attached | ✅ Pass |
| Escalation at limit 12 | STOP_JOB | ✅ Pass |
| Audit trail persistence | decision + duration + operator | ✅ Pass |

### Regression suite

```
npx vitest run \
  tests/scheduler-recovery.test.ts \
  tests/scheduler-ownership.test.ts \
  tests/round-registry.test.ts \
  tests/auto-round-integrity.test.ts \
  tests/auto-round-engine.integration.test.ts

→ 26/26 passed
```

### Simulated failure coverage

| Failure | Recovery path |
|---------|---------------|
| Scheduler crash | RESUME + spawn |
| Worker crash | RESUME (same path) |
| Runtime stall | RETRY → RESTART_CURRENT_STAGE → FAIL_CURRENT_ROUND |
| Heartbeat loss | RETRY with monotonic merge (Phase 3) |
| Scanner / AI timeout | Stage restart via cancel + respawn |
| Database disconnect | RETRY after ping failure |
| Concurrent recovery | Serialized `recoveryQueues` per job |
| Recovery loop | Escalation → STOP_JOB |

---

## Health Dashboard Report

### Production health snapshot

`getProductionHealthSnapshot()` returns scores 0–100:

| Metric | Source |
|--------|--------|
| Overall Health Score | Weighted aggregate |
| Scheduler Health | Local loop / live lease |
| Runtime Health | Active run issues |
| Recovery Health | Escalation inverse |
| Watchdog Health | Active watchdog count |
| Scanner / AI Health | Stage issue components |
| Database Health | Connectivity ping |
| Ownership / Registry / Heartbeat / Lease | Component issue scores |

### UI: `SchedulerHealthPanel`

- Dashboard component polling `/api/trades/rounds/recovery`
- Shows overall score, component grid, watchdog status, running job issues
- Manual **Run Recovery** button (POST)

### Status API enrichment

`getAutoRoundStatus` now includes `health` snapshot alongside existing `scheduler` block.

---

## Production Readiness Report

| Criterion | Status |
|-----------|--------|
| One job → one scheduler | ✅ Phase 1 |
| One scheduler → one watchdog | ✅ Phase 5 atomic start |
| One watchdog → one recovery manager | ✅ Tick → executeSchedulerRecovery |
| One active round / owner / runtime | ✅ Phases 2–4 |
| Deterministic recovery | ✅ decideRecoveryPolicy |
| Observable | ✅ Audit trail + API + dashboard |
| Auditable | ✅ Persisted events with reason |
| No duplicate spawn on recovery | ✅ Stress tested |
| Safe resume | ✅ Registry + idempotent attach |
| Escalation on infinite loops | ✅ 12/hour limit |
| Repository only | ✅ No strategy/AI/scanner changes |

### Operational notes

- `ensureAutoRoundRecovery()` now **actively recovers** (no longer read-only with `recoveredLoops: 0`)
- Dashboard overview recovery poll triggers self-healing on each load
- Peer process lease: recovery returns `NO_ACTION` — by design for multi-instance safety

---

## Modified Files

| File | Change |
|------|--------|
| `src/server/execution/scheduler-recovery.types.ts` | **New** — recovery types |
| `src/server/execution/scheduler-recovery.service.ts` | **New** — Recovery Manager |
| `src/server/execution/scheduler-watchdog.service.ts` | **New** — exclusive watchdog |
| `src/server/repositories/scheduler-recovery-audit.repository.ts` | **New** — audit + limits |
| `src/server/execution/scheduler-ownership.service.ts` | Export lease/loop helpers |
| `src/server/execution/auto-round-engine.service.ts` | Wire recovery + watchdog |
| `services/trading-engine.service.ts` | Facade exports |
| `app/api/trades/rounds/recovery/route.ts` | **New** — health/recovery API |
| `src/features/dashboard/components/scheduler-health-panel.tsx` | **New** — dashboard panel |
| `src/types/platform.ts` | Health + scheduler status types |
| `app/(platform)/dashboard/page.tsx` | Mount health panel |
| `tests/scheduler-recovery.test.ts` | **New** — fault injection |
| `tests/auto-round-engine.integration.test.ts` | Recovery/watchdog mocks |

---

## Rollback Plan

### 1. Revert application code

```bash
git checkout HEAD~1 -- \
  src/server/execution/scheduler-recovery.types.ts \
  src/server/execution/scheduler-recovery.service.ts \
  src/server/execution/scheduler-watchdog.service.ts \
  src/server/repositories/scheduler-recovery-audit.repository.ts \
  src/server/execution/scheduler-ownership.service.ts \
  src/server/execution/auto-round-engine.service.ts \
  services/trading-engine.service.ts \
  app/api/trades/rounds/recovery/route.ts \
  src/features/dashboard/components/scheduler-health-panel.tsx \
  src/types/platform.ts \
  "app/(platform)/dashboard/page.tsx" \
  tests/scheduler-recovery.test.ts \
  tests/auto-round-engine.integration.test.ts
```

### 2. Restore read-only recovery behaviour

`ensureAutoRoundRecovery` reverts to reconcile-only without spawn — recoverable failures will again require explicit `POST /api/trades/rounds/start`.

### 3. Metadata cleanup (optional)

Recovery audit data lives in job metadata — no migration required. To clear:

```sql
UPDATE "AutoRoundJob"
SET metadata = metadata - 'recoveryAudit' - 'recoveryState'
WHERE metadata ? 'recoveryAudit' OR metadata ? 'recoveryState';
```

### 4. Verify

Run Phases 1–3 tests — core integrity remains; self-healing loop removed.

---

## Success Criteria — Verified

The platform satisfies:

```
One Job → One Scheduler → One Watchdog → One Recovery Manager
  → One Active Round → One Owner → One Runtime → Consistent Recovery
```

Recoverable failures no longer require manual intervention under single-process deployment. Recovery is **deterministic**, **observable**, **auditable**, and **production-safe** with escalation guardrails.

**Full sprint complete:** Phases 1–5 implemented, validated, and documented.
