# KRIPTO P0 — TDI Zero-Approval / Master Decision Engine Forensic

**Report ID:** `kripto-tdi-zero-approval-forensic`  
**Method:** Read-only code trace + artifact aggregation — **no code changes, no paper run**  
**Machine-readable:** [`kripto-tdi-zero-approval-forensic.json`](kripto-tdi-zero-approval-forensic.json)  
**Reference run:** `cmstltuqn0007un9ksbk3xn9c` (46 rounds, 0 trades)

---

## 1. Executive answer

**Why does sensitivity show 28.4% approval at threshold 55 while runtime shows 0% APPROVED?**

Because they measure **different things**.

| Engine | Location | Approval rule |
|--------|----------|---------------|
| **Sensitivity (28.4%)** | `tdi-sensitivity.service.ts` | `consensusScore >= 55` |
| **Runtime (0%)** | `hybrid-decision-engine.ts` + `master-decision-engine.service.ts` | `finalDecision === "BUY"` or `legacyDecision === "BUY"` |

**5067 / 17,626** TDI records (28.7%) have `consensusScore >= 55`, but **zero** have `hybridDecision === "BUY"` or `masterDecision ∈ {BUY, STRONG_BUY}`. Threshold 55 is **not** the runtime TDI approval gate.

**PRIMARY:**

> **`TDI_MASTER_DECISION_OVERRULE`** — Runtime TDI `APPROVED` requires a **BUY** outcome from hybrid or master legacy decision. Score ≥ 55 only qualifies for sensitivity's simplified counterfactual. Hybrid downgrades score-qualified setups to **HOLD** (`momentumWeak`, `techStrongButOthersWeak`). Master emits **NO_TRADE** when blended expert **confidence < 40** even with consensusScore 55–68, with LEARNING/MOMENTUM listed as blockers.

**Confidence:** HIGH

---

## 2. 46-round evidence

| Metric | Value |
|--------|------:|
| TDI decisions | 17,626 |
| TDI APPROVED | **0** |
| TDI WAIT | 6,094 |
| TDI REJECTED | 11,532 |
| `consensusScore >= 55` | **5,067 (28.7%)** |
| `hybridDecision === BUY` | **0** |
| `hybridDecision === HOLD` | 11,472 |
| `masterDecision === NO_TRADE` | 8,538 |
| `masterDecision === BUY/STRONG_BUY` | **0** |
| Score ≥ 55 → HOLD | 3,226 |
| Score ≥ 55 → master NO_TRADE | 3,125 |

**WAIT reason details (top):**

| Pattern | Count |
|---------|------:|
| "Momentum guven vermiyor" | 5,535 |
| "Teknik guclu ama diger AI destegi zayif" | 5,675 |
| AI gate blocked (execution bridge) | 358 |

**Note:** `decision-intelligence.json` does **not** exist in this repo. Closest artifacts: `tdi-decisions.json`, `decision-trace.json`, `consensus-trace.json`.

---

## 3. Master decision call graph

```
Scanner candidate
    ↓ scanner.service / candidate-ranking
Strategy + regime (market-regime, strategy-selector)
    ↓
MI / MC / SI — analysis-orchestrator.ts
    → provider-1 (technical), provider-2 (sentiment), provider-3 (risk)
    ↓
Hybrid decision — hybrid-decision-engine.ts
    → composite score, finalDecision BUY|HOLD|NO_TRADE
    → bridgeTdiDecision (candidateId: hybrid:*)
    → bridgeHybridEv (EV vs runtimeMinCompositeScore)
    ↓
Master decision — adjudicateWithMasterDecisionEngine()
    → runAllExperts() — domain-experts.ts
        MARKET, MOMENTUM, VOLUME, LIQUIDITY, RISK, NEWS, EXECUTION, LEARNING
    → computeConsensusMetrics() → consensusScore, confidence
    → resolveMasterDecision() → STRONG_BUY|BUY|WATCHLIST|WAIT|NO_TRADE|...
    → resolveEffectiveTradingDecision() → legacyDecision (BUY preservation)
    → bridgeTdiDecision (candidateId: tdi:*)
    ↓
TDI verdict mapping
    hybrid:  BUY → APPROVED | HOLD → WAIT | else → REJECTED
    master:  legacyDecision BUY → APPROVED | WAIT/WATCHLIST → WAIT | else → REJECTED
    ⚠ NOT: consensusScore >= 55 → APPROVED
    ↓
Execution (round winner path, separate)
    → ai-execution-gate.service.ts (VETO on NO_TRADE)
    → bridgeTdiDecision after gate (WAIT/BELOW_THRESHOLD)
```

**Verdict producers:**

| Verdict | Producer |
|---------|----------|
| APPROVED | Only `BUY` in hybrid or master legacy path |
| WAIT | `HOLD` hybrid; master `WAIT`/`WATCHLIST`; `classifyTdiWaitReason` → NEUTRAL/BELOW_THRESHOLD/NO_SLOT |
| REJECTED | `NO_TRADE` hybrid; master `NO_TRADE`/`SELL`/`REDUCE` |

---

## 4. Score reconciliation

Each candidate produces **two TDI rows** with the **same field name** but **different score semantics**:

| Source | `consensusScore` meaning | Example (METRY, R4) |
|--------|---------------------------|---------------------|
| `hybrid:*` | Hybrid **composite** score | 60.29 |
| `tdi:*` | Master **expert average** (`avg(expert scores)`) | 63.62 |

**Sample reconciliation:**

| candidateId | Score | Threshold-55 pass? | Verdict | Expected (sensitivity) | Actual |
|-------------|------:|:--------------------:|---------|------------------------|--------|
| hybrid:METRY:485371f8 | 60.29 | YES | WAIT (HOLD) | APPROVED | HOLD — momentumWeak |
| tdi:METRY:e6880433 | 63.62 | YES | REJECTED | APPROVED | NO_TRADE — conf 27 < 40 |
| hybrid:ENSOTRY:38989fdf | 68.93 | YES | WAIT (HOLD) | APPROVED | HOLD — techStrongButOthersWeak |
| tdi:ENSOTRY:4a9eb521 | 53.14 | NO | REJECTED | WAIT | NO_TRADE — LEARNING+MOMENTUM |

**Delta source:** Sensitivity ignores momentum gate, master confidence floor, and BUY-only approval definition.

---

## 5. Learning penalty

**Code:** `domain-experts.ts` → `analyzeLearningExpert`

| Condition | Expert behavior |
|-----------|-----------------|
| No `analysisMemory` | `NO_OPINION`, score 50, risk `insufficientHistory` |
| Weak history | `avgWin < 45` or `avgReturn < 0` → bearish opinion, lower score |

**TDI effect (master path only):**

- `buildAttribution()` lists LEARNING as **blocker** when bearish
- `buildHumanReadableDecision()` → `"Blocked/reduced by LEARNING and MOMENTUM"`
- `resolveMasterDecision`: if `confidence < 40` → **NO_TRADE** (even when score ≥ 45)

**Can force APPROVED → REJECTED?** Yes — master path never reaches `legacyDecision === "BUY"`. Hybrid path does not call LEARNING expert directly but master adjudication runs after hybrid on every AI analysis.

**Example:** `tdi:METRY:e6880433` — score 63.6, confidence 27, `"Blocked/reduced by LEARNING and MOMENTUM"`, verdict REJECTED.

**Execution-stage learning gates** (`LEARNING_IMMEDIATE_BLOCK`, etc. in `execution-orchestrator.service.ts`) apply **after** TDI artifact emission for round winners — not the cause of 0/17626 APPROVED.

---

## 6. Momentum penalty

**Hybrid — `hybrid-decision-engine.ts`:**

```typescript
// line ~801
momentumWeak = sentiment.score < AI_HYBRID_MIN_SENTIMENT_SCORE(52) + regimeDelta
            || (|shortMomentum| < 0.08 && |shortFlowImbalance| < 0.03)

// line ~996 — BUY requires momentumSupportive = sentimentOk && !momentumWeak
// line ~1071-1076 — if BUY && techStrongButOthersWeak → finalDecision = HOLD
```

**Effects:**

1. Prevents initial `finalDecision = "BUY"`
2. Adds `"Momentum guven vermiyor"` to reasonDetail (**5,535** WAIT rows)
3. Downgrades would-be BUY to HOLD when technical strong but momentum weak

**Master — `conflict-detection.service.ts`:**

```typescript
// BUY requires matrix.momentum >= 60 (line 121)
// WATCHLIST at score>=55 requires confidence>=50, bullishCount>=2
// WAIT requires confidence>=40
// else NO_TRADE
```

**Distribution:** APPROVED count = 0, so momentum among APPROVED is N/A. Among score ≥ 55: **1,468 WAIT**, **3,599 REJECTED**.

---

## 7. Override rules

| Rule | Source | Affected | Effect |
|------|--------|----------|--------|
| **APPROVED requires BUY, not score≥55** | hybrid:1464, master:80-81 | 5,067 | All score-qualified → WAIT/REJECT |
| **techStrongButOthersWeak → HOLD** | hybrid:1071-1076 | 5,675 | BUY downgrade |
| **momentumWeak blocks BUY** | hybrid:801,996 | 5,535 | NEUTRAL WAIT |
| **Master confidence < 40 → NO_TRADE** | conflict-detection:123-124 | 8,538 master | REJECTED despite score 55-67 |
| **Master BUY bar (≥68 score, ≥62 conf, ≥4 bullish, momentum≥60)** | conflict-detection:121 | all | Never reached (masterBuy=0) |
| **Hybrid BUY preservation (needs hybrid BUY + conf≥65)** | conflict-detection:182-196 | 0 | Never triggered |

**Dominant override turning approvable-by-score into WAIT/REJECT:** Hybrid **momentumWeak + HOLD mapping** for slot path; master **confidence floor** for expert path.

---

## 8. Learning mode

**Resolved:** `aiMode = learning` (from job + `resolved-config.json`)

**What it means in code:**

| Mechanism | File | Effect on TDI APPROVED |
|-----------|------|------------------------|
| `isPaperAutoRoundJob` | auto-round-engine:1157 | Enables paper execution |
| `paperRelaxed = mode === "paper"` | execution-orchestrator:1095 | Lowers some hybrid floors — **still 0 BUY** |
| `learningLane = mode === "paper"` | auto-round-engine:1672 | Micro-trade advisory path; **VETO policy blocked advisory bypass in this run** |

**Learning mode does NOT** directly set TDI verdict. It relaxes some paper thresholds but **does not disable** `momentumWeak` or master confidence floors. It is **not harmless** for approval count — paper relaxed still produced 0 hybrid BUY across 17,626 decisions.

---

## 9. Sensitivity divergence

**Generator:** `src/server/forensics/tdi-sensitivity.service.ts`

```typescript
// Sensitivity "approval" — NOT production TDI
const wouldApprove = scores.filter((score) => score >= effectiveThreshold).length;
approvalRate = wouldApprove / scores.length;  // → 28.4% at threshold 55

// Production actual
approvalRate = decisions.filter((row) => row.verdict === "APPROVED").length / total;  // → 0%
```

**Is sensitivity the production engine?** **NO.** It is a **simplified counterfactual** using only `consensusScore >= threshold`. It mixes hybrid composite and master expert scores in one array.

**Exact differences causing 28.4% vs 0%:**

1. Different approval criterion (score vs BUY)
2. Different score semantics in same field
3. Ignores momentumWeak / techStrongButOthersWeak
4. Ignores master confidence floor
5. Ignores expert matrix (bullishCount, matrix.momentum, matrix.execution)
6. Threshold 55 in master engine maps to **WATCHLIST**, not BUY — and WATCHLIST → TDI **WAIT**, not APPROVED

---

## 10. AI / TDI interaction (round-winner path)

**20 rounds** ended `AI_GATE_BLOCK: NO_TRADE`. **Separate from TDI APPROVED=0.**

**Round 4 ENSOTRY sequence (artifact-proven):**

| Order | Stage | TDI verdict | Decision |
|------:|-------|-------------|----------|
| 1 | hybrid TDI | WAIT | HOLD, score 68.93, "Momentum guven vermiyor" |
| 2 | master TDI | REJECTED | NO_TRADE, LEARNING+MOMENTUM blockers |
| 3 | AI execution gate | — | `aiFinalDecision=NO_TRADE`, VETO BLOCK |
| 4 | post-gate TDI bridge | WAIT | BELOW_THRESHOLD |

**Conclusion:** TDI **rejected/waited before AI** on this path. AI gate is a **downstream** blocker for round winners, not the explanation for **0 TDI APPROVED across all 17,626 slot evaluations**.

---

## 11. Config audit

| Key | Resolved / default | Relevance |
|-----|-------------------|-----------|
| TDI threshold (sensitivity) | **55** hardcoded in `tdi-sensitivity.service.ts` | Not used for runtime APPROVED |
| `AI_HYBRID_MIN_COMPOSITE_SCORE` | 62 | Hybrid BUY requires `compositeOk` |
| `AI_HYBRID_MIN_SENTIMENT_SCORE` | 52 | momentumWeak boundary |
| `AI_HYBRID_MIN_EDGE_SCORE` | 70 | strictScoreOk gate |
| `aiMode` | learning | Paper relaxed, not TDI approval |
| `EXECUTION_AI_GATE_POLICY` | VETO | Blocks round winners after TDI |
| `TRADING_DECISION_POLICY.minHybridConfidenceToPreserve` | 65 | Never met (0 hybrid BUY) |

**Hidden mismatch:** Sensitivity `DEFAULT_THRESHOLD = 55` is forensic-only; production master at score 55 returns **WATCHLIST** (→ WAIT), not APPROVED. No `.env` override changes the BUY-only approval definition.

**Historical baseline:** **NO_EXECUTING_LOCAL_BASELINE** — no local artifact with TDI APPROVED > 0 or orders > 0.

---

## 12. Primary root cause

```
PRIMARY: TDI_MASTER_DECISION_OVERRULE

Exact rule:
  Runtime TDI APPROVED ≡ (hybrid finalDecision === "BUY" OR master legacyDecision === "BUY")
  Sensitivity "approval" ≡ (consensusScore >= 55)
  These are not equivalent.

Affected: 5,067 candidates with score >= 55 (28.7% of TDI records)

Observed:
  - 0 hybrid BUY, 0 master BUY/STRONG_BUY
  - 3,226 score>=55 → HOLD (momentumWeak / techStrongButOthersWeak)
  - 3,125 score>=55 → master NO_TRADE (confidence < 40, LEARNING+MOMENTUM blockers)

Expected (sensitivity): ~28.4% score pass rate mislabeled as approval rate

Difference: Sensitivity counts score threshold; production requires full BUY pipeline

Confidence: HIGH
```

---

## 13. Contributing causes (max 5)

| P | Class | Detail |
|---|-------|--------|
| P0 | **SENSITIVITY_MODEL_DIVERGENCE** | `tdi-sensitivity.service.ts` is not production logic |
| P0 | **HYBRID_MOMENTUM_GATE** | `momentumWeak` + BUY→HOLD downgrade → 0 hybrid BUY |
| P1 | **MASTER_CONFIDENCE_FLOOR** | Blended confidence ~20–27 → NO_TRADE despite score 55–68 |
| P1 | **DUAL_SCORE_SEMANTICS** | Same `consensusScore` field, two different computations |
| P2 | **AI_GATE_ROUND_WINNER** | 20 terminal AI blocks — downstream of TDI, not cause of 0 APPROVED |

---

## 14. Safe fix proposals (NOT implemented)

### FIX-A — Align sensitivity with production verdict logic

| | |
|-|-|
| **What** | Replace `score >= threshold` counterfactual with replay of hybrid `finalDecision` + master `legacyDecision` rules |
| **Why** | Eliminates false 28.4% vs 0% paradox |
| **Risk** | LOW (forensic-only) |
| **Expected** | `sensitivity.approvalRate ≈ runtime.approvalRate` |
| **Tests** | Unit test: fixture `tdi-decisions.json` → approvalRate = 0 for canonical run |

### FIX-B — Rename misleading sensitivity metrics

| | |
|-|-|
| **What** | Rename to `scoreAboveThresholdRate`; add separate `projectedBuyApprovalRate` |
| **Why** | Operators must not read 28.4% as "approvable trades" |
| **Risk** | LOW |
| **Expected** | Forensic reports stop implying false approval pool |
| **Tests** | Schema/export validation |

### FIX-C — Split score fields in TDI artifacts

| | |
|-|-|
| **What** | `hybridCompositeScore` vs `masterExpertConsensusScore` in `TdiDecisionRecord` |
| **Why** | Enables per-candidate reconciliation |
| **Risk** | MEDIUM (artifact schema) |
| **Expected** | `runtimeScore vs recomputedScore` traceable |
| **Tests** | Round export snapshot test |

**NOT recommended without separate business decision:** Lowering TDI threshold to 55 — forensic proof shows threshold is **not** the runtime approval gate; lowering it would not fix BUY-only semantics.

---

## 15. 2-round validation design (do NOT run yet)

**Purpose:** Verify fix removes sensitivity/runtime paradox **or** document legitimate 0% BUY.

**Acceptance criteria:**

1. `tdi-sensitivity.approvalRate` within **2pp** of runtime `TDI APPROVED` rate
2. **Either** `TDI APPROVED > 0` **or** written proof that BUY gates legitimately block 100%
3. If APPROVED > 0: at least one non-empty `risk-sizing-trace.json`
4. AI gate exercised under VETO — no safety bypass
5. Artifacts: `tdi-decisions.json`, `tdi-sensitivity.json`, `decision-trace.json`, `risk-sizing-trace.json`

**Success metrics:**

| Metric | Target |
|--------|--------|
| Sensitivity vs runtime approval delta | ≤ 2% |
| `tdiApproved` | ≥ 1 OR documented N/A |
| `CRITICAL_AI_EXECUTION_BYPASS` | not triggered |

---

*End of report. No code, thresholds, prompts, risk, sizing, strategy, or allowlists were modified.*
