# KRIPTO P2 — SCANNER AI CONSENSUS HARD-BLOCK ROOT CAUSE

Generated: 2026-08-28T16:55:55.459Z  
**PAPER_STARTED = NO**

## Executive Summary

EDENTRY (confidence 78, `finalDecision=BUY`, `finalConsensusDecision=NO-TRADE`) was **not** blocked at scanner selection (`isBlockingAiDecision` allows BUY). The candidate reached `executeAnalyzeAndTrade`, where **execution-stage** `evaluateAiExecutionReadiness` returned `AI_DECISION_CONFLICT` because master decision engine **preserved hybrid BUY** while leaving consensus mapped to master deferral (NO-TRADE).

This is an **aggregation bug** (`AI_DECISION_AGGREGATION_BUG`), not a policy to approve more trades.

## Root Cause

| Layer | Behavior |
|-------|----------|
| Hybrid engine | Produced BUY with high confidence |
| Master engine | `resolveEffectiveTradingDecision` preserved BUY (`preservedHybridBuy=true`) |
| Master engine bug | `finalConsensusDecision` still mapped master WAIT/NO_TRADE → NO-TRADE |
| Selection gate | BUY passed (`isBlockingAiDecision` = false) |
| Execution gate | BUY vs NO-TRADE → `AI_DECISION_CONFLICT` |
| TDI | Never entered (blocked at AI execution gate) |

## Fix Applied

`mapMasterConsensusDecision(decision, preservedHybridBuy)` — when hybrid BUY is preserved, consensus aligns to BUY. **No threshold changes. VETO intact.**

## Research Answers (abbreviated)

1. Scanner AI role: **FILTER** at selection; **authoritative VETO** at execution via conflict check  
2. AI before TDI: **intentional** — execution gate in `execution-orchestrator.service.ts` ~2060  
3. TDI has technical/regime data AI lacks — **yes**, complementary  
4. Scanner AI can prevent TDI only via execution gate after selection — **yes**  
5. Provider disagreement should hard-block unless master preservation aligns fields — **bug was misalignment, not disagreement**  
6. `isBlockingAiDecision`: blocks NO_TRADE/HOLD/REJECT/WAIT/empty only  
7. Authoritative at execution: **aligned finalDecision + finalConsensusDecision**  
8. Same candidate BUY→NO_TRADE at stages: **yes, due to aggregation bug**  
9. Scanner vs execution AI: same `candidate.ai` object, single evaluation path  

## 4-Round Replay

| Symbol | Before | After fix |
|--------|--------|-----------|
| EDENTRY | AI_DECISION_CONFLICT | AI_GATE_PASS → TDI reachable |
| GENIUSTRY | NO_TRADE selection block | unchanged |
| HOLOTRY | NO_TRADE selection block | unchanged |
| FDUSDTRY | NO_TRADE selection block | unchanged |

## Final Verdict

```
EDENTRY_ROOT_CAUSE = AI_DECISION_AGGREGATION_BUG
EDENTRY_CONFLICT = BUG
SCANNER_AI_ROLE = FILTER
SCANNER_AI_HARD_BLOCK = INCORRECT
TDI_PRE_AI_ORDERING = CORRECT
HIGH_CONFIDENCE_CONFLICTS = 1
AI_POLICY_REJECTIONS = 3
AI_RELIABILITY_CASES = 0
SNAPSHOT_MISMATCHES = 0
DUPLICATE_AI_PATHS = 1
37_COHORT_AFFECTED = 0
37_COHORT_TDI_RELEASED = 0
37_COHORT_EXECUTION_READY_COUNTERFACTUAL = 0
paperGateConflictCases = 1
42_PROFITABLE_RELEASED = 0
206_LOSS_RELEASED = 0
COUNTERFACTUAL_NET_PNL = 0
COUNTERFACTUAL_EXPECTANCY = 0
AI_VETO_PRESERVED = YES
TDI_PRESERVED = YES
EV_PRESERVED = YES
RISK_SIZING_PRESERVED = YES
FIX_TARGET = FIX_AI_DECISION_AGGREGATION
FIX_IMPLEMENTED = YES
TESTS = PASS
DETERMINISTIC_REPLAY = PASS
PAPER_STARTED = NO
READY_FOR_5_ROUND_RETEST = YES
READY_FOR_30_ROUND = CONDITIONAL
NEXT_STEP = Run 5-round paper gate to confirm EDENTRY reaches TDI (expected TDI reject on technical score) and zero false AI_DECISION_CONFLICT from preservedHybridBuy.
```
