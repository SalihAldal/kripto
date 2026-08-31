# KRIPTO P2 — FINAL PROFITABILITY / POSITIVE NET EDGE ENGINEERING

Generated: 2026-08-21T23:46:33.284Z

## Baseline (Current Post-P0/P1)
- roundCount: 5
- validRounds: 5
- tradeCount: 0
- winRate: 0.00%
- grossPnL: 0
- fees: 0
- netPnL: 0
- expectancy: 0
- profitFactor: N/A

## Historical Research Context (Labeled, Non-Canonical)
- trades: 51
- grossPnL: -0.33651532
- fees: 5.09837823
- netPnL: -5.43489355
- exit model: 51/51 END_OF_REPLAY

## Why Money Was Lost (Evidence)
- PRIMARY: FEE_EROSION + REPLAY_WINDOW distortion + STRATEGY_WEAKNESS (historical evidence).
- CURRENT POST-P0/P1: no closed trades, so realized loss attribution is not provable yet.

## Fee Drag
- Classification: DOMINANT (historical).
- grossPositiveNetNegative: 11 (historical).

## Entry / Exit Quality
- Entry quality: NOT_PROVEN (current sample has no executed entries).
- Exit quality: EXIT_EDGE_NOT_PROVEN (historical end-of-replay dominance; no current closed trades).

## Strategy x Regime
- Matrix cells: 28
- NOT_ENOUGH_DATA cells: 28

## TDI and AI
- TDI approved (5-round current): 0
- TDI verdict: OVERLY_CONSERVATIVE
- AI remote health: PASS
- AI parity: PASS
- AI predictive quality: UNKNOWN

## Controlled Experiment Status
- BASELINE: NOT_PROVEN (REFERENCE)
- FEE_AWARE: RESEARCH_ONLY (RESEARCH_ONLY)
- ENTRY_QUALITY_PROTECTED: RESEARCH_ONLY (RESEARCH_ONLY)
- REGIME_AWARE: RESEARCH_ONLY (RESEARCH_ONLY)
- TDI_INTERACTION_CORRECTION: RESEARCH_ONLY (RESEARCH_ONLY)
- STRATEGY_SPECIFIC_REGIME_GATING: RESEARCH_ONLY (RESEARCH_ONLY)

## Promotion Gate
- Promotable variants: NONE
- Best evidence-backed variant: FEE_AWARE (RESEARCH_ONLY, not promotable)

## Staged Paper Validation Plan
- Stage 1 (5 rounds): runtime + lifecycle evidence, min trades 3.
- Stage 2 (30 rounds): first meaningful profitability sample, min trades 20.
- Stage 3 (50+ rounds): robust profitability and OOS-backed validation, min trades 40.

## Final Verdict
- LOSS_ROOT_CAUSE = MIXED
- PROFITABILITY_STATUS = NOT_PROVEN
- POSITIVE_NET_EDGE = NOT_PROVEN
- BEST_EVIDENCE_BACKED_VARIANT = FEE_AWARE
- PROMOTABLE_VARIANTS = NONE
- OOS_SUPPORTED = NO
- READY_FOR_30_ROUNDS = CONDITIONAL
- READY_FOR_50_ROUNDS = CONDITIONAL

## Report Must Answer
1. Why did historical trades lose money?  
   Fee erosion + replay-window exit distortion + strategy weakness in historical sample.
2. How much was caused by fees?  
   Historical fees 5.09837823 vs grossPnL -0.33651532; fee drag is dominant.
3. How much was caused by entry quality?  
   Current post-P0/P1 sample cannot measure this (0 executed entries).
4. How much was caused by exits?  
   Historical 51/51 END_OF_REPLAY indicates exit realism distortion; current non-replay exit edge not proven.
5. How much was caused by regime mismatch?  
   Not quantifiable yet due sparse trade outcomes (NOT_ENOUGH_DATA).
6. Which strategies show evidence of edge?  
   None proven net-positive yet.
7. Which regimes show evidence of edge?  
   None proven net-positive yet.
8. Is TDI too conservative?  
   Current evidence suggests yes (runtime approvals 0 across latest 5-round).
9. Is AI predictive quality useful?  
   Unknown; AI parity is PASS but predictive usefulness is unproven without realized outcomes.
10. What is the strongest evidence-backed improvement?  
    FEE_AWARE pre-trade expectedNetEdge protection (research-only).
11. Which variants are research-only?  
    FEE_AWARE, ENTRY_QUALITY_PROTECTED, REGIME_AWARE, TDI_INTERACTION_CORRECTION, STRATEGY_SPECIFIC_REGIME_GATING.
12. Which variants are promotable?  
    None.
13. Is there any positive NET edge yet?  
    Not proven.
14. What must be measured next?  
    Closed trades with non-replay exits, then OOS expectancy validation on sufficient sample.
