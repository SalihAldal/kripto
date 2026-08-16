# KRIPTO P0 — Scheduler Recovery False Restart Fix

**Date:** 2026-08-14  
**Scope:** Native Kripto only (BrainOS untouched)  
**Strategy/threshold changes:** None

---

## 1. Exact root cause

Three interacting defects caused healthy rounds to fail at ~4 minutes with `Recovery restart current stage`:

### A. Unconditional `AI_TIMEOUT` health issue
`evaluateJobHealth()` added an `AI_TIMEOUT` warning **whenever** the runtime step contained `AI` or `CONSENSUS`, without checking heartbeat age, progress age, or selection budget. During normal scanner/AI selection this issue was **always present**.

### B. Recovery counter inflated on NO_ACTION watchdog ticks
`appendRecoveryAuditEvent()` incremented `recoveryCount` on **every** watchdog evaluation, including `NO_ACTION` / `skipped` outcomes. With a 15s watchdog interval, escalation reached level 2 (`recoveryCount >= 6`) in ~90–240s even while the round was healthy.

### C. `RESTART_CURRENT_STAGE` treated as terminal round failure
When recovery cancelled selection, `runCooperativeRoundSelection()` returned `aborted: true`, and `auto-round-engine` **failed the entire round** instead of retrying selection within the 20-minute `selectionBudgetMs`.

Secondary contributor: the selection watchdog used a fixed progress-stale threshold (~180s) independent of real progress signals and selection budget semantics.

---

## 2. Exact triggering condition

```
scheduler-watchdog (every 15s)
  → executeSchedulerRecovery()
    → evaluateJobHealth()
      → issues includes AI_TIMEOUT (unconditional during AI step)
    → decideRecoveryPolicy()
      → escalationLevel >= 2 (from inflated recoveryCount)
      → action = RESTART_CURRENT_STAGE
    → cancelRoundSelection(jobId, "Recovery restart current stage")
      → cooperative selection aborted
        → failRound()  [before fix]
```

Observed at ~246s in session `cmst21ldd0007unbgm1ngckq6` while `selectionBudgetMs = 1_200_000` and heartbeats were active.

---

## 3. Why ~4 min despite 20 min budget

| Signal | Configured | Effective behavior (before fix) |
|--------|------------|----------------------------------|
| `selectionBudgetMs` | 1,200,000 ms | Honored by selection loop, **ignored by recovery** |
| Watchdog interval | 15,000 ms | Fired ~16 times in 4 min |
| `recoveryCount` | Escalates at ≥6 | Incremented on NO_ACTION ticks too |
| `AI_TIMEOUT` issue | N/A | Always raised during AI phase |
| Restart threshold | Escalation ≥2 + stall-class issue | Met at ~4 min without true stall |

Recovery was using **watchdog tick count**, not **forward progress within selection budget**.

---

## 4. Files changed

| File | Change |
|------|--------|
| `src/server/execution/round-progress-state.service.ts` | **New** — progress state machine |
| `src/server/execution/scheduler-recovery.service.ts` | Progress-aware health + policy |
| `src/server/execution/cooperative-async.service.ts` | Progress-aware selection watchdog |
| `src/server/execution/round-selection.service.ts` | Pass runtime snapshot + budget to watchdog |
| `src/server/execution/auto-round-engine.service.ts` | Retry selection on recovery cancel within budget |
| `src/server/execution/scheduler-recovery.types.ts` | Progress assessment telemetry types |
| `src/server/repositories/scheduler-recovery-audit.repository.ts` | Don't increment counter on NO_ACTION/skipped |
| `src/server/forensics/recovery-telemetry.service.ts` | Extended recovery decision fields |
| `src/server/forensics/round-forensic-export.service.ts` | Failed-round summary + `recovery-decisions.json` |
| `tests/round-progress-recovery.test.ts` | **New** targeted tests |

---

## 5. Recovery state machine behavior

| State | Meaning | Recovery action |
|-------|---------|-----------------|
| `ACTIVE_PROGRESS` | Recent progress + within stall threshold | **CONTINUE** (NO_ACTION) |
| `HEARTBEAT_ONLY` | Heartbeat fresh, progress not advancing | **CONTINUE** (monitor) |
| `POSSIBLY_HUNG` | Stall detected but inside grace window | **CONTINUE** + diagnostic telemetry |
| `STALLED` | No heartbeat/progress past stall threshold, budget remains | **RESTART_CURRENT_STAGE** (after escalation) |
| `FAILED` | Selection budget exhausted | Selection loop handles (not recovery restart) |

Legitimate scheduler crash / lease stale paths still use `RESUME` / `RECONCILE` and are **not** blocked by progress states.

---

## 6. Progress semantics

Progress evidence uses **real work signals** only:

- `candidatesProcessed`, `aiProcessed`, `scannerTotal`, `pumpProcessed`
- `intraRoundPct` / progress breakdown
- `lastProgressAt` updated by `noteProgress()` and `transition()` — **not** by timer-only heartbeats

Heartbeats update `heartbeatAt` only via `touchHeartbeatClock()` without advancing `lastProgressAt`.

---

## 7. Failed-round artifact behavior

`failRound()` already invoked `exportRoundForensicArtifacts()`. Export now additionally writes:

- `recovery-decisions.json` — filtered recovery telemetry for the round
- `round-summary.json` fields: `failReason`, `exportKind: failed-round-partial`, `funnelState`

Full P0/P1/P2 bundle is still emitted on failure when forensic session data exists (not only incremental `ai-progress.json`).

---

## 8. Tests

```
tests/round-progress-recovery.test.ts     8/8 pass
tests/scheduler-recovery.test.ts          5/5 pass
tests/forensics/p1-runtime-reliability    10/10 pass
tests/forensics/paper-preflight.test.ts   6/6 pass
tests/forensics/round-export.test.ts      1/1 pass
```

Covers: ACTIVE_PROGRESS no restart, HEARTBEAT_ONLY grace, STALLED restart, budget respect, recovery counter semantics.

---

## 9. Single-round validation result

**Not executed in this pass** (per prior instruction to avoid multi-round runtime until fix landed). Recommended next step:

```bash
npx tsx scripts/run-5round-paper-validation.ts
# with TOTAL_ROUNDS=1 locally, or dedicated 1-round smoke
```

Acceptance criteria for that run:

- No premature `Recovery restart current stage` during active AI/scanner progress
- Round reaches execution or legitimate terminal zero-trade decision
- `recovery-decisions.json` shows `CONTINUE` / `PROGRESS_ADVANCING` during healthy phases

---

## 10. Remaining blockers

1. **Live 1-round re-validation** after deploy — confirm fix under real scanner/AI load
2. **`round-manifest.json`** still not implemented (pre-existing gap)
3. **Integration test timeouts** (pre-existing, unrelated)
4. If `RESTART_CURRENT_STAGE` fires legitimately, verify selection retry completes without exhausting `maxSelectionAttempts` too quickly

---

## Production impact

- Scheduler recovery **not disabled**
- No trading thresholds changed
- No profitability claims
- Fixes false-positive round kills during healthy paper selection
