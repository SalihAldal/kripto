# KRIPTO P1 — PUMP SCAN RELIABILITY + PRIORITY LANE FIX REPORT

## 1) Pump scan root cause
- `PUMP_SCAN_FAILED` kaynagi, `resolveLiveTopGainerPumpCandidates` cagrisinin 90s dis timer ile tek parcada sarilmasi ve bu cagrinin asiri genis sembol seti uzerinde calisabilmesiydi.
- Kok neden siniflandirmasi: `TOO_MANY_SYMBOLS + CACHE_MISS + PROVIDER_LATENCY + CANCELLATION`.
- Canli pump path'inde parent abort/deadline propagation eksikti; timeout halinde secim akisi erken sonlanabiliyordu.

## 2) Timeout behavior
- `runBoundedLivePumpScan` artik parent `AbortSignal` aliyor ve bounded await icinde cancellation destekli calisiyor.
- Timeout/cancel/network durumlari explicit lifecycle event olarak yaziliyor:
  - `PUMP_SCAN_TIMEOUT`
  - `PUMP_SCAN_ABORTED`
  - `PUMP_SCAN_NETWORK_ERROR`
  - `PUMP_SCAN_ERROR`
- Pump scan hata verse bile fallback event uretip scanner'a gecis yolu korunuyor.

## 3) Budget behavior
- Pump timeout artik selection deadline'e gore hesaplanarak deterministic sonlandiriliyor.
- Etkin form: `min(AUTO_ROUND_PUMP_SCAN_TIMEOUT_MS, remainingSelectionBudget)`.
- `resolvePumpLiveScanTimeoutMs` deadline'e yaklasildiginda scan suresini otomatik kisitliyor.

## 4) Fallback hierarchy
- Uygulanan zincir:
  1. cache tarama + cache telemetry
  2. stale priority warning telemetry (`PRIORITY_DATA_STALE`)
  3. bounded live pump scan
  4. live pump failure/timeout -> explicit fallback (`scanner_rotation`)
  5. safe empty result (`PUMP_SCAN_EMPTY`)
- Pump hatalari sessiz yutulmuyor; event ve reason telemetry saklaniyor.

## 5) Priority lane design
- Priority lane bounded/deduplicated/evaluate-sooner olarak korundu; auto-trade bypass eklenmedi.
- Scanner coverage metriklerine su alanlar eklendi:
  - `priorityMaxPerCycle`
  - `rotationCount`
  - `priorityCount`
  - `duplicateCount`
  - `totalEvaluationCount`
  - `prioritySource` (discovery source satiri bazinda)

## 6) COW reproduction
- Deterministik fixture testi korunup dogrulandi (`cursor=224`, `cycleLimit=79`, watchlist index `0`).
- `COWTRY` normal rotation disinda kalirken priority lane ile cycle evaluation icine aliniyor.
- Priority lane'den direkt `BUY/ORDER/TRADE` bypassi eklenmedi; sonraki gate zinciri korunuyor.

## 7) Scanner metrics
- `pump-scan-lifecycle` event yapisi genisletildi:
  - `phase`
  - `reasonCode`
  - `fallbackUsed`
  - `source`
  - `timeoutMs`
  - `cacheHit/cacheMiss/cacheAgeMs/liveScanTriggered` (meta)
- Round artifact export zinciri degismeden bu verileri `pump-scan-lifecycle.json` icinde disari veriyor.

## 8) Performance impact
- Live pump scan sembol islemesi `maxSymbolsToEvaluate` ile bounded hale getirildi.
- Pump context taramasi cooperative pool ile timeout/abort kontrollu calisiyor.
- Watcher-aware cache TTL floor ile gereksiz live rescan olasiligi dusuruldu.

## 9) Recovery interaction
- Round selection path'i pump timeout'u tek basina round'u oldurmeyecek sekilde fallback'a yonlendirildi.
- `PUMP_SCAN_FAILED` durumunda telemetry uretiliyor, sonra full scanner akisina devam ediliyor.
- Tek-round kontrollu kanitta zombie gozlenmedi (`noZombie=true`).

## 10) Tests
- Calistirilan suite:
  - `tests/forensics/p0-gap-closure.test.ts`
  - `tests/forensics/p1-strategy-scanner-ev.test.ts`
  - `tests/forensics/p1-pump-scan-priority-fix.test.ts` (yeni)
  - `tests/round-progress-recovery.test.ts`
  - `tests/scheduler-recovery.test.ts`
  - `tests/scanner.test.ts`
- Sonuc: **6/6 file PASS**, **35/35 test PASS**.

## 11) Controlled validation (max 1 round)
- Artifact: `kripto-p1-pump-priority-1round-validation.json`
- Job: `cmsxnjwi90007unqwzfr3oxdi`
- Ozet:
  - `pumpScanTimeoutCount=0`
  - `fallbackCount=15`
  - `priorityCandidates=0`
  - `priorityRescuedCount=0`
  - `noZombie=true`
  - `noAiBypass=true`
  - `noFeeMismatch=true`
- Round sonucu `SIM_TIGHT_FILTER` sebebiyle basarisiz; blocker pump timeout degil.

## 12) Remaining blockers
- Tek-round snapshot'ta `priorityCandidates` sifir olabilir; bu metrik icin daha fazla runtime ornekleme gerekli.
- Asagi akislardaki sikilastirilmis filtreler (`SIM_TIGHT_FILTER`) hala round fail sebebi olabiliyor.
- 30-50 round readiness karari icin ek cok-round runtime kaniti gerekiyor.
