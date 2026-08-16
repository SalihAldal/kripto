# KRIPTO P0 — AI Cancellation Propagation Fix Report

**Date:** 2026-08-14  
**Incident:** Session `cmst8nza40007unvsi2211emo`, Round 4, Run `cmstaljbi09zsunvsk1hn8ik0`  
**Scope:** Runtime reliability only — no strategy, threshold, prompt, risk, SL/TP, or fee changes.

---

## 1. Exact Root Cause

The Tur 4 PIXELTRY stall was a **cancellation failure**, not an AI quality issue.

| Layer | Failure |
|-------|---------|
| **Primary** | `withBoundedAwait` used `Promise.race` and rejected the outer await on timeout, but **did not abort** the underlying consensus, provider HTTP, or Prisma work. |
| **Secondary** | `selectionBudgetMs` was enforced only **between** pool items (`shouldAbort` / `checkBudget(false)` on heartbeat skip paths). An in-flight worker could run past the 20-minute ceiling. |
| **Tertiary** | Cooperative pool worker timeout did not reliably call `failAiCandidate`. PIXELTRY remained `STARTED` while heartbeat stopped. |

**Observed chain (before fix):**

```
runCooperativePool → worker with timeout → runAIConsensusFromInput
  → Promise.all(provider lanes) → remote fetch / Prisma

Outer withBoundedAwait rejects → inner work continues → pool slot occupied → round RUNNING
```

---

## 2. Cancellation Propagation Path (After Fix)

```
registerRoundCancellation(jobId)
  └─ AbortController.signal
       └─ FastEntryRuntimeHooks.abortSignal
            └─ scanner mapWithConcurrency / runCooperativePool
                 └─ per-worker linkAbortSignal(poolAbort)
                      └─ withCancellableBoundedAwait(signal)
                           └─ runAIConsensusFromInput(input, { signal })
                                └─ analyzeLaneWithSingleProvider(..., signal)
                                     └─ withAiRetry({ signal })
                                          └─ input.runtimeControl.abortSignal
                                               └─ remote-llm postJson/getJson(parentSignal)
                           └─ withBoundedPrisma(..., { signal }) on getRuntimeExecutionContext
```

**On parent abort:**

1. Provider `fetch` aborts via linked `AbortController`
2. Cancel/timeout errors propagate from lanes (no longer swallowed)
3. Consensus rejects with `CooperativeAsyncCancelledError` / timeout
4. Worker settles; pool slot releases
5. `failAiCandidate` marks `AI_TIMEOUT` / `AI_FAILED` — never orphan `STARTED`

---

## 3. Timeout Behavior

**Before:** Timeout = outer rejection only; inner promise continued.

**After (`withCancellableBoundedAwait`):**

1. Timer fires → `CooperativeAsyncTimeoutError` (reject **before** abort to preserve error type)
2. Local `AbortController` aborts linked work
3. Provider/consensus/Prisma races lose to timeout/cancel
4. Scanner catch + `onWorkerTimeout` → `failAiCandidate(AI_TIMEOUT)` with `timeoutAt`, `aborted`, `signalPropagated`

Timeout is **never** counted as success.

---

## 4. Selection Budget Behavior

| Mechanism | Role |
|-----------|------|
| `selectionDeadlineMs` on pool | Caps each worker `effectiveTimeout` via `remainingMsUntil(deadline)` |
| Pool budget interval | Calls `enforceBudget()` every ≤1s while pool runs |
| `startSelectionBudgetEnforcer(jobId)` | Independent 1s timer → `cancelRoundSelection` at absolute deadline |
| `RoundRuntimeController.checkBudget(true)` | All heartbeat paths throw `BUDGET_EXPIRED` when elapsed |
| Watchdog `SELECTION_BUDGET_EXCEEDED` | Triggers cancel + `terminalizeOpenAiCandidates` |

Round cannot remain `RUNNING` after budget expiry without an active abort signal propagating.

---

## 5. Prisma Bounded-Path Behavior

| Hot path | Wrapper | Default bound |
|----------|---------|---------------|
| `getRuntimeExecutionContext()` in consensus | `withBoundedPrisma` | 15s |
| `idempotentPatchJobActiveRound` / `idempotentMergeRunMetadata` in runtime persist | `withBoundedPrisma` | 15s |

Slow/hung DB → `BoundedPrismaError` → candidate fails bounded → pool slot releases. Errors are logged, not hidden.

---

## 6. Recovery Interaction

Existing scheduler recovery semantics preserved:

| State | Action |
|-------|--------|
| `ACTIVE_PROGRESS` | Continue — no premature `RESTART_CURRENT_STAGE` |
| `HEARTBEAT_ONLY` | Grace period |
| `POSSIBLY_HUNG` | Grace + diagnostics |
| `STALLED` / budget exceeded | `cancelRoundSelection(reason)` + `terminalizeOpenAiCandidates` |

Recovery is only considered effective when the abort signal propagates and in-flight work settles.

---

## 7. Process Isolation (P0-7)

**Not used in this fix.** Cooperative pool timeout + `AbortSignal` chain is the primary guarantee. Process/worker-thread isolation remains a documented fallback if a future provider SDK ignores abort.

---

## 8. Candidate Lifecycle Before / After

| Event | Before | After |
|-------|--------|-------|
| Start | `STARTED`, often missing provider/model | `STARTED` + `provider`, `model`, `executionMode`, `startedAt` |
| Worker timeout | Often orphan `STARTED` (PIXELTRY) | `AI_TIMEOUT` + `timeoutAt`, `aborted`, `abortReason`, `durationMs` |
| Cancel / budget | Pool checked between items only | Mid-flight abort + `cancelledAt`, `cancelReason`, `signalPropagated` |
| Complete | `COMPLETED` | `COMPLETED` + provider/model on record |

---

## 9. Artifacts on Stall

`writeMinimumAiStallArtifacts` guarantees minimum partial bundle:

- `ai-progress.json`
- `ai-trace.json`
- `round-watchdog.json`
- `recovery-decisions.json`
- `recovery-telemetry.json`
- `round-summary.json`

Called from scanner `onWorkerTimeout` and AI failure catch paths. No silent catch.

---

## 10. Tests

```bash
npx vitest run tests/ai-cancellation.test.ts tests/cooperative-async.test.ts
```

**Result:** 14/14 passed (2026-08-14)

| # | Scenario | Status |
|---|----------|--------|
| 1 | Hung consensus → timeout → AI_TIMEOUT → next candidate | ✅ |
| 2 | Abort parent signal cancels bounded await | ✅ |
| 3 | Pool continues after hung worker | ✅ |
| 4 | Cancel/budget aborts in-flight pool work | ✅ |
| 5 | `cancelRoundSelection` aborts consensus lanes | ✅ |
| 6 | Prisma hang → bounded failure, no STARTED orphan | ✅ |
| 7 | Concurrency=2, 12 items, all terminal | ✅ |
| 8 | HEARTBEAT_ONLY vs STALLED assessment | ✅ |
| 9 | Provider/model at STARTED | ✅ |
| 10 | Minimum partial artifact bundle on timeout | ✅ |

Machine-readable summary: `kripto-p0-ai-cancellation-validation.json`

---

## 11. One-Round Validation

**Status: PENDING** (not executed in this session)

Targeted unit/integration tests passed. Live paper round requires:

1. Rebuild/restart worker with these changes
2. Run: `npx tsx scripts/run-1round-recovery-validation.ts`

Acceptance (runtime reliability only — no trade/profit required):

- [ ] No candidate `STARTED` indefinitely
- [ ] No round `RUNNING` indefinitely
- [ ] Selection budget absolute
- [ ] One hung AI candidate does not freeze pool
- [ ] AI timeout → terminal candidate
- [ ] STALLED recovery terminates with real cancel
- [ ] Forensic artifacts on failure

---

## 12. Remaining Blockers

1. **Live one-round validation** — stack must be up with redeployed worker.
2. **Historical Round 4** (`cmstaljbi09zsunvsk1hn8ik0`) — frozen under old process; will not self-heal until worker restart or manual job termination.
3. **5-round stress re-run** — intentionally deferred until live one-round passes.

---

## Key Files Changed

| File | Change |
|------|--------|
| `src/server/execution/cancellable-work.service.ts` | New — `withCancellableBoundedAwait`, `linkAbortSignal` |
| `src/server/execution/cooperative-async.types.ts` | Extracted telemetry/error types |
| `src/server/execution/cooperative-async.service.ts` | Pool abort/budget, worker signals, `onWorkerTimeout` |
| `src/server/execution/bounded-prisma.service.ts` | New — bounded DB wrapper |
| `src/server/execution/round-runtime.service.ts` | Budget enforcer, bounded persist, `checkBudget(true)` |
| `src/server/execution/round-selection.service.ts` | Abort signal hooks, watchdog terminalization |
| `src/server/scanner/scanner.service.ts` | Signal propagation, forensic start, stall artifacts |
| `src/server/scanner/fast-entry.service.ts` | Runtime hook types |
| `src/server/ai/analysis-orchestrator.ts` | Consensus signal + bounded Prisma + lane cancel propagate |
| `src/server/ai/utils.ts` | Signal-aware timeout/retry |
| `src/server/ai/providers/remote-llm.ts` | Parent abort on fetch |
| `src/server/forensics/ai-runtime.service.ts` | Extended forensic fields + partial export |
| `src/types/ai.ts` | `runtimeControl.abortSignal` |
| `tests/ai-cancellation.test.ts` | 10 regression scenarios |

---

**Trading rules unchanged.** This fix guarantees: **a single stuck AI candidate cannot freeze an entire Paper round forever.**
