# KRIPTO FIX03 — Offline Veri Kabulü, Negatif Kontrol ve QA Kanıt Doğruluğu

## Fingerprints

| Alan | Değer |
|---|---|
| Başlangıç HEAD | `695c9f07ee475d5b4a338cfade769e8825e4ac98` |
| Final HEAD | `695c9f07ee475d5b4a338cfade769e8825e4ac98` (worktree dirty) |
| Tarih | 2026-09-06 |
| JSON kanıt | `kripto-fix03-offline-pipeline-and-evidence.json` |

## Özet

Offline değerlendirme hattındaki sahte/sabit davranışlar kaldırıldı; gerçek replay paketi loader’ı, nedensel negatif kontrol, split-bazlı aggregation, sermaye kısıtlı portföy replay ve evidence-driven QA12 assessment eklendi. Kayıtlı piyasa verisi olmadığı için **piyasa kârlılık deneyi NOT_RUN**; mühendislik kanıtı sentetik paket üzerinde doğrulandı.

## 1. Replay Paketi Kabulü

### Sözleşme

- Schema: `pr05-replay-package-v1`
- Loader: `src/server/profitability/pr05-replay-package-loader.ts`
- Envanter: `src/server/profitability/pr05-data-inventory.ts` (sabit `NOT_PRESENT` kaldırıldı)

### Doğrulamalar

| Kontrol | Davranış |
|---|---|
| Schema | `validateReplayPackageManifest` — geçersiz schema reddedilir |
| Dosya varlığı | `MISSING_FILE` |
| Hash | `contentHashes` ile `HASH_MISMATCH` |
| Path traversal | Paket kökü dışına çıkan `ticksFile` → `PATH_TRAVERSAL` |
| `availableAt` uydurma | Yok — manifest `hasAvailableAt` bayrağı korunur |
| `recordedMarketData=true` | Tek başına market evidence üretmez; `sourceType=recorded` + yeterlilik gerekir |

### Mühendislik paketi

- `data/replay-packages/engineering-synthetic-v1/package.manifest.json`
- `sourceType: synthetic` → `fitnessForEngineeringReplay: FIT`, `fitnessForMarketExperiment: NOT_FIT`
- Tick dosyaları lazy okunur; büyük veri tek seferde belleğe alınmaz

## 2. Negatif Kontrol (Nedensel)

### Eski kusur (geçersiz)

`shiftSignalBlocksWithSeed()` kapalı PnL listesini permüte ediyordu; ortalama değişmediği için gerçek negatif kontrol değildi.

### Yeni yol

- Modül: `src/server/profitability/pr05-negative-control.ts`
- Metod: `CAUSAL_ENTRY_TIME_SHIFT` (`runCausalEntryShiftNegativeControl`)
- **Ne değişir:** `entryAtMs` replay penceresi içinde seed’li kaydırılır; invalidation taşınabilirse yeniden kurulur
- **Ne yeniden çalışır:** `buildMatchedEntryManifest` → `runMatchedExitComparison` → `runPr04ExitReplayWithOutcome`
- **Ne kopyalanmaz:** Eski PnL listesi; kontrol her iterasyonda exit motorunu yeniden çağırır

### Verdict ayrımı

| Alan | Anlam |
|---|---|
| `implementationVerdict` | Prosedür doğru uygulandı mı |
| `significanceVerdict` | Dağılım farkı anlamlı mı (yetersiz örnekte iddia edilmez) |
| `procedureApplied` | Giriş zamanı gerçekten değişti mi |

Eski permütasyon: `shuffleClosedPnlPermutation` → `PNL_PERMUTATION_NON_CAUSAL`, `procedureApplied: false`

## 3. Split ve Portföy

### Split aggregation

- `aggregateTradeOutcomes({ split })` — TRAIN/VALIDATION/HOLDOUT/UNASSIGNED ayrı variant key
- Purged satırlar performans toplamına sızmaz
- Validation seçimi holdout’u etkilemez (mevcut walk-forward sözleşmesi korunur)

### Portföy replay

- Modül: `src/server/profitability/pr05-portfolio-replay.ts`
- Zaman sıralı lifecycle, `startingCapital`, `maxConcurrentPositions: 1`
- Sermaye rezervasyonu: `entryNotional > availableCapital` → red
- `runPr04ExitReplayWithOutcome` ile gerçek exit/settlement yolu
- Engineering fixture’da `portfolioOutcomes.length > 0` (eski `[]` sabiti kaldırıldı)

## 4. Kaldırılan Sabit/Sahte Değerler

| Eski | Yeni |
|---|---|
| `buildPr05DataInventory()` sabit `NOT_PRESENT` | Gerçek loader + fitness ayrımı |
| `entryPrices=100` | Manifest fill fiyatları |
| Hardcoded `strategyId` | Manifest `strategyId` |
| `symbol/regime=null` | Manifest alanları veya `UNKNOWN` |
| Holding = replay penceresi | `closedAtMs - entryAtMs` |
| `portfolioOutcomes=[]` | `runPortfolioReplay` çıktısı |
| QA12 `expect(true).toBe(true)` | Gerçek assessment assertion’ları |
| Sabit phase verdict map | `derivePhaseStatus` input-driven |

## 5. Assessment Motoru

- Modül: `src/server/forensics/qa12-final-assessment.ts`
- Açık HIGH/CRITICAL → `FINAL_ENGINEERING_VERDICT: PARTIAL`
- Zorunlu `REQUIRED_CHECKS_NOT_RUN` → `OVERALL_QA_STATUS: QA_PENDING`
- `supersededClaims` ve `invalidatedReports` eski kanıt iddialarını işaretler
- Markdown ve JSON aynı assessment nesnesinden üretilir

## 6. Geçersizleşen Eski Kanıtlar

| Eski iddia | Durum |
|---|---|
| PR05 shuffle-only negatif kontrol sonuçları | **INVALIDATED** — nedensel değil |
| QA12 Test F `expect(true)` PASS | **INVALIDATED** |
| Sabit QA12 faz verdict’leri | **SUPERSEDED** |
| `recordedMarketDatasetAvailable` sentetik ile | **INVALIDATED** |
| Split karışık aggregate’lar | **SUPERSEDED** (FIX03 split path) |
| Varyant × lifecycle bağımsız örnek şişirme | **SUPERSEDED** |

Tarihsel rapor dosyaları değiştirilmedi; bu rapor geçerlilik revizyonu sağlar.

## 7. Test Sonuçları

| Komut | Sonuç |
|---|---|
| `tests/fix03-offline-pipeline-and-evidence.test.ts` ×3 | **14/14 PASS** (42/42) |
| `tests/pr05-offline-comparison.test.ts` | **36/36 PASS** |
| `tests/qa12-integrated-chain.test.ts` | **17/17 PASS** |
| `tests/fix01-strategy-context-and-invalidation.test.ts` | **32/32 PASS** |
| `tests/fix02-durable-exit-and-settlement.integration.test.ts` | **8/8 PASS** |
| `tests/er04-durable-execution-attempt-lock.test.ts` | **3/3 PASS** |
| `tests/er05-canonical-dataset-persistence.test.ts` | **2/2 PASS** |
| `npm run typecheck` | **exit 0** |
| `npm run build` | **exit 0** |

### Güvenli offline komut

```bash
npm run test:run -- tests/fix03-offline-pipeline-and-evidence.test.ts tests/pr05-offline-comparison.test.ts
```

## 8. Verdict Alanları

| Alan | Verdict |
|---|---|
| FIX03_ENGINEERING_VERDICT | COMPLETED_PARTIAL |
| DATA_PACKAGE_INGESTION_VERDICT | PASS |
| CAUSAL_REPLAY_WIRING_VERDICT | PASS |
| NEGATIVE_CONTROL_IMPLEMENTATION_VERDICT | PASS |
| SPLIT_ISOLATION_VERDICT | PASS |
| PORTFOLIO_REPLAY_INTEGRATION_VERDICT | PASS |
| ASSESSMENT_EVIDENCE_VERDICT | PASS |
| MARKET_EXPERIMENT_STATUS | NOT_RUN |
| PROFITABILITY_EVIDENCE | INSUFFICIENT_DATA |
| PAPER_CAMPAIGN_STARTED | false |
| LIVE_AUTHORIZATION | DISABLED |
| OVERALL_QA_STATUS | QA_PENDING |

## 9. BLOCKED / NOT_RUN

- Kayıtlı (`sourceType=recorded`) replay paketi yok → piyasa deneyi **NOT_RUN**
- Holdout profitability kanıtı **NOT_RUN**
- Tam ölçekli portföy replay (çok lifecycle + recorded data) **NOT_RUN**
- Paper kampanya / live emir **NOT_RUN**

## 10. Genel QA Handoff

| Kaynak | Yol |
|---|---|
| FIX03 rapor | `KRIPTO_FIX03_OFFLINE_PIPELINE_AND_EVIDENCE_REPORT.md` |
| FIX03 JSON | `kripto-fix03-offline-pipeline-and-evidence.json` |
| FIX01 rapor | `KRIPTO_FIX01_STRATEGY_CONTEXT_AND_INVALIDATION_REPORT.md` |
| FIX02 rapor | `KRIPTO_FIX02_DURABLE_EXIT_AND_SETTLEMENT_REPORT.md` |
| Tracker | `KRIPTO_ENGINEERING_RECOVERY_TRACKER.md` |
| Test komutu | `npm run test:run -- tests/fix03-offline-pipeline-and-evidence.test.ts tests/pr05-offline-comparison.test.ts tests/qa12-integrated-chain.test.ts` |

Genel QA başlatılmadı; `OVERALL_QA_STATUS=QA_PENDING`.
