# KRIPTO — 5 Round × 20 Minute Full Stress Paper Validation (FINAL)

**Validation ID:** `5round-stress-2026-08-14T20-10-22-596Z`  
**Session ID:** `cmstdt3ww0007uncgmjwgvf6p`  
**Started:** 2026-08-14T20:10:25Z  
**Completed:** 2026-08-14T20:31:53Z  
**Duration:** ~21.5 minutes (validation window)  
**Production readiness:** **NOT_READY**

---

## Executive Summary

Preflight passed (READY). One of five requested rounds executed before the job entered terminal `FAILED`. Round 1 ran ~21.4 minutes under REAL_SCANNER + REAL_AI + VETO, processed 34 AI candidates with no orders, no VETO bypass, no `STARTED` orphans, and no premature recovery restarts. Forensic export for round 1 was complete (35 artifacts).

**Blockers:** (1) only **1/5** rounds completed, (2) **38× `Maximum call stack size exceeded`** during AI evaluation, (3) round ended on `PUMP_SCAN_FAILED` / selection budget overrun.

---

## 1. Preflight

**Artifact:** [`artifacts/forensics/cmstdt3ww0007uncgmjwgvf6p/preflight.json`](artifacts/forensics/cmstdt3ww0007uncgmjwgvf6p/preflight.json)

| Check | Status | Detail |
|-------|--------|--------|
| Overall | **READY** | `canStart=true` |
| PostgreSQL / Prisma | PASS | DB healthy |
| Binance TR | PASS | BTCTRY ticker ok |
| Clock sync | PASS | Skew 59ms, latency 177ms |
| REAL_AI | PASS | 3 providers configured |
| Emergency stop | PASS | Inactive |
| Active jobs | PASS | No duplicate RUNNING job |
| Worker | PASS | Fresh worker restarted before run |

**Config:** PAPER · BINANCE_TR · REAL_SCANNER · REAL_AI · `EXECUTION_AI_GATE_POLICY=VETO` · selectionBudgetMs=1,200,000

---

## 2. Round-by-round results

| Round | Duration | Outcome class | Candidates | TDI appr/wait | Sizing +/- | Exec ready | AI (remote) | Risk +/- | Orders | Fills | Exits | Gross | Fees | Net | Recovery | Terminal | Fail reason |
|-------|----------|---------------|------------|---------------|------------|------------|-------------|----------|--------|-------|-------|-------|------|-----|----------|----------|-------------|
| **1** | 21.38 min | LEGITIMATE_ZERO_TRADE | 38 | 0 / 14 | 0 / 0 | 0 | 17 (79 remote calls) | 0 / 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 0 | tur_basarisiz | PUMP_SCAN_FAILED (90s timer) |
| 2 | — | **NOT RUN** | — | — | — | — | — | — | — | — | — | — | — | — | — | — | Job FAILED after R1 |
| 3 | — | **NOT RUN** | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| 4 | — | **NOT RUN** | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| 5 | — | **NOT RUN** | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |

**Job:** `FAILED` · completedRounds=0 · failedRounds=1 · lastError=`PUMP_SCAN_FAILED: resolveLiveTopGainerPumpCandidates exceeded 90000ms (timer)`

Round 1 pipeline executed scanner → pump → full scan → AI batch (83 scope, 34 processed) → TDI WAIT (14 NEUTRAL) → zero trades under VETO.

---

## 3. Scheduler stress

| Metric | Value |
|--------|-------|
| Progress samples | 83 |
| Progress states | ACTIVE_PROGRESS: 82 · FAILED: 1 |
| RESTART_CURRENT_STAGE | **0** |
| Premature restart on healthy progress | **NO** |
| Recovery snapshots | 0 |
| Selection budget (R1) | 1,200,000 ms configured · 1,283,351 ms elapsed at terminal |
| AI cancellation events | 0 AI_TIMEOUT (no hung STARTED orphans) |

Healthy progress (`PROGRESS_ADVANCING`) persisted through scanner and AI phases. Final poll recorded `SELECTION_BUDGET_EXCEEDED` progress state before terminal failure.

---

## 4. AI reliability

| Metric | Round 1 |
|--------|---------|
| AI batch scope | 83 |
| Processed | 34 |
| Success | 17 |
| Failed | 17 |
| AI_TIMEOUT | 0 |
| Degraded calls | 23 |
| Remote verified calls | 79 (`remote=true`, aggregate from ai-trace) |
| Orphan STARTED (>180s) | **0** |
| Stack overflow failures | **38** (errors.json) |

All in-flight candidates in `ai-progress.json` terminalized (`COMPLETED` or failed); no indefinite `STARTED`. **New defect:** recurrent `Maximum call stack size exceeded` under concurrent AI load (FILTRY, FORMTRY, DYMTRY, BABYTRY, …).

---

## 5. AI VETO

| Verdict | Orders created |
|---------|----------------|
| NO_TRADE | 0 |
| HOLD | 0 |
| REJECT | 0 |
| WAIT | 0 |

**CRITICAL_AI_EXECUTION_BYPASS:** not observed. VETO gate held — zero orders across round 1.

---

## 6. Clock / API

| Metric | Preflight | Per-round forensics |
|--------|-----------|---------------------|
| clockSkewMs | 59 | Not exported (clock-sync-forensics.json missing R1) |
| apiLatencyMs | 177 | — |
| Safety blocks | 0 | — |
| Endpoint | `https://www.binance.tr/api/v3/time` | — |

Clock safe at preflight. Binance network cooldown/fallback events observed during scanner (bounded, recovered).

---

## 7. Exit

| Exit type | Count |
|-----------|-------|
| TAKE_PROFIT | 0 |
| STOP_LOSS | 0 |
| STRATEGY_EXIT | 0 |
| TIME_EXIT | 0 |
| END_OF_REPLAY | 0 |

**EXIT_EDGE_NOT_PROVEN** — no positions opened.

---

## 8. Fees / PnL

| Gross | Fees | Net | Reconciliation |
|-------|------|-----|----------------|
| 0 | 0 | 0 | PASS (no trades) |

**CRITICAL_PNL_RECONCILIATION_FAILURE:** not triggered (zero trades).

**Profitability classification:** NOT_PROVEN

---

## 9. P1/P2 forensics

| Area | Round 1 |
|------|---------|
| Mean reversion audit | 0 entries (audit shell complete) |
| Scanner NOT_DISCOVERED | 0 qualification rejections logged |
| EV calibration | Present (no trades) |
| Entry timing | 0 records |
| TDI WAIT | 14 × `NEUTRAL` (waitReasonCode present) |
| Slot opportunity | 3 rows |
| Fee-aware entry | 0 evaluations |

P2 TDI WAIT reason codes populated correctly. No execution-ready candidates reached fee-aware entry stage.

---

## 10. Runtime health

| Check | Result |
|-------|--------|
| Worker | Restarted fresh before run |
| DB | Healthy throughout |
| Recovery events | 0 RESTART_CURRENT_STAGE |
| Watchdog | 28 NO_ACTION audits |
| Zombie rounds | 0 |
| Stale locks | None at job end |
| Runner DB disconnect | No |

---

## 11. Runtime ↔ Artifact ↔ DB

| Comparison | Status |
|------------|--------|
| Trade-level (entry/exit/fees) | **SKIPPED** — zero trades |
| Failed round R1 | **AGREE** — failReason, terminalState (`tur_basarisiz`), endedAt aligned |

---

## 12. Failures / warnings

### Critical

1. **INCOMPLETE_STRESS_RUN** — 1/5 rounds only; engine terminated job after round 1 failure.
2. **AI_STACK_OVERFLOW** — 38× `Maximum call stack size exceeded` during AI evaluation.

### Warnings

- Selection budget exceeded on round 1 (1,283s vs 1,200s budget).
- Pump scan 90s timer failure at terminal.
- Clock forensics artifact missing for round 1.
- EXIT_EDGE_NOT_PROVEN (expected with zero trades).

### Passed safety gates

- No AI VETO bypass · No PnL mismatch · No DB/artifact contradiction · No zombie RUNNING · No STARTED orphans · No premature recovery restart

---

## 13. Remaining blockers

1. Auto-round job does not continue to rounds 2–5 after round 1 bounded failure — full 5-round stress not achievable without engine behavior review.
2. AI stack overflow under load — must be root-caused and fixed before re-run.
3. Pump scan 90s timeout recurring at round end (same class as prior validations).
4. No trade execution path exercised — fill, exit, PnL ledger, and trade-level DB reconciliation untested this run.

---

## 14. Final production readiness

### Verdict: **NOT_READY**

| Criterion | Result |
|-----------|--------|
| 5 rounds terminal | **FAIL** (1/5) |
| No AI VETO bypass | PASS |
| No clock bypass | PASS (preflight) |
| No PnL mismatch | PASS |
| No runtime/artifact/DB contradiction | PASS (failed-round) |
| No zombie rounds | PASS |
| No indefinite AI STARTED | PASS |
| No indefinite RUNNING round | PASS |
| Scheduler recovery stable | PASS |
| Cancellation propagation | PASS (no orphans; no AI_TIMEOUT exercised) |
| Forensic exports | PASS (round 1 complete) |
| No new P0 reliability defect | **FAIL** (stack overflow) |

**CONDITIONAL_READY** and **READY** are not applicable until a complete 5-round session succeeds and the AI stack overflow is resolved.

---

## Artifacts

| File | Description |
|------|-------------|
| [`kripto-5round-stress-validation-final.json`](kripto-5round-stress-validation-final.json) | Machine-readable result |
| [`artifacts/forensics/cmstdt3ww0007uncgmjwgvf6p/`](artifacts/forensics/cmstdt3ww0007uncgmjwgvf6p/) | Session forensic bundle |
| [`artifacts/5round-stress-validation-live.log`](artifacts/5round-stress-validation-live.log) | Live runner log |

**Runner:** `npx tsx scripts/run-5round-stress-validation.ts`
