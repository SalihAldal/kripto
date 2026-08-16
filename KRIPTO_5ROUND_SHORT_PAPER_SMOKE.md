# KRIPTO — 5 Round Short Paper Smoke

**Validation ID:** `5round-2026-08-14T22-50-18-796Z`  
**Session ID:** `cmstjiruf0007unr8e78nizga`  
**Run window:** 2026-08-14 22:50 UTC → 23:10 UTC (~20.5 min)  
**Runner:** `npx tsx scripts/run-5round-paper-validation.ts` (no code changes)  
**Config:** PAPER · BINANCE_TR · REAL_SCANNER · REAL_AI · `EXECUTION_AI_GATE_POLICY=VETO`

---

## 1. Preflight

Preflight artifact: `artifacts/forensics/cmstjiruf0007unr8e78nizga/preflight.json` (copied to `preflight.json`)

| Check | Result |
|-------|--------|
| PostgreSQL / Prisma | **PASS** |
| Binance TR | **PASS** — BTCTRY ticker ok |
| Clock sync | **PASS** — skew 28 ms, API latency 111 ms |
| AI providers | **PASS** — 3 enabled (OpenAI ×2, Gemini) |
| Emergency stop | **PASS** — inactive; paper allowed |
| Active jobs | **PASS** — no blocking RUNNING job |
| Zombie rounds | **WARN** — 1 stale round reconciled before start |
| Stale RUNNING job | **WARN** — prior job `cmstjckww…` reconciled (SCHEDULER_LEASE_STALE) |
| Worker locks | **PASS** — no local scheduler loops |
| Resolved config | **PASS** — `executionMode=paper`, exchange=binance, maxPositions=3 |

**Overall preflight verdict:** `DEGRADED` — **canStart: true**

No safety mechanism was bypassed. No critical preflight block.

---

## 2. Round-by-round results

**Job outcome:** `STOPPED` after **3 of 5** rounds (`stopRequested=true`). Rounds 4–5 never started.

| Round | Symbol | State | Duration | Candidates | TDI WAIT | AI calls | Orders | Fills | Net PnL | Fail reason |
|-------|--------|-------|----------|------------|----------|----------|--------|-------|---------|-------------|
| 1 | NILTRY | `tur_basarisiz` | 8.7 min | 12 | 7 (NEUTRAL×6, BELOW_THRESHOLD×1) | 8 completed | 0 | 0 | 0 | `AI_GATE_BLOCK: NO_TRADE` |
| 2 | LUNCTRY | `tur_basarisiz` | 8.7 min | 19 | 19 (NEUTRAL×18, BELOW_THRESHOLD×1) | 2 completed | 0 | 0 | 0 | SIM tight filter + quality stack |
| 3 | NILTRY | `tur_basarisiz` | 2.9 min | 4 | 22 (NEUTRAL×21, BELOW_THRESHOLD×1) | 4 completed | 0 | 0 | 0 | `Tur motoru durduruldu` (job stop) |

### Per-round pipeline evidence

| Stage | R1 | R2 | R3 |
|-------|----|----|-----|
| Scanner | **YES** — 12 candidates | **YES** — 19 candidates | **YES** — 4 candidates |
| TDI | **YES** — WAIT taxonomy populated | **YES** | **YES** |
| Remote AI | **YES** — 31 REMOTE calls in ai-trace | **YES** | **YES** |
| Degraded AI | 11 degraded calls (R1) | 21 degraded (R2) | 22 degraded (R3) |
| Sizing | Not reached | Not reached | Not reached |
| Risk | Not reached | Not reached | Not reached |
| Execution-ready | 0 | 0 | 0 |
| Orders | 0 | 0 | 0 |

Round 1 reached the **execution stage** and recorded `AI_GATE_BLOCK` with VETO policy in `decision-trace.json` — upstream consensus/TDI blocked all but one candidate path; final gate blocked NO_TRADE correctly.

Round 2 failed on **scanner/simulation quality filters** before execution; watchdog recorded `FAIL_ROUND`.

Round 3 was **cut short** when the job received `stopRequested=true` (~172 s into selection).

---

## 3. AI gate validation

**Policy:** `EXECUTION_AI_GATE_POLICY=VETO`

| AI verdict class | Orders expected | Orders observed | Status |
|------------------|-----------------|-----------------|--------|
| NO_TRADE | 0 | 0 | **PASS** |
| HOLD | 0 | 0 | **PASS** |
| REJECT | 0 | 0 | **PASS** |
| WAIT | 0 | 0 | **PASS** |

**Runtime VETO proof (Round 1):** `decision-trace.json` stage=`execution`, `executionVerdict=AI_GATE_BLOCK`, `aiGatePolicy=VETO`, `orderVerdict=BLOCKED`.

**Critical flag:** `CRITICAL_AI_EXECUTION_BYPASS` — **NOT TRIGGERED**

**Verdict:** AI VETO respected. No bypass detected.

---

## 4. Exit validation

| Check | Result |
|-------|--------|
| Closed positions | **0** |
| Exit reasons | **NONE** |
| TP / SL / STRATEGY_EXIT / TIME_EXIT | **NOT_TESTED** |

**Flag:** `EXIT_EDGE_NOT_PROVEN` — no closes to classify. This is **informational**, not a safety failure.

---

## 5. Fee reconciliation

| Check | Result |
|-------|--------|
| Executed trades | **0** |
| `netPnL = grossPnL - totalFees` | **NOT_TESTED** (no ledger entries) |
| PnL mismatch | **NONE** |

**Verdict:** Fee reconciliation not exercised; no mismatch detected.

---

## 6. P1/P2 artifact validation

Artifacts exported under `artifacts/forensics/cmstjiruf0007unr8e78nizga/rounds/{1,2,3}/` (53 JSON files per completed round export).

### P1 checks

| Area | Status | Notes |
|------|--------|-------|
| Mean reversion audit | **EXPORTED** | `mean-reversion-audit.json` present; 0 MR entries (no trades) |
| Scanner NOT_DISCOVERED | **EXPORTED** | `not-discovered-analysis.json`, `scanner-qualification.json` |
| EV calibration | **EXPORTED** | `ev-calibration.json` (0 samples — no EV-pass candidates) |
| Entry timing | **EXPORTED** | `entry-timing.json` present |
| Strategy performance | **EXPORTED** | `strategy-performance.json` present |

### P2 checks

| Area | Status | Notes |
|------|--------|-------|
| TDI WAIT taxonomy | **PASS** | NEUTRAL, BELOW_THRESHOLD coded; no missing `waitReasonCode` |
| Slot opportunity report | **EXPORTED** | `slot-opportunity-report.json` — rank, score, next-best, score gap |
| TDI sensitivity | **EXPORTED** | `tdi-sensitivity.json` |
| Fee-aware entry policy | **EXPORTED** | `fee-aware-entry-policy.json` |
| Promotion gate | **EXPORTED** | `p1-promotion-gate.json`, `promotion-gate.json` |

### Required forensic bundle (minimum)

| Artifact | R1 | R2 | R3 |
|----------|----|----|-----|
| round-summary.json | ✓ | ✓ | ✓ |
| ai-progress.json | ✓ | ✓ | ✓ |
| ai-trace.json | ✓ | ✓ | ✓ |
| recovery-decisions.json | ✓ (empty) | ✓ | ✓ |
| recovery-telemetry.json | ✓ | ✓ | ✓ |
| execution-trace.json | ✓ | ✓ | ✓ |
| exit-trace.json | ✓ | ✓ | ✓ |
| pnl-ledger.json | ✓ | ✓ | ✓ |

No `export-error.json` files. All three rounds: `exportStatus=COMPLETED`.

---

## 7. Runtime health

| Metric | Value |
|--------|-------|
| Total validation duration | ~20.5 min |
| Per-round duration | 2.9–8.7 min (within ~5–10 min target band for R1/R2) |
| Rounds terminal | **3 / 5** |
| Job terminal | **STOPPED** (not COMPLETED) |
| Zombie rounds after job | **0** |
| AI STARTED orphans | **None detected** |
| Stale worker locks | **None** |
| Premature RESTART_CURRENT_STAGE | **None** on R1 (recovery-decisions empty); R2 watchdog `FAIL_ROUND` |
| Selection budget | Bounded — R3 `selectionBudgetMs=1200000`, elapsed 172 s at stop |
| Host RAM at start | **~95%** (observed during preflight window) |

### Stop cause (rounds 4–5 not run)

Job metadata shows `stopRequested=true` after round 3. Round 3 fail reason: **`Tur motoru durduruldu`**. Recovery audit logged `SCHEDULER_CRASH` with `NO_ACTION` (no unsafe restart). Exact stop initiator not captured in artifacts; job exited poll loop when status became `STOPPED`.

---

## 8. Runtime ↔ Artifact ↔ DB consistency

| Layer | Finding |
|-------|---------|
| **Runtime** | 3 rounds started; scanner + AI + TDI exercised; 0 orders; job stopped before round 4 |
| **Artifacts** | Full per-round forensic bundles for R1–R3; preflight OK |
| **Database** | `AutoRoundRun` rows terminal for R1–R3; `netPnl=null`; job `failedRounds=3`, `completedRounds=0` |
| **Cross-check** | `NO_TRADES` — no DB/artifact PnL contradiction |

---

## 9. Failures / warnings

| Code | Severity | Detail |
|------|----------|--------|
| `INCOMPLETE_RUN` | **HIGH** | Only 3/5 rounds executed — job STOPPED early |
| `ZOMBIE_ROUNDS_RECONCILED` | WARN | 1 stale round reconciled at preflight |
| `STALE_JOB_RECONCILED` | WARN | Prior RUNNING job reconciled at preflight |
| `EXIT_EDGE_NOT_PROVEN` | INFO | Zero closed positions |
| `EXECUTION_PATH_NOT_EXERCISED` | INFO | No sizing/risk/order/fill path in any round |
| `HIGH_HOST_RAM` | WARN | ~95% RAM at run start — may affect long runs |

**Not triggered:** `CRITICAL_AI_EXECUTION_BYPASS`, `PNL_FEE_MISMATCH`, zombie rounds post-job, indefinite RUNNING round.

---

## 10. Profitability snapshot

| Metric | Value |
|--------|-------|
| Trades | 0 |
| Wins | 0 |
| Losses | 0 |
| grossPnL | 0 |
| fees | 0 |
| netPnL | 0 |
| winRate | N/A |

**Classification:** `PROFITABILITY = NOT_PROVEN`

Zero trades reflect legitimate upstream blocking (TDI WAIT, consensus NO_TRADE, scanner filters, AI VETO) — not forced orders and not a safety bypass.

---

## 11. Final verdict

### **PARTIAL**

| PASS criterion | Result |
|----------------|--------|
| 5 rounds terminal | **FAIL** — 3/5 only |
| No critical safety failure | **PASS** |
| AI VETO respected | **PASS** (runtime proof on R1) |
| No PnL mismatch | **PASS** (N/A — 0 trades) |
| No zombie/orphan | **PASS** |
| Artifacts available | **PASS** (R1–R3 full export) |
| Runtime stable through R3 | **PASS** with early stop |

### What was proven (sanity smoke)

- Scanner, TDI, remote AI, consensus, and forensic export pipeline work end-to-end.
- AI VETO blocks execution with documented `AI_GATE_BLOCK` artifacts.
- No AI execution bypass under VETO.
- P1/P2 research artifacts export correctly on failed rounds.

### What was not proven

- Full 5-round completion.
- Execution, fee tracking on fills, exit models, risk/sizing pass paths.
- Profitability (by design — sample too small and zero trades).

### Recommended follow-up (outside this run)

Re-run remaining 2 rounds in a clean environment (no concurrent dev stop, worker/scheduler isolated, RAM headroom) if a **PASS** verdict on the full 5-round gate is required. Do not change thresholds or safety gates for that rerun.

---

**Machine-readable summary:** `kripto-5round-short-paper-smoke.json`  
**Full runner output:** `kripto-5round-paper-validation.json`
