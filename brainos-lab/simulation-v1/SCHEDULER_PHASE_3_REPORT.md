# Scheduler Integrity Sprint — Phase 3 Report

> **Date:** 06.08.2026  
> **Scope:** Database integrity, transactions & idempotency (repository layer only)  
> **Prerequisite:** Phase 1 atomic scheduler ownership, Phase 2 round registry  
> **Out of scope:** Trading strategy, AI, scanner quality, execution logic

---

## Executive Summary

Phase 3 guarantees **database consistency under every runtime condition** by moving all critical round lifecycle writes into **single Prisma transactions**, adding **repository-level idempotency keys**, **optimistic concurrency (`persistVersion`)**, and **monotonic heartbeat merge** for runtime persistence.

```
One Logical Round
  ↓
One Database Record        (partial unique index + idempotencyKey)
  ↓
One Owner                  (registry inside same TX as run create)
  ↓
One Runtime                (run.metadata.runtime — job gets pointer only)
  ↓
One Execution              (unchanged — no execution logic modified)
```

**Stress validation:** 25, 50, and 100 concurrent `transactionallyBeginRound()` calls → **1 created**, remainder **attached**, **1 run ID**, **1 active row per (jobId, roundNo)**.

**Full suite:** 21/21 tests passed (`scheduler-ownership`, `round-registry`, `auto-round-integrity`, `auto-round-engine.integration`).

---

## Database Integrity Report

### Problem addressed

Prior audits documented:

| Defect | Evidence |
|--------|----------|
| Duplicate `AutoRoundRun` rows | 76 duplicate rows / 24 unique `roundNo` in last 100 runs |
| Partial writes | Separate `updateAutoRoundJob` + `createAutoRoundRun` calls |
| Counter drift | Read-modify-write on `failedRounds` / `completedRounds` |
| Shared runtime blob | Job metadata overwritten by concurrent round heartbeats |

### Phase 3 invariant

At every point in the round lifecycle, the database must reflect **exactly one canonical record** per logical round, with counters and registry updated **atomically** or **not at all**.

### New module

`src/server/repositories/auto-round-integrity.repository.ts`

| Function | Role |
|----------|------|
| `transactionallyBeginRound()` | Single TX: idempotent run create + job counters/metadata/registry/activeRunId |
| `transactionallyFailRound()` | Terminal fail + atomic `failedRounds` increment |
| `transactionallyCompleteRound()` | Terminal complete + atomic `completedRounds` increment |
| `idempotentMergeRunMetadata()` | Monotonic heartbeat merge on run metadata |
| `idempotentPatchJobActiveRound()` | Job `activeRound` pointer only (no full runtime) |
| `persistRoundOwnershipRecordTransactional()` | Version-aware registry persist |
| `auditAutoRoundIntegrity()` | Integrity audit helper |
| `OptimisticConcurrencyError` | Stale write detection |

---

## Transaction Report

### Transactional round creation (`transactionallyBeginRound`)

All of the following succeed **or rollback completely**:

| Step | Operation |
|------|-----------|
| 1 | Lookup by `idempotencyKey` → attach if open |
| 2 | Lookup open run `(jobId, roundNo, endedAt IS NULL)` → attach |
| 3 | `AutoRoundRun.create` with idempotency key |
| 4 | `AutoRoundJob.updateMany` (version CAS): `currentRound`, `activeState`, `activeRunId`, registry, `activeRound` pointer |
| 5 | Registry entry written with canonical `runId` |

**Engine wiring:** Removed separate `updateAutoRoundJob({ currentRound })` before acquire; round begin is fully transactional via `acquireOrCreateRoundRun()` → `transactionallyBeginRound()`.

### Transactional round failure (`transactionallyFailRound`)

Single TX:

- Terminal run update (`endedAt`, `failReason`, terminal idempotency key)
- Atomic `failedRounds: { increment: 1 }`
- Registry release / ownership record update
- Clear `activeRunId` if matches failed run
- Clear `activeRound` pointer

**Idempotent:** Second call returns `already_terminal` — no duplicate counter increment.

### Transactional round completion (`transactionallyCompleteRound`)

Single TX:

- Terminal run update with result metadata
- Atomic `completedRounds: { increment: 1 }`
- Optional `jobMetadataPatch` (e.g. `usedSymbols`)
- Registry + pointer cleanup

**Idempotent:** Second call returns `already_terminal`.

### Runtime persistence (non-terminal)

| Path | Transaction scope |
|------|-------------------|
| Heartbeat / progress | `idempotentPatchJobActiveRound` (job pointer) |
| Full runtime snapshot | `idempotentMergeRunMetadata` (run metadata only) |

These are separate transactions by design — job pointer and run runtime **never overwrite each other**.

---

## Constraint Report

### Schema changes (`prisma/schema.prisma`)

**AutoRoundJob**

| Column | Type | Purpose |
|--------|------|---------|
| `persistVersion` | `Int @default(0)` | Optimistic concurrency |
| `activeRunId` | `String?` | Canonical open run pointer |

**AutoRoundRun**

| Column | Type | Purpose |
|--------|------|---------|
| `idempotencyKey` | `String? @unique` | Idempotent create / terminal transition |
| `persistVersion` | `Int @default(0)` | Optimistic concurrency |

### Migration

`prisma/migrations/20260806130000_scheduler_integrity_phase3/migration.sql`

| Constraint | Definition |
|------------|------------|
| `AutoRoundRun_idempotencyKey_key` | Unique on `idempotencyKey` |
| `AutoRoundRun_jobId_roundNo_active_key` | **Partial unique** `(jobId, roundNo) WHERE endedAt IS NULL` |
| `AutoRoundRun_jobId_roundNo_endedAt_idx` | Query index for open-run lookup |
| `AutoRoundJob_activeRunId_idx` | Active run pointer lookup |

### Idempotency key format

| Phase | Key |
|-------|-----|
| Active round | `{jobId}:round:{roundNo}:active` |
| Terminal round | `{jobId}:round:{roundNo}:terminal:{runId}` |

Terminal transition re-keys the run so a new active round can use the active key without collision.

---

## Idempotency Report

### Create idempotency

| Trigger | Behaviour |
|---------|-----------|
| Same `idempotencyKey` exists (open) | Return existing run (`attached`) |
| Open run exists for `(jobId, roundNo)` | Return existing run (`attached`) |
| `P2002` on create (race) | Re-fetch and attach |
| Partial unique index violation | Prevented at DB level |

### Terminal idempotency

| Trigger | Behaviour |
|---------|-----------|
| `transactionallyFailRound` on ended run | `already_terminal`, no counter increment |
| `transactionallyCompleteRound` on ended run | `already_terminal`, no counter increment |

### Heartbeat idempotency

`shouldAcceptHeartbeatUpdate(current, next)` — accepts only monotonically newer ISO timestamps.

Stale heartbeats return `stale_ignored` without corrupting runtime state.

---

## Concurrency Report

### Optimistic concurrency

All job mutations use:

```typescript
updateMany({
  where: { id: jobId, persistVersion: expectedVersion },
  data: { persistVersion: { increment: 1 }, ... },
});
```

If `count !== 1` → `OptimisticConcurrencyError` or `version_conflict` (runtime patch path).

### Runtime separation

| Store | Contents |
|-------|----------|
| `AutoRoundJob.metadata.activeRound` | Pointer: `runId`, `roundNo`, `heartbeatAt`, `step`, `message` |
| `AutoRoundRun.metadata.runtime` | Full `RoundRuntimeSnapshot` |
| `AutoRoundJob.metadata.roundRegistry` | Ownership records (Phase 2) |

**Rule:** Job metadata never receives full runtime blob. Run metadata never receives job-level scheduler state.

### Engine integration

| Before | After |
|--------|-------|
| `updateAutoRoundJob` + `acquireOrCreateRoundRun` (2 ops) | `transactionallyBeginRound` (1 TX) |
| `failRound`: separate run + job updates | `transactionallyFailRound` |
| Success: separate run + job counter updates | `transactionallyCompleteRound` |
| `round-runtime.persist`: dual full metadata writes | `idempotentPatchJobActiveRound` + `idempotentMergeRunMetadata` |

---

## Counter Report

### Atomic counters

| Counter | Update mechanism |
|---------|------------------|
| `completedRounds` | `{ increment: 1 }` inside `transactionallyCompleteRound` TX |
| `failedRounds` | `{ increment: 1 }` inside `transactionallyFailRound` TX |
| `currentRound` | Set inside `transactionallyBeginRound` TX |
| `persistVersion` | `{ increment: 1 }` on every versioned job write |

### Eliminated patterns

- ~~`job.failedRounds + 1`~~ read-modify-write
- ~~`job.completedRounds + 1`~~ read-modify-write
- ~~Separate counter update after terminal run write~~

### Selection / execution counters

`selectionAttempt`, `tradeCount`, `executionCount` remain in **run metadata** via idempotent merge — no job-level counter mutation, preventing cross-round interference.

---

## Recovery Report

### Failure modes handled

| Scenario | Protection |
|----------|------------|
| Transaction rollback | Prisma `$transaction` — no partial state |
| Concurrent create race | Idempotency key + partial unique index + P2002 catch |
| Stale job version | `OptimisticConcurrencyError` — caller can retry |
| Duplicate fail/complete | `already_terminal` — idempotent, no double increment |
| Stale heartbeat | `stale_ignored` — monotonic merge |
| DB reconnect mid-TX | TX aborts; no orphan partial writes |
| Deadlock / timeout | Prisma rolls back entire TX |

### Audit helper

`auditAutoRoundIntegrity(jobId)` returns:

| Field | Detects |
|-------|---------|
| `duplicateActiveRoundNos` | Multiple open runs per round number |
| `orphanActiveRunId` | `activeRunId` pointing to non-active run |
| `activeRunCount` | Total open runs |
| Counter snapshot | `completedRounds`, `failedRounds`, `currentRound` |

### Crash recovery (unchanged behaviour)

Phase 1 scheduler recovery + Phase 2 round registry attach paths remain read-only on status routes. Phase 3 ensures any recovery re-entry into round create is idempotent at the repository layer.

---

## Stress Test Results

### `tests/auto-round-integrity.test.ts`

| Concurrency | Operation | Created | Attached | Run IDs | Active rows |
|-------------|-----------|---------|----------|---------|-------------|
| 25 | `transactionallyBeginRound` | 1 | 24 | 1 | 1 |
| 50 | `transactionallyBeginRound` | 1 | 49 | 1 | 1 |
| 100 | `transactionallyBeginRound` | 1 | 99 | 1 | 1 |

### Additional integrity tests

| Test | Result |
|------|--------|
| `transactionallyFailRound` double-call | 1 `failedRounds` increment |
| `transactionallyCompleteRound` double-call | 1 `completedRounds` increment |
| Stale heartbeat merge | Ignored, fresh preserved |
| Job pointer vs run runtime separation | Pass |
| Audit duplicate detection | Pass |

### Regression suite

```
npx vitest run \
  tests/auto-round-integrity.test.ts \
  tests/scheduler-ownership.test.ts \
  tests/round-registry.test.ts \
  tests/auto-round-engine.integration.test.ts

→ 21/21 passed
```

---

## Modified Files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | `persistVersion`, `activeRunId`, `idempotencyKey` |
| `prisma/migrations/20260806130000_scheduler_integrity_phase3/migration.sql` | Constraints + columns |
| `src/server/repositories/auto-round-integrity.repository.ts` | **New** — transactional integrity layer |
| `src/server/repositories/auto-round.repository.ts` | Delegate acquire/persist to integrity layer |
| `src/server/execution/auto-round-engine.service.ts` | TX fail/complete; remove split begin writes |
| `src/server/execution/round-runtime.service.ts` | Idempotent persist paths |
| `tests/auto-round-integrity.test.ts` | **New** — stress + integrity tests |
| `tests/auto-round-engine.integration.test.ts` | Integrity repository mocks |

---

## Rollback Plan

### 1. Revert application code

```bash
git checkout HEAD~1 -- \
  src/server/repositories/auto-round-integrity.repository.ts \
  src/server/repositories/auto-round.repository.ts \
  src/server/execution/auto-round-engine.service.ts \
  src/server/execution/round-runtime.service.ts \
  tests/auto-round-integrity.test.ts \
  tests/auto-round-engine.integration.test.ts
```

Remove `auto-round-integrity.repository.ts` if it did not exist before Phase 3.

### 2. Revert schema (optional — columns are backward compatible)

Migration uses `ADD COLUMN IF NOT EXISTS` — safe to leave columns in place. To remove constraints:

```sql
DROP INDEX IF EXISTS "AutoRoundRun_jobId_roundNo_active_key";
DROP INDEX IF EXISTS "AutoRoundRun_idempotencyKey_key";
DROP INDEX IF EXISTS "AutoRoundRun_jobId_roundNo_endedAt_idx";
DROP INDEX IF EXISTS "AutoRoundJob_activeRunId_idx";
ALTER TABLE "AutoRoundRun" DROP COLUMN IF EXISTS "idempotencyKey";
ALTER TABLE "AutoRoundRun" DROP COLUMN IF EXISTS "persistVersion";
ALTER TABLE "AutoRoundJob" DROP COLUMN IF EXISTS "activeRunId";
ALTER TABLE "AutoRoundJob" DROP COLUMN IF EXISTS "persistVersion";
```

### 3. Regenerate Prisma client

```bash
npx prisma generate
```

### 4. Verify

Run Phase 1 + Phase 2 tests only — engine reverts to split-write pattern (audit defects may reappear under concurrency).

---

## Success Criteria — Verified

| Criterion | Status |
|-----------|--------|
| One logical round → one DB record | ✅ Partial unique index + idempotent create |
| One owner per round | ✅ Registry in same TX as create |
| One runtime per run | ✅ Run metadata only; job pointer separated |
| Every write transactional (lifecycle) | ✅ Begin / fail / complete |
| Every create idempotent | ✅ Key + attach paths |
| Every counter atomic | ✅ `{ increment: 1 }` in TX |
| No partial writes | ✅ Single `$transaction` per lifecycle step |
| Stress 25/50/100 parallel | ✅ 21/21 tests pass |
| Repository only — no strategy/AI/scanner changes | ✅ Confirmed |

---

## Deployment Note

Apply migration before deploying application code:

```bash
npx prisma migrate deploy
npx prisma generate
```

Existing open runs without `idempotencyKey` remain valid; new runs receive keys on create. Terminal transitions backfill terminal keys on fail/complete.
