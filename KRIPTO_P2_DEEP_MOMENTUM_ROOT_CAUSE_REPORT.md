# KRIPTO P2 — DEEP MOMENTUM RESIDUAL BLOCKER ROOT-CAUSE FORENSIC

## Evidence Depth
- 42 trade-level rows: `kripto-p2-42-profitable-momentum-blockers.csv`
- 2278 candidate-level rows: `kripto-p2-2278-current-momentum-blockers.csv`
- code path map: `kripto-p2-momentum-code-path.json`
- formula + units: `kripto-p2-momentum-formula.json` + `kripto-p2-momentum-unit-audit.csv`
- counterfactual traces: `kripto-p2-momentum-counterfactuals.csv`

## Required Questions (Condensed)
1) exact momentum code path: exported in code-path JSON
2) exact units: shortMomentum=percent-points, shortFlow=normalized[-1,1], momentumScore/sentiment/confidence=0..100
3) shortMomentum double-counted: PARTIAL
4) shortFlow double-counted: PARTIAL
5) sentiment double-counted: PARTIAL
6) regime delta double-counted: PARTIAL
7) momentum via confidence second-penalty: PARTIAL
8) learning same-signal repeat: PARTIAL
9) each of 42 failures: row-wise CSV'd
10) most common blocker: MOMENTUM_SCORE
11) largest numeric gap: momentumScoreGap
12) ordering materially changes outputs: YES
13) master independent suppression: UNKNOWN
14) best counterfactual: A_remove_shortMomentum_penalty
15) losing trade release count: 0
16) released net PnL: 0
17) OOS support: YES
18) MR+LOW_VOL dışı robustness: INSUFFICIENT_SAMPLE
19) current zero approval same blocker: YES
20) safest first experiment: MOMENTUM_CONFIDENCE_INTERACTION

## Final Verdict
PROFITABLE_TRADES = 42
CURRENT_CANDIDATES = 2278
PRIMARY_MOMENTUM_SUPPRESSOR = MOMENTUM_SCORE
PRIMARY_SUPPRESSOR_SHARE = 0.714286
LARGEST_NUMERIC_GAP = momentumScoreGap
MOMENTUM_UNIT_BUG = NO
DOUBLE_COUNTING = PARTIAL
LEARNING_INTERACTION = PARTIAL
CONFIDENCE_INTERACTION = PARTIAL
ORDERING_EFFECT = YES
MASTER_SUPPRESSION = UNKNOWN
BEST_COUNTERFACTUAL = A_remove_shortMomentum_penalty
RELEASED_PROFITABLE_TRADES = 0
RELEASED_LOSING_TRADES = 0
RELEASED_NET_PNL = 0
RELEASED_EXPECTANCY = 0
OOS_SUPPORTED = YES
ROBUSTNESS = INSUFFICIENT_SAMPLE
CURRENT_ZERO_APPROVAL_SHARED = YES
FIRST_EXPERIMENT = MOMENTUM_CONFIDENCE_INTERACTION
PRODUCTION_CHANGE_RECOMMENDED = NO
