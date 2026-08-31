# KRIPTO P3 — Historical Feature Semantic Reconstruction

Generated: 2026-08-28T20:59:55.352Z

## Executive Summary

**NOT_COMPARABLE** — `LearningTrade.metadata.momentumScore` top-level alanı **0/248** trade'de mevcut değil.
Önceki P3 positive-edge analizi bu alanı **symbol-median inference** ile doldurmuş (evidenceClass=INFERRED, 42/42).

Gerçek karar-anı verisi `metadata.setupSnapshot.numericFeatures` içinde:
- `shortMomentum`, `shortFlow`, `aiConfidence`, `mtfAlignment` → **248/248**

## momentumScore Kök Neden

| Kaynak | Profitable Median | Not |
|--------|-------------------|-----|
| Önceki INFERRED (symbol median) | ~1.94 – 18.78 | metadata.momentumScore yok → fallback |
| **Reconstructed scoreMomentumImpulse** | **10.108** | shortMom*28 (+ change5m/15m eksik) |
| Current 2278 runtime | 18.78 | EXACT_RUNTIME_REPLAY |
| TDI threshold | **60** | Hiçbir cohort'ta ulaşılamıyor (max ~40-47) |

**MOMENTUM_HISTORICAL_VS_CURRENT = FORMULA_MISMATCH**

Kod: `scoreMomentumImpulse` — `src/server/decision-engine/experts/momentum-expert.utils.ts`
```
clamp(abs(shortMomentumPercent)*28 + abs(change5m)*10 + abs(change15m)*4, 0, 100)
```

## Semantic Classification

- **momentumScore**: DIFFERENT_FEATURE — Top-level momentumScore never persisted in LearningTrade; prior P3 used symbol-median inference
- **shortMomentum**: EXACTLY_SAME — Same unit; stored at trade close from position metadata snapshot
- **shortFlow**: EXACTLY_SAME — Same ratio scale [-1,1]
- **confidence**: SAME_CONCEPT_DIFFERENT_FORMULA — Stored aiConfidence may differ from live finalConfidence path
- **technicalScore**: UNKNOWN — Decision-time technical not reliably archived for historical trades
- **MTF**: EXACTLY_SAME — Same field path via metadata.mtfAlignmentScore alias
- **sentiment**: SAME_CONCEPT_DIFFERENT_FORMULA — Not in setupSnapshot numeric features
- **learningScore**: DIFFERENT_FEATURE — Not archived at trade close
- **compositeScore**: DIFFERENT_FEATURE — Not in learning metadata

## Discrimination (Current Reconstruction)

- reconstructedMomentumScore: profitable median 10.108 vs losing 6.44 → POSITIVE (AUROC 0.569117)
- reconstructedConfidence: profitable median 58 vs losing 58 → NONE (AUROC 0.515892)
- reconstructedTechnicalScore: profitable median 48.54 vs losing 55.56 → NEGATIVE (AUROC 0.405629)
- reconstructedShortMomentum: profitable median 0.361 vs losing 0.23 → POSITIVE (AUROC 0.569175)
- reconstructedShortFlow: profitable median 0.7273 vs losing 0.6724 → POSITIVE (AUROC 0.530629)
- reconstructedMtf: profitable median 57.9 vs losing 67.65 → NEGATIVE (AUROC 0.483125)

## Zero-Trade Reassessment

**REAL_POLICY_STRICTNESS** — TDI momentum threshold 60, mevcut formülle ulaşılamaz aralıkta.
Önceki "momentum≈2 vs threshold 60" karşılaştırması **geçersiz** (semantic mismatch + inference hatası).

## Safe Next Experiment

**FEATURE_PIPELINE_FIX** — Persist decision-time TDI telemetry (momentumScore, technical, sentiment, change5m/15m) into position metadata at entry before re-running any policy experiment; do not tune TDI threshold until telemetry parity is proven.

PRODUCTION_CHANGE=NO | PAPER_STARTED=NO
