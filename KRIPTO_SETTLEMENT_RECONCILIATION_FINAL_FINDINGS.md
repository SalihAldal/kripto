# KRIPTO Settlement/Reconciliation Final Findings

## SRF-FIXED-01 (HIGH) — FIXED
- **Kök neden:** Reconcile path `reconcile:*` kimliğiyle normal settlement kimliğinden ayrışıyordu.
- **Production path:** `execution-engine-v2(RECONCILE)` → `fix02-exit-reconciliation` → `applyCanonicalPartialSettlementFill`
- **Değişen dosyalar:** `src/server/execution/canonical-fill-identity.ts`, `src/server/execution/post-trade-settlement.service.ts`, `src/server/execution/fix02-exit-reconciliation.service.ts`
- **Düzeltme:** Canonical fill kimliği tek helper (`fill-v2`) üstüne alındı; execution metadata içindeki fill kimliği tekrar kullanılıyor.
- **Regression kanıtı:** `tests/settlement-reconciliation.integration.test.ts` (normal→reconcile no-op, execution var/settlement yok path)
- **DB/process kanıtı:** Disposable PG üzerinde tek `PositionSettlementFill`, tek ekonomik etki.
- **Kalan limit:** Legacy execution satırında trade/order kimliği yoksa otomatik apply yapılmıyor (pending kalıyor).

## SRF-FIXED-02 (HIGH) — FIXED
- **Kök neden:** Multi-fill reconcile döngüsü her fill için aynı `stateVersion` kullanıyordu.
- **Production path:** `reconcileFix02ExitBundles` fill loop
- **Değişen dosyalar:** `src/server/execution/fix02-exit-reconciliation.service.ts`, `src/server/execution/canonical-settlement-fill.service.ts`
- **Düzeltme:** Her fill öncesi güncel persisted bundle yeniden okunuyor; tx retry/backoff genişletildi.
- **Regression kanıtı:** `tests/settlement-reconciliation.integration.test.ts` (0.2+0.3+0.5), `tests/execution-correction.integration.test.ts` (concurrent farklı fill)
- **DB/process kanıtı:** 3 tur crash/concurrency koşusunda final fail yok.
- **Kalan limit:** Cumulative-only exchange verisinde trade-id yoksa identity unresolved durumunda apply edilmiyor.

## SRF-FIXED-03 (HIGH) — FIXED
- **Kök neden:** `ALREADY_APPLIED` sonucu order referansı taşımadığı için üst katman yanlış yorumlayabiliyordu.
- **Production path:** `canonical-settlement-fill` duplicate dedup branch
- **Değişen dosyalar:** `src/server/execution/canonical-settlement-fill.service.ts`
- **Düzeltme:** `ALREADY_APPLIED` artık `tradeOrderId` döndürüyor.
- **Regression kanıtı:** `tests/execution-correction.integration.test.ts` F, `tests/execution-process-kill.integration.test.ts`
- **DB/process kanıtı:** Duplicate retry sonrası tek settlement receipt korunuyor.
- **Kalan limit:** Yok.

## SRF-FIXED-04 (HIGH) — FIXED
- **Kök neden:** Dust/balance mismatch fallback gerçek satış olmadan fake close + PnL yazıyordu.
- **Production path:** `post-trade-settlement` (`BALANCE_MISMATCH_AUTO_CLOSE`, `DUST_AUTO_CLOSE`)
- **Değişen dosyalar:** `src/server/execution/post-trade-settlement.service.ts`
- **Düzeltme:** Bu yollar reconcile-required/visible failure davranışına çekildi; position açık kalıyor, fake PnL yazılmıyor.
- **Regression kanıtı:** `tests/settlement-reconciliation.integration.test.ts` dust + mismatch case
- **DB/process kanıtı:** `Position.status=OPEN`, `ProfitLossRecord=0`.
- **Kalan limit:** Dust için ayrı accounting type/model henüz eklenmedi (yalnızca fake close engellendi).

## SRF-FIXED-05 (HIGH) — FIXED
- **Kök neden:** Counterfactual negatif kontrol son tick’e koşulsuz sentetik fill ekliyordu.
- **Production path:** `pr05-negative-control` → `buildCounterfactualEntryShift`
- **Değişen dosyalar:** `src/server/profitability/pr05-negative-control.ts`, `tests/replay-correction.test.ts`, `tests/pr05-offline-comparison.test.ts`
- **Düzeltme:** Koşulsuz final fill kaldırıldı; procedureApplied yoksa `INSUFFICIENT_DATA`.
- **Regression kanıtı:** `tests/replay-correction.test.ts`, `tests/pr05-offline-comparison.test.ts`
- **DB/process kanıtı:** N/A (replay katmanı)
- **Kalan limit:** Tam karşı-olgusal execution market-microstructure modeli bu tur kapsamı dışında.

## SRF-OPEN-01 (HIGH) — OPEN
- **Kök neden:** ACK-loss için “accepted + timeout + local order id yok” akışında exchange/clientOrderId discovery zinciri eksik.
- **Production path:** `fix02-exit-routing` + `post-trade-settlement` + `fix02-exit-reconciliation`
- **Beklenen:** Restart sonrası durable intent/clientOrderId ile borsadan order/fill discovery.
- **Mevcut:** Pending/reconcile path var; tam belirsiz submit discovery e2e kanıtı yok.
- **Kalan limit:** Bu açık `ACK_LOSS_RECOVERY_VERDICT`i PARTIAL tutuyor.

## SRF-OPEN-02 (HIGH) — OPEN
- **Kök neden:** Manual seed olmadan tek parça production chain testi yok.
- **Production path:** entry evaluator/router/admission → entry orchestration → partial → stop
- **Mevcut:** Seedli settlement zincirleri güçlü; ama “entry gerçek yolundan position üret” tek test eksik.
- **Kalan limit:** `PRODUCTION_CHAIN_VERDICT=PARTIAL`.

## SRF-OPEN-03 (HIGH) — OPEN
- **Kök neden:** Crash testlerinde “commit sonrası response/cache öncesi kill” net bariyer ayrıştırması sınırlı.
- **Production path:** canonical settlement tx + process crash recovery
- **Mevcut:** Child-process pre-commit kill rollback + crash sonrası restart exactly-once kanıtı var.
- **Kalan limit:** Net post-commit/pre-response barrier kanıtı ve ACK-loss + process death birleşik test açık.

