# KRIPTO P2 — Profitability Optimization Report

**References:** `CRYPTO_PROFITABILITY_FORENSIC_REPORT.md`, `KRIPTO_P0_PROFITABILITY_FOUNDATION_REPORT.md`, `KRIPTO_P1_PROFITABILITY_ENGINEERING_REPORT.md`  
**Validation artifact:** `kripto-p2-profitability-optimization.json`  
**Date:** 2026-08-15  

---

## Verdict

| Gate | Result |
|------|--------|
| P2 slot/TDI analysis (unit tests) | **PASS** (34/34 targeted) |
| Strategy A/B harness (single-change) | **PASS** |
| Regime × strategy matrix | **PASS** |
| Fee/timing experiments (offline) | **PASS** |
| AI × strategy forensic research | **PASS** |
| Experiment registry | **PASS** |
| Promotion gate (no auto-promote) | **PASS** |
| Production changes applied | **NONE** |
| Live 3-round smoke | **PENDING** |

**Overall P2 acceptance:** **PASS** (research complete; zero production promotions)

---

## 1. TDI Slot Analysis (P2-1)

**Architecture preserved:** `maxPositions = 3` (unchanged)

**New artifact:** `slot-allocation-analysis.json`

For every NO_SLOT candidate records:
- candidateId, symbol, rank, score, reasonCode, strategy, regime, EV
- Classification: `JUSTIFIED_NO_SLOT` | `POSSIBLE_MISSED_SLOT` | `UNKNOWN`
- Evidence array (post-entry move used **only** in forensic section)

**Historical context:** 87/102 TDI WAIT, many score-73 candidates — analyzed, not used to lower thresholds.

---

## 2. Slot Experiment (P2-1A)

**Artifact:** `slot-allocation-experiment.json`

| Variant | Description |
|---------|-------------|
| BASELINE | maxPositions=3 (offline sim) |
| EXPERIMENT | maxPositions=4 (offline sim) |

Metrics: tradeCount, winRate, grossPnL, fees, netPnL, expectancy, profitFactor, drawdown, capitalUtilization, missedOpportunities, riskExposure.

**Promotion:** RESEARCH_ONLY — no real risk increase, production unchanged.

---

## 3. TDI Sensitivity (P2-2)

**Artifact:** `tdi-sensitivity.json`

- Score distribution (min, max, mean, p50, p75, p90)
- Approval / WAIT / NO_SLOT rates
- Offline sensitivity at threshold ±2 (no production change)
- Recommendation: `NO_CHANGE` or `INSUFFICIENT_DATA`

**Production TDI threshold NOT modified.**

---

## 4. Volatility Breakout Validation (P2-3)

**Artifact:** `volatility-breakout-validation.json`

Historical n=3 (2W/1L) treated as **INSUFFICIENT_DATA** (minimum n=20).

Enhanced with regime breakdown cells labeled `NOT_ENOUGH_DATA` when sparse.

**Not promoted** despite tiny positive sample — by design.

---

## 5. Strategy A/B Results (P2-4)

**Single-change experiments only** (via `p2-experiment-services.ts`):

| experimentId | Variant |
|--------------|---------|
| mr-regime-filter | MR regime gating |
| breakout-regime-preference | Breakout regime filter |
| fee-aware-entry | Fee floor (offline) |
| entry-timing-protection | POSSIBLY_LATE block (offline) |

Combined multi-change bundle marked **MULTI_CHANGE_RESEARCH_ONLY** — not for promotion.

**Artifact:** `profitability-experiments.json`, `strategy-comparison-report.json`

---

## 6. Strategy × Regime Matrix (P2-5)

**Artifacts:** `strategy-regime-matrix.json`, `strategy-regime-matrix-p2.json`

Cells with n < 5 labeled **`NOT_ENOUGH_DATA`**.

Example research cells:
- Mean Reversion × RANGE
- Mean Reversion × HIGH_VOLATILITY
- Volatility Breakout × TREND

No rules created from sparse cells.

---

## 7. Fee-Aware Entry Experiment (P2-6)

**Artifact:** `fee-aware-entry-experiment.json`

Classifications: `FEE_SAFE`, `FEE_BORDERLINE`, `FEE_EROSION`

Compares baseline vs fee-floor experiment offline.

**Production blocking:** disabled (`blockingEnabledInProduction: false`)

---

## 8. Entry Timing Experiment (P2-7)

**Artifact:** `entry-timing-experiment.json`

| Baseline | Experiment |
|----------|------------|
| CURRENT_ENTRY | CONTROLLED_ENTRY_PROTECTION |

Blocks `POSSIBLY_LATE` entries **offline only**. Decision-time data only; no look-ahead.

---

## 9. AI × Strategy Interaction (P2-8)

**Artifact:** `ai-strategy-interaction.json`

Analyzes AI APPROVE / NO_TRADE / REJECT by strategy and regime.

**AI prompts NOT modified. AI decisions NOT overridden.**

Forensic research only unless statistically supported experiment passes promotion gate.

---

## 10. Opportunity Value (P2-9)

**Artifact:** `opportunity-value.json`

Post-entry movement used **only** in `POST_ENTRY_ANALYSIS` scope.

Stages ranked: SCANNER, TDI, SLOT, SIZING, AI, RISK, EXECUTION.

Never fed back into live decision path.

---

## 11. Experiment Registry (P2-11)

**Artifact:** `profitability-experiments.json`

Each experiment records:
- experimentId, baseline, variant, hypothesis, parameters
- sample, metrics, risk, result, promotionStatus

`safetyPreserved`: aiGate, riskGate, sizingGate, executionIntegrity, pnlReconciliation = true

---

## 12. Promotion Decisions (P2-10)

**Artifacts:** `promotion-gate.json`, `promotion-decisions.json`

| Change | Status |
|--------|--------|
| Slot 3 vs 4 | RESEARCH_ONLY |
| Fee-aware entry | RESEARCH_ONLY |
| Entry timing protection | RESEARCH_ONLY |
| TDI threshold | NO_CHANGE / REJECTED |
| Volatility Breakout n=3 | REJECTED |
| Combined multi-change | RESEARCH_ONLY |

**Runtime `promoted: false` always.**

---

## 13. Tests

```
tests/forensics/p2-profitability-optimization.test.ts  → 11/11
tests/forensics/p2-tdi-slot-strategy.test.ts           → 11/11
tests/forensics/p1-profitability-engineering.test.ts   → 11/11
tests/forensics/round-export.test.ts                   → 1/1
Total: 34/34 PASS
```

---

## 14. Controlled Validation

Script: `npx tsx scripts/run-p2-profitability-optimization-validation.ts`

- Max **3 rounds**
- Verifies P2 artifacts, no auto-promotion, safety preserved
- Does **not** optimize for profitability

---

## 15. Final Recommended Production Changes

**None at this time.**

All experiments remain research-only pending:
- n ≥ 20 sample
- Positive net expectancy improvement
- Acceptable drawdown
- OOS confirmation
- No symbol overfit

---

## Changes That Must Remain Research-Only

1. MR regime filter
2. Fee-aware entry floor
3. Entry timing protection
4. Slot 4 simulation
5. TDI threshold adjustment
6. Volatility Breakout promotion from n=3

---

## Preserved (Unchanged)

- Sizing threshold 45
- Risk limits
- maxPositions = 3
- AI prompts / VETO gate
- EV thresholds
- SL/TP values
- Emergency stop
- Binance API safety

---

## Files Added/Changed

| File | Purpose |
|------|---------|
| `slot-allocation-analysis.service.ts` | P2-1 NO_SLOT classification |
| `slot-allocation-experiment.service.ts` | P2-1A 3 vs 4 offline |
| `tdi-sensitivity.service.ts` | P2-2 threshold research |
| `ai-strategy-interaction.service.ts` | P2-8 AI × strategy |
| `opportunity-value.service.ts` | P2-9 post-entry value |
| `p2-experiment-services.ts` | Fee/timing/A/B helpers |
| `experiment-registry.service.ts` | P2-11 registry |
| `p2-forensic-report.service.ts` | Unified P2 bundle |
| `volatility-breakout-validation.service.ts` | Regime breakdown |
| `promotion-gate.service.ts` | NOT_ENOUGH_DATA cells |
| `round-forensic-export.service.ts` | 10 new P2 artifacts |
| `tests/forensics/p2-profitability-optimization.test.ts` | P2 acceptance tests |
| `scripts/run-p2-profitability-optimization-validation.ts` | Live smoke |

---

## Remaining Blockers

1. No experiment meets PROMOTABLE criteria (sample + OOS)
2. Live 3-round artifact export validation pending
3. Repeatable STRATEGY + REGIME + ENTRY + AI + FEE edge not yet proven at scale

**Objective status:** Research infrastructure complete; profitability optimization awaits evidence, not trade-count chasing.
