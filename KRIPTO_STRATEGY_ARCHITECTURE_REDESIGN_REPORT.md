# KRIPTO Strategy Architecture Redesign Report

## 1. Executive Summary

Fresh dataset (2026-08-04 → 2026-08-18, overlap yok) üzerinde 7 setup family bağımsız test edildi. **Hiçbir setup VALIDATION gate geçemedi.** Tüm family'ler realistic cost altında negatif expectancy gösterdi.

- **STRATEGY_ARCHITECTURE_VERDICT:** NO_EDGE_ACROSS_TESTED_SETUPS
- **NEXT_PHASE:** ALTERNATIVE_MARKET_PARADIGM
- **RUN_15H_PAPER:** NO
- **PRODUCTION_WIRED:** false

## 2. Starting HEAD

`fbf5c721f17cb903517fccc626b7ac7eb07984f4`

## 3. Prior Evidence

Scanner ~22–27% winner rate, ranking FAIL, Discovery V2 FAIL, top-1 vs top-3 information loss confirmed across prior datasets.

## 4. New Dataset

| Alan | Değer |
|------|-------|
| Start | 2026-08-04T00:00:00Z |
| End | 2026-08-18T00:00:00Z |
| Windows | 1,049 |
| Symbols | 11 |

## 5. Train / Validation / Final Test

| Split | Period |
|-------|--------|
| TRAIN | 55% — Aug 4 – Aug 11 16:48 |
| VALIDATION | 25% — Aug 11 – Aug 15 04:48 |
| FINAL TEST | 20% — Aug 15 – Aug 18 |

## 6. Baseline

Production scanner top-1: 1,003 selected, **50.55%** positive-edge rate (cost-aware label).

## 7. Setup Architecture

```
market state → setup detectors → setup-specific confidence → diversified shortlist → setup-specific exit
```

Global score kullanılmadı. Her family ayrı contract + exit profile.

## 8. BREAKOUT_CONTINUATION

| Split | Samples | Expectancy | PF | Net PnL |
|-------|--------:|-----------:|---:|--------:|
| VAL | 77 | **-5.96** | 0.19 | -458.96 |
| TEST | 44 | -2.27 | 0.60 | -99.93 |

**REJECTED**

## 9. TREND_PULLBACK

| Split | Samples | Expectancy | PF |
|-------|--------:|-----------:|---:|
| VAL | 13 | -5.37 | 0.00 |
| TEST | 9 | -6.42 | 0.00 |

**REJECTED** (insufficient + negative)

## 10. VOLUME_CONFIRMED_MOMENTUM

| Split | Samples | Expectancy | PF |
|-------|--------:|-----------:|---:|
| VAL | 15 | -3.38 | 0.52 |
| TEST | 19 | -3.81 | 0.56 |

**REJECTED**

## 11. MEAN_REVERSION

| Split | Samples | Expectancy | PF | Net PnL |
|-------|--------:|-----------:|---:|--------:|
| VAL | 443 | -3.68 | 0.19 | -1,628 |
| TEST | 330 | -4.26 | 0.17 | -1,406 |

En fazla sample ama en kötü performans. **REJECTED**

## 12. VOLATILITY_EXPANSION

1 TRAIN sample only. **DISABLED_EXPERIMENT**

## 13. POST_SPIKE_CONSOLIDATION

2 VAL samples. **DISABLED_EXPERIMENT**

## 14. RANGE_BREAK

| Split | Samples | Expectancy | PF | Net PnL |
|-------|--------:|-----------:|---:|--------:|
| VAL | 163 | -4.45 | 0.12 | -725 |
| TEST | 117 | -3.68 | 0.31 | -431 |

**REJECTED**

## 15–16. Setup Confidence & Monotonicity

Not evaluated per-family (all failed edge gate before monotonicity mattered).

## 17. Top-1 vs Top-N

| Metric | Rate |
|--------|-----:|
| Top-1 positive capture | **66.14%** |
| Top-3 diversified capture | **81.85%** |
| Windows with positive setup | 573 |

Pattern persists: top-1 loses ~16pp vs diversified shortlist.

## 18. Setup-Diversified Shortlist

Offline architecture tested; no production wiring.

## 19–20. Cost-Aware Labels & Exit Models

Realistic round-trip **0.44%**. Per-family exit from TRAIN MFE contract defaults.

## 21. Pre-AI Expectancy

**No setup passed VALIDATION** → portfolio replay 0 trades.

## 22. Rejected Setup Families

ALL 7: BREAKOUT, PULLBACK, VOLUME_MOMENTUM, MEAN_REVERSION, VOL_EXPANSION, RANGE_BREAK, POST_SPIKE.

## 23. Final Test

No passing setups → FINAL TEST portfolio not executed.

## 24. Portfolio Combination

0 trades | net 0 | expectancy 0

## 25–27. AI Reintroduction / Value Add

Skipped — pre-AI edge gate not met.

## 28. Production Architecture Proposal

Multi-setup architecture is conceptually sound (top-3 capture +81%) but **no setup family demonstrated positive cost-adjusted edge** on unseen data. Do not wire.

## 29. Production Wiring Decision

**false**

## 30. Strategy Verdict

**NO_EDGE_ACROSS_TESTED_SETUPS**

Momentum-based intraday spot hunting across all tested paradigms (breakout, pullback, volume, mean reversion, range, post-spike) shows **negative expectancy** after realistic costs.

## 31. 15H PAPER Decision

**NO**

## 32. Next Phase

**ALTERNATIVE_MARKET_PARADIGM** — Consider: cross-sectional relative strength, BTC regime rotation, multi-day swing, stat-arb baskets. Momentum intraday paradigm should be deprioritized.

---
*Generated 2026-09-07T23:15:32Z*
