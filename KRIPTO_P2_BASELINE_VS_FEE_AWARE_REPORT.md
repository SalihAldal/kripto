# KRIPTO P2 — BASELINE vs FEE_AWARE CONTROLLED PAPER A/B EXPERIMENT

Generated: 2026-08-21T23:57:31.915Z

## 1. Experiment Design
- Method: DETERMINISTIC_PAIRED_POLICY_EVALUATION_FROM_EXISTING_FORENSICS
- SAME candidate opportunity guarantee enforced by equal input hashes.
- Only fee-aware policy branch differs (baseline observe vs fee-aware pass/block semantics).

## 2. Paired-candidate Integrity
- candidatePairs: 2
- validPairs: 2
- invalidPairs: 0

## 3. Baseline Metrics
- trades: 0, netPnL: 0, expectancy: 0

## 4. FEE_AWARE Metrics
- trades: 0, netPnL: 0, expectancy: 0

## 5. Net PnL Comparison
- baseline vs fee-aware: 0 vs 0

## 6. Expectancy Comparison
- baseline vs fee-aware: 0 vs 0

## 7. Fee Drag Comparison
- baseline fees vs fee-aware fees: 0 vs 0

## 8. Gross-positive/net-negative Comparison
- baseline vs fee-aware: 0 vs 0

## 9. Trade Reduction / Opportunity Retention
- tradeReductionRate: 0
- opportunityRetentionRate: 1

## 10. Entry Quality Comparison
- No executed paired trades.

## 11. Exit Comparison
- EXIT_COMPARISON_NOT_PROVEN

## 12. Strategy Comparison
- NOT_ENOUGH_DATA

## 13. Regime Comparison
- NOT_ENOUGH_DATA

## 14. Safety Parity
- PASS

## 15. Look-ahead Audit
- YES

## 16. OOS Result
- NO

## 17. Statistical Limitations
- Sample size too small for significance.
- No paired executed trades => expectancy/PnL delta unproven.

## 18. Promotion Gate
- RESEARCH_ONLY

## 19. Recommendation
- Keep FEE_AWARE as RESEARCH_ONLY. Next step: collect paired executed trades with preserved fee policy evaluations.

## 20. Next Paper Validation Stage
- Run a controlled 5-round paired evidence stage with minimum 3 closed trades and non-replay exit evidence before any promotion discussion.

## Required Final Answers
VALID_PAIRED_SAMPLE = 2
BASELINE_TRADES = 0
FEE_AWARE_TRADES = 0
BASELINE_NET_PNL = 0
FEE_AWARE_NET_PNL = 0
BASELINE_NET_EXPECTANCY = 0
FEE_AWARE_NET_EXPECTANCY = 0
BASELINE_FEES = 0
FEE_AWARE_FEES = 0
GROSS_POSITIVE_NET_NEGATIVE_BASELINE = 0
GROSS_POSITIVE_NET_NEGATIVE_FEE_AWARE = 0
OPPORTUNITY_RETENTION = 1
LOOKAHEAD_FREE = YES
SAFETY_PARITY = PASS
OOS_SUPPORTED = NO
FEE_AWARE_STATUS = RESEARCH_ONLY
BEST_NEXT_STEP = Generate paired executed-trade sample where fee-aware decision snapshot and full trade lifecycle coexist in the same deterministic dataset.
