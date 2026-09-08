# KRIPTO Scanner Discovery V2 Report

## 1. Executive Summary

Üçüncü frozen dataset (2026-08-18 → 2026-08-28, overlap yok) üzerinde setup-aware **Scanner Discovery V2** test edildi. 4 setup family, cost-aware opportunity labeling, false positive/negative forensic ve top-N architecture analizi yapıldı.

**Sonuç:** V2 VALIDATION gate geçemedi — validation positive-edge rate baseline'dan düştü (45.45% vs ~57%). FINAL TEST economics replay atlandı. Production discovery **değiştirilmedi**.

- **STRATEGY_VERDICT:** NO_DISCOVERABLE_EDGE
- **NEXT_PHASE:** STRATEGY_ARCHITECTURE_REDESIGN
- **RUN_15H_PAPER:** NO

## 2. Starting HEAD

`fbf5c721f17cb903517fccc626b7ac7eb07984f4`

## 3. Previous Evidence

| Period | Winner rate | Ranking miss |
|--------|------------:|-------------:|
| Reference (Sep 4–7) | 22.54% | ~65% |
| Unseen #2 (Aug 28–Sep 4) | 22.41% | 57.19% |
| Ranking V2 | FAIL | worse than baseline |

Scanner score non-predictive. AI master gates unchanged.

## 4. New Dataset

| Alan | Değer |
|------|-------|
| Start | 2026-08-18T00:00:00Z |
| End | 2026-08-28T00:00:00Z |
| Symbols | 11 |
| Windows | 917 |
| Overlap | None with prior datasets |

## 5. TRAIN / VALIDATION / FINAL TEST

| Split | Period |
|-------|--------|
| TRAIN | 60% — Aug 18–24 |
| VALIDATION | 25% — Aug 24–26 12:00 |
| FINAL TEST | 15% — Aug 26 12:00–28 |

## 6. Production Baseline

| Metric | Value |
|--------|------:|
| Qualified candidates | 4,566 |
| Selected (top-1) | 911 |
| Positive-edge rate (cost-aware label) | 56.97% |
| TP_FIRST rate (1.2/0.8) | 34.91% |
| SL_FIRST rate | 54.23% |
| Winner rate (TP vs SL) | 39.16% |
| Avg max net opportunity | 1.99% |

## 7. Market State Features

Production-computable: returns 1m–60m, volume ratios, acceleration, persistence, PV confirmation, ATR, RSI, EMA distances, spread, liquidity, BTC context, regime, micro score.

## 8. Cost-Aware Labels

Realistic round-trip: **0.44%** (fee 0.30% + slippage 0.14%).

| Class | Threshold |
|-------|-----------|
| STRONG_POSITIVE_EDGE | max net opp ≥ 1.5% |
| WEAK_POSITIVE_EDGE | max net opp ≥ 0.44% |
| NEGATIVE_EDGE | max net opp < -0.44% |

## 9. Positive Edge Candidate Profile

ELITE tier (confidence ≥72): **68.29%** positive-edge rate. Volume-confirmed momentum + moderate extension from low. Sustained volumeRatio20 band 0.85–1.85.

## 10. Negative Candidate Profile

Dominant loser patterns: weak volumeRatio20, near 60m high, momentum without volume persistence, pump boost inflation.

## 11. False Positives (baseline selected losers)

| Root cause | Count |
|------------|------:|
| weak_volume_ratio20 | 270 |
| near_60m_high | 169 |
| score_saturation_no_separation | 121 |
| pump_boost_inflation | 83 |
| momentum_without_volume | 42 |

**FALSE_POSITIVE_ROOT_CAUSE:** Scanner qualifies high score despite weak persistent volume — score components don't penalize volume deficiency enough.

## 12. False Negatives (missed positive-edge setups)

| Gate blocking | Count |
|---------------|------:|
| score_below_threshold | 2,250 |
| regime_or_direction | 87 |

**FALSE_NEGATIVE_ROOT_CAUSE:** Hard score threshold rejects setups that later show positive cost-aware opportunity.

## 13. Discovery Miss Reasons

Top-1 captures only 57.54% of windows with a positive-edge candidate present. Top-3 captures 81.15% — **architectural information loss from top-1-only selection**.

## 14. Setup Families

| Family | Discovered count |
|--------|-----------------:|
| BREAKOUT_CONTINUATION | 337 |
| TREND_PULLBACK | 159 |
| VOLUME_CONFIRMED_MOMENTUM | 128 |
| VOLATILITY_EXPANSION | 83 |

## 15. Setup Confidence

Tier buckets show ELITE > HIGH ≈ MEDIUM > LOW for positive-edge rate (68% vs ~55%).

## 16. Confidence Monotonicity

**true** — ELITE bucket (68.29%) outperforms lower tiers. Scoring semantics valid within V2 families.

## 17. Top-1 vs Top-N

| Architecture | Positive-edge capture |
|--------------|----------------------:|
| Top-1 | 57.54% |
| Top-2 | 74.17% |
| Top-3 | 81.15% |

**Verdict:** Top-1-only is significant information loss; top-3 shortlist to AI would capture ~24pp more positive setups (offline only — not wired).

## 18. Discovery V2 Architecture

Setup-aware evaluation → shortlist (max 3/window) → top-1 selected. Hard gates: spread safety, invalidating conditions per family. No global 0–100 score compression.

## 19. Development Results

707 discovered / 671 shortlisted across full dataset. V2 is more selective than baseline (4,566 qualified).

## 20. Validation Results

| Metric | Baseline (VAL) | V2 (VAL) |
|--------|---------------:|---------:|
| Selected count | ~228 | 110 |
| Positive-edge rate | ~57%* | **45.45%** |
| Avg net opportunity | ~1.5%* | 0.66% |
| Winner rate (TP/SL) | ~39%* | 38.04% |

*Estimated from full-dataset baseline; V2 validation underperforms → **VALIDATION FAIL**.

## 21. Final Test

| Metric | Baseline (TEST) | V2 (TEST) |
|--------|----------------:|----------:|
| Selected | ~73 | 73 |
| Positive-edge rate | ~55%* | 53.42% |
| Winner rate | ~39%* | **49.12%** |
| Avg net opportunity | ~1.5%* | 2.09% |

Final test shows improvement on winner rate but validation gate not passed → economics replay **not executed** (0 trades).

## 22. Candidate Quality Before/After

V2 reduces false positives via setup filters but also filters out too many validation positive-edge setups. Net validation quality **worse**.

## 23. MFE/MAE

V2 final test selected: avg net opp 2.09%, SL rate 39.73% (vs baseline 54% on full dataset).

## 24. Setup-Specific Exit Economics

| Family | TP | SL | Hold |
|--------|---:|---:|-----:|
| VOLUME_CONFIRMED_MOMENTUM | 2.2% | 0.8% | 75m |
| BREAKOUT_CONTINUATION | 2.8% | 0.85% | 90m |
| TREND_PULLBACK | 1.6% | 0.7% | 60m |
| VOLATILITY_EXPANSION | 2.5% | 0.9% | 75m |

Not replayed — validation gate failed.

## 25. Cost-Adjusted Replay

**0 trades** — FINAL TEST replay skipped per protocol.

## 26. AI Recheck

Skipped — no positive economics gate.

## 27. AI Value Add

N/A

## 28. Production Wiring Decision

**PRODUCTION_DISCOVERY_V2_WIRED = false**

## 29. Strategy Verdict

**NO_DISCOVERABLE_EDGE** — V2 failed validation; cost-adjusted positive expectancy not demonstrated on unseen FINAL TEST.

## 30. 15H PAPER Decision

**RUN_15H_PAPER = NO**

## 31. Recommended Next Phase

**STRATEGY_ARCHITECTURE_REDESIGN** — Momentum/pump-hunting scanner paradigm may lack discoverable edge. Consider: multi-candidate AI shortlist (top-3), regime-specific strategies, or fundamentally different signal generation.

**DISCOVERY_ROOT_CAUSE:** GLOBAL_SCORE_COLLAPSES_DISTINCT_SETUPS — single score cannot separate setup types; volume persistence is the strongest discriminator but current scanner under-weights it.

---
*Generated 2026-09-07T22:46:54Z*
