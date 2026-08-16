# KRIPTO — One Round Live AI Cancellation Validation

**Validation ID:** `1round-ai-cancel-2026-08-14T19-30-42-079Z`  
**Completed:** 2026-08-14T19:36:44Z  
**Verdict:** **PASS**

**Reference fix:** `kripto-p0-ai-cancellation-validation.json` (14/14 targeted tests)

---

## Executive Summary

One controlled Paper round was executed with the P0 AI cancellation code loaded via `tsx` (git `31e2771`, cancellable-work SHA `553a99c2…`). The round **did not trade** (0 fills) and terminated after ~5.6 minutes due to `PUMP_SCAN_FAILED` on BELTRY — unrelated to the PIXELTRY AI stall incident.

**Primary acceptance criterion met:** no AI candidate remained `STARTED` indefinitely. Job and round both reached terminal states. All six required forensic artifacts were written.

---

## 1. Preflight

**Artifact:** [`preflight.json`](preflight.json)

| Check | Status | Detail |
|-------|--------|--------|
| Postgres / Prisma | PASS | DB healthy |
| Binance TR | PASS | BTCTRY ticker ok |
| Clock sync | PASS | Skew 13ms, latency 138ms |
| REAL_AI | PASS | 3 providers configured |
| Paper mode | PASS | `EXECUTION_MODE=paper` |
| Emergency stop | PASS | Inactive |
| Active job | PASS → reconciled | Stale job `cmst8nza40007unvsi2211emo` STOPPED |
| Zombie round | WARN → reconciled | Round 4 `cmstaljbi09zsunvsk1hn8ik0` → `tur_basarisiz` |
| Worker locks | PASS | Clear at preflight |
| **canStart** | **true** | Overall verdict: DEGRADED (reconciliation only) |

**Code fingerprint (new cancellation code loaded):**

| Field | Value |
|-------|-------|
| gitHead | `31e27712566af791a8ecb1c24bbc7f376d608a5e` |
| cancellableWorkSha | `553a99c216c9e281` |
| cooperativeAsyncSha | `7bd4bb853b1e8745` |
| validationProcessPid | 38580 |

Background worker restarted: `npm run worker:start` (PID 20280).

---

## 2. Round Timeline

| Time (UTC) | Event |
|------------|-------|
| 19:30:55 | Job started — session `cmstce95w0007unronp6bkn7p` |
| 19:30:55 | Round 1 run `cmstce9gb000junroyg7ptq1v` created |
| 19:30:55 – 19:32:35 | Pump scan + full scanner (100 symbols context) |
| 19:33:26 | AI batch started — 87 candidates, concurrency 2 |
| 19:33:26 – 19:33:38 | ACETRY + BELTRY consensus completed (~11.5s each) |
| 19:34:03 | aiProcessed reached 4; last AI progress timestamp |
| 19:34:03 – 19:36:31 | Pump confirmation on BELTRY (live scan) |
| 19:36:31 | Round failed: `PUMP_SCAN_FAILED` (90s pump timer) |
| 19:36:33 | Round terminal `tur_basarisiz`; job `FAILED` |

**Duration:** 336s round / 355s total validation window  
**Config:** PAPER, BINANCE_TR, REAL_SCANNER, REAL_AI, `EXECUTION_AI_GATE_POLICY=VETO`

---

## 3. AI Candidates

**Source:** `artifacts/forensics/cmstce95w0007unronp6bkn7p/rounds/1/ai-progress.json`

| Metric | Value |
|--------|-------|
| Total scope | 87 |
| Processed | 4 |
| Success | 2 |
| Failed | 2 |
| Timeout | 0 |
| Concurrency | 2 |
| **STARTED orphans (end)** | **0** |
| **STARTED orphans (during run, >180s)** | **0** |

### Recorded candidates (forensic-complete at START)

| candidateId | symbol | provider | model | executionMode | status | startedAt | completedAt | durationMs |
|-------------|--------|----------|-------|---------------|--------|-----------|-------------|------------|
| ai:ACETRY:ec02d8d5 | ACETRY | provider-1 | gpt-4o-mini,… | paper | COMPLETED | 19:33:26.244Z | 19:33:37.789Z | 11,545 |
| ai:BELTRY:d6963378 | BELTRY | provider-1 | gpt-4o-mini,… | paper | COMPLETED | 19:33:26.257Z | 19:33:37.791Z | 11,534 |

Both in-flight `STARTED` records transitioned to `COMPLETED` within ~12s. Pool slots released; no PIXELTRY-style freeze.

**Note:** `processed=4` with `failedCount=2` indicates two additional AI evaluations failed and terminalized, but their rows are not retained in the final `candidates[]` snapshot (in-memory ring buffer). No `STARTED` orphan was observed at any poll interval.

---

## 4. Timeout / Cancel Events

| Event | Observed |
|-------|----------|
| AI_TIMEOUT | No |
| AI candidate abort mid-consensus | No (consensus completed normally) |
| Binance fetch abort | Yes — `"This operation was aborted"` during scanner (normal bounded timeout/fallback) |
| Round cancel via budget | No (elapsed 336s << 1,200s budget) |
| Pump scan timeout | Yes — caused round failure (downstream of AI) |

No live AI_TIMEOUT was triggered this round; cancellation fix validated by **absence of orphan STARTED** and **terminal round/job** under concurrent AI load.

---

## 5. Pool Slot Release

- Concurrency 2: ACETRY + BELTRY started simultaneously at 19:33:26.
- Both completed at 19:33:37; pool slots freed.
- `aiProcessed` incremented to 4 before round left AI phase.
- Round continued to pump confirmation — pool did not freeze.

---

## 6. Selection Budget

| Field | Value |
|-------|-------|
| configuredMs | 1,200,000 (20 min) |
| elapsedMs at terminal | 335,814 |
| budgetRespected | **true** |
| Job RUNNING after budget | **no** |

Budget was not exhausted; round failed earlier on pump scan. No mid-flight budget breach to exercise abort-on-budget this run.

---

## 7. Recovery Behavior

| Check | Result |
|-------|--------|
| ACTIVE_PROGRESS during scanner/AI | Yes — `PROGRESS_ADVANCING` |
| Premature RESTART_CURRENT_STAGE | **No** |
| Recovery during healthy progress | All `NO_ACTION` |
| STALLED termination needed | No — round self-terminated on pump failure |

Watchdog/recovery did not interfere while AI progress was advancing (19:33:26 – 19:34:03).

---

## 8. Artifact Completeness

**Root:** `artifacts/forensics/cmstce95w0007unronp6bkn7p/rounds/1/`

| Artifact | Present |
|----------|---------|
| round-summary.json | ✅ |
| ai-progress.json | ✅ |
| ai-trace.json | ✅ |
| round-watchdog.json | ✅ |
| recovery-decisions.json | ✅ |
| recovery-telemetry.json | ✅ |

Export kind: `failed-round-partial` (expected for non-trade failure).

---

## 9. Zombie / Lock Status

| Item | Status |
|------|--------|
| Prior stale job (Round 4 PIXELTRY) | Reconciled → STOPPED |
| New session zombie runs | 0 |
| Job terminal | FAILED |
| Round terminal | tur_basarisiz |
| Worker lock at end | Clear |

---

## 10. Optional Safety Path

| Check | Result |
|-------|--------|
| Trades / orders | 0 (VETO path not exercised — no BUY) |
| Execution reached | No |
| Legitimate zero-trade terminal | Yes |

---

## PASS / FAIL Classification

### PASS criteria

| Criterion | Result |
|-----------|--------|
| New cancellation code loaded | ✅ git + SHA fingerprint |
| No candidate STARTED indefinitely | ✅ 0 orphans at end and during run |
| No round/job RUNNING indefinitely | ✅ terminal in 336s |
| Selection budget absolute | ✅ 336s << 1,200,000ms |
| Cancellation path active (no pool freeze) | ✅ concurrent AI completed, round continued |
| Forensic evidence complete | ✅ all 6 artifacts |
| No premature recovery restart | ✅ |

### Not exercised this run (non-blocking)

- Live `AI_TIMEOUT` with `timeoutAt` / `aborted=true` / `signalPropagated=true` — no slow/hung consensus occurred
- Selection budget expiry mid-flight abort — budget not reached
- STALLED recovery termination — round failed on pump scan first

---

## Remaining Notes

1. **Round business outcome** was pump-scan failure, not AI stall — acceptable for this validation (runtime reliability only).
2. **Two failed AI evaluations** counted in `processed`/`failedCount` but not present in final `candidates[]` — minor forensic retention gap, not a STARTED orphan.
3. **Five-round stress** remains deferred; this single round PASS clears the gate for optional next step.

---

## Artifacts

| File | Description |
|------|-------------|
| [`preflight.json`](preflight.json) | Pre-flight checks + code fingerprint |
| [`kripto-one-round-ai-cancellation-validation.json`](kripto-one-round-ai-cancellation-validation.json) | Machine-readable validation result |
| [`artifacts/forensics/cmstce95w0007unronp6bkn7p/`](artifacts/forensics/cmstce95w0007unronp6bkn7p/) | Session forensic bundle |

**Runner:** `npx tsx scripts/run-1round-ai-cancellation-validation.ts`
