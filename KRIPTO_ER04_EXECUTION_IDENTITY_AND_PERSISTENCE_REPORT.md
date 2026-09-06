# KRIPTO ER04 - EXECUTION IDENTITY AND PERSISTENCE REPORT

## Executive Verdict

- `PHASE4_VERDICT=PARTIAL`
- `REAL_PERSISTENCE_VERDICT=BLOCKED`
- `LATE_FILL_RECONCILIATION_VERDICT=PARTIAL`
- `STRATEGY_IDENTITY_CHAIN_VERDICT=PARTIAL`
- `OVERALL_ENGINEERING_READINESS=PARTIAL`
- `NEXT_PAPER_PREFLIGHT=NO_GO`
- `PROFITABILITY_EVIDENCE=NOT_EVALUATED`

## İncelenen Sürüm ve Çalışma Kopyası

- HEAD: `a85a04677acc8dba27af3362f238f86a1d463ea5`
- Branch: `main`
- Worktree: `DIRTY`
- Runtime: Node `v24.13.0`, npm `11.6.2`
- Disk: `~477.68 GB` boş

## ER03 ve ER01/ER02 Bağımlılık Doğrulaması

- Admission/risk/authorization ayrımı ER03 kodunda korunuyor; `LIVE_DISABLED` submit yolu kesmeye devam ediyor.
- ER01 structured telemetry/verdict ve ER02 feature contract regression setleri 3x tekrar PASS.
- Bu fazda ER03 davranışına ters bir bypass veya threshold gevşetmesi yapılmadı.

## Bu Fazda Kapatılan Kök Nedenler

1) **Strateji kimliği zinciri kopması (open->monitor->settlement)**
- Kök neden: open path'te bazı alanlar `marketRegime.strategy` ile yazılıyordu.
- Düzeltme:
  - `position.metadata.marketRegimeStrategy` authoritative `selectedStrategyId` ile yazıldı.
  - `order.metadata`, `tradeExecution.metadata`, `idempotent execution` kaydına `strategyId`, `strategyPolicyVersion`, `regimePolicyVersion`, `featureSnapshotId`, `sourceType`, `decisionId`, `candidateId` eklendi.
  - monitor attach/recovery tarafında `strategyId` öncelikli restore kuralı eklendi.

2) **Execution claim yalnız in-memory idi (cross-worker dayanıklılığı yok)**
- Kök neden: `claimCanonicalExecutionAttempt` sadece process `Map` üzerinde çalışıyordu.
- Düzeltme:
  - `claimDurableCanonicalExecutionAttempt` ve `releaseDurableCanonicalExecutionAttempt` eklendi (`app_setting` unique key).
  - orchestrator claim akışı durable lock'a geçirildi.
  - finalize aşamasında lock release uygulanıyor.

3) **Paper close persistence eşleme/quantity tutarsızlığı**
- Kök neden: close eşlemede `symbol+OPEN` lookup ve close quantity'de full quantity yazımı.
- Düzeltme:
  - `paper-trade-recorder` içinde open trade lookup `positionId`/`executionId` ile güçlendirildi.
  - close quantity `executedQty` bazlı yazılıyor (`min(openQty, executedQty)`).
  - close metadata'da strategy/regime/execution bağları korunuyor.
  - missing candidate bağında `LEGACY_UNRESOLVED` açık şekilde raporlanıyor.

## Execution / Persistence Zinciri (Bu İterasyonda Doğrulanan)

- **Canonical decision**: `execution-orchestrator` içinde canonical admission sonucu.
- **Execution authorization / risk revalidation**: ER03/ER04 öncesi korunan katman.
- **Durable claim**: yeni `app_setting` lock (`execution.attempt.lock.<user>.<mode>.<venue>.<candidate>`).
- **Submit attempt**: live/paper adapter çağrısı, telemetry üretimi.
- **Order persistence**: `tradeOrder.create` + identity metadata.
- **Fill persistence**: `tradeExecution.create` + identity metadata.
- **Position open/update**: `position.create` + immutable decision snapshot.
- **Monitor registration**: strategy identity ile `attachPositionMonitor`.
- **Close fill persistence**: `persistPaperCloseFillForSettlement` -> `recordPaperFillEvent`.
- **Settlement**: `closePositionRecord`, `createPnlRecord`, close execution kaydı.
- **Reconciliation/restart**: `markPaperPersistenceReconciliation` ve failsafe yolları korunuyor.

## Authoritative / Projection Tablolar

- Authoritative lifecycle tabanları: `TradeOrder`, `TradeExecution`, `Position`, `ProfitLossRecord`.
- Paper projection tabanları: `PaperTrade`, `PaperExecution` (simülasyon ve doğrulama görünümü).
- Bağlantılar:
  - `TradeOrder.positionId` -> `Position.id`
  - `TradeExecution.tradeOrderId` -> `TradeOrder.id`
  - `PaperExecution.paperTradeId` -> `PaperTrade.id`
  - Ek metadata: `executionId`, `decisionId`, `candidateId`, `strategyId`.

## Test Kanıtları

- Focused regression (3 ardışık koşu, her biri `exit 0`):
  - `tests/er04-durable-execution-attempt-lock.test.ts`
  - `tests/p0-paper-persistence.test.ts`
  - `tests/er03-canonical-policy.test.ts`
  - `tests/p1-round-selection-event-driven.test.ts`
  - `tests/er02-feature-contract-and-router-input.test.ts`
  - `tests/er01-telemetry-verdict.test.ts`
  - Sonuç: `71/71 PASS` (her tekrarda)

- Consumer regresyon koşusu:
  - `tests/phase01-core-reset.test.ts` PASS
  - `tests/phase06-paper-production.test.ts` PASS
  - `tests/p0-paper-close-persistence.test.ts` PASS
  - `tests/execution-settlement.integration.test.ts` FAIL (`localhost:5432` erişim yok + timeout)

- DB smoke:
  - `tests/forensics/db-validation-smoke.integration.test.ts` FAIL (`localhost:5432` erişim yok)

- `npm run typecheck` -> `exit 0`
- `npm run build` -> `exit 0`

## Çalıştırılamayan Kontroller ve Açık Blocker'lar

- Disposable PostgreSQL kurulumu denendi, Docker CLI mevcut ama daemon erişimi yok:
  - `docker --version` -> `exit 0`
  - `docker ps ...` -> `exit 1` (`dockerDesktopLinuxEngine` yok)
- Bu nedenle gerçek DB üzerinde zorunlu lifecycle/crash-late-fill matrisinin tamamı `BLOCKED/NOT_RUN`.
- Özellikle aşağıdakiler bu iterasyonda tam kanıtlanamadı:
  - timeout sonrası gerçek geç fill (DB persisted) senaryosu
  - cross-worker claim yarışının gerçek DB client'larla doğrulaması
  - fault injection A..F senaryolarının tamamı

## Prompt 5'e Devredilen Teknik Notlar

- Canonical execution/settlement dataset üretiminde identity alanları artık daha eksiksiz; Prompt 5 dataset/horizon doğrulaması buna bağlanmalı.
- Durable lock için stale lease reclaim/distributed restart davranışı ayrı regression setiyle tamamlanmalı.
- Gerçek DB erişimi açıldığında lifecycle full integration (OPEN->CLOSED, partial/zero fill, late fill, restart) zorunlu olarak tekrar doğrulanmalı.
