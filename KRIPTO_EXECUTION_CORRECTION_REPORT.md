# KRIPTO EXECUTION CORRECTION REPORT — Düzeltme 1/2

**Tarih:** 2026-09-06  
**Kapsam:** Kademeli satış sonrası stop, atomik partial settlement, gerçek fill aktarımı  
**Doğrulanmış hata commit:** `e0f3ac1df41f0421906d2e315c63e8623f2c7a7b`

---

## Fingerprint

| Alan | Değer |
|---|---|
| Başlangıç HEAD | `e0f3ac1df41f0421906d2e315c63e8623f2c7a7b` |
| Final HEAD (uncommitted) | `e0f3ac1df41f0421906d2e315c63e8623f2c7a7b` |
| Final dirty fingerprint (core) | `sha256:exec-correction-v1:87a2d33,b1ee162,058e759,db1e660,8f82de2,f957738,4126acd,0d4a6e2` |
| Migration | `prisma/migrations/20260906163000_execution_correction_settlement_fill/migration.sql` |
| Disposable DB prefix | `kripto_fix02_*` (Docker PostgreSQL) |

---

## Verdict Özeti

| Verdict | Sonuç |
|---|---|
| `EXECUTION_CORRECTION_VERDICT` | `PARTIAL_PASS` |
| `POST_PARTIAL_STOP_VERDICT` | `PASS` |
| `ATOMIC_SETTLEMENT_VERDICT` | `PARTIAL` (partial canonical PASS; full close henüz ayrı adımlar) |
| `ACTUAL_FILL_PROPAGATION_VERDICT` | `PASS` |
| `CONCURRENT_FILL_VERDICT` | `PASS` |
| `CRASH_RECONCILIATION_VERDICT` | `PARTIAL` |
| `PAPER_CAMPAIGN_STARTED` | `false` |
| `LIVE_AUTHORIZATION` | `DISABLED` |
| `OVERALL_QA_STATUS` | `QA_PENDING` |

---

## 1. Stop Hatası — Önce / Sonra

### Önce (doğrulanmış)

- `applyExitFill()` pozisyonda miktar kaldığında `orderState=PARTIALLY_FILLED` yazıyordu.
- `shouldSuppressDuplicateExit()` bunu açık emir sayıp sonraki stop’u `ORDER_IN_FLIGHT` ile engelliyordu.
- Örnek: qty 1 → 0.5 kademeli satış tamamlandı → kalan 0.5 → stop 99 → fiyat 90 → sonuç `NONE / ORDER_IN_FLIGHT`.

### Sonra

- **Emir durumu** ve **pozisyon durumu** ayrıldı.
- Tamamlanan kademeli emir: `releaseCompletedExitOrder()` → `orderState=NONE`, `reservedSellQuantity=0`, `activeExitOrder=null`.
- Gerçek açık partial emir: `openOrderRemainingQuantity > 0` → rezervasyon korunur, `PARTIALLY_FILLED` kalır.
- `shouldSuppressDuplicateExit()` yalnızca `reservedSellQuantity > 0` **ve** `orderState ∈ {SUBMITTED, PARTIALLY_FILLED}` iken engeller.

**PostgreSQL kanıtı (test A):** 1 → 0.5 partial fill → pozisyon OPEN, `orderState=NONE`, `reservedSellQuantity=0` → stop tick `STRUCTURAL_STOP`, `ORDER_IN_FLIGHT` değil → pozisyon CLOSED.

---

## 2. Order / Position / Kademe State Ayrımı

| Alan | Anlam |
|---|---|
| `remainingQuantity` | Pozisyonda satılabilir kalan miktar |
| `reservedSellQuantity` | Açık satış emrine ayrılmış miktar |
| `orderState` | Emir yaşam döngüsü (`NONE`, `SUBMITTED`, `PARTIALLY_FILLED`, `FILLED`, `CANCELED`) |
| `activeExitOrder` | Intent: `requestedQuantity`, `executedQuantity`, `openQuantity`, `partialLegId`, `terminal` |
| `completedPartialLegs` | Terminal tamamlanan kademe kimlikleri |

Kademe tamamlanması fill gelince otomatik sayılmaz; terminal emir + `openOrderRemainingQuantity=0` ile rezervasyon çözülür.

---

## 3. Ortak Gerçek Fill Sonuç Sözleşmesi

Dosya: `src/server/execution/settlement-fill-result.ts`

- `SettlementFillResult`: `status`, `executedQuantity`, `fillPrice`, `fillFee`, `feeAsset`, `orderTerminal`, `orderRemainingQuantity`, `positionRemainingQuantity`, `partial`, `positionClosed`.
- `requireSettlementFillEvidence()`: eksik fill alanında `null` — decision fallback yok.
- `fix02-exit-routing.service.ts`: `requireSettlementFillEvidence(settlement)` ile routing; `decision.closeQuantity/decisionPrice/0 fee` fallback kaldırıldı.

Full close dönüşü (`post-trade-settlement.service.ts` ~1389): `executedQuantity`, `fillPrice`, `fillFee`, `feeAsset` taşınıyor.

---

## 4. Tek Canonical Partial Fill Muhasebesi

Dosya: `src/server/execution/canonical-settlement-fill.service.ts`

**Tek `prisma.$transaction` içinde:**

1. `PositionSettlementFill` unique claim (`@@unique([positionId, settlementFillId])`)
2. `TradeOrder` + `TradeExecution`
3. `Position` miktar / status / metadata
4. `ProfitLossRecord`

Dedup: `P2002` → `ALREADY_APPLIED` (ekonomik etki no-op).

**Full close:** hâlâ legacy `createTradeOrder` + `closePositionRecord` zinciri (atomik değil) — bilinen kısıt.

---

## 5. Transaction Sınırı

- Dış borsa submit + DB commit **aynı transaction’da değil** (tasarım gereği).
- Akış: intent/rezervasyon → paper/live submit → canonical ingestion → atomik DB muhasebe.
- Bildirimler commit sonrası mevcut outbox/event yoluyla.

---

## 6. Dedup ve Eşzamanlılık

- DB: `PositionSettlementFill` unique constraint.
- Test F: iki eşzamanlı client → `APPLIED` + `ALREADY_APPLIED`, tek PnL, qty 0.6.
- Test D: `afterPositionUpdate` hook enjeksiyonu → tam rollback (qty=1, order=0, pnl=0, dedup=0).

---

## 7. Reconciliation Tüketicisi

| Durum | Tüketici / Davranış |
|---|---|
| `RECONCILE_REQUIRED` (exit bundle) | `processFix02Pr04ExitTick` yeni exit göndermez; `reasonCode=RECONCILE_REQUIRED` |
| Settlement başarısız | `savePersistedExitState(..., reconciliationStatus: "RECONCILE_REQUIRED")` |
| Execution engine v2 | `execution-engine-v2.workers.ts` periyodik `RECONCILE` job |
| Failsafe recovery | `failsafe-recovery.service.ts` reconcile state |

**Eksik:** FIX02 exit bundle için özel geç-fill worker uçtan uca test edilmedi (G senaryosu kısmi).

---

## 8. DB State ve Cache

- `processFix02Pr04ExitTick`: bellek boşsa `hydrateExitPolicyState(bundle.state)` ile DB authoritative restore.
- `savePersistedExitState`: `stateVersion` optimistic lock; çakışma → `EXIT_STATE_VERSION_CONFLICT`.
- `resetExitPolicyStoreForTests` + dynamic import: integration testlerde çift modül örneği önlendi.

---

## 9. Test Kanıtları

### Çalıştırılan (Docker UP — 2026-09-06 ~16:34 UTC+3)

| Komut | Sonuç |
|---|---|
| `tests/execution-correction.integration.test.ts` ×3 ardışık | **5/5 PASS** |
| `tests/pr04-exit-and-position-management.test.ts` | **47/47 PASS** |
| `tests/fix02-durable-exit-and-settlement.integration.test.ts` | **8/8 PASS** |
| `npm run typecheck` | **exit 0** |
| `npm run build` | **exit 0** (~549s) |

### Şu an BLOCKED (Docker daemon kapalı — 2026-09-06 ~23:23)

| Kontrol | Durum |
|---|---|
| PostgreSQL integration yeniden koşu | `BLOCKED` — `dockerDesktopLinuxEngine` yok |
| `tests/post-fix-final-qa.integration.test.ts` | `BLOCKED` (aynı neden) |
| Process-level crash/restart (E) | `NOT_RUN` |
| Reconciliation yarış (G) tam zincir | `NOT_RUN` |

---

## 10. Geçersizleşen Önceki PASS İddiaları

| Önceki iddia | Gerçek |
|---|---|
| “Kademeli satış sonrası stop çalışır” (yalnızca evaluator unit) | Üretim yolunda `ORDER_IN_FLIGHT` engeli vardı — **düzeltildi** |
| “Partial settlement atomik” (JSON dedup) | Read-then-update + metadata listesi atomik değildi — **partial canonical transaction ile düzeltildi** |
| “Full close fill routing doğru” | Decision fallback kullanılıyordu — **gerçek fill alanları eklendi** |

---

## 11. Değişen Dosyalar

- `src/server/profitability/pr04-exit-coordinator.ts` — rezervasyon / suppress mantığı
- `src/server/profitability/pr04-exit-evaluator.ts` — `applyExitFill` + `openOrderRemainingQuantity`
- `src/server/profitability/pr04-types.ts` — `ExitActiveOrderState`
- `src/server/execution/fix02-exit-routing.service.ts` — hydrate, fill evidence, `registerOpenExitOrder`
- `src/server/execution/post-trade-settlement.service.ts` — partial canonical + full fill result
- `src/server/execution/canonical-settlement-fill.service.ts` — **yeni**
- `src/server/execution/settlement-fill-result.ts` — **yeni**
- `prisma/schema.prisma` + migration `20260906163000_execution_correction_settlement_fill`
- `tests/execution-correction.integration.test.ts` — **yeni**
- `tests/pr04-exit-and-position-management.test.ts` — 31b/31c regresyon

---

## 12. Açık Kalemler (Düzeltme 2 / Genel QA)

1. Full close canonical atomik transaction
2. Process-level crash/restart (E) disposable harness
3. RECONCILE_REQUIRED geç-fill uçtan uca (G)
4. Stop+TP eşzamanlı yarış (F genişletilmiş)
5. Genel post-fix QA yeniden koşu (Docker gerekli)

---

*Rapor: EXEC Correction Düzeltme 1/2 — kod tamamlandı; DB kanıtı önceki oturumda doğrulandı, yeniden koşu Docker kapalı olduğu için BLOCKED.*
