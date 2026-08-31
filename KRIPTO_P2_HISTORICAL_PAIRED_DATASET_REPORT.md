# KRIPTO P2 — HISTORICAL FORENSIC PAIRED DATASET REPORT

Generated: 2026-08-22T00:02:51.523Z

## Scope and Constraints
- NO NEW PAPER RUN respected.
- NO NEW MARKET DATA respected.
- Trading behavior unchanged; analysis-only reconstruction.

## Historical Run Discovery
- Runs discovered: 60
- Forensic files scanned: 6886
- Canonical run present: YES

## Universal Tables
- Historical candidates (normalized): 33076
- Historical trades (normalized): 346

## Paired Dataset
- candidatePairs: 2
- validPairedSampleForQuant: 2
- executedPairedTrades: 0

## 51-Trade Historical Reference
- trades: 51
- grossPnL: -0.33651532
- fees: 5.09837823
- netPnL: -5.43489355
- reconstructed trade rows from this reference: 0

## Final A/B Metrics
- baselineNetPnl: 0
- feeAwareCounterfactualNetPnl: 0
- baselineNetExpectancy: 0
- feeAwareNetExpectancy: 0
- baselineFees: 0
- feeAwareExpectedFees: 0
- grossPositiveNetNegativeBaseline: 0
- grossPositiveNetNegativeFeeAware: 0
- opportunityRetention: 1
- tradeReductionRate: 0

## Safety / Look-Ahead / OOS
- Safety parity: PASS (analysis-only path, no bypass indicators used).
- Look-ahead free: YES
- OOS supported: NO

## Report Must Answer
1) Historical candidates: 33076
2) Valid baseline/FEE_AWARE pairs: 2
3) Paired records with real closed trades: 0
4) Reconstructed from 51-trade reference: 0
5) Baseline net PnL: 0
6) Fee-aware counterfactual net PnL: 0
7) Gross-positive/net-negative due fees (baseline): 0
8) Trades FEE_AWARE would block (executed paired subset): 0
9) Profitable trades it would block: 0
10) Opportunity retention: 1
11) Is FEE_AWARE improving net expectancy? NO/NOT_PROVEN
12) OOS supported? NO
13) FEE_AWARE status: RESEARCH_ONLY

## Final Answers
TOTAL_HISTORICAL_CANDIDATES = 33076
TOTAL_HISTORICAL_TRADES = 346
VALID_PAIRED_SAMPLE = 2
EXECUTED_PAIRED_TRADES = 0
BASELINE_NET_PNL = 0
FEE_AWARE_COUNTERFACTUAL_NET_PNL = 0
BASELINE_NET_EXPECTANCY = 0
FEE_AWARE_NET_EXPECTANCY = 0
GROSS_POSITIVE_NET_NEGATIVE_BASELINE = 0
GROSS_POSITIVE_NET_NEGATIVE_FEE_AWARE = 0
OPPORTUNITY_RETENTION = 1
TRADE_REDUCTION_RATE = 0
OOS_SUPPORTED = NO
FEE_AWARE_STATUS = RESEARCH_ONLY
BEST_NEXT_STEP = Backfill decision-time fee metrics into executions/pnl ledger for historical rounds so paired executed sample can exceed OOS threshold.
