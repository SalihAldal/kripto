# KRIPTO P1 — EXIT LIFECYCLE + FEE EDGE PROFITABILITY REPORT

## 1) Exit lifecycle root cause

Native Kripto paper runtime closes positions through `position-monitor -> settleOpenPosition -> mapPositionMonitorExit -> bridgeClosedTradePnl -> pnl-ledger`.

Historical `END_OF_REPLAY` dominance came from replay-window exit attribution path, not from the native monitor settlement path. In current native runtime, `END_OF_REPLAY` is replay-forensics specific and is not produced by the position-monitor settlement path.

## 2) Why previous exits were `END_OF_REPLAY`

First architectural cause: historical runs were evaluated with replay-window attribution (`REPLAY_WINDOW`) where positions were closed at replay boundary. That produced `END_OF_REPLAY` even when native monitor-runtime evidence was not exercised in the same way.

## 3) Position monitor status

- `startAutoRoundJob` now restores monitor state with `ensureOpenPositionMonitors(user.id)` at job start.
- This prevents monitor loss after process/job restarts and keeps open paper positions eligible for TP/SL/strategy/time checks.

## 4) Exit precedence

Exported explicitly via `exit-forensics.json` as `exitPrecedence`:

- Position monitor: `EXIT_AI -> PAPER_PROTECTIONS -> SMART_EXIT -> TP/SL -> DYNAMIC_EXIT -> TRAILING/EARLY_PROTECT -> TIMEOUT`
- Replay window: `SAME_CANDLE: STOP_LOSS (default), then STOP_LOSS, then TAKE_PROFIT, then TIME_EXIT/END_OF_REPLAY`

## 5) Historical replay diagnostics

`replay-exit-diagnostics.json` now uses deterministic tri-state values:

- `TRUE`
- `FALSE`
- `UNKNOWN`

No historical trade outcome is rewritten.

## 6) Fee reconciliation

Reconciliation remains explicit and unchanged:

- `totalFee = entryFee + exitFee (+ slippage if present)`
- `netPnL = grossPnL - totalFee`

Forensic completeness was extended to fallback close paths (`BALANCE_MISMATCH_AUTO_CLOSE`, `DUST_AUTO_CLOSE`) so these no longer skip `bridgeClosedTradePnl`.

## 7) Gross-positive / net-negative analysis

Known historical evidence (50-round set):

- Gross PnL: `-0.33651532`
- Fees: `5.09837823`
- Net PnL: `-5.43489355`
- Gross-positive + net-negative trades: `11`

This is fee-dominant behavior in that sample.

## 8) Fee impact by strategy

No new trade sample was produced in this 1-round acceptance run, so strategy-level deltas are unchanged from existing historical artifacts (`fee-by-strategy.json`).

## 9) Fee impact by hold time

No new closed trade in this 1-round run; hold-time fee distribution remains unchanged from existing exported artifacts (`fee-by-hold-time.json`).

## 10) Entry + fee interaction

The fee-edge snapshot now exposes explicit decision-time aliases:

- `expectedGrossEdge`
- `expectedNetEdge`
- `feeToGrossEdgeRatio`
- `minimumGrossMoveToCoverFees`
- `edgeAfterFees`
- `feeClassification`

These are exported from the same deterministic fee model (no new threshold invention).

## 11) Exit + fee interaction

`exit-fee-interaction.json` classification remains forensic-only:

- `EXIT_CREATED_LOSS`
- `FEE_CREATED_LOSS`
- `BOTH`
- `UNKNOWN`

Runtime execution logic is unchanged by this classification.

## 12) Tests

Executed and passing:

- `tests/execution-settlement.integration.test.ts` (7/7)
- `tests/forensics/p1-profitability-engineering.test.ts` (12/12)
- `tests/forensics/p0-execution-correctness.test.ts` (28/28)

Added regression coverage:

- Forensic bridge assertions on settlement close (`exitReason`, `exitModel`, `positionId`)
- Fallback close forensic coverage (`MANUAL_TIMEOUT` mapping)
- Replay diagnostics tri-state (`TRUE/FALSE/UNKNOWN`)
- Fee-edge alias field presence

## 13) One-round runtime validation

Script:

- `scripts/_p1-exit-fee-1round-validation.ts`

Output:

- `reports/p1-exit-fee-1round-validation.json`

Observed:

- `sessionId`: `cmsxpchd50009un34ekvojvgq`
- job status: `COMPLETED` (1 round attempted, failed by tight filter before execution)
- orders: `0`, closed trades: `0`
- AI bypass: `0`
- fee mismatch: `0`
- artifacts present: `exit-forensics.json`, `replay-exit-diagnostics.json`, `fee-aware-entry-policy.json`, `pnl-ledger.json`

Result:

- `EXIT_RUNTIME_NOT_EXERCISED` (no position opened; no trade was forced)

## 14) Remaining limitations

- This validation window did not produce a live closed position, so TP/SL/STRATEGY/TIME runtime exits were not observed in this sample.
- Strategy-level and hold-time fee impact require a trade-producing controlled sample.

## 15) Recommended next validation

Run another controlled native paper validation (small-round staged), keeping all current safety gates unchanged, and stop at first sample that produces at least one closed trade. Then confirm:

- non-empty `exit-forensics` with explicit `POSITION_MONITOR`/reason evidence
- pre-trade fee-edge rows for execution-ready candidates
- continued `AI bypass = 0` and fee reconciliation pass

---

## Final Objective Answers (Current Evidence)

1. Are losses caused by bad exits? **Partially unresolved in this run** (no closed trade sample).
2. Are losses caused by fees? **Yes in historical sample (fee-dominant).**
3. Are fees destroying positive gross edge? **Yes (historical gross-positive/net-negative cases).**
4. Was `END_OF_REPLAY` hiding true behavior? **Yes in historical replay-window attribution path.**
5. Can Paper exercise real `POSITION_MONITOR` exits? **Architecturally yes; runtime not exercised in this 1-round sample.**
6. Can expected net edge be measured pre-trade? **Yes (explicit deterministic fee-edge metrics exported).**
