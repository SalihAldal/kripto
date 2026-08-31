# KRIPTO P2 — VARIANT_D LIVE SHADOW REPORT

Generated: 2026-08-22T11:50:27.214Z

## Scope
- Research/shadow validation only.
- No new paper runs started in this task.
- No production exit behavior changes.

## Production Compatibility
- Status: PARTIAL
- MANUAL_TIMEOUT semantic class: MISNAMED_SYSTEM_TIMEOUT

## Live Shadow Evidence
- Live trades observed by Variant_D exit shadow: 0
- System-timeout live count: 0
- Shadow net delta: 0
- Live shadow direction: NOT_PROVEN

## Historical Context
- Historical replay net delta: 17.00464466
- Historical OOS delta: 0.04352356

## Gate Decision
- Variant_D status: RESEARCH_ONLY
- First next step: Enable exit-level Variant_D shadow observer (observe-only) in paper runtime, then run <=5 controlled rounds to collect real live-shadow holdout evidence.

## Final Verdict
LIVE_TRADES_OBSERVED = 0
SYSTEM_TIMEOUT_LIVE_COUNT = 0
SYSTEM_TIMEOUT_BASELINE_NET_PNL = 0
VARIANT_D_SHADOW_NET_DELTA = 0
HISTORICAL_OOS_DELTA = 0.04352356
LIVE_SHADOW_DIRECTION = NOT_PROVEN
OUTSIDE_MR_LOWVOL_DIRECTION = NOT_PROVEN
LOOKAHEAD_VIOLATIONS = 0
RUNTIME_REGRESSION = NO
PRODUCTION_COMPONENT_COMPATIBILITY = PARTIAL
VARIANT_D_STATUS = RESEARCH_ONLY
FIRST_NEXT_STEP = Enable exit-level Variant_D shadow observer (observe-only) in paper runtime, then run <=5 controlled rounds to collect real live-shadow holdout evidence.
PRODUCTION_CHANGE_RECOMMENDED = NO
