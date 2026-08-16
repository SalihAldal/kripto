# Scheduler Integrity Sprint — Phase 1 Report

> **Date:** 06.08.2026  
> **Scope:** Atomic scheduler ownership & spawn refactor only  
> **Out of scope:** Trading strategy, AI, scanner quality, execution logic

---

## Executive Summary

Phase 1 eliminates the verified **check-then-set scheduler spawn race** identified in the Scheduler & Concurrency Audit. The non-atomic `spawnJobLoop()` pattern has been replaced with **`atomicSpawnScheduler()`**, backed by:

- **Scheduler ownership states** (`NOT_RUNNING` → `STARTING` → `RUNNING` → `STOPPING` → `STOPPED` / `FAILED`)
- **Per-process lease** with DB persistence (`job.metadata.schedulerLease`)
- **Serialized spawn queue** per job (no concurrent spawn paths)
- **Read-only status/recovery** (no scheduler creation on GET routes)
- **Duplicate in-progress run consolidation** in the round loop

**Stress validation:** 1, 10, 25, 50, and 100 simultaneous spawn requests → **always exactly 1 spawned loop**, remainder attach.

---

## Scheduler Ownership Report

### Ownership states

| State | Meaning |
|-------|---------|
| `NOT_RUNNING` | No active lease / loop |
| `STARTING` | Lease acquired, loop booting |
| `RUNNING` | Loop owns job, heartbeat renewing |
| `STOPPING` | Stop requested, abort signalled |
| `STOPPED` | Loop exited cleanly |
| `FAILED` | Loop crashed |

### Lease structure

Stored in `AutoRoundJob.metadata.schedulerLease`:

| Field | Purpose |
|-------|---------|
| `jobId` | Job identifier |
| `ownerId` | Process owner (`hostname:pid:uuid`) |
| `createdAt` | Lease creation ISO timestamp |
| `lastHeartbeatAt` | Last scheduler heartbeat |
| `version` | Optimistic concurrency version |
| `generation` | Monotonic generation; stale loops must exit |
| `state` | Ownership state |

### Process owner ID

Generated once per process in `scheduler-ownership.service.ts`:

```typescript
const PROCESS_OWNER_ID = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
```

### Invariant enforcement

```
One Job
  ↓
One Scheduler Loop (loopRegistry)
  ↓
One Lease Owner (ownerRegistry + DB CAS)
  ↓
One Active Round (consolidated in-progress guard)
  ↓
One Selection Pipeline (single loop iteration)
```

---

## Atomic Spawn Report

### Before (defect)

```typescript
function spawnJobLoop(jobId: string) {
  if (loopRegistry.has(jobId)) return;  // TOCTOU race
  const runner = runRoundJob(jobId).finally(() => loopRegistry.delete(jobId));
  loopRegistry.set(jobId, runner);
}
```

### After (atomic)

```typescript
export async function atomicSpawnScheduler(jobId, startLoop, persistence) {
  // Serialized via spawnQueues[jobId] chain
  // Serialized via withTransitionLock(jobId)
  // Returns spawned | attached | rejected
}
```

### Spawn result actions

| Action | Meaning |
|--------|---------|
| `spawned` | This request created the sole loop |
| `attached` | Loop already exists; idempotent attach |
| `rejected` | Another live lease holder (cross-process stale window) |

### Idempotent start

`startAutoRoundJob()` always calls `ensureSingleSchedulerLoop(jobId)`:

- New job → spawns once, returns `scheduler.spawned: true`
- Existing RUNNING job → attaches, returns `scheduler.attached: true`
- Repeated calls → same `ownerId` + `generation`

---

## Lease Report

### DB persistence

New repository helpers in `auto-round.repository.ts`:

- `readSchedulerLeaseFromMetadata()`
- `loadSchedulerLease(jobId)`
- `compareAndSetSchedulerLease({ jobId, lease, expectedVersion })`

Uses Prisma `$transaction` with **version CAS** — no update unless `expectedVersion` matches.

### Stale lease takeover

If another owner's lease heartbeat is older than **45s** and state is `RUNNING`/`STARTING`, a new owner may acquire with `generation + 1`. Older loops detect generation mismatch via `assertSchedulerLoopOwnership()`.

### Heartbeat renewal

`runRoundJob()` calls `touchSchedulerLease()` each iteration, persisting to DB when configured.

---

## Lifecycle Report

### Protected transitions

All transitions run inside `withTransitionLock(jobId)`:

| Transition | Trigger |
|------------|---------|
| → `STARTING` | Atomic spawn acquire |
| → `RUNNING` | Loop begins `startLoop()` |
| → `STOPPING` | `markSchedulerStopping()` / stop request |
| → `STOPPED` | Normal loop exit |
| → `FAILED` | Uncaught loop error |

### Read paths (no spawn)

| Endpoint | Before | After |
|----------|--------|-------|
| `GET /api/trades/rounds/status` | `spawnJobLoop()` | **Read-only** + registry snapshot |
| `GET /api/dashboard/overview` → `ensureTradeRoundRecovery()` | Spawn all RUNNING jobs | **Reconcile stale waits only** |
| `ensureAutoRoundRecovery()` | Spawn loops | Returns `needsExplicitStart: true` |

### Write paths (spawn allowed)

| Endpoint | Behavior |
|----------|----------|
| `POST /api/trades/rounds/start` | `atomicSpawnScheduler()` via `startAutoRoundJob()` |
| Existing RUNNING job + start | Idempotent attach |

### Duplicate round guard

When multiple in-progress runs exist (legacy data), all but the newest are failed:

```typescript
const inProgressRuns = sortInProgressRuns(job.rounds ?? []);
if (inProgressRuns.length > 1) {
  for (const duplicate of inProgressRuns.slice(1)) {
    await failRound({ reason: "Duplicate in-progress run consolidated by scheduler ownership guard" });
  }
}
```

---

## Concurrency Validation

| Check | Result |
|-------|--------|
| Non-atomic `if (!exists) spawn` | **Removed** |
| Multiple loops same job (in-process) | **Prevented** by spawn queue + transition lock |
| Status poll creates loop | **Removed** |
| Dashboard recovery creates loop | **Removed** |
| Idempotent start | **Verified** in tests |
| DB lease CAS | **Implemented** |
| Shared job.runtime overwrite from parallel loops | **Reduced** (single loop guarantee) |

---

## Stress Test Results

Command:

```bash
npx vitest run tests/scheduler-ownership.test.ts tests/auto-round-engine.integration.test.ts
```

| Concurrent requests | Spawned | Attached | Loop registry max | loopStarts |
|--------------------:|--------:|---------:|--------------------:|-----------:|
| 1 | 1 | 0 | ≤1 | 1 |
| 10 | 1 | 9 | ≤1 | 1 |
| 25 | 1 | 24 | ≤1 | 1 |
| 50 | 1 | 49 | ≤1 | 1 |
| 100 | 1 | 99 | ≤1 | 1 |

**Integration test:** 10-round job completes with exactly **10 runs**; second start rejected; status polling does not duplicate loops.

**Result:** ✅ All 8 tests passed.

---

## Modified Files

| File | Change |
|------|--------|
| `src/server/execution/scheduler-ownership.types.ts` | **New** — lease/state types |
| `src/server/execution/scheduler-ownership.service.ts` | **New** — atomic spawn, lease, registries |
| `src/server/repositories/auto-round.repository.ts` | DB lease load/CAS helpers |
| `src/server/execution/auto-round-engine.service.ts` | Replace spawn; read-only status/recovery; round guard |
| `services/trading-engine.service.ts` | Export scheduler registry helper |
| `tests/scheduler-ownership.test.ts` | **New** — stress tests 1–100 |
| `tests/auto-round-engine.integration.test.ts` | Lease mocks + ownership reset |

**Not modified:** Scanner, AI, filters, execution orchestrator, strategy config.

---

## Rollback Plan

1. Revert commits touching files listed above.
2. Restore `spawnJobLoop()` and `loopRegistry` in `auto-round-engine.service.ts`.
3. Restore `spawnJobLoop()` calls in `getAutoRoundStatus()` and `ensureAutoRoundRecovery()`.
4. Remove `schedulerLease` from job metadata (optional cleanup).
5. Restart web process (`pm2 restart kinetic-web`).

No schema migration required — lease lives in existing JSON `metadata` field.

---

## Remaining Risks (Phase 2+)

| Risk | Status after Phase 1 |
|------|------------------------|
| Cross-process duplicate loops (multi-instance PM2) | Mitigated by DB lease CAS; not load-tested multi-process |
| `(jobId, roundNo)` DB uniqueness | Not added — consolidation guard only |
| `registerRoundCancellation` shared per jobId | Unchanged |
| `job.metadata.runtime` shared write slot | Single loop reduces but not eliminated |
| Post-crash auto-resume without explicit start | By design — call `POST /rounds/start` to idempotent attach |

---

## Success Criteria Checklist

| Criterion | Met |
|-----------|-----|
| One job → one scheduler loop | ✅ |
| One lease owner | ✅ |
| Atomic spawn (no check-then-set) | ✅ |
| Idempotent start | ✅ |
| Read ops never spawn | ✅ |
| 100 concurrent spawns → 1 loop | ✅ |
| No trading/AI/scanner changes | ✅ |

---

*Phase 1 complete. Implementation + validation + report generated.*
