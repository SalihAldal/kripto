# KRIPTO P2 — TDI CONFIDENCE INTERACTION FORENSIC + PROFITABILITY SHADOW

## Evidence Quality
- EXACT_RUNTIME_REPLAY: 0
- POLICY_FORENSIC_REPLAY: 0
- INFERRED: 42

## Core Answers
1. Why do all 42 profitable historical trades become WAIT? -> Current confidence-gated + interaction-heavy policy path; reconstructable runtime traces are limited, but current population blocker distribution and formula show confidence interaction suppression.
2. What exact confidence component suppresses them? -> LEARNING_CONFIDENCE_INTERACTION
3. Is there a duplicate penalty? -> PARTIAL
4. Is confidence incorrectly normalized? -> NO
5. Is confidence correlated with profitability? -> UNKNOWN
6. Does confidence interact badly with momentum? -> YES
7. Does confidence interact badly with regime? -> UNKNOWN
8. Does learning suppress profitable candidates? -> YES
9. Is the issue confidence itself or a downstream artifact? -> DOWNSTREAM/INTERACTION leaning
10. How many profitable historical opportunities are suppressed? -> 42
11. Can a correctness fix improve TDI without lowering thresholds? -> YES (shadow/forensic interaction correction candidate)
12. What is the safest first experiment? -> CONFIDENCE_INTERACTION_CORRECTION
13. Does the finding survive OOS? -> YES
14. What must NOT be changed? -> thresholds, AI gate, risk/sizing, strategy/scanner, SL/TP, fee model, Variant_D

## Final Verdict
PROFITABLE_HISTORICAL_TRADES = 42
CURRENT_PAPER_CANDIDATES = 2278
CONFIDENCE_SUPPRESSION = DOMINANT
TOP_CONFIDENCE_SUPPRESSOR = LEARNING_CONFIDENCE_INTERACTION
DOUBLE_PENALTY = PARTIAL
NORMALIZATION_BUG = NO
CONFIDENCE_CALIBRATION = UNKNOWN
CONFIDENCE_INTERACTION = MIXED
HISTORICAL_COUNTERFACTUAL_NET_PNL = 2.45373448
OOS_SUPPORTED = YES
FIRST_EXPERIMENT = CONFIDENCE_INTERACTION_CORRECTION
PRODUCTION_CHANGE_RECOMMENDED = NO
CURRENT_ZERO_APPROVAL_EXPLAINED = YES
