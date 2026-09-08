# KRIPTO Funding/Basis Alpha V3 & 3H Forward Report

## Dataset

| Metric | Value |
|--------|-------|
| Period | 2026-02-01 → 2026-08-04 (184 days) |
| Symbols | 10 liquid perpetuals |
| Funding events | 5,520 |
| Basis bars | 4,417/symbol |

## Walk-Forward (30d train / 14d val, roll 14d)

| Metric | Value |
|--------|-------|
| Folds | 5 |
| Positive | 3 |
| Negative | 2 |
| Aggregate trades | 192 |
| WF expectancy | +0.014 |
| WF PF | 1.002 |
| **Pass** | **false** (SYMBOL_CONCENTRATION — aggregate edge ≈ noise) |

LONG net PnL: -217.45 (70 trades) | SHORT net PnL: +220.05 (122 trades)

## Fresh Unseen (2026-02-01 → 2026-03-15)

117 trades, exp -0.065, PF 0.993 — **FAIL**

## Cross-Period Robustness

2/4 periods positive — **FAIL** (gate requires WF pass first)

## Ablation / Variant Selection

Per-fold variant selected from train: `FUNDING_BASIS` (percentile thresholds 90/10, hold 8–16h). No static rate overfit.

## 3H Paper

**NOT STARTED** — walk-forward + fresh unseen + robustness gates FAIL.

## Research Program Status

```text
FUNDING_BASIS_ALPHA_V3 = FAIL
TRADING_ALPHA_PROGRAM_VERDICT = NO_ROBUST_EDGE_FOUND
NEXT_PHASE = PRODUCT_PIVOT_OR_NEW_EXTERNAL_DATA
REGIME_ROUTER_ALPHA_EDGE = false (engineering preserved, not authoritative)
```

Residual momentum family: **RESEARCH_ARCHIVED** in scoreboard.


| Verdict | Result |
|---------|--------|
| ENGINEERING | PASS |
| FUNDING_ALPHA | FAIL |
| HISTORICAL_EDGE | FAIL |
| TRADING_PROGRAM | NO_ROBUST_EDGE_FOUND |

## Next Phase

`PRODUCT_PIVOT_OR_NEW_EXTERNAL_DATA` — recommended paper duration: **24h**

---
*Generated 2026-09-08T09:22:21.014Z*
