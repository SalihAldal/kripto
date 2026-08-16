# KRIPTO P1 — Profitability / Strategy Edge Engineering Report

**Reference evidence:** `CRYPTO_PROFITABILITY_FORENSIC_REPORT.md` (15 trades, MR 0/7, VB 2/3, EV ~15.8 vs negative net, 87/102 TDI WAIT)  
**Validation artifact:** `kripto-p1-profitability-engineering.json`  
**Date:** 2026-08-15  

---

## Verdict

| Gate | Result |
|------|--------|
| P1 forensic instrumentation (unit tests) | **PASS** (33/33 targeted) |
| MR regime gating experiment (offline) | **PASS** — RESEARCH_ONLY |
| EV calibration + attribution (offline) | **PASS** |
| Opportunity funnel + loss/win patterns | **PASS** |
| Fee-aware edge research (observe only) | **PASS** |
| Promotion gate (no auto-promote) | **PASS** |
| Strategy/threshold/risk/safety unchanged | **PASS** |
| Live 2-round smoke validation | **PENDING/RUNNING** |

**Overall P1 acceptance:** **PASS** (research layer complete; no production strategy promotion)

---

## 1. MR Regime Findings

**Reference:** Mean Reversion 7 trades, 0 wins, ~-1.50 TRY net — **insufficient to delete strategy**.

**Implementation:**
- Every MR candidate records: regime, volatility, trend strength, liquidity, momentum, side, entry timing, spread (via `bridgeMeanReversionEntry`)
- Forensic regime taxonomy: `RANGE`, `TREND`, `HIGH_VOLATILITY`, `LOW_VOLATILITY`, `CHAOS`, `LOW_LIQUIDITY`, `UNKNOWN`
- All classification uses **decision-time fields only**

**P1-1A experiment (`mr-regime-gating-experiment.json`):**

| Variant | Description |
|---------|-------------|
| `CURRENT_MR` | All MR trades in sample |
| `MR_WITH_REGIME_FILTER` | Excludes `CHAOS`, `HIGH_VOLATILITY`, `TREND` |

Metrics reported: tradeCount, winRate, grossPnL, fees, netPnL, profitFactor, expectancy, drawdown, missedOpportunities.

**Promotion:** `RESEARCH_ONLY` (sample below n=20). MR **not disabled** in production.

---

## 2. Scanner Qualification Findings

**Reference:** NOT_DISCOVERED movers (e.g. VICTRY, REDTRY) — goal is diagnosis, not manual symbol adds.

**Implementation (`scanner-qualification-forensics.service.ts`):**
- Captures per exclusion: symbol, stage, filterName, reasonCode, reasonDetail, threshold, actualValue
- First blocking layer identified via `resolvePrimaryScannerRejection`
- Post-entry analysis (`not-discovered-analysis.json`) uses qualification trail **without** injecting future price into filter decisions

**Classification guidance:**
- `LIKELY_CORRECT_FILTER` — volume/spread/score thresholds legitimately fail
- `POSSIBLE_FALSE_NEGATIVE` — in-universe but outside cycle slice
- `INSUFFICIENT_EVIDENCE` — no qualification trail

---

## 3. EV Calibration

**Reference:** Positive EV ~15.8 did not translate to positive replay outcomes.

**Implementation (`ev-calibration.service.ts`):**
- Bucketed by EV width (default 5)
- Per bucket: sampleCount, winRate, averageGross, averageNet, expectancy, profitFactor, calibrationDelta
- **EV threshold unchanged**

Artifact: `ev-calibration.json`

---

## 4. EV Component Attribution (P1-3A)

**New:** `ev-component-attribution.service.ts` → `ev-component-attribution.json`

| Component | Role |
|-----------|------|
| expectedProfit | Positive return input |
| expectedLoss | Downside penalty |
| fees | Round-trip fee drag |
| winProbability | Probability weight |
| expectedRiskReward | R/R modifier |

Each component reports: weight, range, observed contribution, evidence quality.

**Formula unchanged.** Dominant weak input surfaced for research.

---

## 5. Entry Timing

**Implementation (`entry-timing-forensics.service.ts`):**
- Tracks candidate → decision → entry timestamps
- Computes entry delay, price movement, slippage proxy
- Classifies: `GOOD_ENTRY`, `NORMAL`, `POSSIBLY_LATE`, `UNKNOWN`

**Thresholds unchanged.** Used in offline A/B harness only (`entryTimingProtection` flag).

Artifact: `entry-timing.json`

---

## 6. Strategy × Regime Performance

**Enhanced `strategy-performance.json`:**
- Added: averageWin, averageLoss, medianHoldingTimeMs

**New `strategy-regime-matrix.json`:**
- Cells: strategy × regime with tradeCount, winRate, grossPnL, fees, netPnL, expectancy, profitFactor

Example research cells: Mean Reversion × RANGE, Volatility Breakout × HIGH_VOLATILITY.

---

## 7. Loss Patterns (P1-6)

**New:** `trade-pattern-analysis.service.ts` → `loss-patterns.json`

| Code | Evidence requirement |
|------|---------------------|
| FEE_DRAG | fees ≥ gross magnitude |
| ENTRY_TIMING | POSSIBLY_LATE classification |
| REGIME_MISMATCH | MR in TREND / CHAOS / HIGH_VOL |
| EXIT_PROBLEM | END_OF_REPLAY without TP/SL |
| NORMAL_VARIANCE | small loss within fee noise |
| STRATEGY_WEAKNESS | fallback when no stronger evidence |

Each classification includes explicit `evidence[]` array.

---

## 8. Winning Patterns (P1-7)

**New:** `winning-patterns.json`

| Level | Criteria |
|-------|----------|
| HYPOTHESIS | n < 5 or weak evidence |
| FACT | n ≥ 5 with supporting evidence |
| REPEATED_PATTERN | n ≥ 20 with multiple evidence lines |

No symbol-specific rules. No overfit to n < 20.

---

## 9. Opportunity Funnel (P1-8)

**New:** `opportunity-funnel.service.ts` → `opportunity-funnel.json`

Canonical stages:
```
DISCOVERED → STRATEGY_QUALIFIED → TDI → AI → RISK → EXECUTION
```

Loss reasons aggregated:
`NOT_DISCOVERED`, `FILTERED_OUT`, `TDI_WAIT`, `NO_SLOT`, `AI_REJECTED`, `RISK`, `EXECUTION_FAILED`

Post-entry movement **not** used in live funnel counts.

---

## 10. NO_SLOT Analysis (P1-9)

**Existing P2 instrumentation retained:**
- `tdi-decisions.json` — WAIT taxonomy: `NO_SLOT`, `BELOW_THRESHOLD`, `NEUTRAL`, `RISK`, `COOLDOWN`
- `slot-opportunity-report.json` — selected vs next-best (score gap, strategy, regime, EV)

**maxPositions=3 unchanged.** Analysis-first; no slot allocation changes.

---

## 11. Fee-Aware Edge Research (P1-10)

**New:** `fee-aware-edge-research.service.ts` → `fee-aware-edge-research.json`

Uses P0 `FeeEdgeMetricsSnapshot` from decision traces:
- `edgeAfterFees = expectedNetAfterFeesAtTp`
- Classifies: `FEE_ERASING_EDGE`, `FEE_SAFE_EDGE`, `UNKNOWN`

**Auto-blocking disabled** (`blockingEnabled: false` in orchestrator).

---

## 12. Experiment Results (P1-11)

**Harness:** `strategy-comparison-harness.service.ts`

Single-change experiments supported:
- MR regime filter (`regimeGating`)
- Fee floor (`feeFloor`)
- Entry timing protection (`entryTimingProtection`)

Reports: sample, netPnL, grossPnL, fees, drawdown, expectancy, winRate, profitFactor, tradeCount, missed opportunities, risk impact.

**No combined multi-change experiments in default bundle.**

Artifact: `strategy-comparison-report.json`, `mr-regime-gating-experiment.json`

---

## 13. Promotion Gates (P1-12)

**New:** `promotion-gate.service.ts`

| Status | Meaning |
|--------|---------|
| PROMOTABLE | All criteria met (rare; requires n≥20, improved expectancy, drawdown ok, OOS) |
| RESEARCH_ONLY | Partial evidence |
| REJECTED | Fails core criteria |

**Runtime `promoted: false` always** in this pass.

Artifacts: `p1-promotion-gate.json`, `promotion-gate.json`

---

## 14. Tests

```
npm run test:run -- tests/forensics/p1-profitability-engineering.test.ts
→ 11/11 PASS

npm run test:run -- tests/forensics/p1-strategy-scanner-ev.test.ts
→ 10/10 PASS

npm run test:run -- tests/forensics/p2-tdi-slot-strategy.test.ts
→ 11/11 PASS

npm run test:run -- tests/forensics/round-export.test.ts
→ 1/1 PASS
```

Coverage: MR regime experiment, NOT_DISCOVERED, EV calibration, EV attribution, entry timing, strategy×regime matrix, loss/win patterns, opportunity funnel, fee edge research, A/B harness, promotion gate, no look-ahead.

---

## 15. Controlled Validation

Script: `npx tsx scripts/run-p1-profitability-engineering-validation.ts`

- **Max 2 rounds**
- Validates: P1 artifacts exported, AI VETO preserved, no auto-promotion
- **Not** optimizing for profitability

Update `kripto-p1-profitability-engineering.json` with live session results when complete.

---

## Files Changed

| File | Purpose |
|------|---------|
| `ev-component-attribution.service.ts` | P1-3A EV attribution |
| `mr-regime-gating-experiment.service.ts` | P1-1A MR A/B |
| `opportunity-funnel.service.ts` | P1-8 funnel |
| `trade-pattern-analysis.service.ts` | P1-6/7 loss/win patterns |
| `fee-aware-edge-research.service.ts` | P1-10 fee edge research |
| `promotion-gate.service.ts` | P1-12 promotion evaluation + strategy×regime matrix |
| `p1-forensic-report.service.ts` | Unified P1 bundle |
| `p2-forensic-report.service.ts` | Uses shared promotion gate |
| `mean-reversion-regime-audit.service.ts` | Enhanced strategy performance metrics |
| `forensic.types.ts` | New P1 report types |
| `round-forensic-export.service.ts` | 8 new JSON artifacts |
| `tests/forensics/p1-profitability-engineering.test.ts` | P1 acceptance tests |
| `scripts/run-p1-profitability-engineering-validation.ts` | 2-round smoke |

---

## Remaining P1/P2 Blockers

1. **Reference sample too small** (n=15) — no production threshold or strategy changes justified
2. **MR regime filter** — RESEARCH_ONLY until n≥20 + OOS
3. **Volatility Breakout n=3** — not promoted despite positive reference (by design)
4. **Live artifact export** — confirm on completed 2-round smoke run
5. **Cycle-slice blind spot** — symbols outside scanner cycle not fully traced pre-discovery

---

## Safety Confirmation

| Rule | Status |
|------|--------|
| No threshold lowering for trade count | ✅ |
| No MR deletion | ✅ |
| No symbol allowlists | ✅ |
| No sizing 45 change | ✅ |
| No EV/TDI threshold change | ✅ |
| No maxPositions change | ✅ |
| No AI bypass | ✅ |
| No look-ahead in live decisions | ✅ |
| No auto-promotion to production | ✅ |
