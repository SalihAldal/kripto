# KRIPTO P2 — VARIANT_D LIVE SHADOW HOLDOUT REPORT

## Final Verdict
- FIVE_ROUNDS_COMPLETED: NO
- LIVE_TRADES_OBSERVED: 0
- SYSTEM_TIMEOUT_LIVE_COUNT: 0
- BASELINE_LIVE_NET_PNL: 0
- VARIANT_D_SHADOW_NET_DELTA: 0
- HISTORICAL_REPLAY_DELTA: 17.00464466
- HISTORICAL_OOS_DELTA: 0.04352356
- LIVE_SHADOW_DIRECTION: NOT_PROVEN
- SYSTEM_TIMEOUT_SHADOW_EFFECT: NOT_PROVEN
- OUTSIDE_MR_LOWVOL_EFFECT: NOT_PROVEN
- LOOKAHEAD_VIOLATIONS: 0
- RUNTIME_REGRESSION: NO
- BASELINE_BEHAVIOR_UNCHANGED: YES
- SHADOW_NON_BLOCKING: PASS
- SHADOW_ERRORS: 0
- SHADOW_TIMEOUTS: 0
- VARIANT_D_STATUS: RESEARCH_ONLY
- PRODUCTION_CHANGE_RECOMMENDED: NO
- NEXT_STEP: LIVE_SHADOW_NOT_EXERCISED: maintain shadow wiring and rerun controlled holdout when natural trades occur.

## Report Answers
1. Real Paper -> shadow observer reached: NO
2. Live trades observed: 0
3. SYSTEM_TIMEOUT count: 0
4. Baseline live netPnL: 0
5. Variant_D shadow counterfactual netPnL: 0
6. Shadow delta: 0
7. SYSTEM_TIMEOUT improvement: NOT_PROVEN
8. Outside MR+LOW_VOL effect: NOT_PROVEN
9. Shadow runtime regression: NO
10. Look-ahead zero: YES
11. Baseline unchanged: YES
12. Live direction aligned with historical OOS: NO
13. Next promotion readiness: RESEARCH_ONLY
14. Exact next step: LIVE_SHADOW_NOT_EXERCISED: maintain shadow wiring and rerun controlled holdout when natural trades occur.

## Layered Comparison
- HISTORICAL_REPLAY: delta=17.00464466, direction=POSITIVE
- HISTORICAL_OOS: delta=0.04352356, direction=POSITIVE
- LIVE_SHADOW_HOLDOUT: delta=0, direction=NOT_PROVEN

## Shadow Performance
- shadowEvaluationCount=0
- shadowErrors=0
- shadowTimeouts=0
- shadowLatencyP50=0
- shadowLatencyP95=0
- shadowLatencyP99=0

