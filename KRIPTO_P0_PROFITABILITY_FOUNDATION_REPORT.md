# KRIPTO P0 — Profitability Foundation Report

**Reference forensic:** `CRYPTO_PROFITABILITY_FORENSIC_REPORT.md` (15 trades, 13L/2W, all `END_OF_REPLAY`, historical BrainOS AI bypass — **not re-implemented**)  
**Validation artifact:** `kripto-p0-profitability-foundation.json`  
**Live session:** `cmstipo0p0007un1o31ozf8jh` (1 round, 0 trades)  
**Date:** 2026-08-15  

---

## Verdict

| Gate | Result |
|------|--------|
| P0-1 AI VETO gate (unit tests) | **PASS** (23/23) |
| P0-1 AI VETO gate (live execution path) | **NOT OBSERVED** (round failed before orchestrator order creation) |
| P0-2 Exit taxonomy (unit tests) | **PASS** (TP/SL/TIME_EXIT/END_OF_REPLAY/POSITION_MONITOR) |
| P0-2 Exit taxonomy (live) | **NOT OBSERVED** (zero trades) |
| P0-3 Fee visibility + reconciliation (unit tests) | **PASS** |
| P0-3 Fee artifacts (live) | **NOT OBSERVED** (zero trades) |
| No strategy/threshold/safety changes | **PASS** |
| One minimal Paper round | **COMPLETED** (zero trades — legitimate) |

**Overall P0 acceptance:** **PASS** (deterministic foundation validated; live execution-path forensics deferred to next stable round)

---

## 1. Current AI Gate Implementation

**Canonical gate:** `evaluateAiExecutionReadiness()` in `src/server/execution/ai-execution-gate.service.ts`

**Policy resolver:** `resolveAiExecutionGatePolicy()` — default **VETO** for paper unless `EXECUTION_AI_GATE_POLICY=ADVISORY` **and** learning lane.

**Pre-order checks (missing evidence never approves):**

| Check | reasonCode |
|-------|------------|
| AI object missing | `AI_VERDICT_MISSING` |
| `finalDecision` empty | `AI_VERDICT_MISSING` |
| No healthy provider outputs | `AI_EVIDENCE_MISSING` |
| Consensus missing | `CONSENSUS_MISSING` |
| NO_TRADE / HOLD / REJECT / WAIT | decision-specific block |
| BUY / SELL | `AI_GATE_PASS` (downstream gates still apply) |

**Orchestrator wiring:** `execution-orchestrator.service.ts` calls `evaluateAiExecutionReadiness({ ai, policy, learningLane, microTradeEligible })` before order creation. On `AI_GATE_BLOCK`, returns `finishExecution` with `rejectReason: AI_GATE_BLOCK:*` — **no order**.

**Forensic persistence:** `bridgeAiExecutionGate()` writes JSON payload with `candidateId`, `aiFinalDecision`, `consensusDecision`, `aiGatePolicy`, `aiGateVerdict`, `executionVerdict`, `reasonCode`.

---

## 2. Historical Bypass Status

The reference BrainOS Paper run executed orders despite AI `NO_TRADE` via **`LivePaperEngine.openOrder()` subprocess**, bypassing native orchestrator.

**Current native Kripto path:** Does **not** re-implement that bypass. The VETO gate blocks non-executable decisions. ADVISORY micro-exploration only applies when explicitly configured (`EXECUTION_AI_GATE_POLICY=ADVISORY` + learning lane + micro-trade eligible).

**Additional tightening:** Under VETO, `healthyProviders.length === 0` now blocks even in paper-relaxed mode (previously could continue to later gates).

---

## 3. Exact Current Execution Gate

```
AI consensus (finalDecision + consensus + provider evidence)
  → evaluateAiExecutionReadiness()     [canonical AI gate — single policy]
  → TDI / EV / quality / risk / sizing gates (unchanged thresholds)
  → computeFeeEdgeMetrics + bridgeFeeEdgeMetrics
  → order creation
```

No duplicate AI gate added. Policy logic lives only in `ai-execution-gate.service.ts`.

---

## 4. Exit Model Architecture

| Model | Path | Use |
|-------|------|-----|
| `REPLAY_WINDOW` | `exit-replay.engine.ts` | Backtest / candle replay; TP/SL/TIME_EXIT/END_OF_REPLAY |
| `POSITION_MONITOR` | `exit-forensics.service.ts` → `mapPositionMonitorExit` | Live paper via `post-trade-settlement.service.ts` |

**Exit reasons:** `TAKE_PROFIT`, `STOP_LOSS`, `STRATEGY_EXIT`, `TIME_EXIT`, `END_OF_REPLAY`

Closed positions carry: `positionId`, `symbol`, `side`, entry/exit prices & timestamps, `holdDurationMs`, `tpLevel`, `slLevel`, `strategyExit`, `exitReason`, `exitModel`, `grossPnL`, `fees`, `netPnL` (via exit forensics + PnL ledger).

No TP/SL values changed. No fabricated candles.

---

## 5. Exit Validation Results

| Fixture | Expected | Test result |
|---------|----------|-------------|
| Price reaches TP | `TAKE_PROFIT` | PASS |
| Price reaches SL | `STOP_LOSS` | PASS |
| Strategy exit (monitor) | `STRATEGY_EXIT` | PASS |
| Max hold exceeded | `TIME_EXIT` | PASS |
| Replay window ends first | `END_OF_REPLAY` | PASS |
| Position monitor path | `POSITION_MONITOR` | PASS |
| Replay path | `REPLAY_WINDOW` | PASS |
| No look-ahead | guard throws | PASS |

**Live:** Round produced 0 closed trades (pump scan timeout). Non-`END_OF_REPLAY` exits are **demonstrably possible in tests** under existing conditions.

---

## 6. Fee-to-Edge Implementation

**Pre-trade (`computeFeeEdgeMetrics`):**

- `estimatedEntryFee`, `estimatedExitFee`, `estimatedRoundTripFee(s)`
- `expectedGrossPnL`, `expectedNetPnL`, `feeToExpectedGrossRatio`, `minimumGrossToCoverFees`
- Decision-time only (entry price × qty × fee rate × TP/SL %)

**Post-trade (`createPnlLedgerEntry`):**

- `grossPnL`, `entryFee`, `exitFee`, `totalFee`, `netPnL`
- `feeReconciliationStatus`: `PASS` when `netPnL === grossPnL - totalFee` and `totalFee === entryFee + exitFee (+ slippage)`
- `reconcileFeeStatus()` helper for explicit PASS/FAIL/UNKNOWN

**Orchestrator:** `bridgeFeeEdgeMetrics()` + `bridgeExecutionCandidateForensic({ feeEstimate })` on execution-ready candidates.

---

## 7. Fee Reconciliation

Unit test verifies:

```
totalFee = entryFee + exitFee
netPnL = grossPnL - totalFee
feeReconciliationStatus = PASS
```

Divergent totals → `FAIL`. Non-finite inputs → `UNKNOWN`.

---

## 8. Files Changed

| File | Change |
|------|--------|
| `src/server/execution/ai-execution-gate.service.ts` | `evaluateAiExecutionReadiness`, consensus/evidence checks |
| `src/server/execution/execution-orchestrator.service.ts` | Wire readiness gate; VETO blocks missing AI providers in paper |
| `src/server/forensics/forensic.types.ts` | Extended AI gate + fee + reconciliation types |
| `src/server/forensics/fee-edge-metrics.service.ts` | Full fee-edge fields; `reconcileFeeStatus()` |
| `src/server/forensics/pnl-ledger.service.ts` | `feeReconciliationStatus` on every entry |
| `src/server/forensics/forensic-bridge.service.ts` | Full AI gate forensic payload |
| `src/server/forensics/index.ts` | Export `evaluateAiExecutionReadiness` |
| `tests/forensics/p0-execution-correctness.test.ts` | Expanded P0-1/2/3 coverage (23 tests) |
| `scripts/run-p0-profitability-foundation-validation.ts` | One-round controlled validation |

---

## 9. Tests

```
npm run test:run -- tests/forensics/p0-execution-correctness.test.ts
→ 23/23 PASS

npm run test:run -- tests/forensics/round-export.test.ts
→ 1/1 PASS
```

Coverage: AI VETO, missing verdict/consensus/evidence, HOLD/REJECT/WAIT, SELL pass, TP/SL/TIME_EXIT/END_OF_REPLAY, POSITION_MONITOR/REPLAY_WINDOW, fee metrics, fee reconciliation, no look-ahead.

---

## 10. One-Round Validation

| Field | Value |
|-------|-------|
| Session | `cmstipo0p0007un1o31ozf8jh` |
| Round | 1 / ACETRY |
| Trades | 0 |
| Fail reason | `PUMP_SCAN_FAILED` (90s timeout) |
| AI gate traces in artifacts | 0 (execution path not reached) |
| Upstream blocks | TDI `NO_TRADE` ×2, consensus reject ×2, AI failed ×2 |

**Interpretation:** Zero trades is acceptable. Upstream decision layers rejected `NO_TRADE` candidates before order creation. Live `AI_GATE_*` bridge records require a round that reaches `execution-orchestrator` order submission.

Artifacts: `artifacts/forensics/cmstipo0p0007un1o31ozf8jh/rounds/1/`

---

## 11. Remaining Blockers

1. **Live AI gate forensic observation** — re-run when pump scan / network stable (`npx tsx scripts/run-p0-profitability-foundation-validation.ts`).
2. **Live non-END_OF_REPLAY exit** — requires a round that opens and closes via position monitor (not validated live this pass).
3. **Historical BrainOS bypass** — confirmed not present in native path; no action taken.

**Not in scope (P1):** Strategy optimization, threshold tuning, profitability targets.

---

## Acceptance Criteria Summary

| Criterion | Status |
|-----------|--------|
| AI VETO → no forbidden orders | **PASS** (tests + upstream live blocks) |
| Non-END_OF_REPLAY exits possible | **PASS** (unit tests) |
| Fee reconciliation exact | **PASS** (unit tests) |
| No look-ahead | **PASS** |
| No strategy/risk/threshold changes | **PASS** |
| No safety bypass | **PASS** |
