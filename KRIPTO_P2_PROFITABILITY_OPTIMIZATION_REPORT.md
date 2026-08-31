# KRIPTO P2 — Strategy + Regime + Edge Profitability Optimization

Date: 2026-08-17  
Primary outputs: `kripto-p2-profitability-optimization.json`, `kripto-strategy-regime-matrix.csv`, `kripto-profitability-experiments.csv`

## Final Profitability Verdict

**NOT_PROVEN**

Rationale: P2 research infrastructure and artifact chain are working, but current post-fix controlled run produced 0 closed trades in the only completed round window. There is not enough post-fix trade evidence yet to claim repeatable positive net edge.

## 1) Current Baseline

Source: `artifacts/forensics/cmsxj8zqh0007un4ksq8ygspa/rounds/1/baseline-metrics.json`

- tradeCount: 0
- winRate: 0
- grossPnL: 0
- fees: 0
- netPnL: 0
- profitFactor: 0
- expectancy: 0
- maxDrawdown: 0
- averageWin / averageLoss / averageHold / medianHold: 0

Interpretation: post-P0/P1/P1-fix baseline is observable, but statistically empty in this validation snapshot.

## 2) Strategy × Regime Matrix

- JSON: `strategy-regime-matrix-p2.json`
- CSV: `kripto-strategy-regime-matrix.csv`
- Sparse cells are marked `NOT_ENOUGH_DATA`.
- No production rule is promoted from sparse cells.

## 3) Mean Reversion Analysis

Historical evidence remains negative, but post-fix sample is insufficient for causal promotion decisions.

Separation framework is implemented via artifacts:

- `MR_REGIME_MISMATCH` (regime gating experiment)
- `MR_ENTRY_PROBLEM` (entry timing experiment)
- `MR_FEE_PROBLEM` (fee-aware experiment)
- `MR_EXIT_PROBLEM` (exit-forensics + exit-fee-interaction)
- `MR_STRATEGY_WEAKNESS` (only if reproduced with sufficient sample)

Current state: **RESEARCH_ONLY**

## 4) Volatility Breakout Analysis

- Validation artifact: `volatility-breakout-validation.json`
- Success/failure pattern mapping remains research-only due low effective post-fix sample.
- No automatic disable/promotion applied.

## 5) Trend Following Analysis

New artifact: `trend-following-validation.json`

- Verdict logic: `NOT_PROVEN` when trend/momentum trade sample < 10
- Current state: **NOT_PROVEN**

## 6) Candidate Quality Analysis

New artifact: `candidate-quality-factors.json`

Compares winners vs losers on available decision-time factors:

- net/gross/fee profile
- fee-to-gross ratio
- entry delay and movement-to-entry
- TDI score
- expected gross-to-fee ratio

Evidence class output:

- `FACT` / `REPEATED_PATTERN` / `HYPOTHESIS`

## 7) EV Calibration

- Artifact: `ev-calibration.json`
- No threshold change is promoted from sparse/unknown EV buckets.
- If bucket sample insufficient, calibration is effectively blocked by evidence quality.

## 8) TDI Calibration

- Artifact: `tdi-sensitivity.json`
- Classification path retained: `GOOD_FILTER` / `OVERLY_CONSERVATIVE` / `MISALIGNED` / `UNKNOWN` via evidence
- No threshold mutation in production from current sample.

## 9) AI Predictive Quality

- Artifact: `ai-strategy-interaction.json`
- AI execution parity remains protected (NO_TRADE bypass remains guarded by VETO path).
- Predictive quality remains evidence-limited in this run.

## 10) Regime Gating Experiment

- Single-change MR regime experiment remains active in A/B harness.
- Promotion gate now evaluates single-change candidate instead of multi-change bundle for promotability decision.
- Status: **RESEARCH_ONLY**

## 11) Entry Quality Experiment

- Artifact: `entry-timing-experiment.json`
- Uses existing timing classes (`POSSIBLY_LATE`, `CHASING`, `EDGE_DECAY`) offline.
- No arbitrary runtime timing threshold introduced.

## 12) Fee-Aware Profitability Experiment

- Artifact: `fee-aware-entry-experiment.json`
- Classification: `FEE_SAFE`, `FEE_BORDERLINE`, `FEE_EROSION`
- Blocking remains disabled in production.
- Status: **RESEARCH_ONLY**

## 13) Strategy A/B Harness

- Single-change experiments exported in `single-change-experiments.json`
- Experiment registry exported in `profitability-experiments.json` and `kripto-profitability-experiments.csv`
- Breakout regime preference now appears in experiment registry.

## 14) Out-of-Sample Validation

New artifact: `out-of-sample-evaluation.json`

- 70/30 chronological split when sufficient rows exist.
- If insufficient sample, OOS gate explicitly fails with reason.
- Current status in this run: unavailable/insufficient evidence.

## 15) Profit Promotion Gate

Promotion gate now includes:

- expectancy improvement
- drawdown control
- sample threshold
- OOS support
- symbol concentration control
- single-trade dependence control

Auto-promotion remains disabled (`promoted: false`) unless all strict criteria pass.

## 16) Profit Concentration

New artifact: `profit-concentration.json`

Reports:

- top1 trade contribution
- top3 contribution
- top symbol contribution
- top strategy contribution
- top regime contribution
- classification: `REAL_EDGE` vs `SINGLE_TRADE_LUCK`

## 17) Loss Attribution Before vs After Fixes

- Historical reference (pre/post older sample): net negative with heavy fee drag and replay-window distortion.
- Current post-fix controlled run sample: zero closed trades in completed round window.

Conclusion: attribution delta is **inconclusive** in this run; framework exists, evidence not yet sufficient.

## 18) Do-Not-Touch Classification

- `DO_NOT_CHANGE_YET`: AI confidence thresholds, TDI thresholds, EV thresholds, sizing/risk limits, maxPositions, AI prompts, SL/TP, strategy hard on/off, symbol allowlists.
- `RESEARCH`: MR regime gating, breakout regime preference, entry timing protection, fee-aware filter.
- `CHANGE` (implemented observability only): baseline/OOS/concentration/candidate-factor/CSV/export and promotion-gate strictness.

## 19) Current Profitability Verdict

**NOT_PROVEN**

Not enough post-fix closed-trade evidence yet for `MIXED`, `PROMISING`, or `POSITIVE_OBSERVATION`.

## 20) Required Validation Design

Defined staged gates in `kripto-p2-profitability-optimization.json`:

- 5–10 rounds: minTrades 5 + non-replay exit + fee reconciliation + AI parity + required artifacts
- 30–50 rounds: minTrades 20 + matrix/concentration baseline artifacts
- 100+ rounds: minTrades 60 + OOS + promotion-gate evidence

## 21) Tests

Executed targeted suites:

- `tests/forensics/p2-profitability-optimization.test.ts` (13)
- `tests/forensics/p2-tdi-slot-strategy.test.ts` (11)
- `tests/forensics/p1-profitability-engineering.test.ts` (11)
- `tests/forensics/round-export.test.ts` (1)

Total: 36 passing tests in targeted run.

## 22) Controlled Validation Outcome

Script: `scripts/run-p2-profitability-optimization-validation.ts` (5 rounds max)

- Session: `cmsxj8zqh0007un4ksq8ygspa`
- Round 1 generated complete P2 artifact set (JSON + CSV)
- Remaining rounds were not completed in this run window
- No auto-promotion and no safety bypass detected

## Promotion Decisions Summary

All strategy/entry/fee variants remain **RESEARCH_ONLY** in production until sufficient sample + OOS support is achieved.
