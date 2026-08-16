# KRIPTO P0 Forensic — AI Batch Stall / PIXELTRY Hang

**Session:** `cmst8nza40007unvsi2211emo`  
**Round:** Tur 4  
**Run ID:** `cmstaljbi09zsunvsk1hn8ik0`  
**Analysis date:** 2026-08-14 (forensic only — no code changes, no restart, no kill)  
**Classification:** **`CANCELLATION_FAILURE`** (primary) + **`SELECTION_BUDGET_BUG`** (secondary) + **`RECOVERY_DETECTION_BUG`** (tertiary)

---

## Executive summary

Tur 4 AI batch stopped forward progress at **~6/91** candidates with **PIXELTRY** left in **`STARTED`** (no `completedAt`). Last runtime heartbeat: **`2026-08-14T18:43:04.004Z`**. Hours later the job remains **`RUNNING`** with the same frozen metadata (`Scanner ai 5/91`, same `heartbeatAt`).

The stall occurred **inside the AI consensus call chain** for PIXELTRY, not at scanner discovery. Remote AI worked in Tur 1–3 (18–100 REMOTE calls). The cooperative pool **did not release forward progress** because the active worker never returned to the pool loop; **`selectionBudgetMs` was not enforced while a worker was mid-flight**; and **timeout/cancel paths do not abort the underlying consensus promise**.

This is **not PASS**. This is **not** a strategy/threshold issue.

---

## 1. PIXELTRY AI invocation (exact record)

From `artifacts/forensics/cmst8nza40007unvsi2211emo/rounds/4/ai-progress.json`:

| Field | Value |
|-------|-------|
| **candidateId** | `ai:PIXELTRY:afd2e663` |
| **symbol** | `PIXELTRY` |
| **provider** | *Not recorded at start* (`startAiCandidate` does not populate provider/model) |
| **model** | *Not recorded at start* |
| **executionMode** | *Inferred REMOTE* (same path as Tur 1–3; no local-only branch reached) |
| **startedAt** | `2026-08-14T18:42:44.803Z` |
| **requestStartedAt** | Same (consensus checkpoint at `18:42:44.810Z`) |
| **timeoutMs (per-candidate AI config)** | `90000` (`resolveAiConsensusTimeoutMs()` default) |
| **retry count** | `0` (in progress record) |
| **attempt** | Round selection attempt `1` (`selectionAttempt: 1` in runtime) |
| **consensusStage at stall** | Started as `"ai"`, runtime moved to `"consensus"` |
| **completion status** | **`STARTED`** — no `completedAt`, no `failAiCandidate` |

**Completion classification:** **`RUNNING` → frozen as `UNKNOWN` (zombie in-flight)**

Runtime timeline for PIXELTRY (from job metadata `timeline`):

```
18:42:44.731  Scanner ai 4/91      (onItemStart / checkpoint)
18:42:44.810  Scanner consensus 2/91  (entered runAIConsensusFromInput)
18:42:48.561  heartbeat            (consensus still 2/91)
18:43:03.819  heartbeat            (last ever)
18:43:04.004  heartbeatAt persisted to DB — then nothing
```

### Inferred providers for PIXELTRY consensus

From `buildLaneProviderMap()` in `src/server/ai/analysis-orchestrator.ts` (3-provider setup):

| Lane | Provider | Typical model |
|------|----------|---------------|
| technical | `provider-1` | `gpt-4o-mini` (OpenAI) |
| momentum | `provider-1` or `provider-2` (cursor `% 4`) | `gpt-4o-mini` |
| risk | `provider-3` | `gemini-1.5-flash-latest` |

Exact momentum lane provider depends on global cursor at call time; not persisted for PIXELTRY because **`ai-trace.json` for Tur 4 was never written** (round never completed export).

---

## 2. Timeout / abort semantics (call chain)

### Layer stack for one scanner AI candidate

```
runCooperativePool (scanner.service mapWithConcurrency)
  └─ withBoundedAwait(workerTimeoutMs = resolveScannerAiWorkerTimeoutMs() ≈ 180s)
       └─ scanner worker (scanner.service.ts ~546)
            ├─ withBoundedAwait(buildMarketContext, 45s)
            ├─ withBoundedAwait(formatAIRequest, 45s)
            └─ withBoundedAwait(runAIConsensusFromInput, 90s)   ← PIXELTRY stuck here
                 └─ runAIConsensusFromInputImpl
                      ├─ await logTradeEvent (AI_ANALYSIS_STARTED) — DB, errors swallowed
                      └─ Promise.all([
                           withCircuitBreaker → analyzeLaneWithSingleProvider(technical)
                           withCircuitBreaker → analyzeLaneWithSingleProvider(momentum)
                           withCircuitBreaker → analyzeLaneWithSingleProvider(risk)
                         ])
                      each lane: withAiRetry → withAiTimeout → provider.* → remote-llm postJson
                           └─ AbortController.abort() on HTTP timeout (~11–16s per attempt)
                      then (no withBoundedAwait):
                           getRuntimeExecutionContext()  ← Prisma, NO timeout
                           applyAiPerformanceWeights()
                           buildHybridDecision / bridgeConsensusResult / logTradeEvent
```

### Answers (file/function level)

| Question | Answer |
|----------|--------|
| If provider hangs > timeout, does promise reject? | **At lane level:** `withAiTimeout` in `src/server/ai/utils.ts:17-27` races `setTimeout` — **should reject** after ~11–16s per attempt. **At consensus wrapper:** `withBoundedAwait(..., 90s)` in `scanner.service.ts:622-627`. **At worker:** `withBoundedAwait(..., ~180s)` in `cooperative-async.service.ts:331-337`. |
| Does underlying request abort? | **HTTP only:** `remote-llm.ts:416-428` uses `AbortController` on fetch. **Consensus promise:** **NO** — when outer `withBoundedAwait` times out, inner `runAIConsensusFromInput` **keeps running** (`cooperative-async.service.ts:181-188`, no cancellation linkage). |
| Does concurrency slot release? | **Only when** the worker's `withBoundedAwait` rejects and pool `catch` runs (`cooperative-async.service.ts:341-367`). If event loop stops, **never**. |
| Does `onItemComplete` fire? | **Only after** worker `withBoundedAwait` settles. PIXELTRY: **did not fire** after `18:42:44`. |
| Does `aiProcessed` increment? | Batch counter (`ai-runtime.service.ts:155`) increments in `completeAiCandidate` / `failAiCandidate` only. PIXELTRY: **never incremented for this candidate**. |
| Can pool start next item? | **Second slot** should take next index after SAHARATRY completed (`18:42:48`). Snapshot shows **no progress past 6 batch completions / runtime checkpoint 2/91** — pool **did not advance** after final heartbeat. |

**Key functions:**

- `withBoundedAwait` — `src/server/execution/cooperative-async.service.ts:167-232`
- `runCooperativePool` — same file:257-406
- `mapWithConcurrency` — `src/server/scanner/scanner.service.ts:140-184`
- AI worker body — `src/server/scanner/scanner.service.ts:543-686`
- Consensus — `src/server/ai/analysis-orchestrator.ts:630-807`
- Lane provider calls — `analysis-orchestrator.ts:134-218`

---

## 3. Concurrency deadlock analysis

**Configured concurrency:** `2` (`ai-progress.json`, `env.SCANNER_AI_CONCURRENCY` effective value 2 in this run)

### Batch state at stall

| Metric | Value | Source |
|--------|-------|--------|
| `processed` (batch) | 6 | ai-progress.json |
| `successCount` | 3 | ai-progress.json |
| `failedCount` | 3 | ai-progress.json |
| `timeoutCount` | 0 | ai-progress.json |
| Open `STARTED` | 1 (PIXELTRY) | ai-progress.json |
| Runtime `aiProcessed` (DB) | 2 | job metadata (stale persist) |
| Checkpoint message | `Scanner consensus 2/91` | runtime timeline |

### Slot occupancy at ~18:42:44–18:43:04

1. **Worker A:** PIXELTRY — in `runAIConsensusFromInput` since `18:42:44.803Z`
2. **Worker B:** SAHARATRY completed `18:42:48.569Z` — slot freed; should dequeue index ≥ 4

**Not a classic semaphore deadlock** (no `await` on a lock held by second worker in code review). Observed behavior matches:

- **One worker permanently occupied** by PIXELTRY consensus await
- **Event loop / scheduler process ceased scheduling** after `18:43:04` (no further heartbeats, no worker timeout side effects, no budget enforcement hours later)
- Second worker **did not** advance `aiProcessed` in runtime DB (persist freeze or never reached next item)

**Concurrency = 2 did not cause a logical lock cycle**; it amplified blast radius by leaving one slot in a non-cancellable long await while the batch orchestrator could not make forward progress.

---

## 4. Provider response analysis

**No PIXELTRY provider HTTP trace** in artifacts (no Tur 4 `ai-trace.json`, no `AI_PROVIDER_RESULT` export for this run after freeze).

Evidence-based inference:

| Observation | Inference |
|-------------|-----------|
| Heartbeats continued until `18:43:03` with message `Scanner consensus 2/91` | Worker was **inside consensus phase**, not stuck in discovery/market-context |
| ~19s elapsed from consensus start to last heartbeat | Consistent with **in-flight `Promise.all` lane calls** (max ~22s with retries per `withAiRetry`) **or** early post-provider Prisma path |
| Tur 1–3: 18–100 successful REMOTE calls | **Not a global provider outage** |
| Last heartbeat then total silence for hours | **Not a slow but healthy completion** — scheduler stopped advancing |

**Classification:**

- **Not proven:** `PROVIDER_HANG` (no HTTP log)
- **Likely:** **`CONSUMER_HANG`** or **`CANCELLATION_FAILURE`** — outer await stopped scheduling before lane timeouts could complete recovery; underlying work not cancelled
- **Correlated (not proven isolated):** Postgres stress at ~18:43 (validation runner DB disconnect same window) could block `getRuntimeExecutionContext()` / `persist()` — both use **unbounded Prisma** (`execution.repository.ts:11-35`, `round-runtime.service.ts:214-241`)

---

## 5. AI progress vs worker logs

| Source | `processed` / progress | Last update |
|--------|------------------------|-------------|
| `ai-progress.json` | 6/91 (3 ok, 3 fail) | `lastProgressAt: 18:43:03.827Z` |
| Runtime DB metadata | `aiProcessed: 2`, `candidatesProcessed: 2` | `lastProgressAt: 18:42:44.810Z`, `heartbeatAt: 18:43:04.004Z` |
| Job active message | `Scanner ai 5/91` | frozen |
| `ai-trace.json` Tur 4 | **missing** | — |
| Async telemetry in snapshot | **missing** | — |

**Why `aiProcessed` stayed at 6 (batch) and did not reach 7:**

- `completeAiCandidate` / `failAiCandidate` never called for PIXELTRY (`ai-runtime.service.ts:132-201`)
- `onItemComplete` in cooperative pool never ran for PIXELTRY worker (`scanner.service.ts:529-541`)
- Progress writer (`writeAiProgressArtifact`) last ran at 6 completions — **the actual AI work and the progress writer both stopped together**, indicating **worker/orchestrator freeze**, not a telemetry-only bug

**Runtime DB `aiProcessed: 2` vs batch `6`:** checkpoint/persist lag — `controller.transition` / `persist()` stopped updating after `18:43:04` while in-memory batch counter had already reached 6 via `onItemComplete` callbacks.

---

## 6. Selection budget enforcement

| Config | Value |
|--------|-------|
| `selectionBudgetMs` | `1_200_000` (20 min) |
| Round 4 `selectionStartedAt` | ~`18:40:35Z` |
| Budget deadline | ~`19:00:35Z` |
| Stall time | `18:43:04Z` (~2.5 min elapsed) |
| Hours later | Job still `RUNNING`, same heartbeat |

### Critical finding — `SELECTION_BUDGET_BUG`

`checkBudget()` in `round-runtime.service.ts:172-191`:

- **`throwOnExpire: true`** only in `ensureJobActive()` and `shouldAbort()` (pool between items)
- **`heartbeat()` calls `checkBudget(false)`** — budget expiry **does not abort** on heartbeat path (lines 159, 169)
- Cooperative pool calls `shouldAbort()` **between items**, not while inside PIXELTRY worker body

**Therefore:** If one AI worker hangs mid-candidate, **`selectionBudgetMs` is never enforced** — the round can stay `RUNNING` **indefinitely**, even past 20 minutes. This explains Tur 4 exceeding the operational ceiling while Tur 2 failed with `Tur secim suresi doldu (1200s)` (budget checked between candidates during heavy churn).

Per-call timeout ceiling:

| Layer | Timeout |
|-------|---------|
| Lane HTTP | ~11–16s × retries |
| Consensus wrapper | 90s |
| Worker wrapper | ~180s |

**None of these fired** after `18:43:04` → event loop / process **stopped processing timers**, not merely slow AI.

---

## 7. Recovery interaction

### Scheduler recovery (`RECOVERY_DETECTION_BUG`)

Job metadata shows repeated audits (~`18:42:27`–`18:42:44`):

```json
{
  "failure": "SCHEDULER_CRASH",
  "action": "NO_ACTION",
  "message": "No recoverable issue detected"
}
```

From `scheduler-recovery.service.ts:360-368`:

- Trigger context: `SCHEDULER_CRASH` (validation runner lost DB / external poll crash — **not** engine proof of death)
- `evaluateJobHealth()` found **no primary issue** while engine heartbeat still fresh
- `decideRecoveryPolicy` → **`NO_ACTION`**

`shouldBlockRecoveryRestart()` (`round-progress-state.service.ts:230-236`) blocks restart on:

- `ACTIVE_PROGRESS`
- `HEARTBEAT_ONLY`
- `POSSIBLY_HUNG`

While heartbeat was fresh (< 180s), recovery **correctly avoided false `RESTART_CURRENT_STAGE`** — but after heartbeat freeze, **no successful recovery action** updated job state (process likely dead or loop frozen; scheduler watchdog in same process).

### Selection watchdog

`startRoundSelectionWatchdog` (`cooperative-async.service.ts:410-449`) fires `onStale` only on **`STALLED`**, not on `POSSIBLY_HUNG`.

After `18:43:04`, with both heartbeat and progress stale > 180s, assessment should become **`STALLED`**. Even then:

- `onStale` → `cancelRoundSelection()` sets `AbortSignal`
- Pool only checks abort **between items** (`shouldAbort` in loop) — **does not interrupt in-flight PIXELTRY `withBoundedAwait`**

**Why round was not terminated:**

1. Early window: recovery blocked by fresh heartbeat (`NO_ACTION`)
2. Post-freeze: **`cancelRoundSelection` ineffective mid-worker**
3. **Budget not enforced on heartbeat timer**
4. Likely **process/event-loop freeze** — watchdog timers also stopped

---

## 8. Root cause (exact)

**Primary:** **`CANCELLATION_FAILURE`**

PIXELTRY entered `runAIConsensusFromInput` wrapped by `withBoundedAwait` (90s) inside a cooperative pool worker (180s). The timeout layers use `Promise.race` **without aborting** the inner consensus task or its HTTP/Prisma sub-operations. When the scheduler event loop ceased advancing at **`18:43:04Z`**, neither lane timeouts, consensus timeout, worker timeout, selection budget, nor recovery cancel could release the batch — leaving Tur 4 **`RUNNING`** with PIXELTRY **`STARTED`** indefinitely.

**Secondary:** **`SELECTION_BUDGET_BUG`**

`selectionBudgetMs = 1_200_000` is only enforced at `shouldAbort()` / `ensureJobActive()` with `throwOnExpire=true`, not on heartbeat or while a worker is mid-flight — so a single hung candidate bypasses the 20-minute operational ceiling.

**Tertiary:** **`RECOVERY_DETECTION_BUG`**

Recovery correctly suppressed false restarts while heartbeat was fresh, but provided **no escalation path** when heartbeat + progress simultaneously died; `cancelRoundSelection` does not cancel active `withBoundedAwait` work.

**Not primary:** Provider outage (disproven by Tur 1–3), AI gate bypass (no orders), premature `RESTART_CURRENT_STAGE` (0).

---

## 9. Safe fix proposal (do not implement in this forensic pass)

1. **Link cancellation to in-flight work:** Pass `AbortSignal` from round cancellation into `runAIConsensusFromInput` → lane provider fetches; on `withBoundedAwait` timeout, abort signal must fire.

2. **Enforce selection budget on timer:** Independent interval that calls `checkBudget(true)` or fails round regardless of worker state; fail round if `elapsedMs >= selectionBudgetMs` even mid-AI-batch.

3. **Harden cooperative pool:** On worker timeout, mark candidate `failAiCandidate(AI_TIMEOUT)` explicitly (PIXELTRY left `STARTED` forever).

4. **Bounded Prisma for hot path:** Wrap `getRuntimeExecutionContext`, `persist()`, `idempotentMergeRunMetadata` with `withBoundedAwait` + fail candidate on timeout.

5. **Record provider/model at `startAiCandidate`** for forensic completeness.

6. **Export partial `ai-trace.json` on heartbeat** during long batches.

7. **Process-level health:** If heartbeat not persisted for > N seconds while job RUNNING, external supervisor should mark job failed (out-of-process watchdog).

---

## 10. Required regression tests

1. **Hung consensus mock:** Stub one lane to never resolve → assert worker timeout fires, slot released, `failAiCandidate`, batch continues within 180s.

2. **AbortSignal propagation:** Cancel mid-consensus → assert fetch aborted, PIXELTRY not left `STARTED`.

3. **Selection budget mid-flight:** Start 91-candidate batch, freeze worker at candidate 6, advance clock past 1200s → assert round fails with `BUDGET_EXPIRED` **without** waiting for worker hang.

4. **Heartbeat-only stall:** Stop progress updates but keep heartbeats → assert transition to `POSSIBLY_HUNG` then `STALLED` and recovery action **terminates round**.

5. **Postgres slow/hang injection:** Block Prisma after providers return → assert consensus fails bounded, does not freeze pool > worker timeout.

6. **Concurrency=2 stress:** 91 symbols, 2 workers, random lane delays → assert `processed` reaches 91 or round fails bounded; no `STARTED` orphans.

7. **Recovery NO_ACTION guard:** Fresh heartbeat + stalled progress → assert eventual escalation, not infinite `RUNNING`.

---

## 11. Final checklist (requested)

| # | Question | Answer |
|---|----------|--------|
| 1 | Exact root cause | **`CANCELLATION_FAILURE`** + **`SELECTION_BUDGET_BUG`** — mid-flight consensus not cancellable; budget not enforced while worker stuck; event loop froze ~18:43:04 |
| 2 | PIXELTRY provider/model | **Inferred:** technical=`provider-1`/gpt-4o-mini, momentum=`provider-1|2`, risk=`provider-3`/gemini-1.5-flash — **not persisted** in artifact |
| 3 | Request timed out? | **No evidence of timeout fired** — `timeoutCount: 0`, status still `STARTED` |
| 4 | Cancellation happened? | **No** — no abort linkage; `cancelRoundSelection` ineffective mid-worker |
| 5 | Concurrency slot released? | **No** — PIXELTRY occupied worker until process freeze |
| 6 | Why aiProcessed remained 6 | **`completeAiCandidate` never called for PIXELTRY**; pool never completed 7th item |
| 7 | Why scheduler did not terminate | Budget checked only between items; recovery `NO_ACTION` while heartbeat fresh; post-freeze timers dead; cancel doesn't interrupt active await |
| 8 | Exact file/function | `scanner.service.ts:622-627` → `analysis-orchestrator.ts:791-807` → `cooperative-async.service.ts:331-337`; budget: `round-runtime.service.ts:172-191`; recovery: `scheduler-recovery.service.ts:360-368` |
| 9 | Safe fix | See §9 above |
| 10 | Regression tests | See §10 above |

**Final classification:** **`CANCELLATION_FAILURE`** (primary)

**Status:** **FAIL** — Tur 4 AI batch stall is a P0 reliability defect. Do not treat as PASS.

---

## Artifact references

- `artifacts/forensics/cmst8nza40007unvsi2211emo/rounds/4/ai-progress.json`
- `artifacts/forensics/cmst8nza40007unvsi2211emo/job-status-snapshot.json`
- `artifacts/forensics/cmst8nza40007unvsi2211emo/rounds/2/round-watchdog.json` (contrast: Tur 2 bounded fail)
- Code: `cooperative-async.service.ts`, `scanner.service.ts`, `analysis-orchestrator.ts`, `ai-runtime.service.ts`, `round-progress-state.service.ts`, `round-runtime.service.ts`, `scheduler-recovery.service.ts`
