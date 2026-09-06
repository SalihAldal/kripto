# KRIPTO ENGINEERING RECOVERY TRACKER

## Seri Durumu (12 Prompt — Güncel Plan)

| Prompt | Aşama | Durum |
|---|---|---|
| 1 | ER01 — Telemetry ve verdict doğruluğu | `COMPLETED_PARTIAL` |
| 2 | ER02 — Feature contract ve router input | `COMPLETED_PASS` |
| 3 | ER03 — Canonical policy ve selection | `COMPLETED_PARTIAL` |
| 4 | ER04 — Execution identity ve persistence | `COMPLETED_PARTIAL` |
| 5 | ER05 — Dataset ve causal replay | `COMPLETED_PARTIAL` |
| 6 | ER06 — Entegrasyon ve bounded smoke | `COMPLETED_PARTIAL` |
| 7 | PR01 — İşlem evreni, gecikme, net ekonomi | `COMPLETED_PARTIAL` |
| 8 | EARLY — Gerçek veriye dayalı erken ivmelenme | `COMPLETED_PARTIAL` |
| 9 | MOMENTUM/RETEST — Trend devamı state machine | `COMPLETED_PARTIAL` |
| 10 | Stratejiye bağlı çıkış modelleri | `COMPLETED_PARTIAL` |
| 11 | Zaman sıralı offline değerlendirme ve strateji seçimi | `COMPLETED_PARTIAL` |
| 12 | İlk 11 promptun genel ağır QA | `COMPLETED_WITH_GAPS` |

**Plan revizyonu:** Eski Phase 7 “bağımsız ağır QA” Prompt 12’ye taşındı. Prompt 7 artık kârlılık geliştirme serisinin 1/5’i (işlem yapılabilir fırsat evreni).

## FIX03 — Offline Veri Kabulü, Negatif Kontrol & QA Kanıt (Düzeltme 3/4)

| Alan | Durum |
|---|---|
| Replay paket loader (`pr05-replay-package-v1`) | `PASS` |
| Veri envanteri (gerçek loader, fitness ayrımı) | `PASS` |
| Nedensel negatif kontrol (`CAUSAL_ENTRY_TIME_SHIFT`) | `PASS` |
| Split-bazlı aggregation | `PASS` |
| Portföy replay (sermaye kısıtı) | `PASS` |
| QA12 evidence-driven assessment | `PASS` |
| Kayıtlı market dataset | `NOT_RUN` |
| Piyasa kârlılık deneyi | `NOT_RUN` |
| Rapor | `KRIPTO_FIX03_OFFLINE_PIPELINE_AND_EVIDENCE_REPORT.md` |
| JSON | `kripto-fix03-offline-pipeline-and-evidence.json` |

**QA durumu:** `OVERALL_QA_STATUS=QA_PENDING` (FIX03 tamamlandı; genel post-fix QA tamamlandı).

## EXEC CORRECTION — Kademeli Stop, Atomik Settlement, Gerçek Fill (Düzeltme 1/2)

| Alan | Durum |
|---|---|
| Post-partial stop (`ORDER_IN_FLIGHT` engeli kaldırıldı) | `PASS` |
| Açık partial emir rezervasyonu | `PASS` |
| Canonical partial settlement (tek transaction) | `PASS` |
| Full close gerçek fill aktarımı | `PASS` |
| Full close atomik settlement | `PARTIAL` (legacy path) |
| Eşzamanlı fill dedup (`PositionSettlementFill`) | `PASS` |
| Transaction rollback injection (D) | `PASS` |
| Process crash/restart (E) | `NOT_RUN` |
| Reconciliation geç-fill tam zincir (G) | `NOT_RUN` |
| Disposable PostgreSQL harness | `PASS` (Corrections Final QA — `kripto_fix02_*`, fingerprint `986947de949587aa`) |
| Rapor | `KRIPTO_EXECUTION_CORRECTION_REPORT.md` |
| JSON | `kripto-execution-correction.json` |
| Migration | `20260906163000_execution_correction_settlement_fill` |

**Verdict:** `EXECUTION_CORRECTION_VERDICT=PARTIAL_PASS` — üretim yolu düzeltildi ve DB ile doğrulandı; full-close atomiklik ve crash/reconciliation tam zinciri bekliyor.

**QA durumu:** `OVERALL_QA_STATUS=QA_PENDING` (Düzeltme 2 tamamlandı; **Corrections Final QA tamamlandı** — açık HIGH: full-close atomik).

## REPLAY CORRECTION — Context, NC, Portfolio (Düzeltme 2/2)

| Alan | Durum |
|---|---|
| Trade/candle availability causality | `PASS` |
| REST backfill anti-lookahead | `PASS` |
| Counterfactual NC (market fixed) | `PASS` |
| Chronological portfolio replay | `PASS` |
| Fill replay session (no orphan fill) | `PASS` |
| Engineering synthetic fixture validation | `PASS` |
| Recorded market experiment | `NOT_RUN` |
| PostgreSQL execution-correction re-run | `PASS` (Corrections Final QA, 3× crash run) |
| Rapor | `KRIPTO_REPLAY_CORRECTION_REPORT.md` |
| JSON | `kripto-replay-correction.json` |

**Verdict:** `REPLAY_CORRECTION_VERDICT=PASS` — `PROFITABILITY_EVIDENCE=INSUFFICIENT_DATA` (sentetik fixture only).

**QA durumu:** `OVERALL_QA_STATUS=QA_PENDING` → **superseded** by Corrections Final QA (bu bölüm).

## CORRECTIONS FINAL QA — Düzeltme 1/2 + 2/2 Adversarial Doğrulama

| Alan | Durum |
|---|---|
| Post-partial stop (ADV-STOP-01, DB PnL/fill/rezervasyon) | `PASS` |
| Açık partial rezervasyon (execution-correction B) | `PASS` |
| Canonical partial atomik settlement (ADV-ATOMIC-01 + D) | `PASS` |
| Gerçek fill aktarımı (ADV-FILL-01 + C) | `PASS` |
| Eşzamanlı fill dedup (ADV-CONCURRENT-01 + F, 3×) | `PASS` |
| Full close atomik canonical | `NOT_RUN` (legacy path — CFQA-OPEN-01) |
| Reconciliation consumer e2e | `NOT_RUN` (CFQA-OPEN-02) |
| Availability causality (ADV-AVAIL-01/02) | `PASS` |
| Negatif kontrol tick hash (ADV-NC-01) | `PASS` |
| Portföy zaman/sermaye (ADV-PORT-01) | `PASS` |
| Orphan replay fill (ADV-FILL-02) | `PASS` |
| Settlement integration zinciri (ADV-STOP-01) | `PARTIAL` (entry orchestrator yok) |
| `closePositionRecord` quantity sıfırlama | `FIXED` (CFQA-FIXED-02) |
| Prisma disposable harness | `FIXED` (CFQA-FIXED-03) |
| Typecheck / build | `PASS` (exit 0) |
| Rapor | `KRIPTO_CORRECTIONS_FINAL_QA_REPORT.md` |
| JSON | `kripto-corrections-final-qa.json` |
| Findings | `KRIPTO_CORRECTIONS_FINAL_QA_FINDINGS.md` |
| Matrix | `KRIPTO_CORRECTIONS_FINAL_QA_MATRIX.md` |
| Content fingerprint | `986947de949587aa` |

**Verdict:** `FINAL_ENGINEERING_VERDICT=PARTIAL` — `OPEN_HIGH_COUNT=1` (full-close atomik); `REQUIRED_CHECKS_NOT_RUN`: EXEC-RECONCILE-01, EXEC-FULL-ATOMIC-01.

**Önceki rapor geçerliliği:** `KRIPTO_EXECUTION_CORRECTION_REPORT.md` → **PARTIALLY_VALID**; `KRIPTO_REPLAY_CORRECTION_REPORT.md` → **VALID**; `KRIPTO_POST_FIX_FINAL_QA_REPORT.md` → **SUPERSEDED**.

## POST-FIX FINAL QA — Düzeltme 1–3 Entegrasyon Denetimi

| Alan | Durum |
|---|---|
| FIX01 context → signal → entry | `PASS` |
| FIX02 PostgreSQL exit/settlement | `PASS` |
| FIX03 loader + causal NC + assessment | `PASS` |
| Full chain DB (EARLY → persist → partial) | `PASS` |
| Recorded market profitability | `NOT_RUN` |
| Process crash injection A–F | `PARTIAL` |
| Rapor | `KRIPTO_POST_FIX_FINAL_QA_REPORT.md` |
| JSON | `kripto-post-fix-final-qa.json` |
| Requirement matrix | `KRIPTO_POST_FIX_QA_REQUIREMENT_MATRIX.md` |
| Findings | `KRIPTO_POST_FIX_QA_FINDINGS.md` |

**Final verdict:** `FINAL_ENGINEERING_VERDICT=PARTIAL` — mühendislik zinciri doğrulandı; piyasa verisi ve tam crash injection eksik.

## FIX02 — Durable Exit State & Partial Settlement (Düzeltme 2/4)

| Alan | Durum |
|---|---|
| PR04 → settleOpenPosition routing | `PASS` (flag-gated) |
| Exit state PostgreSQL persistence | `PASS` |
| Partial settlement | `PASS` |
| Shadow dry-run (no state mutation) | `PASS` |
| Claim owner/fence | `PASS` |
| Disposable PostgreSQL harness | `PASS` |
| 36-scenario full matrix | `PARTIAL` (8 kritik DB testi) |
| Rapor | `KRIPTO_FIX02_DURABLE_EXIT_AND_SETTLEMENT_REPORT.md` |
| JSON | `kripto-fix02-durable-exit-and-settlement.json` |

**QA durumu:** `OVERALL_QA_STATUS=QA_PENDING` (FIX02 tamamlandı; FIX03 tamamlandı; Düzeltme 4 + genel QA bekliyor).

## FIX01 — Strategy Context & Invalidation (Düzeltme 1/4)

| Alan | Durum |
|---|---|
| Producer → context → router → entry | `PASS` |
| Fixture fallback kaldırıldı | `PASS` |
| Seçili sinyal immutable taşıma | `PASS` |
| EARLY yapısal invalidation | `PASS` |
| DB/restart kalıcılığı | `BLOCKED` → FIX02 |
| Rapor | `KRIPTO_FIX01_STRATEGY_CONTEXT_AND_INVALIDATION_REPORT.md` |
| JSON | `kripto-fix01-strategy-context-and-invalidation.json` |

## İncelenen Sürüm ve Çalışma Kopyası

- HEAD: `a85a04677acc8dba27af3362f238f86a1d463ea5`
- Branch: `main`
- Worktree: `DIRTY` (kullanıcı değişiklikleri + ER01/ER02/ER03/ER04 değişiklikleri)
- Node/NPM: `v24.13.0` / `11.6.2`
- Disk (C): `~476.76 GB` boş

## Faz 4 Kapsamı

- Orchestrator submit zincirinde strategy identity ve execution identity alanları order/execution/position metadata'sına eklendi.
- Position metadata'da `marketRegimeStrategy` artık authoritative `selectedStrategyId` ile yazılıyor.
- Position monitor attach ve recovery tarafında `strategyId` öncelikli restore akışı eklendi.
- `claimCanonicalExecutionAttempt` in-memory yoluna ek olarak durable DB lock (`app_setting`) tabanlı claim/release eklendi; orchestrator bu yolu kullanmaya geçirildi.
- Paper fill recorder tarafında close eşleme `positionId`/`executionId` ile güçlendirildi, close quantity `executedQty` ile tutarlı hale getirildi.
- Missing close candidate kimliği `LEGACY_UNRESOLVED` olarak açık işaretleniyor.

## Blocker Kayıtları (Faz 4)

| Blocker ID | Önem | Kök Neden | Dosya/Fonksiyon | Düzeltme | Test Kanıtı | Durum |
|---|---|---|---|---|---|---|
| ER04-A | P0 | Router seçilen strateji ile position/monitor strateji kimliği ayrışabiliyordu | `src/server/execution/execution-orchestrator.service.ts` | `selectedStrategyId` order+execution+position+monitor zincirinde authoritative yazıldı | `tests/p0-paper-persistence.test.ts`, `tests/er04-durable-execution-attempt-lock.test.ts` + typecheck | FIXED |
| ER04-B | P0 | Candidate execution path guard yalnız process-memory'deydi, cross-worker claim kanıtı yoktu | `src/server/hot-path/execution-attempt-lock.service.ts`, `src/server/execution/execution-orchestrator.service.ts` | Durable `app_setting` lock eklendi (`claimDurable...`/`releaseDurable...`) ve orchestrator'a bağlandı | `tests/er04-durable-execution-attempt-lock.test.ts` | FIXED |
| ER04-C | P1 | Paper close recorder yanlış OPEN trade eşlemesi ve quantity şişmesi riski taşıyordu | `src/server/paper-validation/paper-trade-recorder.service.ts` | OPEN trade lookup `positionId/executionId` odaklı; close quantity `executedQty` tabanlı | `tests/p0-paper-persistence.test.ts` | FIXED |
| ER04-D | P0 | Gerçek DB persistence/lifecycle kanıtı için izole PostgreSQL hazır değil | test altyapısı / ortam | `localhost:5432` erişilemiyor, Docker daemon yok (`dockerDesktopLinuxEngine`) | `tests/forensics/db-validation-smoke.integration.test.ts`, `tests/execution-settlement.integration.test.ts` | OPEN/BLOCKED |
| ER04-E | P1 | Settlement integration suite DB'ye bağlı yan çağrılar nedeniyle timeout oluyor | `tests/execution-settlement.integration.test.ts` + bağlı repository çağrıları | Tam çözüm için disposable DB + fail-closed test harness gerekli | `npm run test:run -- tests/execution-settlement.integration.test.ts` | OPEN/BLOCKED |

## Çalıştırılan Doğrulamalar

- `npm run test:run -- tests/er04-durable-execution-attempt-lock.test.ts tests/p0-paper-persistence.test.ts tests/er03-canonical-policy.test.ts tests/p1-round-selection-event-driven.test.ts tests/er02-feature-contract-and-router-input.test.ts tests/er01-telemetry-verdict.test.ts` -> `exit 0` (3 ardışık tekrar, 71/71 PASS)
- `npm run test:run -- tests/phase01-core-reset.test.ts tests/phase06-paper-production.test.ts tests/p0-paper-close-persistence.test.ts tests/execution-settlement.integration.test.ts` -> `exit 1` (ilk üç suite PASS, settlement suite DB erişimi yok + timeout)
- `npm run test:run -- tests/forensics/db-validation-smoke.integration.test.ts` -> `exit 1` (`localhost:5432` erişim hatası)
- `npm run typecheck` -> `exit 0`
- `npm run build` -> `exit 0` (Turbopack broad-pattern uyarıları var, compile tamamlandı)
- `docker --version` -> `exit 0`; `docker ps ...` -> `exit 1` (daemon erişimi yok)

## Çalıştırılmayan / Sınır Gereği Engellenen

- Paper campaign / auto-round campaign başlatma: `NOT_RUN`
- Live trading / exchange order submit: `NOT_RUN`
- Production DB mutation/migration/backfill: `NOT_RUN`

## Prompt 5 Handoff Notları

- Canonical execution/settlement veri sözleşmesinde `strategyId`, `strategyPolicyVersion`, `regimePolicyVersion`, `featureSnapshotId`, `sourceType`, `decisionId`, `candidateId` alanları artık order/execution/position metadata'da birlikte bulunuyor.
- Durable claim DB-backed yapıya alındı; crash sonrası stale lease reclaim politikası henüz tam değildir (şu an release-on-finalize).
- Gerçek DB lifecycle (OPEN->CLOSED + late fill reconciliation + crash injection A..F) kanıtı için disposable PostgreSQL erişimi şart; mevcut ortamda `BLOCKED`.
- Settlement testlerinde DB yan etkili yollar (tradeEventLog, duplicate-protection, paper account setting) izole edilmeden deterministic PASS alınamıyor.

## Faz 5 Kapsamı (ER05)

- `canonical-dataset` hattında immutable alan politikası sıkılaştırıldı; `previous.value ?? newValue` ile sessiz null-overwrite kaldırıldı.
- Horizon satırları her baseline (`FIRST_DETECTED/HOT/MICRO_CONFIRMED/EXECUTION_READY/CANONICAL_ENTER/EXECUTION_FILL`) için bağımsız hesaplanacak şekilde yeniden kuruldu.
- Horizon hesaplarında pencere dışı fiyat sızıntısı, horizon sonu stale-end, ve `null -> 0` outcome dönüşümleri kapatıldı.
- Producer->builder->persistence bağlantısı gerçek call-site'a bağlandı: `persistShadowOutcomes` artık canonical observation + baseline-horizon paketini `shadowCandidateOutcome.snapshot.canonicalDataset` altında version'lı persist ediyor.
- Negative-control helper fail-closed hale getirildi (`NOT_IMPLEMENTED`), multiple-testing helper invalid p-value için fail-closed (`INVALID_P_VALUE`) dönüyor.
- Walk-forward split label interval sonunu (`labelEndAtMs`) embargo/purge kararına dahil edecek şekilde güncellendi.

## Blocker Kayıtları (Faz 5)

| Blocker ID | Önem | Kök Neden | Dosya/Fonksiyon | Düzeltme | Test Kanıtı | Durum |
|---|---|---|---|---|---|---|
| ER05-A | P0 | Disposable PostgreSQL erişimi yok; gerçek persistence zinciri DB üzerinde doğrulanamıyor | test ortamı / Prisma | Kod düzeltmeleri tamam; gerçek DB kanıtı `BLOCKED` | `tests/forensics/db-validation-smoke.integration.test.ts` (`exit 1`, `localhost:5432`) | OPEN/BLOCKED |
| ER05-B | P1 | Settlement integration DB yan yolları timeout/bağlantı hatasına düşüyor | `tests/execution-settlement.integration.test.ts` | Faz 6 öncesi disposable DB + izolasyon gerekli | aynı suite (`3 fail timeout`, Prisma bağlantı hataları) | OPEN/BLOCKED |
| ER05-C | P2 | Build adımında Next "another build process running" guard tetikleniyor (orphan process/lock) | `npm run build` | Build child process'leri temizlendi, ancak guard tekrarlandı | `npm run build` (`exit 1`) | OPEN/BLOCKED |

## Faz 6 Kapsamı (ER06)

- ER01..ER05 dependency matrisi güncel HEAD/worktree üstünde tekrar doğrulandı; ER01 assessment renderer (`evaluateRecoveryAssessment`) bu fazda doğrudan testle kullanıldı.
- Entegrasyon zinciri regression seti tekrar koşuldu; `auto-round-engine.integration` testinde izolasyon açığı kapatıldı (failsafe/daemon/scanner/log dış sınırları mocklanarak deterministic hale getirildi).
- ER01..ER05 focused suite PASS, entegrasyon bundle PASS, typecheck PASS, build PASS.
- Gerçek DB persistence ve settlement lifecycle kanıtı halen `BLOCKED` (`localhost:5432` erişilemiyor, docker daemon yok).
- Bounded smoke preflight fail-closed değerlendirildi; zorunlu DB/persistence koşulları sağlanmadığı için campaign başlatılmadı (`NO_GO`).

## Blocker Kayıtları (Faz 6)

| Blocker ID | Önem | Kök Neden | Dosya/Fonksiyon | Düzeltme | Test Kanıtı | Durum |
|---|---|---|---|---|---|---|
| ER06-A | P0 | Disposable PostgreSQL yok; gerçek persistence kanıtı üretilemiyor | test ortamı / Prisma | Kod düzeltmelerinden bağımsız ortam blocker | `tests/forensics/db-validation-smoke.integration.test.ts` (`exit 1`) | OPEN/BLOCKED |
| ER06-B | P0 | Settlement lifecycle entegrasyonu DB erişimsiz ortamda timeout | `tests/execution-settlement.integration.test.ts` | 3 tekrar koşu ile deterministic blocker doğrulandı | lifecycle suite run1-2-3 (`exit 1`) | OPEN/BLOCKED |
| ER06-C | P1 | Auto-round integration testi gerçek DB/worker yan yollarına sızıyordu | `tests/auto-round-engine.integration.test.ts` | Test izolasyonu güçlendirildi (failsafe/daemon/scanner/log boundary mock) | `tests/auto-round-engine.integration.test.ts` (`exit 0`) | FIXED |

## Faz 7 Kapsamı (PR01 — Prompt 7)

- Point-in-time işlem evreni contract: `src/server/profitability/pr01-universe.ts` (mevcut `venue-config` + `precision-layer` authority üzerine)
- Fırsat envanteri ve cohort A..F ayrımı: `pr01-opportunity-inventory.ts` (ER05 mover + candidate join, retrospective vs causal onset)
- Gecikme ayrıştırması: `pr01-latency.ts` (ER01 funnel event kimlikleri; eksik timestamp ≠ sıfır gecikme)
- İşlem ekonomisi contract: `pr01-economics.ts` (`computeFeeEdgeMetrics` sarmalayıcı; COST_COVERAGE / MOVE_VIABILITY / EXPECTANCY / REALIZED ayrımı)
- Offline analiz orchestrator: `pr01-analysis.ts`; experiment registry: `experiment-registry.ts` (`pr01-opportunity-universe-v1` = `PLANNED`)
- 38 maddelik test matrisi + funnel latency: `tests/pr01-opportunity-universe-and-net-economics.test.ts` (`39/39 PASS`, 3 ardışık tekrar)
- ER01..ER06 regression: `97/97 PASS`; typecheck `exit 0`; build `exit 0`
- Kayıtlı market dataset yok → `MARKET_ANALYSIS_RESULT=NOT_RUN`
- Paper/auto-round/live başlatılmadı; admission gate değiştirilmedi

## Blocker Kayıtları (Faz 7)

| Blocker ID | Önem | Kök Neden | Dosya/Fonksiyon | Düzeltme | Test Kanıtı | Durum |
|---|---|---|---|---|---|---|
| PR01-DATA-01 | P0 | Kayıtlı/provenance’lı offline market dataset erişimi yok | `pr01-analysis.ts` | Contract/test fixture ile kanıt; gerçek market analizi NOT_RUN | `runPr01OfflineAnalysis` → NOT_RUN | OPEN/BLOCKED |
| PR01-DATA-02 | P1 | Tarihsel venue/listing metadata eksik; geçmiş evren kapsamı kısmi | `pr01-universe.ts` | `HISTORICAL_ELIGIBILITY_UNKNOWN` fail-closed işaretleme | `tests/pr01-opportunity-universe-and-net-economics.test.ts` | OPEN/PARTIAL |
| ER06-A | P0 | Disposable PostgreSQL yok; ER04 realized-net settlement join kanıtı BLOCKED | test ortamı | Prompt 8+ için disposable DB gerekli | settlement suite `exit 1` | OPEN/BLOCKED |

## Prompt 8 Handoff (EARLY)

- Hazır contract’lar: latency timeline segmentleri, post-detection remaining move buckets, `MOVER_SPECS` versioned buckets, trade economics ayrımı (cost/viability/expectancy/realized)
- Eksik veri: recorded tick/book history + `availableAt`, historical causal threshold crossing archive, disposable DB settlement chain
- Strateji geliştirme/promotion yapılmadı

## PR01 Kanıt Dosyaları

- Rapor: `KRIPTO_PR01_OPPORTUNITY_UNIVERSE_AND_NET_ECONOMICS_REPORT.md`
- JSON: `kripto-pr01-opportunity-universe-and-net-economics.json`
- Forensics: `artifacts/forensics/pr01-assessment-20260906T085600+0300/`

## Faz 8 Kapsamı (PR02 — Prompt 8)

- Authoritative EARLY evaluator: `pr02-early-features.ts`, `pr02-early-setup.ts`, `pr02-early-evaluator.ts`, `pr02-early-replay.ts`
- P4 router delegates `EARLY_ACCELERATION` to PR02 evaluator (no parallel motor)
- Producer mode: trade/book-derived features with causal windows; producer mode requires signed buy-flow confirmation
- Router fixture mode: ER02 `StrategyInput` fallback without lifecycle store mutation
- Lifecycle: WARMUP/OBSERVING/ARMED/TRIGGERED/INVALIDATED/EXPIRED + duplicate/rearm/expiry rules
- Economics: PR01 `buildTradeEconomicsRecord` attached; UNKNOWN when cost/move evidence missing
- Experiment registry: `pr02-early-acceleration-v1` (`PLANNED`)
- 38-test focused matrix PASS; regression bundle 147/147 PASS; typecheck/build exit 0
- `MARKET_BEHAVIOR_ANALYSIS=NOT_RUN` (no recorded dataset)
- Paper/auto-round/live başlatılmadı; strateji otomatik aktive edilmedi

## Blocker Kayıtları (Faz 8)

| Blocker ID | Önem | Kök Neden | Dosya/Fonksiyon | Düzeltme | Test Kanıtı | Durum |
|---|---|---|---|---|---|---|
| PR02-DATA-01 | P0 | Kayıtlı market dataset yok | `pr02-early-replay.ts` | Contract tests with synthetic fixture only | `runEarlyReplayAnalysis` NOT_RUN | OPEN/BLOCKED |
| PR02-DATA-02 | P1 | Tarihsel listing metadata kısmi | `pr01-universe.ts` | PR01 carry-over blocker | PR01 tests | OPEN/PARTIAL |
| ER06-A | P0 | Disposable PostgreSQL yok | test ortamı | ER04 settlement joins blocked | settlement suite | OPEN/BLOCKED |

## Prompt 9 Handoff (MOMENTUM/RETEST)

- Hazır: lifecycle store contract, feature producer pattern, router delegation, replay harness
- Eksik: recorded tick/book archive, disposable DB settlement chain

## Faz 9 Kapsamı (PR03 — Prompt 9)

- Authoritative MOMENTUM + BREAKOUT evaluators: `pr03-causal-features.ts`, `pr03-breakout-setup.ts`, `pr03-momentum-setup.ts`, `pr03-breakout-evaluator.ts`, `pr03-momentum-evaluator.ts`, `pr03-replay.ts`
- P4 router delegates `MOMENTUM_CONTINUATION` and `BREAKOUT_RETEST` to PR03 evaluators
- BREAKOUT lifecycle: pivot level (confirmed) → breakout → retest → hold → flow reacceleration trigger
- MOMENTUM lifecycle: impulse → pause → resumption trigger (no artificial retest level)
- Frozen reference level/impulse at setup start; chronological breakout scan (`findFirstBreakoutAfterLevel`)
- Router fixture mode: ER02 `StrategyInput` fallback without lifecycle store mutation
- Economics: PR01 `buildTradeEconomicsRecord`; UNKNOWN when cost missing
- Experiment registry: `pr03-momentum-and-retest-v1` (`PLANNED`)
- 45-test focused matrix PASS (3×); regression bundle 85/85 PASS; typecheck/build exit 0
- `MARKET_BEHAVIOR_ANALYSIS=NOT_RUN`
- Paper/auto-round/live başlatılmadı

## Blocker Kayıtları (Faz 9)

| Blocker ID | Önem | Kök Neden | Dosya/Fonksiyon | Düzeltme | Test Kanıtı | Durum |
|---|---|---|---|---|---|---|
| PR03-DATA-01 | P0 | Kayıtlı market dataset yok | `pr03-replay.ts` | Sentetik fixture testleri only | `runPr03ReplayAnalysis` | OPEN/BLOCKED |
| PR03-DATA-02 | P1 | Lifecycle store in-memory; prod DB migration yok | `pr03-*-setup.ts` | Test-isolated store | unit tests | OPEN/PARTIAL |
| ER06-A | P0 | Disposable PostgreSQL yok | test ortamı | ER04 settlement joins blocked | settlement suite | OPEN/BLOCKED |

## Prompt 10 Handoff (Exit models)

- `InvalidationContract` + `StrategyTriggerResult` on PR03 evaluation results
- Setup invalidation ≠ position force-close
- Signal `validUntil` ≠ execution uncertainty resolution

## Faz 10 Kapsamı (PR04 — Prompt 10)

- Versioned exit policy contract: `pr04-types.ts` (`ExitPolicySnapshot`, `ExitPolicyState`, `ExitDecision`, `MatchedEntryManifest`)
- Policy family A–E: `pr04-policy-registry.ts` (baseline, structural+target, structural+trail, partial+trail, time decay)
- Structural stop from PR02/PR03 invalidation: `pr04-structural-stop.ts`
- Causal one-way trailing: `pr04-trailing.ts`
- Partial exit accounting: `pr04-partial-exit.ts`, `pr04-pnl-accounting.ts`
- Exit coordinator (priority, duplicate, claim): `pr04-exit-coordinator.ts`
- Evaluator + in-memory state store: `pr04-exit-evaluator.ts`
- Matched entry manifest + replay: `pr04-matched-entry-manifest.ts`, `pr04-replay.ts`
- Production shadow bridge: `pr04-exit-bridge.ts` (`EXECUTION_PR04_EXIT_EVAL_ENABLED` default false)
- Orchestrator snapshot at entry; monitor shadow tick (non-blocking)
- Experiment registry: `pr04-exit-and-position-management-v1` (`PLANNED`, 5 variants)
- 45-test focused matrix PASS (3×); regression bundle 169/169 PASS; typecheck/build exit 0
- `MARKET_BEHAVIOR_ANALYSIS=NOT_RUN`; `EXIT_POLICY_WINNER=NOT_SELECTED`
- Paper/auto-round/live başlatılmadı

## Blocker Kayıtları (Faz 10)

| Blocker ID | Önem | Kök Neden | Dosya/Fonksiyon | Düzeltme | Test Kanıtı | Durum |
|---|---|---|---|---|---|---|
| PR04-DATA-01 | P0 | Kayıtlı market dataset yok | `pr04-replay.ts` | Sentetik fixture testleri only | `runPr04ExitReplayAnalysis` | OPEN/BLOCKED |
| PR04-PERSIST-01 | P1 | Exit state in-memory; prod DB migration yok | `pr04-exit-evaluator.ts` | Test-isolated store | unit tests | OPEN/PARTIAL |
| PR04-SETTLE-01 | P1 | Partial close settlement bağlı değil | `pr04-exit-bridge.ts` | `resolvePr04CloseQuantity` not wired | BLOCKED | OPEN |
| PR04-INVALID-01 | P1 | Orchestrator `invalidation:null` at entry | `execution-orchestrator.service.ts` | Evaluator handoff pending | structural-stop tests | OPEN/PARTIAL |
| ER06-A | P0 | Disposable PostgreSQL yok | test ortamı | ER04 settlement joins blocked | settlement suite | OPEN/BLOCKED |

## Prompt 11 Handoff (Offline comparison)

- Matched entry manifest: `pr04-matched-entry-manifest.ts`
- Exit replay harness: `pr04-replay.ts`
- Policy variants: `EXIT_POLICY_REGISTRY` (5 policies)
- Experiment: `pr04-exit-and-position-management-v1`
- Equal-risk comparison requires separate manifest if initial stop differs

## PR04 Kanıt Dosyaları

- Rapor: `KRIPTO_PR04_EXIT_AND_POSITION_MANAGEMENT_REPORT.md`
- JSON: `kripto-pr04-exit-and-position-management.json`
- Forensics: `artifacts/forensics/pr04-assessment-20260906T125300+0300/`

## Faz 11 Kapsamı (PR05 — Prompt 11)

- Kilitli deney manifesti: `pr05-experiment-manifest.ts` (performans görmeden hash)
- Veri envanteri: `pr05-data-inventory.ts` → recorded market **MISSING**
- Kronolojik split + embargo: `pr05-split-manifest.ts` + `walkForwardSplit`
- Eşleştirilmiş çıkış karşılaştırması: `runMatchedExitComparison` + `runPr04ExitReplayWithOutcome`
- Negatif kontrol: `pr05-negative-control.ts` (`SIGNAL_BLOCK_SHIFT`, sabit seed)
- Maliyet stresi: `pr05-cost-stress.ts` (measured=false)
- Aday değerlendirme: `pr05-candidate-evaluation.ts`
- Ana orchestrator: `pr05-offline-comparison.ts`
- Experiment registry: `pr05-offline-comparison-v1` (`PLANNED`, 15 varyant)
- Piyasa deneyi: **BLOCKED** (`PR05-DATA-01`); sentetik fixture altyapı doğrulaması only
- 36-test focused matrix PASS (3×); regression 177/177 PASS; typecheck exit 0
- `PROFITABILITY_EVIDENCE=INSUFFICIENT_DATA`; `SELECTED_CANDIDATE_IDS=[]`
- Paper/auto-round/live başlatılmadı; production policy değişmedi

## Blocker Kayıtları (Faz 11)

| Blocker ID | Önem | Kök Neden | Dosya/Fonksiyon | Düzeltme | Test Kanıtı | Durum |
|---|---|---|---|---|---|---|
| PR05-DATA-01 | P0 | Kayıtlı market replay paketi yok | `pr05-offline-comparison.ts` | Veri toplama gerekli | `runPr05OfflineComparison` BLOCKED | OPEN/BLOCKED |
| PR05-HOLDOUT-01 | P1 | Holdout provenance bilinmiyor | `pr05-data-inventory.ts` | Bağımsız veri aralığı gerekli | holdout NOT_RUN | OPEN |
| PR05-PORTFOLIO-01 | P1 | Tam portföy replay market verisi olmadan NOT_RUN | `pr05-offline-comparison.ts` | PR02/PR03 replay + sermaye modeli | BLOCKED | OPEN |
| ER06-A | P0 | Disposable PostgreSQL yok | test ortamı | settlement joins blocked | settlement suite | OPEN/BLOCKED |

## Prompt 12 Handoff (Genel QA)

- Piyasa deneyi kanıtı için recorded replay paketi şart
- Portföy replay tam entegrasyonu
- Holdout provenance bağımsızlığı doğrulaması
- DB-backed experiment result persistence
- Settlement join kanıtı (ER06-A)

## PR05 Kanıt Dosyaları

- Rapor: `KRIPTO_PR05_OFFLINE_COMPARISON_AND_CANDIDATE_REPORT.md`
- JSON: `kripto-pr05-offline-comparison-and-candidate.json`
- Forensics: `artifacts/forensics/pr05-assessment-20260906T130700+0300/`

## PR03 Kanıt Dosyaları

- Rapor: `KRIPTO_PR03_MOMENTUM_AND_RETEST_IMPLEMENTATION_REPORT.md`
- JSON: `kripto-pr03-momentum-and-retest.json`
- Forensics: `artifacts/forensics/pr03-assessment-20260906T094500+0300/`

## PR02 Kanıt Dosyaları

- Rapor: `KRIPTO_PR02_EARLY_ACCELERATION_IMPLEMENTATION_REPORT.md`
- JSON: `kripto-pr02-early-acceleration.json`
- Forensics: `artifacts/forensics/pr02-assessment-20260906T094000+0300/`
