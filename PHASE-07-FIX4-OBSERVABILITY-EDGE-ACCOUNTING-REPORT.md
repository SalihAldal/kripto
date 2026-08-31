# PHASE-07 FIX4 - OBSERVABILITY + EDGE ACCOUNTING + GROUND-TRUTH MOVER JOIN

## STATUS
- Durum: PARTIAL-DONE (çekirdek FIX4 observability omurgasi eklendi).
- Strateji/risk threshold veya execution davranisi degistirilmedi.
- Long paper validation calistirilmadi (5/10/30 round, 9s, 24s calistirilmadi).
- Live order submission acilmadi; bu taskta live order yolu kullanilmadi.

## RUN IDENTITY
- `run-identity.json` artifact eklendi.
- Alanlar: `runId`, `sessionId`, `configHash`, `startedAt`, `endedAt`, `mode`, `venue`.
- Round export sirasinda her run icin yaziliyor.

## CONFIG HASH
- Canonical hash servisi eklendi: `src/server/forensics/config-hash.service.ts`.
- `resolveRuntimeConfigSnapshot()` artik `configHash` uretiyor.
- Kapsam: opportunity/hot/micro/final-rank/risk/paper/venue/effective-policy snapshot.

## EVENT MODEL
- Canonical structured envelope eklendi: `src/server/forensics/canonical-event.service.ts`.
- Alanlar: `eventId`, `runId`, `candidateId?`, `positionId?`, `executionIntentId?`, `symbol?`, `venue?`, `eventType`, `timestamp`, `sourceService`, `sourceInstanceId`, `payload`.
- Candidate lifecycle transitionlari bu envelope ile loglaniyor.

## CANDIDATE TELEMETRY
- `candidate-store` transitionlarinda canonical event emit eklendi.
- Event tipleri FIX4 listesine maplendi (`CANDIDATE_DISCOVERED`, `CANDIDATE_HOT`, `MICRO_CONFIRMED`, `RISK_ALLOWED`, `PAPER_OPENED`, `CANDIDATE_EXPIRED`, vb.).
- Terminal state durumunda `terminalReason` fallback ile bos kalmiyor.

## FUNNEL COUNTERS
- Round exporta `pipeline-funnel-counters.json` eklendi.
- Kaynak: `summarizeFunnelTraces(runId)`.

## FUNNEL INVARIANTS
- Candidate store invariant audit (FIX1/3) korunuyor (`PIPELINE_INVARIANT_VIOLATION` sayaci).
- Runtime telemetry snapshot ile exporta tasiniyor.

## LANE COUNTERS
- Lane bazli performans exportu `edge-analytics.json` icinde uretiliyor.
- Mevcut lane seti: `EARLY`, `STEADY`, `MOMENTUM`, `CONTINUATION`.

## SHADOW OUTCOMES
- `shadow-outcomes.json` artifact eklendi.
- Trade acilsa da acilmasa da shadow tracking export ediliyor.

## OUTCOME HORIZONS
- Mevcut horizonlar: 1/3/5/10/15/30/60/120 dakika.
- MFE/MAE/return ve `timeToMfeMs` korunuyor.
- Veri kalitesi `OK` vs `OUTCOME_DATA_INCOMPLETE` olarak tutuluyor.

## GROUND TRUTH MOVER ENGINE
- Ground truth mover candidate pipeline'dan bagimsiz.
- Export: `mover-ground-truth.json`.

## MOVER DEDUPE
- Rolling horizon + emit araligi ile ayni hareketin tekrar tekrar yazilmasi engelleniyor.

## MOVER -> CANDIDATE JOIN
- `edge-analytics.json` icinde mover recall/missed mover analizi uretiliyor.
- Join semantigi: symbol + zaman penceresi.

## MOVER RECALL
- +1/+2/+3/+5/+7/+10/+15/+20 esikleri icin recall exportu eklendi.
- Bunun icin mover threshold seti +1/+2 ile genisletildi.

## EARLY RECALL
- Erken yakalama (`before1/before2/before3/before5`) analizi mevcut.

## DETECTION LEAD TIME
- Median/p25/p75/p90 lead-time analizi mevcut (`leadTimes`).

## MFE BUCKETS
- Score ve lane bazli calibration/precision alanlari `edge-analytics.json` icinde mevcut.

## PROFITABLE OPPORTUNITY -> TRADE
- FIX4 bu adimda analytics export omurgasi kuruldu.
- Tam trade conversion tablo/markdown raporu future run datasina bagli.

## MISSED PROFITABLE OPPORTUNITIES
- `missedMovers` ve funnel/terminal reason kaynaklari exportta mevcut.
- Full MFE>=2/3/5 trade-conversion classification bir sonraki validation datasinda dolacak.

## PROFITABLE REJECTION HISTOGRAM
- Terminal reason kaynaklari exportlandi; histogram hesaplari report generator katmanina baglandi.

## FALSE POSITIVES / FALSE NEGATIVES
- `edge-analytics.json` icinde false-positive ve missed mover analizleri mevcut.

## SCORE CALIBRATION / RANK CALIBRATION
- Score calibration exportu mevcut.
- Rank kalibrasyonu mevcut veri modeli uzerinden turetilebilir (altyapi hazir).

## HOT GATE VALUE / MICRO VALUE / RISK VALUE
- HOT/Micro etkisi lane+pipeline+precision metriklerinde olculebilir hale getirildi.
- Risk value icin mevcut reject telemetry korunuyor; tuning yok.

## PAPER VS SHADOW / CAPTURE RATIO
- Shadow outcome exportu eklendi; paper ledger zaten mevcuttu.
- Capture ratio hesap tabani olustu (rapor generator ile birlestirilebilir).

## SMALL MOVE ANALYSIS / BIG MOVER ANALYSIS
- Mover thresholdleri +1/+2/+3/+5/+7/+10/+15/+20 destekleniyor.
- Small/big mover recall dataseti exportta.

## STEADY DEEP DIVE
- Lane ayrimi ve STEADY metrikleri `edge-analytics.json` tarafinda uretiliyor.

## PAPER ECONOMICS / LANE ECONOMICS
- FIX3 PnL artifactleri korunuyor (`pnl-ledger.json` vb.).
- FIX4 runtime export ile ayni round klasorunde birlesik.

## PIPELINE LATENCY
- Runtime tarafinda mevcut latency alanlari export edildi.
- Tam p50/p95 stage chain latency hesaplarini genisletme acik backlog.

## MARKET COVERAGE
- `runtime-telemetry.json` icinde universe/live/stale/coverage export ediliyor.

## WEBSOCKET METRICS
- `1008`, reconnect, subscription, dedupe, control-msg rate alanlari exportlandi.

## BREAKER METRICS
- Domain breaker snapshot exportlandi (`OPEN/HALF_OPEN/CLOSED`, counters).

## REST / 429 / 418
- Runtime telemetry icinde REST rate + 429/418 sayaclari exportlandi.

## RESOURCE METRICS
- Runtime memory metrikleri exportta (`memoryBytes` vb.).
- CPU/eventLoop/RedisLatency genisletmesi backlog olarak acik.

## BASELINE SUPPORT
- Reusable report generator eklendi (`generateValidationReport(runId)`).
- Baseline kiyasi icin analytics wiring mevcut, future run datasinda aktif.

## AI VALUE / TDI VALUE / LEARNING VALUE
- AI/TDI segmentation `edge-analytics.json` icinde var.
- Authority counters runtime exportta (`aiHardVetoCount`, `tdiHardVetoCount`, `learningHardVetoCount`).

## REPORT GENERATOR
- Yeni servis: `src/server/forensics/validation-report-generator.service.ts`.
- `generateValidationReport(runId)` ile artifact tabanli markdown rapor uretiyor.

## TESTS
- Calisan testler:
  - `npx vitest run tests/forensics/fix4-observability.test.ts tests/forensics/forensic-export-runner.test.ts`
- Sonuc: PASS (5/5 test).
- Not: test logunda DB yok uyarisi var ancak export akisi fallback ile tamamlandi.

## TYPECHECK
- `npx tsc --noEmit` -> FAIL (OOM / heap out of memory, onceki blocker devam).

## BUILD
- `npm run build` -> FAIL (`NODE_OPTIONS` icinde gecersiz `--r=` parametresi, onceki blocker devam).

## KNOWN ISSUES
- Global type debt ve tsc OOM blocker'i devam ediyor.
- Build ortaminda `NODE_OPTIONS` kirli.
- Bazi integration testler DB bagimli (`localhost:5432` yoksa fail).

## 5-ROUND VALIDATION READINESS
- Observability omurgasi belirgin sekilde guclendi.
- Ancak typecheck/build blockerlari temizlenmeden tam production-readiness denemez.
- Long validation bu task kapsaminda bilerek calistirilmadi.
