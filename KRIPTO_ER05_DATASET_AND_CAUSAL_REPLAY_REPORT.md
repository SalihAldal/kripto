# KRIPTO ER05 - DATASET / HORIZON-BASELINE / CAUSAL REPLAY REPORT

## Executive Verdict

- `PHASE5_VERDICT=PARTIAL`
- `DATASET_PERSISTENCE_VERDICT=PARTIAL`
- `HORIZON_BASELINE_CORRECTNESS_VERDICT=PARTIAL`
- `CAUSAL_REPLAY_VERDICT=PARTIAL`
- `EXECUTION_REALISM_CAPABILITY=PRICE_ONLY`
- `HISTORICAL_DATA_QUALITY=PARTIAL_MEASURED`
- `OVERALL_ENGINEERING_READINESS=PARTIAL`
- `NEXT_PAPER_PREFLIGHT=NO_GO`
- `PROFITABILITY_EVIDENCE=NOT_EVALUATED`

## İncelenen Sürüm / Ortam

- HEAD: `a85a04677acc8dba27af3362f238f86a1d463ea5`
- Branch: `main`
- Worktree: `DIRTY`
- Runtime: Node `v24.13.0`, npm `11.6.2`
- OS zaman damgası: `20260906022312.152000+180`
- Docker daemon: `UNAVAILABLE` (`dockerDesktopLinuxEngine` pipe erişilemiyor)

## 1) ER04 ve Önceki Contract Doğrulaması

- Candidate/decision/execution/position zinciri ER04 kapsamındaki regression setinde korunuyor (`71/71 PASS`).
- Strategy/policy/source identity kırılmadı; ER02/ER03 regression setleri PASS.
- Missing/uncertain execution sonuçlarının "başarı" sayılmaması tarafında ER04 durumunu değiştiren bir regresyon bulunmadı.
- Shadow outcome ile gerçek settlement ayrımı korunuyor; bu fazda executed net PnL formülü değiştirilmedi.
- Gerçek DB kanıtı önceki fazdaki gibi halen `BLOCKED` (bu fazda da doğrulama tekrarlandı, aynı bağlantı hatası alındı).

## 2) Producer -> Persistence -> Consumer Haritası (Gerçek Call-Site)

1. **Producer**
   - `observeCanonicalShadowTick` (`scanner-worker`, `round-selection`)  
   - `ShadowOutcomeEngine.observeOpportunity/observeMicro/tickPrices`
2. **Canonical Builder**
   - `buildCanonicalCandidateObservation`
   - `buildOutcomeHorizonRows` (ER05 ile gerçek persist hattına bağlandı)
3. **Persistence**
   - `persistShadowOutcomes` -> `shadowCandidateOutcome.upsert`
   - Persist edilen canonical paket: `snapshot.canonicalDataset`
4. **Finalization**
   - `ensureShadowOutcomeFinalizerStarted` -> `finalizeShadowOutcomes`
5. **Consumer**
   - `reports.ts`, `analytics.ts`, `round-forensic-export.service.ts`, `micro-bottleneck-forensic.service.ts`

## 3) Dataset Schema/Version ve Immutability

- Canonical snapshot altında yeni version'lı paket:
  - `schemaVersion=er05-dataset-v1`
  - `policyVersion=er05-canonical-baseline-v1`
  - `datasetId=<campaignId>:<runId>:er05-dataset-v1`
  - `observation` + `horizonsByBaseline` + `qualityDimensions`
- Immutable alan politikası:
  - İlk tespit alanları (`firstDetectedAt`, `firstDetectedPrice`, `firstScore`, `firstRank`) artık `previous ?? new` ile sessiz overwrite edilmiyor.
  - Önceki kayıt varsa değer aynen korunuyor (null dahil).
- Kalite boyutları ayrıştırıldı:
  - `identityQuality`, `featureQuality`, `priceCoverageQuality`, `executionEvidenceQuality`, `finalizationState`

## 4) Horizon / Baseline Düzeltmeleri

- Her baseline/horizon çifti bağımsız hesaplanıyor:
  - `FIRST_DETECTED`, `HOT`, `MICRO_CONFIRMED`, `EXECUTION_READY`, `CANONICAL_ENTER`, `EXECUTION_FILL`
- Kritik düzeltmeler:
  - Pencere dışı fiyatların kısa horizon sonucunu değiştirmesi engellendi.
  - Horizon sonu coverage stale ise `INVALID_DATA/HORIZON_END_PRICE_STALE`.
  - `mfe/mae/endReturn` null ise artık `0`'a çevrilmiyor.
  - `timeToMaeMs` eklendi; MFE/MAE zamanları bağımsız izleniyor.
  - Baseline fiyatında max yaş kuralı var (`BASELINE_PRICE_MAX_AGE_MS=120000`); stale baseline'da satır üretilmiyor.

## 5) Shadow Outcome vs Executable/Settled Ayrımı

- Bu fazda shadow fiyat sonucu (`mfe/mae/return`) ile executed net PnL birleştirilmedi.
- `executionEvidenceQuality` ile `OPEN_ONLY`, `NO_EXECUTION_EVIDENCE`, `SETTLED_PAPER_EVIDENCE` ayrımı eklendi.
- `EXECUTION_REALISM_CAPABILITY=PRICE_ONLY` olarak raporlandı; book/depth/latency yoksa executable kanıt iddiası yapılmıyor.

## 6) Replay Contract ve Leakage Sınırları

- Lookahead-safe hesaplar korunuyor (`computeOneHorizon` / `computeReachTimes` / engine refresh).
- Gelecek tick'in kısa horizon sonucunu bozmaması testle doğrulandı.
- Negative control helper kapsamı dürüstleştirildi:
  - `runNegativeControlLabelShuffle` artık uygulanmayan gerçek permutation yerine `NOT_IMPLEMENTED` döner (fail-closed).
  - `evaluateMultipleTesting` invalid p-value için `INVALID_P_VALUE` döner.

## 7) Split / Purge / Embargo

- `walkForwardSplit` artık `labelEndAtMs` bilgisini embargo hesabına dahil ediyor.
- Böylece train label interval'ının validation/test dönemine sarkmasında leakage riski filtreye giriyor.

## 8) Test Kanıtları

- `npm run test:run -- tests/er04-durable-execution-attempt-lock.test.ts tests/p0-paper-persistence.test.ts tests/er03-canonical-policy.test.ts tests/p1-round-selection-event-driven.test.ts tests/er02-feature-contract-and-router-input.test.ts tests/er01-telemetry-verdict.test.ts` -> `exit 0` (`71/71 PASS`)
- `npm run test:run -- tests/phase05-shadow-outcome.test.ts tests/p4-regime-strategy-shadow.test.ts tests/er05-canonical-dataset-persistence.test.ts` -> `exit 0` (`39/39 PASS`)
- Aynı ER05 focused suite 3 ardışık tekrar -> her koşu `exit 0`, `39/39 PASS`
- `npm run test:run -- tests/forensics/db-validation-smoke.integration.test.ts` -> `exit 1` (`localhost:5432` erişilemiyor)
- `npm run test:run -- tests/execution-settlement.integration.test.ts` -> `exit 1` (Prisma DB erişim hataları + 3 test timeout)
- `npm run typecheck` -> `exit 0`
- `npm run build` -> `exit 1` (Next "another build process is already running" guard; orphan process/lock davranışı)

## 9) Ölçülemeyen Noktalar / Blocker Ayrımı

### Engineering Blocker
- Disposable PostgreSQL erişimi yok (`ER05-A`): gerçek producer->DB->finalizer->consumer zinciri canlı DB üzerinde kanıtlanamadı.
- Build stabilizasyonu (`ER05-C`): Next build guard nedeniyle güvenli build adımı bu iterasyonda final PASS üretmedi.

### Sample/Data Blocker
- Bu fazda production backfill veya historical repair çalıştırılmadı (kural gereği).
- Availability timestamp (availableAt/receivedAt) eksikliği olan eski kayıtlarda ileri nedensellik iddiası yapılmadı.

## 10) Prompt 6 Preflight Handoff

- Önce disposable PostgreSQL test ortamı zorunlu.
- ER05 canonical snapshot revision/export sabitlemesi DB üstünde tekrar doğrulanmalı.
- Execution-settlement integration timeout noktaları (duplicate-protection, tradeEventLog, appSetting) fail-closed izolasyonla yeniden koşulmalı.
- Build guard/orphan process kök nedeni Prompt 6 öncesi temizlenmeli.
