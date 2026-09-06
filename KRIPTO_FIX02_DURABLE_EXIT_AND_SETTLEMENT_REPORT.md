# KRIPTO FIX02 — Durable Exit State, Restart/Reconciliation & Canonical Partial Settlement

## Fingerprints

| Alan | Değer |
|---|---|
| Başlangıç HEAD | `695c9f07ee475d5b4a338cfade769e8825e4ac98` |
| Final HEAD | `695c9f07ee475d5b4a338cfade769e8825e4ac98` (worktree dirty) |
| Tarih | 2026-09-06 |

## Özet

PR04 çıkış kararları artık canonical `settleOpenPosition` yoluna bağlanabilir; exit snapshot/state PostgreSQL'de kalıcı; partial fill `applyPartialPositionClose` ile pozisyonu OPEN bırakır; shadow değerlendirme dry-run modunda state mutasyonu yapmaz.

**Canlı varsayılan:** `EXECUTION_PR04_EXIT_ROUTING_ENABLED=false` — üretim davranışı değişmez; izole testte flag açılır.

## Exit → Settlement Zinciri

```
Position fill
  → bootstrapExitPersistenceAtEntry (DB snapshot + mutable state)
  → position-monitor tick
      → evaluatePr04ExitShadowTick (dryRun, telemetri)
      → processFix02Pr04ExitTick (routing flag açıkken)
          → evaluateExitPolicyTick
          → claimExitQuantity
          → settleOpenPosition({ requestedCloseQuantity, settlementFillId })
          → applyPartialPositionClose | closePositionRecord
          → applyExitFill + savePersistedExitState
```

## Şema / Migration

- Model: `PositionExitPersistedState` (`prisma/schema.prisma`)
- Migration: `prisma/migrations/20260906151500_fix02_position_exit_persisted_state/migration.sql`
- Alanlar: immutable `snapshot` + `selectedSignal`, mutable `state`, `stateVersion`, `processedFillIds`, `reconciliationStatus`, owner fence

## Disposable PostgreSQL Kanıtı

| Özellik | Kanıt |
|---|---|
| Container | `kripto-main-postgres-1` (healthy, port 5432) |
| DB adı | `kripto_fix02_<timestamp>_<rand>` |
| Fail-closed | `kinetic` ve `postgres` DB adları engelli |
| Harness | `tests/helpers/fix02-disposable-postgres.ts` |
| Migration | Yalnızca disposable DB'ye `prisma migrate deploy` |

## Claim / Owner Modeli

- `claimDurableCanonicalExecutionAttempt`: P2002 → `DUPLICATE_EXECUTION_PATH`; P1001 → `EXECUTION_CLAIM_DB_UNAVAILABLE`
- `ownerFenceToken` + `executionId` ile release
- Expired lease → `CLAIM_RECONCILE_REQUIRED` (doğrudan resubmit yok)
- `reconcileExpiredDurableExecutionAttempt` eklendi

## Partial Settlement

- `settleOpenPosition` → `requestedCloseQuantity`, `settlementFillId` dedup
- Partial path → `applyPartialPositionClose` (quantity azaltır, status OPEN kalır)
- Full path → mevcut `closePositionRecord` (geriye uyumlu)

## Test Sonuçları

| Komut | Sonuç |
|---|---|
| `tests/fix02-durable-exit-and-settlement.integration.test.ts` x3 | **8/8 PASS** (24/24) |
| ER04 + PR04 + FIX01 + execution-settlement | **87/87 PASS** |
| `npm run typecheck` | **exit 0** |
| `npm run build` | **exit 1** — Next build lock guard (ortam) |

### DB Senaryoları (kapsanan alt küme)

1-2 snapshot persist/restart, 3 version conflict, 5 shadow no reserve, 6-10 partial routing, 11 fill dedup, 28-29 owner release, 31 DB error classification, 35 stale tick no fill.

## Verdict Alanları

| Alan | Verdict |
|---|---|
| FIX02_ENGINEERING_VERDICT | COMPLETED_PARTIAL |
| DISPOSABLE_POSTGRES_VERDICT | PASS |
| EXIT_DECISION_ROUTING_VERDICT | PASS |
| DURABLE_EXIT_STATE_VERDICT | PASS |
| PARTIAL_SETTLEMENT_VERDICT | PASS |
| CLAIM_OWNERSHIP_VERDICT | PASS |
| CRASH_RECONCILIATION_VERDICT | PARTIAL |
| ACCOUNTING_INVARIANTS_VERDICT | PARTIAL |
| PROFITABILITY_EVIDENCE | NOT_EVALUATED |
| PAPER_CAMPAIGN_STARTED | false |
| LIVE_AUTHORIZATION | DISABLED |
| OVERALL_QA_STATUS | QA_PENDING |

## Açık / BLOCKED

- 36 senaryonun tamamı ayrı test olarak yazılmadı; kritik alt küme gerçek PostgreSQL ile doğrulandı
- Crash/restart process-boundary testleri (worker yeniden başlatma) kısmi
- `npm run build` Next lock guard nedeniyle bu oturumda tamamlanamadı
- Production DB migration uygulanmadı (sınır gereği)

## Handoff — Düzeltme 3

- Offline veri kabulü ve negatif kontrol
- Kalan 36 senaryo matrisinin tam test kapsamı
- Build lock temizliği + tam QA12 yeniden değerlendirme

## Dosyalar

- `src/server/execution/fix02-exit-persistence.service.ts`
- `src/server/execution/fix02-exit-routing.service.ts`
- `src/server/execution/post-trade-settlement.service.ts` (partial path)
- `src/server/repositories/execution.repository.ts` (`applyPartialPositionClose`)
- `src/server/hot-path/execution-attempt-lock.service.ts`
- `tests/fix02-durable-exit-and-settlement.integration.test.ts`
- `kripto-fix02-durable-exit-and-settlement.json`
