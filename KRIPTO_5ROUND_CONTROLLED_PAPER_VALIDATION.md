# KRIPTO — 5 Round Controlled Paper Validation

**Validation ID:** `5round-2026-08-14T14-41-00-416Z`  
**Session ID:** `cmst21ldd0007unbgm1ngckq6`  
**Run window:** 2026-08-14 14:41 UTC → 15:03 UTC (~22 min total job time)  
**Production readiness:** **NOT_READY**

---

## 1. Preflight

Preflight artifact: `artifacts/forensics/cmst21ldd0007unbgm1ngckq6/preflight.json`

| Check | Result |
|-------|--------|
| PostgreSQL / Prisma | **PASS** — DB healthy, AutoRound schema accessible |
| Binance TR | **PASS** — BTCTRY ticker ok |
| AI providers | **PASS** — 3 enabled (OpenAI ×2, Gemini) |
| Emergency stop | **PASS** — inactive; paper allowed by policy |
| Active jobs | **PASS** — no blocking RUNNING job after reconciliation |
| Zombie rounds | **WARN** — 1 stale round reconciled before start |
| Stale RUNNING job | **WARN** — prior job `cmss20myt…` STOPPED (SCHEDULER_LEASE_STALE) |
| Worker locks | **PASS** — no local scheduler loops at preflight |
| Resolved config | **PASS** — `executionMode=paper`, exchange=binance |
| Simulation Lab Win Rate | **NOT_CHECKED** — not part of current preflight service |

**Overall preflight verdict:** `DEGRADED` (reconciliations only) — **canStart: true**

No safety mechanism was bypassed. Emergency stop did not block paper.

---

## 2. Round-by-round results

| Round | Symbol | State | Duration | Orders | Fills | Net PnL | Fail reason |
|-------|--------|-------|----------|--------|-------|---------|-------------|
| 1 | ACETRY | `tur_basarisiz` | 4.1 min | 0 | 0 | — | Recovery restart current stage |
| 2 | EDUTRY | `tur_basarisiz` | 3.8 min | 0 | 0 | — | Recovery restart current stage |
| 3 | KATTRY | `tur_basarisiz` | 4.4 min | 0 | 0 | — | Recovery restart current stage |
| 4 | SOMITRY | `tur_basarisiz` | 4.9 min | 0 | 0 | — | Recovery restart current stage |
| 5 | AITRY | `tur_basarisiz` | 5.0 min | 0 | 0 | — | Recovery restart current stage |

**Job outcome:** `COMPLETED` with **0 completed / 5 failed** rounds.

Each round reached **scanner + partial AI** (incremental `ai-progress.json` written) but was **terminated by scheduler recovery** before execution. Durations were **under the ~10 min operational ceiling**; rounds were not slow — they were **cancelled**.

### Per-round metrics (aggregate)

| Metric | R1 | R2 | R3 | R4 | R5 |
|--------|----|----|----|----|-----|
| candidateCount (summary) | 0* | 0* | 0* | 0* | 0* |
| AI invoked (ai-progress) | 2 | 2 | 4 | partial | partial |
| TDI approvals | 0 | 0 | 0 | 0 | 0 |
| Orders | 0 | 0 | 0 | 0 | 0 |

\*Full `round-summary.json` not exported on failed rounds.

---

## 3. P0 AI Gate validation

**Policy:** `EXECUTION_AI_GATE_POLICY=VETO` (default, unchanged)

| Check | Result |
|-------|--------|
| Orders created | **0** |
| AI NO_TRADE → order bypass | **None detected** (no orders) |
| Runtime proof of VETO blocking | **NOT_TESTED** — execution path never reached |

**Verdict:** No AI veto bypass occurred, but **VETO semantics were not exercised at runtime** because no candidate reached order submission.

---

## 4. P0 Exit validation

| Check | Result |
|-------|--------|
| Closed positions | **0** |
| Exit reason classification | **NOT_TESTED** |
| REPLAY_WINDOW vs POSITION_MONITOR | **NOT_TESTED** |

**Flag:** `EXIT_EDGE_NOT_PROVEN` — no closes to classify.

---

## 5. P0 Fee validation

| Check | Result |
|-------|--------|
| Executed trades | **0** |
| `netPnL = grossPnL - totalFee` | **NOT_TESTED** |
| Pre-trade fee metrics at gate | **NOT_EXPORTED** |

---

## 6. P1 validation

| Area | Status | Notes |
|------|--------|-------|
| Mean Reversion regime evidence | **NOT_TESTED** | 0 MR trades |
| Scanner NOT_DISCOVERED forensics | **PARTIAL** | `scanner-summary.json` shows qualification rows; full `scanner-qualification.json` not exported |
| EV calibration | **NOT_EXPORTED** | Round failed before export |
| Entry timing | **NOT_EXPORTED** | — |
| Strategy performance | **NOT_EXPORTED** | — |

Scanner **did run** with real Binance TR data. Example (Round 1 `scanner-summary.json`): symbols AIXBTTRY, ACETRY scanned with volume/spread qualification trails.

---

## 7. P2 validation

| Area | Status |
|------|--------|
| TDI `waitReasonCode` distribution | **NOT_EXPORTED** (`tdi-decisions.json` missing) |
| Slot opportunity report | **NOT_EXPORTED** |
| Fee-aware entry policy samples | **NOT_EXPORTED** |
| Strategy A/B / promotion gate | **NOT_EXPORTED** |

---

## 8. Runtime health

| Metric | Value |
|--------|-------|
| Total validation duration | ~22 min |
| Per-round duration | 3.8–5.0 min (under 10 min ceiling) |
| Zombie rounds after job | **0** |
| Job terminal | **Yes** (`COMPLETED`) |
| Round terminal | **Yes** (all 5, but all `tur_basarisiz`) |
| Recovery events | **5** — one per round |
| DB tx timeouts (exported) | **0** (no transaction-duration export on failed rounds) |
| Binance TR | Intermittent auth envelope on `www.binance.tr` public API (cooldown logged); recovered |

### Root cause — repeated round failure

All 5 rounds failed with identical reason:

```
Recovery restart current stage
```

**Mechanism:** `configureSchedulerRecovery` → `RESTART_CURRENT_STAGE` → `cancelRoundSelection(jobId, "Recovery restart current stage")` → `failRound`.

**Timeline pattern (Round 1 example):**
1. Selection attempt 1: scanner + AI analysis (~4 min)
2. Recovery triggers `RESTART_CURRENT_STAGE` at selection attempt 2 during pump-cache
3. Round marked `tur_basarisiz` before execution

This is a **runtime reliability / recovery policy interaction**, not a strategy or threshold change.

---

## 9. Runtime ↔ Artifact ↔ DB consistency

| Layer | Finding |
|-------|---------|
| **Runtime** | 5 rounds started; scanner/AI partial; 0 orders |
| **Artifacts** | Preflight OK; per-round **partial** (`scanner-summary.json`, `ai-progress.json` only); **no** `round-summary.json`, decision/execution/PnL/TDI bundles |
| **Database** | `AutoRoundRun` rows terminal with `failReason=Recovery restart current stage`; `netPnl=null` |

**Trade-level consistency:** **N/A** — zero trades.

**Round-level consistency:** DB fail reasons align with runtime logs. Forensic export **incomplete** because `exportRoundForensicArtifacts` runs on successful round completion path.

---

## 10. Failures / warnings

### Failures (validation objectives not met)

1. **ALL 5 ROUNDS FAILED** — none completed the trading pipeline to execution
2. **INCOMPLETE P0/P1/P2 ARTIFACT BUNDLE** — 15/17 expected per-round files missing on every round
3. **`round-manifest.json` NOT IMPLEMENTED** — file does not exist in codebase
4. **No runtime proof** of AI gate, fee reconciliation, exit classification, TDI wait codes, or slot report at live round end

### Warnings (non-fatal but noted)

- Preflight `DEGRADED` (stale job/zombie reconciled)
- Simulation Lab Win Rate not in preflight checklist
- Binance TR public endpoint auth envelope cooldown during pump live scan

### Critical stop conditions triggered

**None** — no AI bypass, no PnL mismatch, no fake AI detected, no zombie rounds left RUNNING.

---

## 11. Remaining blockers

1. **Fix scheduler recovery vs long AI selection** — recovery must not fail healthy in-progress rounds during legitimate scanner/AI phases (~4–20 min selection budget is `AUTO_ROUND_SELECTION_BUDGET_SEC=1200`)
2. **Re-run 5-round validation** after recovery fix, with worker + scheduler in stable single-process or dedicated worker role
3. **Ensure `exportRoundForensicArtifacts` on failed rounds** (or export partial bundle) for post-mortem when `tur_basarisiz`
4. **Implement or document `round-manifest.json`** if required (`domainSlug`, `isTradingDomain`)
5. **Add Simulation Lab Win Rate to preflight** if required by ops checklist

---

## 12. Production readiness

### Verdict: **NOT_READY**

| Criterion | Met? |
|-----------|------|
| 5/5 rounds terminal | Yes |
| 5/5 rounds **successful** | **No** (0/5) |
| No AI veto bypass | N/A (no orders) |
| Fee reconciliation at runtime | **No** |
| Exit classification at runtime | **No** |
| Full forensic export | **No** |
| No zombie rounds | Yes |
| No runtime/artifact contradiction on trades | N/A |

**NOT_READY** because the controlled validation **did not prove** P0/P1/P2 runtime behavior — rounds were killed by scheduler recovery before execution.

---

## Profitability

| Metric | Value |
|--------|-------|
| Trades | 0 |
| Wins / Losses | 0 / 0 |
| Gross PnL | 0 |
| Fees | 0 |
| Net PnL | 0 |

**PROFITABILITY = NOT_PROVEN** (5-round validation sample; zero trades)

---

## Artifacts

| Path | Description |
|------|-------------|
| `artifacts/forensics/cmst21ldd0007unbgm1ngckq6/preflight.json` | Preflight checks |
| `artifacts/forensics/cmst21ldd0007unbgm1ngckq6/rounds/{1-5}/` | Partial round artifacts |
| `artifacts/forensics/5round-validation-run.log` | Full runtime log |
| `kripto-5round-paper-validation.json` | Machine-readable summary |
| `scripts/run-5round-paper-validation.ts` | Validation runner used |

---

## Recommended next step

Re-run after investigating why `scheduler-recovery.service` emits `RESTART_CURRENT_STAGE` ~4 minutes into round selection when `selectionBudgetMs=1200000` and heartbeats are active. Run from a dedicated worker process (`npm run worker:start`) with the validation script polling only, to avoid recovery fighting an in-process scheduler loop.

**No strategy, threshold, or BrainOS changes were made during this validation.**
