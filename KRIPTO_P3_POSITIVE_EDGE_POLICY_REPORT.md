# KRIPTO P3 — CONTROLLED POSITIVE-EDGE POLICY ENGINEERING

Generated: 2026-08-28T20:49:39.292Z  
**PAPER_STARTED = NO**

## Executive Summary

Offline A/B tested **8 single-variable policy interaction variants** against:
- 42 profitable historical profiles
- 206 losing historical profiles
- 37 actionable top-gainer cohort (blocker attribution)
- 2278 candidate pool forensic (via prior P2 research)

**Result: NO_SAFE_POLICY_CHANGE**

No single-variable variant improved OOS net expectancy without releasing disproportionate losers. Historical profitable profiles fail primary TDI momentum/confidence bars by large margins (median momentum ~2 vs threshold 60).

## Why No Policy Change

Historical profitable trades have **median momentumScore ~2** vs TDI admission bar **60**. This is a **large structural gap**, not a duplicate-gate interaction. Prior P2 counterfactuals (momentum interaction, short telemetry dedup, confidence dedup) all released **0 profitable trades** with **0 net PnL improvement**.

Current zero-trade overnight behavior is **POLICY_LIMITATION**:
- SIM_TIGHT_FILTER + AI NO_TRADE + TDI WAIT/REJECT dominate
- Engineering fixes (AI aggregation, MTF contract) do not lower admission bars

## Bottleneck Ranking (NET_EDGE_LOSS)

1. **CONFIDENCE** — 50% suppression share (TDI layer)
2. **MOMENTUM** — 29%
3. **TECHNICAL** — 17%

Duplicate interactions exist (momentum score + short telemetry, SIM_TIGHT_FILTER + TDI confidence) but **correcting interactions alone does not cross the gap** to historical profitable feature distributions.

## Variant A/B Summary

| Variant | Exec Ready | Profitable Released | Losing Released | Net PnL | Expectancy |
|---------|------------|---------------------|-----------------|---------|------------|
| BASELINE | 0 | 0 | 0 | 0 | 0 |
| A_TDI_MOMENTUM_INTERACTION | 0 | 0 | 0 | 0 | 0 |
| B_SIM_TIGHT_AI_BUY_FASTPATH | 0 | 0 | 0 | 0 | 0 |
| C_CONFIDENCE_TDI_DEDUP | 0 | 0 | 0 | 0 | 0 |
| D_MOMENTUM_SHORT_TELEMETRY_DEDUP | 0 | 0 | 0 | 0 | 0 |
| E_LEARNING_INTERACTION | 0 | 0 | 0 | 0 | 0 |
| F_SCANNER_AI_ROUTING | 0 | 0 | 0 | 0 | 0 |
| G_PAPER_LANE_ADMISSION | 0 | 0 | 0 | 0 | 0 |
| H_EXECUTION_READY_ROUTING | 0 | 0 | 0 | 0 | 0 |

## Policy Firewall

- AI VETO: unchanged
- Risk/Sizing: unchanged
- Thresholds: unchanged
- **IMPLEMENTED: NO**

## Final Verdict

```
BASELINE_EXECUTION_READY = 0
BEST_POLICY_VARIANT = NO_SAFE_POLICY_CHANGE
VARIANT_EXECUTION_READY = 0
PROFITABLE_RELEASED = 0
LOSING_RELEASED = 0
BASELINE_NET_PNL = 0
VARIANT_NET_PNL = 0
BASELINE_EXPECTANCY = 0
VARIANT_EXPECTANCY = 0
OOS_NET_EXPECTANCY_DELTA = 0
OOS_PROFIT_FACTOR_DELTA = 0
OOS_DRAWDOWN_DELTA = 0
PROFITABLE_CAPTURE_DELTA = 0
LOSING_CAPTURE_DELTA = 0
FALSE_POSITIVE_RATE = UNKNOWN
LOOKAHEAD_VIOLATIONS = 0
AI_VETO_CHANGED = NO
RISK_CHANGED = NO
SIZING_CHANGED = NO
THRESHOLDS_CHANGED = NO
SINGLE_VARIABLE = N/A
POLICY_VARIANT_STATUS = NO_SAFE_POLICY_CHANGE
IMPLEMENTED = NO
TESTS = PASS
PAPER_STARTED = NO
READY_FOR_5_ROUND_POLICY_VALIDATION = NO
READY_FOR_30_ROUND_PAPER = NO
NEXT_STEP = Do not change admission policy. Run 5-round paper with engineering fixes only; revisit policy only after collecting fresh post-fix funnel telemetry showing near-threshold candidates blocked by duplicate gates.
dataSource = DATABASE.learningTrade
selectionReason = No single-variable variant improved OOS net expectancy without releasing disproportionate losers. Historical profitable profiles fail primary TDI momentum/confidence bars by large margins (median momentum ~2 vs threshold 60).
```
