# KRIPTO Regime-Adaptive Alpha & 3H Forward Report

## Executive Summary

Regime-adaptive alpha portfolio mimarisi tamamlandı. Walk-forward (6 fold, 4 pozitif) aggregate metrikleri pozitif ancak **PnL konsantrasyonu** (tek gün %132, tek sembol %138) nedeniyle walk-forward gate **FAIL**. Fresh unseen (2026-03-15→2026-04-15) **FAIL** (exp -3.19, PF 0.58). Cross-period robustness **FAIL**. **3H paper başlatılmadı** — gate düşürülmedi, sahte PASS üretilmedi.

`LIVE_TRADING_ENABLED=false` — değişmedi.

---

## Regime Engine V2

- Composite regimes: UPTREND_HIGH_VOL, UPTREND_LOW_VOL, DOWNTREND_HIGH_VOL, DOWNTREND_LOW_VOL, SIDEWAYS, TRANSITION
- Features: BTC 1h/4h/12h/24h return, EMA slope, trend strength, realized vol, ATR percentile, volume regime
- Transition detection: trend flip / rapid change → CASH preferred
- Lookahead guard: automated test PASS

---

## Walk-Forward (14d train / 7d val, roll 7d)

| Metric | Value |
|--------|-------|
| Folds | 6 |
| Positive folds | 4 |
| Negative folds | 2 |
| Aggregate expectancy | 1.7482 |
| Aggregate PF | 1.1827 |
| Top day concentration | 132.35% (2026-05-10) |
| Top symbol concentration | 137.73% (SUIUSDT) |
| **Pass** | **false** (PNL_CONCENTRATION) |

Fold 4 ve 5 ciddi negatif validation (exp -26.9 / -7.2) — regime shift kök nedeni doğrulandı.

---

## Alpha × Regime Eligible Cells (top)

- **LOW_TURNOVER_SWING** @ DOWNTREND_HIGH_VOL: exp 10.5719, PF 2.6171, trades 6
- **RESIDUAL_MOMENTUM_SHORT** @ DOWNTREND_HIGH_VOL: exp 6.815, PF 2.8035, trades 168
- **RESIDUAL_MEAN_REVERSION** @ DOWNTREND_LOW_VOL: exp 5.6461, PF 3.4443, trades 6
- **RESIDUAL_MEAN_REVERSION** @ UPTREND_LOW_VOL: exp 5.1821, PF 2.5187, trades 25
- **RESIDUAL_MOMENTUM_SHORT** @ UPTREND_HIGH_VOL: exp 4.4798, PF 2.6759, trades 57
- **LOW_TURNOVER_RESIDUAL_SWING** @ UPTREND_LOW_VOL: exp 4.0192, PF 1.7256, trades 92
- **VOLUME_PERSISTENCE_RESIDUAL** @ DOWNTREND_LOW_VOL: exp 3.6733, PF 1.7617, trades 18
- **LOW_TURNOVER_SWING** @ SIDEWAYS: exp 1.7981, PF 1.1288, trades 120
- **RESIDUAL_STRENGTH_LONG** @ DOWNTREND_LOW_VOL: exp 1.4847, PF 1.2548, trades 42
- **RESIDUAL_STRENGTH_LONG** @ SIDEWAYS: exp 1.3919, PF 1.1707, trades 102
- **RESIDUAL_MOMENTUM_SHORT** @ UPTREND_LOW_VOL: exp 1.3109, PF 1.2688, trades 150
- **RESIDUAL_MOMENTUM_SHORT** @ TRANSITION: exp 0.9261, PF 1.1574, trades 138

---

## Standalone vs Regime-Routed (Fresh Unseen)

| Strategy | Trades | Net PnL | Expectancy | PF |
|----------|--------|---------|------------|-----|
| Best standalone (FUNDING_BASIS_DISLOCATION) | 10 | 113.56 | 11.3561 | 4.9761 |
| Regime-routed | 207 | -660.21 | -3.1894 | 0.5814 |

Delta (routed − best standalone): exp -14.5455, PF -4.394699999999999, netPnl -773.77

---

## Fresh Unseen Gate

- Dataset: 2026-03-15→2026-04-15
- Trades: 207, Net PnL: -660.21, Exp: -3.1894, PF: 0.5814
- **Pass: false**

---

## Cross-Period Robustness (frozen router)

- Periods: 4, Positive: 1, Negative: 3
- **Pass: false**

---

## 3H Paper

**NOT STARTED** — walk-forward + fresh unseen + robustness gates FAIL.

---

## Verdicts

| Verdict | Result |
|---------|--------|
| ENGINEERING | PASS |
| REGIME_ADAPTIVE_EDGE | FAIL |
| HISTORICAL_EDGE | FAIL |
| PAPER_FORWARD | NOT_STARTED |
| PROFITABILITY | NOT_STARTED |

---

*Generated 2026-09-08T07:18:05.522Z*
