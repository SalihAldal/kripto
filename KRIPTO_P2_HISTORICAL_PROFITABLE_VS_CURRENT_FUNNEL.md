# KRIPTO P2 — HISTORICAL PROFITABLE TRADES vs CURRENT FUNNEL GAP

## Core Findings
- Historical profitable trades: 42
- Current paper candidates: 2278
- Historical profitable -> current TDI pass/wait/reject: 0/42/0
- Primary suppression stage: CONFIDENCE
- Distribution shift: NO_SHIFT
- Current zero approval explained: YES

## Required Answers
1. How many historical profitable trades exist? 42
2. How many would pass CURRENT TDI? 0
3. How many would be WAIT? 42
4. How many would be REJECT? 0
5. Which first blocker kills the most profitable historical opportunities? CONFIDENCE
6. What is the median score gap? UNKNOWN
7. Is the problem upstream candidate quality or TDI filtering? TDI_FILTERING
8. Is there a material regime shift? NO_SHIFT
9. Is momentum the dominant blocker? NO
10. Is technical the dominant blocker? NO
11. Is confidence the dominant blocker? YES
12. How many profitable historical opportunities would current TDI suppress? 42
13. Is current 0 approval explainable without changing thresholds? YES
14. What are the top 3 safe experiments? TDI_INTERACTION_ANALYSIS, MOMENTUM_POLICY_SHADOW, REGIME_AWARE_TDI_SHADOW
15. What should NOT be changed? TDI thresholds, technical thresholds, momentum thresholds, confidence thresholds, sizing, EV, risk, maxPositions, AI prompts, AI VETO, scanner rules, strategy rules, SL/TP, TIME_EXIT, fee model, Variant_D, scanner selection policy
16. What evidence is still missing? Her historical trade için decision-time TDI trace eşleşmesi birebir mevcut değil. | Bazı LearningTrade metadata alanları boş; candidate-level geçmiş chain eksik. | Birebir runtime TDI motor replay’i yerine policy seviyesinde forensics simülasyonu kullanıldı.

## Final Verdict
HISTORICAL_PROFITABLE_TRADES = 42
CURRENT_PAPER_CANDIDATES = 2278
HISTORICAL_PROFITABLE_WOULD_PASS_CURRENT_TDI = 0
HISTORICAL_PROFITABLE_WOULD_WAIT_CURRENT_TDI = 42
HISTORICAL_PROFITABLE_WOULD_REJECT_CURRENT_TDI = 0
PRIMARY_SUPPRESSION_STAGE = CONFIDENCE
PRIMARY_SUPPRESSION_SHARE = 0.501756
MEDIAN_SCORE_GAP = UNKNOWN
DISTRIBUTION_SHIFT = NO_SHIFT
CURRENT_ZERO_APPROVAL_EXPLAINED = YES
UPSTREAM_VS_TDI = TDI_FILTERING
TOP_EXPERIMENT = TDI_INTERACTION_ANALYSIS
PRODUCTION_CHANGE_RECOMMENDED = NO
OOS_SUPPORTED = YES
