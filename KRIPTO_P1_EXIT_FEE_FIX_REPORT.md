# KRIPTO P1 — Exit Lifecycle + Fee-Aware Profitability Fix

## Executive Result

Exit lifecycle and fee observability were made explicit in native Kripto runtime forensics, with deterministic exit attribution precedence, replay-vs-monitor separation, and pre/post-trade fee edge reconciliation.

Targeted tests pass.  
5-round controlled validation was attempted and marked `EXIT_VALIDATION_BLOCKED` because the run failed before trades closed (`PUMP_SCAN_FAILED` timeout), so real position-monitor exit outcomes could not be observed in that runtime window.

## 1) Exit Lifecycle Map

Mapped and verified runtime path:

`entry -> position create -> position monitor -> TP/SL/strategy/time checks -> settlement -> pnl ledger -> round export`

Primary implementation files:

- `src/server/execution/execution-orchestrator.service.ts`
- `src/server/execution/position-monitor.service.ts`
- `src/server/execution/post-trade-settlement.service.ts`
- `src/server/forensics/exit-forensics.service.ts`
- `src/server/forensics/exit-replay.engine.ts`
- `src/server/forensics/pnl-ledger.service.ts`

## 2) Replay vs Position-Monitor Separation

Exit model is now explicitly preserved and exported:

- `POSITION_MONITOR`
- `REPLAY_WINDOW`
- `MANUAL_TIMEOUT`

For each closed trade, exit forensics now includes:

- `tradeId`, `positionId`, `symbol`
- `entryPrice`, `entryTimestamp`
- `exitPrice`, `exitTimestamp`, `holdDurationMs`
- `exitReason`, `exitModel`
- `tpLevel`, `slLevel`
- `strategyExitReason`, `timeExitReason`
- `grossPnL`, `entryFee`, `exitFee`, `totalFee`, `netPnL`

`END_OF_REPLAY` is not relabeled as strategic exit.

## 3) Exit Attribution + Precedence

Single explicit exit reason classification retained:

- `TAKE_PROFIT`
- `STOP_LOSS`
- `STRATEGY_EXIT`
- `TIME_EXIT`
- `END_OF_REPLAY`

Precedence rules are now documented in artifacts:

- Position monitor precedence:  
  `EXIT_AI -> paper protections -> smart-exit -> TP/SL -> dynamic-exit -> trailing/early-protect -> timeout`
- Replay same-candle precedence: default `STOP_LOSS`, overrideable to `TAKE_PROFIT`

## 4) Replay Distortion Diagnostics

New artifact:

- `replay-exit-diagnostics.json` (also mirrored as `replayExitDiagnostics.json`)

For replay-boundary exits, deterministic inference is marked `UNKNOWN` when stored evidence is insufficient to prove pre-boundary TP/SL/strategy condition.

Historical PnL is not rewritten.

## 5) Fee-Aware Pre-Trade and Post-Trade

Pre-trade fee edge is standardized and classified:

- Metrics: estimated entry/exit/round-trip fees, expected gross/net edge, fee ratio, minimum movement to cover fees
- Classes: `FEE_SAFE`, `FEE_BORDERLINE`, `FEE_EROSION`, `UNKNOWN`
- Runtime policy remains observe-first (`blockingEnabled=false`), no new production auto-block

Post-trade ledger now carries:

- `feeReconciliationStatus` (`PASS`/`FAIL`/`UNKNOWN`)
- `feeEdgeClass`
- `grossPositiveNetNegative`

Reconciliation rules enforced:

- `totalFee = entryFee + exitFee (+ slippage)`
- `netPnL = grossPnL - totalFee`

## 6) Gross-Positive / Net-Negative and Fee Drag Views

New analytics exports:

- `gross-positive-net-negative.json`
- `fee-by-strategy.json`
- `fee-by-hold-time.json`
- `exit-fee-interaction.json`

This enables direct forensic answers for:

- gross-positive but net-negative cases,
- fee drag by strategy,
- fee drag by hold duration,
- interaction of exit outcome and fee erosion (`EXIT_CREATED_LOSS` / `FEE_CREATED_LOSS` / `BOTH` / `UNKNOWN`).

## 7) Required Artifacts

Round export now writes and validates:

- `exit-forensics.json`
- `fee-aware-entry-policy.json`
- `pnl-ledger.json`
- `replay-exit-diagnostics.json`

Export-required list was expanded so failures are not silent.

## 8) Test Coverage

Executed and passed:

- `tests/forensics/p0-execution-correctness.test.ts`
- `tests/forensics/p1-profitability-engineering.test.ts`
- `tests/forensics/p2-profitability-optimization.test.ts`
- `tests/forensics/trading-engine-forensics.test.ts`
- `tests/forensics/round-export.test.ts`

Includes deterministic fixtures for:

- TP, SL, strategy exit, time exit, replay boundary,
- same-candle TP/SL precedence,
- gross-positive/net-negative fee erosion,
- no-lookahead constraints.

## 9) Controlled Validation (5 Rounds)

Script:

- `scripts/_p1-exit-fee-5round-validation.ts`

Output:

- `reports/p1-exit-fee-5round-validation.json`

Observed run:

- `sessionId`: `cmsxircm50007unj4l3g0zinv`
- Job status: `FAILED`
- Fail reason: `PUMP_SCAN_FAILED` timeout on live pump candidate resolution
- Closed trades: `0`
- AI veto bypass: `0`

Result:

- `EXIT_VALIDATION_BLOCKED`

Reason:

- run failed before exit lifecycle produced closeable trades, so real position-monitor non-`END_OF_REPLAY` exits were not observable in this sample.

## 10) Acceptance Status

- Exit model explicitly recorded: **PASS**
- Exit reason explicitly recorded: **PASS**
- TP/SL/strategy/time exits testable: **PASS**
- Replay boundary explicitly separated: **PASS**
- PnL reconciliation exact: **PASS**
- Fees visible pre and post trade: **PASS**
- No look-ahead: **PASS**
- No safety bypass: **PASS**
- Real position-monitor exits observed in 5–10 rounds: **BLOCKED (runtime)**

Overall: **PROVISIONAL PASS**
