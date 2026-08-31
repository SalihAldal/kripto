# KRIPTO P2 — EXIT FORENSIC REPLAY REPORT

Generated: 2026-08-22T11:37:15.133Z

## Scope & Constraints
- Research/forensics only.
- No new paper run, no new market data, no production behavior change.

## Canonical Dataset
- Trades analyzed: 173
- Exit-problem trades: 140

## Exit Inventory (Loss Contribution)
- MANUAL_TIMEOUT: count=17, netPnL=-10.341904, expectancy=-0.608347
- STOP_LOSS: count=45, netPnL=-4.826633, expectancy=-0.107259
- STRATEGY_EXIT: count=99, netPnL=-4.324718, expectancy=-0.043684
- TAKE_PROFIT: count=12, netPnL=0.898054, expectancy=0.074838

## Exit Model Loss
- MANUAL_TIMEOUT: count=17, netPnL=-10.341904, expectancy=-0.608347
- POSITION_MONITOR: count=156, netPnL=-8.253298, expectancy=-0.052906

## Replay Distortion vs Position Monitor
- Replay distortion share: 0
- Position-monitor loss share: 0.495411

## Counterfactual Exit Variants
- VARIANT_D: reconstructable=163, dExpectancy=0.10115426, dNetPnL=17.56301183, dDrawdown=17.37880183
- VARIANT_A: reconstructable=163, dExpectancy=0.10072831, dNetPnL=17.49358179, dDrawdown=17.30356421
- VARIANT_C: reconstructable=163, dExpectancy=0.10072831, dNetPnL=17.49358179, dDrawdown=17.30356421
- VARIANT_B: reconstructable=99, dExpectancy=0.06380269, dNetPnL=14.27048318, dDrawdown=14.27048318

## OOS
- OOS supported: PARTIAL

## Best Next Experiment
- VARIANT_D controlled shadow replay (reason-specific exit precedence)

## Report Must Answer
1) Why 121 exit losses: Exit losses are mostly strategy-exit typed closes with negative expectancy under current historical path.
2) Most loss exit reason: MANUAL_TIMEOUT
3) Most loss exit model: MANUAL_TIMEOUT
4) Replay-window distortion share: 0
5) Real position-monitor share: 0.4954112015832297
6) MR+LowVol vs exit: Negative pattern remains strongly linked to Mean Reversion + Low Volatility, but exit timing behavior (strategy/time close profile) explains most realized losses.
7) Early or late exits: EARLY_EXIT
8) Best existing exit policy replay: VARIANT_D
9) Any net expectancy improvement: YES
10) OOS improvement: PARTIAL
11) Drawdown improvement without risk: YES_OR_NEUTRAL
12) Concentrated effect?: ROBUST
13) Single next exit experiment: VARIANT_D controlled shadow replay (reason-specific exit precedence)
14) What should not change: Do not change TDI/AI/strategy/risk/sizing/SL-TP in production based on this forensic-only result.

## Final Verdict
TRADES_ANALYZED = 173
EXIT_PROBLEM_TRADES = 140
PRIMARY_EXIT_LOSS_REASON = MANUAL_TIMEOUT
PRIMARY_EXIT_LOSS_SHARE = 0.500767
REPLAY_DISTORTION_SHARE = 0
POSITION_MONITOR_LOSS_SHARE = 0.495411
BEST_EXIT_VARIANT = VARIANT_D
BEST_VARIANT_NET_EXPECTANCY_DELTA = 0.10115426
BEST_VARIANT_NET_PNL_DELTA = 17.56301183
BEST_VARIANT_DRAWDOWN_DELTA = 17.37880183
OOS_SUPPORTED = PARTIAL
ROBUSTNESS = ROBUST
FIRST_EXPERIMENT = VARIANT_D controlled shadow replay (reason-specific exit precedence)
PRODUCTION_CHANGE_RECOMMENDED = NO
