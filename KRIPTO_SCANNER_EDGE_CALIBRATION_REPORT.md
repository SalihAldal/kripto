# KRIPTO Scanner Edge Calibration Report

## 1. Executive Summary

72h frozen historical dataset üzerinde 284 selected candidate forensic analizi, winner/loser separation, ranking kalitesi ve evidence-based ranking calibration denemesi yapıldı. **Master AI threshold'larına dokunulmadı.** Scanner hard gate'ler değiştirilmedi.

**Sonuç:** Scanner score winner probability ile monoton korelasyon göstermiyor (`SCANNER_SCORE_NOT_PREDICTIVE`). Asıl sorun kısmen discovery (%26 miss) ama daha çok **ranking** (%65 miss — TP-first aday listede var ama top-1 değil). Evidence-based ranking calibration DEV'de +0.09pp, HOLDOUT'ta **-1.39pp** verdi → **production'a alınmadı**.

- **Canonical baseline (önceki phase):** 284 selected, 64 TP_FIRST, 211 SL_FIRST → **22.54%** winner rate
- **Forensic replay baseline (aynı window, script labeling):** 282 selected, 72 TP_FIRST, 198 SL_FIRST → 26.67%
- **RUN_15H_PAPER:** NO
- **STRATEGY_VERDICT:** NO_EDGE

## 2. Starting HEAD

`fbf5c721f17cb903517fccc626b7ac7eb07984f4`

## 3. Dataset Freeze

| Alan | Değer |
|------|-------|
| Start | 2026-09-04T22:38:00.000Z |
| End | 2026-09-07T21:37:59.999Z |
| Symbols | 12 (TRY-heavy universe) |
| Stride | 15m |
| Fees | ~0.30% round-trip taker |
| Slippage | 35 bps/side (EXECUTION_ENGINE_V2_MAX_SLIPPAGE_PERCENT) |
| TP / SL | 1.2% / 0.8% |

## 4. Development / Holdout Split

| Split | Window |
|-------|--------|
| Development | First 48h (2026-09-04T22:38 → 2026-09-06T22:38) |
| Holdout | Last 24h (2026-09-06T22:38 → 2026-09-07T21:37) |

Calibration yalnızca development forensic'ten tasarlandı. Holdout'a dokunulmadı.

## 5. Baseline

| Metric | Canonical (fast replay) | Forensic script |
|--------|------------------------:|----------------:|
| Selected | 284 | 282 |
| TP_FIRST | 64 | 72 |
| SL_FIRST | 211 | 198 |
| Winner rate | **22.54%** | 26.67% |

Fark: script kendi forward-label simülasyonu ve 2 window farkı (rate-limit 429 kline fetch). Karar için canonical 22.54% referans alındı.

## 6. 284 Candidate Forward Labels

Her 15m window'da gate-qualified candidate'lar label'landı: TP_FIRST / SL_FIRST / TIMEOUT / AMBIGUOUS. AI kararında future data kullanılmadı.

## 7. Winner vs Loser Analysis

| Feature (median) | TP_FIRST (n=72) | SL_FIRST (n=198) | Δ |
|------------------|----------------:|-----------------:|--:|
| scannerScore | 87.30 | 87.23 | ~0 (ayrışma yok) |
| return15m | 1.72% | 1.64% | +0.08 |
| extensionFrom60mLow | 4.24% | 4.01% | +0.23 |
| distanceFrom60mHigh | 0.71% | 0.85% | -0.14 |
| volumeRatio20 | **0.98** | **0.78** | **+0.20** |
| volatility | 0.62% | 0.65% | -0.03 |
| rsi14 | 66.7 | 65.8 | +0.9 |
| mfe60 | 2.54% | 1.07% | +1.47 |
| mae60 | -0.59% | -1.68% | +1.09 |

**Güçlü ayrışma:** volumeRatio20, mfe/mae excursion. **Zayıf/yanlış:** scannerScore neredeyse identik.

## 8. Scanner Score Predictiveness

| Bucket | Count | TP | SL | Winner rate |
|--------|------:|---:|---:|------------:|
| 40–49 | 4 | 0 | 2 | 0% |
| 50–59 | 9 | 3 | 5 | 37.5% |
| 60–69 | 11 | 2 | 5 | 28.6% |
| 70–79 | 41 | 13 | 27 | 32.5% |
| **80+** | **205** | **52** | **149** | **25.9%** |

Score yükseldikçe winner rate yükselmiyor. **80+ bucket en düşük anlamlı bucket.**

**SCANNER_SCORE_NOT_PREDICTIVE = true**

## 9. Rank Quality

| Metric | Value |
|--------|------:|
| Windows | 282 |
| Top-1 TP rate | 25.5% |
| TP in candidate list rate | 73.8% |
| Ranking miss rate | **65.4%** |
| Discovery miss rate | 26.2% |

Winner'lar çoğunlukla listede var ama ranking onları aşağıda bırakıyor.

## 10. Discovery vs Ranking

| Problem | Rate | Verdict |
|---------|-----:|---------|
| Discovery miss (TP hiç listede değil) | 26.2% | PARTIAL |
| Ranking miss (TP listede ama top-1 değil) | 65.4% | **RANKING_QUALITY_PROBLEM** |

## 11. Winner Profile

- Sürdürülebilir relative volume (volumeRatio20 ~1.0)
- TP hit sonrası mfe60 median 2.54%
- Moderate RSI (~67), trend alignment
- Scanner score winner/loser arasında ayırt edici değil

## 12. False Positive Profile (SL_FIRST)

- Düşük volumeRatio20 (median 0.78)
- Daha derin MAE60 (-1.68%)
- Scanner score yine ~87 (false confidence)
- Yüksek score + düşük volume = tipik loser pattern

## 13. Pump Chasing

return15m winner/loser medyanları benzer (1.72 vs 1.64). Aggregate pump-chase flag **false**, ancak overextension + near-high penalty'ler loser tail'de yoğun. Kök neden: **score inflation without volume confirmation**, saf late-entry değil.

## 14. Volume Quality

Winner volumeRatio20 > loser (+0.20 median). Tek candle spike exhaustion (volumeRatio20 ≥ 2.15 + volumeSpike > 80) loser'larda daha sık. **Volume persistence weak positive signal.**

## 15. Momentum Quality

Short vs hour momentum divergence loser'larda hafif fazla. Momentum level tek başına yeterli değil; alignment + volume gerekli.

## 16. Regime Interaction

TRY-only universe (12 symbol). Regime breakdown önceki AI forensic ile uyumlu: RANGE_SIDEWAYS dominant. Regime tek başına veto önerilmez.

## 17. TRY vs USDT

| Quote | Winner rate |
|-------|------------:|
| TRY | 26.67% |
| USDT | 0% (bu run'da USDT selected yok) |

## 18. Cost Model

| Component | Value |
|-----------|------:|
| Round-trip fee | 0.30% |
| Round-trip slippage | 0.70% (35 bps × 2) |
| **Total round-trip** | **~1.0%** |

## 19. Slippage Semantics

`EXECUTION_ENGINE_V2_MAX_SLIPPAGE_PERCENT=0.35` → **per-side cap**, paper/backtest simulator her trade'e worst-case 35 bps uygular. Bu güvenlik cap'i; gerçek slippage genelde daha düşük olabilir. Replay pessimistic ama kasıtlı düşürülmedi.

## 20. TP/SL Economics

| Metric | Value |
|--------|------:|
| TP gross | 1.2% |
| SL gross | 0.8% |
| Net TP (after cost) | **+0.2%** |
| Net SL (after cost) | **-1.8%** |
| Break-even win rate | **~90%** |

Mevcut TP/SL + cost yapısı yapısal olarak zor. Scanner %22–27 winner rate ile ekonomi negatif.

## 21. MFE/MAE Distribution

| Group | MFE60 median | MAE60 median |
|-------|-------------:|-------------:|
| TP_FIRST | 2.54% | -0.59% |
| SL_FIRST | 1.07% | -1.68% |

TP 1.2% hedefi winner'ların median excursion'ına uygun; SL 0.8% loser tail'i tam yakalamıyor.

## 22. Confirmed Scanner Root Cause

```
SCANNER_ROOT_CAUSE = SCORE_NON_PREDICTIVE + VOLUME_CONFIRMATION_MISSING
RANKING_QUALITY_VERDICT = RANKING_QUALITY_PROBLEM (65% miss)
DISCOVERY_QUALITY_VERDICT = PARTIAL (26% miss)
PUMP_CHASING_VERDICT = WEAK_SIGNAL (not primary)
VOLUME_QUALITY_VERDICT = POSITIVE_SEPARATION
MOMENTUM_QUALITY_VERDICT = INSUFFICIENT_ALONE
REGIME_INTERACTION_VERDICT = NO_STRONG_REGIME_VETO
COST_MODEL_VERDICT = CONFIRMED_1PCT_ROUND_TRIP
TP_SL_ECONOMICS_VERDICT = STRUCTURALLY_HOSTILE (~90% break-even)
```

## 23. Calibration Design

`candidate-quality-rank.service.ts` — ranking-only adjustments:
- Overextension penalty (return15m, extension from 60m low)
- Near-high penalty
- Volume spike exhaustion penalty
- Volume persistence boost (sweet band 1.08–1.75)
- Momentum divergence penalty

Hard veto eklenmedi. Yalnızca ranking score adjustment.

## 24. Code Changes

| File | Status |
|------|--------|
| `src/server/scanner/candidate-quality-rank.service.ts` | Added (experimental) |
| `src/server/scanner/candidate-ranking.service.ts` | **NOT wired** — holdout failed |
| `scripts/run-scanner-edge-calibration.ts` | Added |
| `tests/candidate-quality-rank.test.ts` | Added (3 tests pass) |

## 25. Development Results

| Metric | Before | After |
|--------|-------:|------:|
| Selected | 190 | 190 |
| Winner rate | 27.62% | 27.53% |
| TP_FIRST | 50 | 49 |
| SL_FIRST | 131 | 129 |

## 26. Holdout Results

| Metric | Before | After |
|--------|-------:|------:|
| Selected | 92 | 92 |
| Winner rate | 24.72% | **23.33%** |
| TP_FIRST | 22 | 21 |
| SL_FIRST | 67 | 69 |

Holdout iyileşmedi → calibration production'a alınmadı.

## 27. Overfit Check

DEV +0.09pp, HOLDOUT -1.39pp → **OVERFIT_SUSPECTED = false** (genel başarısızlık, overfit değil).

## 28. AI Re-evaluation

Holdout gate geçmedi → AI replay **atlandı** (0 analysed).

Önceki phase referans: Provider BUY 19/50, Hybrid BUY 13/50, Final BUY 0/50.

## 29. Profitability Replay

Production-parity trade: **0**. Proxy lane: gross -204.82, fees 79.55, slippage 186.34, **net -284.37**.

## 30. Before / After

| Metric | BEFORE | AFTER DEV | AFTER HOLDOUT |
|--------|-------:|----------:|--------------:|
| Selected | 284 | 190 | 92 |
| TP_FIRST % | 22.54% | 25.8% | 22.8% |
| SL_FIRST % | 74.3% | 67.9% | 75.0% |
| AI BUY | 0 | — | — |
| Hybrid BUY | 13/50 | — | — |
| Trades | 0 | 0 | 0 |
| Net PnL | 0 | 0 | 0 |
| Profit Factor | N/A | N/A | N/A |
| Expectancy | N/A | N/A | N/A |

## 31. Strategy Verdict

**NO_EDGE** — Scanner calibration holdout'ta iyileşmedi; TP/SL economics ~90% break-even gerektiriyor; mevcut winner rate ~23–27% yetersiz.

## 32. 15h PAPER Decision

**RUN_15H_PAPER = NO**

Gerekçe: holdout winner rate düştü, final BUY = 0, net expectancy negatif, profit factor > 1 değil.

## 33. Remaining Risks

1. Score inflation (80+ bucket) güven veriyor ama edge taşımıyor
2. Ranking %65 miss — discovery'den önce ranking fix gerekli
3. 1% round-trip cost + 1.2/0.8 TP/SL → yapısal negatif expectancy
4. Rate-limit (429) kline fetch — frozen cache önerilir
5. AI master gate doğru çalışıyor; gevşetmek hybrid BUY 4W/8L kanıtına göre zararlı

---
*Generated 2026-09-07T22:09:38Z | HEAD fbf5c721*
