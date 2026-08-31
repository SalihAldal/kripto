# KRIPTO P2 — VARIANT_D SHADOW REPLAY REPORT

Generated: 2026-08-22T11:41:27.449Z

## Constraints
- Research/forensics only.
- No new paper runs, no new market data, no production behavior change.

## Manual Timeout Semantic Audit
- Manual-timeout trades: 17
- Semantic class: MISNAMED_SYSTEM_TIMEOUT
- Final semantic label: SYSTEM_TIMEOUT

## Variant D Same-Entry Replay
- Replayed trades: 163
- Invalid pairs: 0
- Net PnL delta: 17.00464466
- Expectancy delta: 0.10432297
- Drawdown delta: 16.82043466

## Manual Timeout Impact (17 trades)
- Baseline net: -10.34190362
- Variant D net: 0.38733100
- Net delta: 10.72923462
- Improved/Worsened/Unchanged: 17/0/0

## Temporal OOS
- OOS expectancy delta: 0.04352356

## Robustness
- Class: ROBUST
- Overall delta: 17.00464466
- Excluding top 3 improvements: 6.84402396
- Non-MR delta: 1.05557447
- Non-LowVol delta: 6.04716441

## Final Verdict
TRADES_REPLAYED = 163
MANUAL_TIMEOUT_TRADES = 17
MANUAL_TIMEOUT_SEMANTICS = SYSTEM_TIMEOUT
VARIANT_D_NET_PNL_DELTA = 17.00464466
VARIANT_D_EXPECTANCY_DELTA = 0.10432297
VARIANT_D_DRAWDOWN_DELTA = 16.82043466
MANUAL_TIMEOUT_NET_DELTA = 10.72923462
OOS_DELTA = 0.04352356
ROBUSTNESS = ROBUST
LOOKAHEAD_FREE = YES
PRODUCTION_COMPONENT_COMPATIBLE = PARTIAL
VARIANT_D_STATUS = PROMISING
FIRST_EXPERIMENT = Run controlled shadow experiment: MANUAL_TIMEOUT semantic split + Variant D precedence replay on same-entry cohorts
PRODUCTION_CHANGE_RECOMMENDED = NO
