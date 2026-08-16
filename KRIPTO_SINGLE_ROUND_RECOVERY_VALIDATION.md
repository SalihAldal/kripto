# KRIPTO — Single-Round Scheduler Recovery Validation

**Validation ID:** `1round-recovery-2026-08-14T16-14-52-553Z`  
**Session ID:** `cmst5e8830007und066nb9se1`  
**Run ID:** `cmst5e8pz000jund0t7vcsr65`  
**Run window:** 2026-08-14 16:14:55 UTC → 16:24:17 UTC (~9.4 min)  
**Mode:** PAPER · BINANCE_TR · REAL_SCANNER · REAL_AI · current config (`EXECUTION_AI_GATE_POLICY=VETO`)  
**Machine-readable output:** `kripto-single-round-recovery-validation.json`  
**Raw log:** `artifacts/forensics/single-round-recovery-run.log`

---

## Executive summary

| Objective | Result |
|-----------|--------|
| Healthy scanner/AI selection **not** killed by `RESTART_CURRENT_STAGE` | **PASS** |
| Round allowed to reach execution or legitimate terminal decision | **PASS** (execution entered; order blocked by pre-trade safety) |
| No premature recovery restart during advancing progress | **PASS** |
| Failed-round forensic export completeness | **PARTIAL** (`round-summary.json`, `recovery-decisions.json` missing) |

### Final verdict: **PASS** (scheduler recovery fix validated)

The round ran **~9.3 minutes** of healthy selection (vs **~4 minutes** pre-fix kills in session `cmst21ldd0007unbgm1ngckq6`), reached symbol selection and execution entry, and **never** triggered `RESTART_CURRENT_STAGE` / `"Recovery restart current stage"`. Terminal failure was an unrelated **API health / clock-skew safety block** at order submit — not scheduler recovery.

No profitability claim is made. Zero fills, zero net PnL.

---

## 1. Exact timeline

All times **UTC** unless noted.

| Time | Event | State / step | Notes |
|------|-------|--------------|-------|
| 16:14:55 | Validation preflight | — | `canStart: true`, `overallVerdict: READY` |
| 16:14:56 | Auto-round job started | `bekliyor` | `jobId=cmst5e8830007und066nb9se1`, 1 round |
| 16:14:57 | Round 1 selection loop #1 | `tariyor` / `SCANNER_STARTING` | `selectionBudgetMs=1_200_000`, `elapsedMs=0` |
| 16:14:57 | Pump cache scan | `PUMP_SCAN` | 0 candidates |
| 16:14:57 | Live pump scan started | `PUMP_SCAN` | 90s timeout |
| 16:15:07 → 16:16:27 | Poll samples during live pump wait | `PUMP_SCAN` | `progressState=ACTIVE_PROGRESS`, `recoveryCount=0` |
| 16:16:27 | Pump live scan timeout | `TIMEOUT` | `PUMP_SCAN_FAILED` after 90,120 ms — **selection retry**, not recovery restart |
| 16:16:27 | Selection loop #2 | `SCANNER_STARTING` | Auto retry within budget |
| 16:16:34 | Scanner cycle | `AI_ANALYSIS` | 6-candidate universe |
| 16:17:14 | Pump/scanner attempts continue | mixed | Progress advancing |
| 16:19:24 | Selection loop #3 | `SCANNER_STARTING` | Full scanner universe (~100) |
| 16:19:56 | AI batch analysis | `AI_ANALYSIS` | `aiTotal=79` |
| 16:19:56 → 16:23:57 | AI consensus processing | `AI_ANALYSIS` | 79 candidates invoked; heartbeats + `lastProgressAt` advancing |
| 16:23:58 | Scanner symbol pick | `SYMBOL_SELECTED` | `ROBOTRY`, `elapsedMs=541,570` (~45% of budget) |
| 16:23:59 | Exploration accept | `SYMBOL_SELECTED` | `Tur 1: ROBOTRY exploration accept (relaxed thresholds)` |
| 16:24:07 | Execution phase entered | `coin_secildi` / `EXECUTING` | Selection complete |
| 16:24:12 | Market BUY submit attempted | order-submit | qty=1402, notional≈999.63 TRY @ 0.713 |
| 16:24:12 | **Safety block** | validation | `Clock synchronization failed (skew 254663ms), API latency exceeds threshold (3275ms)` |
| 16:24:12 | Round failed | `tur_basarisiz` | Legitimate terminal failure (not recovery) |
| 16:24:14 | Post-round recovery watchdog | — | `NO_ACTION` — no recoverable issue |
| 16:24:17 | Job completed | `COMPLETED` | `failedRounds=1`, `completedRounds=0` |

**Duration:** round 555,651 ms (~9.3 min). Selection consumed ~541 s of 1,200 s budget.

---

## 2. First recovery evaluation

During the **healthy selection phase** (16:14:57 → 16:24:07), **no recovery decision was recorded** in telemetry (`recoverySnapshots: []`). The watchdog did **not** escalate to `RESTART_CURRENT_STAGE` while AI/scanner work was advancing.

The **first (and only) audited recovery evaluation** captured in DB:

| Field | Value |
|-------|-------|
| Timestamp | `2026-08-14T16:24:14.168Z` |
| Trigger | `watchdog` |
| `recoveryDecision` | `NO_ACTION` |
| Result | `skipped` |
| Failure class | `SCHEDULER_CRASH` (benign — no issue found) |
| Message | `No recoverable issue detected` |
| `escalationLevel` | 0 |
| Duration | 7 ms |

This occurred **after** the round had already terminated on the clock-sync safety block.

`recoveryCount` remained **0** for the entire selection window (52 poll samples).

---

## 3. Progress states (sampled every 10 s)

| Metric | Value |
|--------|-------|
| Total samples | 52 |
| `ACTIVE_PROGRESS` | 52 (100%) |
| `HEARTBEAT_ONLY` | 0 |
| `POSSIBLY_HUNG` | 0 |
| `STALLED` | 0 |
| `FAILED` | 0 |
| Dominant `reasonCode` | `PROGRESS_ADVANCING` |

Representative mid-selection sample (16:21:02 UTC):

| Field | Value |
|-------|-------|
| `runState` | `tariyor` |
| `step` | `AI_ANALYSIS` |
| `elapsedMs` | 314,966 |
| `selectionBudgetMs` | 1,200,000 |
| `heartbeatAt` | `2026-08-14T16:20:12.234Z` |
| `lastProgressAt` | `2026-08-14T16:20:05.383Z` |
| `aiProcessed` / `aiTotal` | 0 / 79 (batch in flight) |
| `progressState` | `ACTIVE_PROGRESS` |
| `recoveryCount` | 0 |

Late selection sample at pump wait (16:16:07 → 16:16:27): step stuck on `PUMP_SCAN` with frozen `elapsedMs=68` while live scan blocked — still assessed as `ACTIVE_PROGRESS` / `PROGRESS_ADVANCING` (within pump timeout grace). **No recovery restart fired**; selection retried normally after pump timeout.

---

## 4. Recovery decisions

| Source | `RESTART_CURRENT_STAGE` | Other decisions |
|--------|-------------------------|-----------------|
| In-memory telemetry (`recoverySnapshots`) | **0** | — |
| DB recovery timeline | **0** | 1 × `NO_ACTION` (post-round) |
| Round `failReason` | **No** — clock sync safety | — |
| Artifact `recovery-decisions.json` | **Missing** | — |

`prematureRestartDetected`: **false**

---

## 5. Did `RESTART_CURRENT_STAGE` occur?

**No.**

- `restartOccurred`: false  
- No log line containing `Recovery restart current stage`  
- No `cancelRoundSelection` driven by recovery during selection  
- Contrast with pre-fix 5-round run (`cmst21ldd0007unbgm1ngckq6`): all 5 rounds failed at ~3.8–4.9 min with exactly that fail reason while AI was active.

---

## 6. Why it did not occur (and what ended the round instead)

**Recovery fix behavior observed:**

1. Progress-aware assessment kept state at `ACTIVE_PROGRESS` while heartbeats and AI counters moved.
2. `recoveryCount` was **not** inflated on benign watchdog ticks (stayed 0).
3. Pump scan timeout triggered a **normal selection retry** inside `selectionBudgetMs`, not a recovery cancel.
4. Selection completed, symbol chosen, execution phase entered.

**Actual terminal cause:** pre-trade API health validation rejected the order:

```
Clock synchronization failed (skew 254663ms), API latency exceeds threshold (3275ms)
```

This is an infrastructure/safety gate — outside scheduler recovery scope. The round legitimately reached execution entry before failing.

---

## 7. Selection budget behavior

| Parameter | Value |
|-----------|-------|
| `selectionBudgetMs` (configured) | **1,200,000** (20 min) |
| Max `elapsedMs` during selection | **541,570** (~9.0 min, **45%** of budget) |
| Budget exhausted? | **No** |
| Recovery restart before budget? | **No** |
| Selection retries after pump timeout | **Yes** (loops #2 and #3) |
| Final selection outcome | `ROBOTRY` via scanner exploration accept |

Budget semantics matched intent: selection was allowed to run until a symbol was chosen, without watchdog killing healthy AI work at ~4 minutes.

---

## 8. Execution reached or not?

| Milestone | Reached? |
|-----------|----------|
| Scanner phase | **Yes** — real Binance TR scan, 79 AI candidates |
| AI consensus phase | **Yes** — remote providers invoked |
| Symbol selected | **Yes** — `ROBOTRY` |
| Execution phase (`coin_secildi` / `EXECUTING`) | **Yes** |
| Order submitted | **Attempted** — MARKET BUY blocked by safety |
| Fill / open position | **No** |
| Zero-trade terminal without execution attempt | N/A — execution was attempted |

Script flag `executionReached: false` reflects strict state checks (`alim_yapildi`, fills, etc.), not the fact that the orchestrator entered order submit. Forensic log confirms execution pipeline activation at 16:24:12 UTC.

---

## 9. Artifact / DB consistency

| Check | Result |
|-------|--------|
| Round terminal (`endedAt` set, terminal state) | **PASS** — `tur_basarisiz`, ended `16:24:12.842Z` |
| Stale `tariyor` runs | **PASS** — `zombieCount=0` |
| Zombie worker / stale lock | **PASS** — job `COMPLETED`, no open runs |
| `scanner-summary.json` | **Present** |
| `ai-progress.json` | **Present** — `total=79`, partial candidate records |
| `round-summary.json` | **Missing** — export not written for this failure path |
| `recovery-decisions.json` | **Missing** |
| `recovery-telemetry.json` | **Missing** |
| DB `failReason` vs runtime | **Consistent** — clock sync safety message |
| Preflight artifact | **Present** — `artifacts/forensics/cmst5e8830007und066nb9se1/preflight.json` |

**Note:** Failed-round partial export (`exportKind: failed-round-partial`) was expected per P0 fix but did not land on disk for this session. `failRound()` calls `exportRoundForensicArtifacts()` with `.catch(() => null)` — failure was silent. This does **not** invalidate the scheduler recovery fix but is a follow-up artifact gap for execution-phase safety failures.

---

## 10. Comparison to pre-fix baseline

| Signal | Pre-fix (5-round session) | Post-fix (this run) |
|--------|----------------------------|---------------------|
| Selection duration before kill | ~230–295 s | **541 s** to symbol pick |
| Fail reason during selection | `Recovery restart current stage` | **None** |
| `RESTART_CURRENT_STAGE` | Yes (all 5 rounds) | **No** |
| Reached execution | No | **Yes** (blocked at safety) |
| `recoveryCount` during AI | Escalated to restart | **0** |
| `progressState` during AI | Not respected | **`ACTIVE_PROGRESS`** throughout |

---

## 11. Final PASS / FAIL

### Scheduler recovery validation: **PASS**

Criteria from validation brief:

- Healthy progress (`ACTIVE_PROGRESS`) during scanner/AI — **met**
- No immediate `RESTART_CURRENT_STAGE` while work advancing — **met**
- Round reached execution (or legitimate terminal zero-trade) — **met** (execution entered; safety block is legitimate)
- No stale `tariyor` / zombie worker / stale lock — **met**

### Ancillary (non-blocking for this test)

- Failed-round forensic export incomplete — document for follow-up
- Clock skew (~255 s) should be corrected on host before live trading validation

---

## Artifacts index

```
artifacts/forensics/cmst5e8830007und066nb9se1/
  preflight.json
  rounds/1/
    scanner-summary.json
    ai-progress.json
kripto-single-round-recovery-validation.json
artifacts/forensics/single-round-recovery-run.log
```
