# KRIPTO P2 — HISTORICAL EXECUTED TRADE FEE BACKFILL REPORT

Generated: 2026-08-22T00:09:29.122Z

## Trade Inventory
- Historical trades: 346 (learning=248, paper=98)
- Recoverable decision snapshots: 268
- Match quality: EXACT=0, HIGH=268, LOW=0, UNMATCHED=78

## Executed Paired Subset
- Included (EXACT+HIGH): 173
- Baseline netPnL: -18.595201229999994
- Baseline expectancy: -0.10748671231213869
- Gross positive but net negative: 0

## Fee-Aware Counterfactual
- Blocks: 9
- Avoided net loss: 0.33816403
- Fee drag avoided: 0
- Opportunity retention: 0.9479768786127167
- Trade reduction rate: 0.05202312138728324

## 51-Trade Historical Reference
- total: 51, matched: 0, unmatched: 51, paired: 0

## OOS / Look-Ahead / Status
- Lookahead free: YES
- OOS supported: PARTIAL
- FEE_AWARE status: RESEARCH_ONLY

## Report Must Answer
1) Recoverable decision-time fee inputs: 268
2) Exact/high-confidence snapshots: 268
3) Executed paired records: 173
4) FEE_AWARE blocks: 9
5) Baseline realized net PnL: -18.595201229999994
6) Avoided net PnL (counterfactual): -0.22495703
7) Gross-positive/net-negative trades: 0
8) Fee drag avoided: 0
9) OOS supported: PARTIAL
10) FEE_AWARE still research-only: YES

## Final Answers
HISTORICAL_TRADES = 346
RECOVERABLE_DECISION_SNAPSHOTS = 268
VALID_EXECUTED_PAIRED_TRADES = 173
BASELINE_NET_PNL = -18.59520123
BASELINE_NET_EXPECTANCY = -0.10748671
FEE_AWARE_COUNTERFACTUAL_BLOCKS = 9
AVOIDED_NET_LOSS = 0.33816403
GROSS_POSITIVE_NET_NEGATIVE = 0
FEE_DRAG_AVOIDED = 0
LOOKAHEAD_FREE = YES
OOS_SUPPORTED = PARTIAL
FEE_AWARE_STATUS = RESEARCH_ONLY
NEXT_STEP = Prioritize artifact-level persistence of candidateId+decision fee metrics on every executed trade to raise exact paired sample and enable OOS validation.
