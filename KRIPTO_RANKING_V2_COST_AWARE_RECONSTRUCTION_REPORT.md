# KRIPTO Ranking V2 & Cost-Aware Reconstruction Report

## 1. Executive Summary

Unseen 7-day Binance historical period (2026-08-28 → 2026-09-04) üzerinde production baseline, window-relative **Ranking Engine V2** (MODEL_A/B/C) ve cost-aware exit economics test edildi. Reference dataset (Sep 4–7) yeniden tune edilmedi.

**Sonuç:** Ranking V2 final test'te baseline'dan **kötü** performans gösterdi (25.33% vs 28.24% winner rate). Cost-adjusted expectancy negatif. Production ranking **değiştirilmedi**. AI replay atlandı.

- **RUN_15H_PAPER:** NO
- **NEXT_PHASE:** SCANNER_DISCOVERY_REDESIGN

## 2. Starting HEAD

`fbf5c721f17cb903517fccc626b7ac7eb07984f4`

## 3. Uncommitted Work Review

Korundu: `replayClockMs`, AI forensic telemetry, historical replay scripts, scanner calibration, `candidate-quality-rank.service.ts` (isolated, production'a bağlı değil), tüm raporlar/JSON.

## 4. New Unseen Dataset

| Alan | Değer |
|------|-------|
| Start | 2026-08-28T00:00:00Z |
| End | 2026-09-04T00:00:00Z |
| Symbols | 11 (MARSCOINTRY kline fetch failed) |
| Windows | 657 |
| Candidates | 2,888 |

Overlap yok — reference dataset (Sep 4–7) ile çakışmıyor.

## 5. Train / Validation / Final Test

| Split | Period |
|-------|--------|
| TRAIN | Aug 28 – Sep 1 (4 days) |
| VALIDATION | Sep 1 – Sep 3 (2 days) |
| FINAL TEST | Sep 3 – Sep 4 (1 day) |

## 6. Unseen Baseline

| Metric | Value |
|--------|------:|
| Selected | 657 |
| TP_FIRST | 134 |
| SL_FIRST | 464 |
| Winner rate | **22.41%** |
| Ranking miss | **57.19%** |
| Top-1 winner rate (when TP in list) | 42.81% |

Reference dataset winner rate (22.54%) ile uyumlu — unseen baseline doğrulandı.

## 7. Scanner Score Decomposition

Winner vs loser weighted contributions (TRAIN sample):

| Component | Winner avg | Loser avg |
|-----------|----------:|----------:|
| volume | 12.43 | 12.61 |
| momentum | 4.95 | 8.36 |

**87 puanlık winner ile 87 puanlık loser neden aynı?** Tüm bileşenler normalize edilmiş 0–100 bandında sıkışıyor; volume/momentum/spread katkıları winner/loser arasında ayırt edici değil. Absolute score window context'i yok sayıyor.

## 8. Score Saturation

| Group | Mean | Median | 80+ count | 85+ | 90+ |
|-------|-----:|-------:|----------:|----:|----:|
| All | 73.2 | 78.2 | 295/657 (45%) | 202 | 88 |
| Winners | 74.4 | 81.0 | 71/134 | 50 | 20 |
| Losers | 73.7 | 78.5 | 214/464 | 147 | 66 |

**SCORE_SATURATION:** false (45% at 80+, not 70%+)
**SCANNER_SCORE_PREDICTIVE:** effectively false (winner mean 74.4 vs loser 73.7, Δ=0.6)

## 9. Relative Ranking

Window-relative percentile ranks (volume, momentum, liquidity, spread, overextension, micro, trend) kullanıldı. Absolute score=87 anlamsız; window içi relative rank anlamlı.

## 10. Winner/Loser Feature Separation (TRAIN)

- volumeRatio20: winner > loser (reference dataset ile uyumlu)
- MFE60 winner median: 2.72%
- MAE60 loser median: -0.80%

## 11. Ranking Model Candidates

| Model | Description |
|-------|-------------|
| MODEL_A | volume + momentum + trend + spread (relative) |
| MODEL_B | A + overextension penalty |
| MODEL_C | B + micro + liquidity + volatility |

## 12. Training Results

| Model | TRAIN winner rate |
|-------|------------------:|
| baseline | 20.91% |
| MODEL_A | 18.56% |
| MODEL_B | 17.52% |
| MODEL_C | 20.07% |

Tüm V2 modelleri TRAIN'de baseline'dan kötü.

## 13. Validation Results

| Model | VAL winner rate | VAL ranking miss |
|-------|----------------:|-----------------:|
| baseline | 22.40% | 61.32% |
| MODEL_A | **20.00%** | 68.87% |
| MODEL_B | 19.38% | 70.75% |
| MODEL_C | 18.29% | 71.70% |

MODEL_A validation'da en iyi V2 model seçildi (hâlâ baseline'dan kötü).

## 14. Ranking Miss Before/After

| Split | Baseline miss | V2 (MODEL_A) miss |
|-------|-------------:|------------------:|
| FINAL TEST | 61.90% | **69.84%** (worse) |

## 15. Discovery Miss

TP in list rate: ~55.8% validation windows — discovery gap devam ediyor ama ranking daha büyük sorun.

## 16. Cost Model Semantics

`EXECUTION_ENGINE_V2_MAX_SLIPPAGE_PERCENT = 0.35` → **MAXIMUM_ALLOWED_SLIPPAGE_CAP**

`validateSlippage()` expected slippage cap'i aşarsa trade reddeder. Cap expected slippage değil.

## 17. Slippage Cap vs Expected Slippage

| Type | Per-side |
|------|--------:|
| Cap (conservative replay) | 35 bps (0.35%) |
| Realistic (estimateSlippage median) | **6.89 bps (0.069%)** |
| Paper simulator | Fixed bps/side = CONSERVATIVE_STRESS_CASE |

## 18. Cost Scenarios

| Scenario | Slippage/side | Round-trip cost |
|----------|-------------:|----------------:|
| A — CONSERVATIVE | 35 bps | ~1.0% |
| B — REALISTIC | 7 bps | ~0.44% |
| C — ZERO (lower bound) | 0 | 0.30% fee only |

## 19. MFE/MAE (TRAIN winners)

| Horizon | P25 | P50 | P75 | P90 |
|---------|----:|----:|----:|----:|
| MFE15 | 0.75% | 1.52% | 2.39% | 3.49% |
| MFE60 | 1.96% | 2.72% | 4.68% | 7.09% |
| MAE60 | -1.71% | -0.80% | -0.33% | -0.06% |

## 20. Exit Economics

Mevcut TP 1.2% / SL 0.8% conservative cost altında break-even ~90%. Winner MFE60 P50 2.72% → daha büyük TP mümkün.

## 21. Candidate Exit Profiles

| Profile | TP | SL | Hold |
|---------|---:|---:|-----:|
| A_CURRENT | 1.2% | 0.8% | 120m |
| B_MFE_P50 | 2.31% | 0.8% | 120m |
| C_MFE_P75_SL_P50 | 3.75% | 0.72% | 90m |

## 22. Break-even Win Rates (realistic cost)

| Profile | Break-even WR |
|---------|-------------:|
| A_CURRENT | 62% |
| B_MFE_P50 | 39.9% |
| C_MFE_P75 | **26.0%** |

Profile C seçildi (validation realistic expectancy en iyi V2 profiller arasında).

## 23. Combined Validation

Ranking V2 + Profile C → validation realistic expectancy hâlâ negatif (-2.84/trade).

## 24. Final Unseen Test

| Metric | Baseline | Ranking V2 |
|--------|----------|------------|
| Winner rate | **28.24%** | 25.33% |
| Ranking miss | 61.90% | 69.84% |

**V2 final test'te baseline'dan kötü.**

## 25. Cost-Adjusted Profitability (FINAL TEST, Profile C)

| Scenario | Trades | Net PnL | Expectancy | PF |
|----------|-------:|--------:|-----------:|---:|
| Realistic | 95 | **-177.51** | -1.87 | 0.69 |
| Conservative | 95 | -696.37 | -7.33 | 0.26 |
| Zero slippage | 95 | +5.29 | +0.06 | 1.01 |

Zero-slippage marginal positive → signal pre-cost edge zayıf var ama maliyetler yok ediyor.

## 26. AI Recheck

Final test pozitif değil → AI replay **atlandı** (0 analysed).

## 27. Production Wiring Decision

**PRODUCTION_RANKING_WIRED = false** — FINAL TEST PASS değil.

## 28. Strategy Verdict

**NO_EDGE** — unseen data'da cost-adjusted pozitif expectancy gösterilemedi.

## 29. 15h PAPER Decision

**RUN_15H_PAPER = NO**

## 30. Recommended Next Phase

**SCANNER_DISCOVERY_REDESIGN** — ranking-only yaklaşım yeterli değil; V2 modelleri baseline'dan kötü. Discovery + scoring architecture yeniden tasarım gerekli. Exit economics (Profile C) break-even ~26% ama achieved winner rate ~25% — marjinal.

---
*Generated 2026-09-07T22:34:02Z | HEAD fbf5c721*
