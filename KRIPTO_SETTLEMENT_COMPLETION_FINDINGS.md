# KRIPTO Settlement Completion Findings

## SC-FIXED-01 (HIGH) — FIXED
- Kök neden: `applyCanonicalPartialSettlementFill` mevcut execution varken yeni execution yaratıyordu; order aggregate iki kez büyüyebiliyordu.
- Production call path: `fix02-exit-reconciliation` -> `canonical-settlement-fill`.
- Değişiklik: mevcut execution eşleştirme (settlementFillId / exchangeTradeId) eklendi; eşleşmede yeni execution create kapatıldı, aggregate execution toplamından hesaplandı.
- Regression kanıtı: `tests/settlement-reconciliation.integration.test.ts` (`execution var settlement yoksa reconcile...`) artık execution count `1`.
- Kalan sınırlama: execution metadata’sında trade kimliği yoksa identity unresolved kalır (fail-open yok).

## SC-FIXED-02 (HIGH) — FIXED
- Kök neden: aktif intent bulunamayınca en son SELL/BUY order fallback’i yanlış order tüketebiliyordu.
- Production call path: `execution-engine-v2 (RECONCILE)` -> `fix02-exit-reconciliation`.
- Değişiklik: aktif intent varken fallback kaldırıldı; intent bağlı order yoksa unresolvedIntent/pending üretiliyor.
- Regression kanıtı: `tests/settlement-reconciliation.integration.test.ts` (`aktif intent bulunamazsa...`).
- Kalan sınırlama: unresolved intent için otomatik remediate akışı yok, manual/sonraki reconcile bekliyor.

## SC-FIXED-03 (HIGH) — FIXED
- Kök neden: ACK-loss sonrası local order yoksa reconcile order keşfi yoktu.
- Production call path: `fix02-exit-routing` (intent) -> `post-trade-settlement` (deterministic clientOrderId) -> `fix02-exit-reconciliation`.
- Değişiklik: `clientOrderId` üzerinden exchange order discovery, gerektiğinde local order recovery ve fills ingest eklendi.
- Regression kanıtı: `tests/settlement-reconciliation.integration.test.ts` (`ack-loss discovery clientOrderId...`).
- Kalan sınırlama: venue bazlı `getOrderStatusByClientOrderId` desteği olmayan adapterlarda discovery `null` döner.

## SC-FIXED-04 (HIGH) — FIXED
- Kök neden: canonical fill kimliği case/field fallback ile unstable olabiliyordu.
- Production call path: `post-trade-settlement`, `fix02-exit-reconciliation`, `canonical-fill-identity`.
- Değişiklik: orderId/clientOrderId trade-id fallback kaldırıldı; normalize uppercasing kaldırıldı; trade identity yoksa canonical apply yapılmıyor.
- Regression kanıtı: `tests/execution-correction.integration.test.ts`, `tests/corrections-final-qa.integration.test.ts`.
- Kalan sınırlama: legacy kayıtlarda exchangeTradeId yoksa otomatik eşleştirme bilinçli olarak yapılmıyor.

## SC-FIXED-05 (HIGH) — FIXED
- Kök neden: reconcile apply çağrısında `openFeePortion=0` koşulsuzdu.
- Production call path: `fix02-exit-reconciliation` -> `canonical-settlement-fill`.
- Değişiklik: open fee metadata’dan okunup fill oranında dağıtıldı.
- Regression kanıtı: `tests/settlement-reconciliation.integration.test.ts` multi-fill job senaryosu.
- Kalan sınırlama: legacy pozisyonlarda openFee metadata yoksa dağıtım 0 kalır.

## SC-OPEN-01 (HIGH) — OPEN
- Kök neden: gerçek process sınırında `commit sonrası / response-cache öncesi` IPC barrier kill kanıtı yok.
- Production call path: `canonical-settlement-fill` process crash recovery.
- Beklenen: child IPC barrier sinyali + parent kill + restart recovery.
- Mevcut: pre-commit kill ve post-commit idempotency kanıtı var.
- Durum: `PROCESS_CRASH_RECOVERY=PARTIAL`.

## SC-OPEN-02 (HIGH) — OPEN
- Kök neden: no-manual-seed tek zincirde `entry -> partial -> stop -> final settlement` test kanıtı eksik.
- Production call path: evaluator/router/admission -> entry orchestration -> settlement.
- Mevcut: fix01/fix02 zincir testleri var, fakat tek testte full entry’den kapanışa DB kanıtı yok.
- Durum: `PRODUCTION_ENTRY_PARTIAL_STOP=PARTIAL`.

## SC-OPEN-03 (HIGH) — OPEN
- Kök neden: counterfactual execution hala deterministic intent->order->latency->fill modelini tam uygulamıyor.
- Production call path: `pr05-negative-control`, `pr04-replay`.
- Mevcut: zorunlu son-tick fill kaldırıldı, ancak tam model yok.
- Durum: `COUNTERFACTUAL_EXECUTION=PARTIAL`.

## SC-OPEN-04 (HIGH) — OPEN
- Kök neden: ACK-loss discovery e2e restart + process death birleşik kanıtı yok.
- Production call path: submit timeout -> restart -> reconcile discovery.
- Mevcut: discovery + canonical apply testi var; process death birleşik kanıtı ayrı değil.
- Durum: `ACK_LOSS_DISCOVERY=PARTIAL`.

## SC-OPEN-05 (HIGH) — OPEN
- Kök neden: accounting/reservation için tüm path’lerde authoritative balance-exposure zinciri tek testte doğrulanmadı.
- Production call path: reconcile + settlement + reservation + balance paths.
- Mevcut: duplicate execution, multi-fill, dust/balance regressionleri PASS; tam kapsam zincir kanıtı eksik.
- Durum: `ACCOUNTING_AND_RESERVATION=PARTIAL`.

