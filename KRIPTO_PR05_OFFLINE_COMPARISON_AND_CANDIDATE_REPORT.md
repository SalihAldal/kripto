# KRIPTO PR05 — OFFLINE KARŞILAŞTIRMA VE ADAY DEĞERLENDİRMESİ

## Executive Verdict

- `PROMPT11_ENGINEERING_VERDICT=PARTIAL`
- `DATA_FITNESS_VERDICT=BLOCKED`
- `SPLIT_AND_LEAKAGE_VERDICT=PASS`
- `REPLAY_PARITY_VERDICT=PASS`
- `NET_ACCOUNTING_VERDICT=PASS`
- `NEGATIVE_CONTROL_VERDICT=PARTIAL`
- `COST_STRESS_VERDICT=PASS`
- `HOLDOUT_PROVENANCE_VERDICT=HOLDOUT_PROVENANCE_UNKNOWN`
- `HOLDOUT_EVALUATION_STATUS=NOT_RUN`
- `PROFITABILITY_EVIDENCE=INSUFFICIENT_DATA`
- `OFFLINE_CANDIDATE_VERDICT=BLOCKED`
- `SELECTED_CANDIDATE_IDS=[]`
- `OVERALL_QA_STATUS=QA_PENDING`
- `PAPER_CAMPAIGN_STARTED=false`
- `LIVE_AUTHORIZATION=DISABLED`
- `PRODUCTION_POLICY_CHANGED=false`

## Worktree Fingerprint

| Field | Value |
|---|---|
| HEAD | `a85a04677acc8dba27af3362f238f86a1d463ea5` |
| Branch | `main` |
| Worktree | `DIRTY` |

## Veri Envanteri — Ne Çalıştı?

| Kaynak | Sınıf | Kullanım |
|---|---|---|
| `data/exchange-info-tr.json` | RETROSPECTIVE_METADATA | Venue filtre metadata |
| `data/scanner-cursor.json` | RETROSPECTIVE_METADATA | Operasyonel cursor |
| `kripto-p2-historical-paired-dataset.json` | PRIOR_DEVELOPMENT_TOUCHED | Forensic run envanteri (tradeCount=0) |
| `tests/*.test.ts` inline fixture | SYNTHETIC_FIXTURE | Mühendislik doğrulama only |
| `recorded-market-replay-package` | **MISSING** | Piyasa deneyi BLOCKED |

**Gerçek piyasa deneyi çalışmadı.** `runPr05OfflineComparison` → `status=BLOCKED`, `PR05-DATA-01`.

## Kilitli Deney Manifesti

- `experimentId`: `pr05-offline-comparison-v1`
- Hash: manifest oluşturuldu **performans görmeden önce** (`createLockedPr05ExperimentManifest`)
- Stratejiler: EARLY_ACCELERATION, MOMENTUM_CONTINUATION, BREAKOUT_RETEST
- Exit politikaları: 5 (PR04 registry A–E)
- Baseline: `BASELINE_FIXED_TP_SL`
- Birincil metrik: `NET_EXPECTANCY_PER_CLOSED_TRADE`
- Split: 60/20/20 kronolojik, embargo 5dk, purge `LABEL_END_PLUS_EMBARGO`
- Min yeterlilik: 30 kapalı işlem/split, 20 bağımsız lifecycle grubu
- Negatif kontrol: `SIGNAL_BLOCK_SHIFT`, seed `420260906`, 200 iterasyon
- Maliyet stresi: BASE, FEE+50%, SLIPPAGE+25bps, LATENCY+1tick (measured=false)

Artifact: `artifacts/forensics/pr05-assessment-20260906T130700+0300/experiment-manifest.json`

## Zaman Ayrımı ve Sızıntı

- `walkForwardSplit` lifecycle gruplama + labelEnd embargo
- `buildPr05SplitManifest` leakage checks
- Holdout: **NOT_RUN** — `HOLDOUT_PROVENANCE_UNKNOWN` (önceki geliştirme verisi dokunulmuş)
- Sentetik fixture piyasa raporuna karışmaz (`ENGINEERING_FIXTURE_ONLY`)

## İki Karşılaştırma Yolu

### A. Eşleştirilmiş giriş / çıkış etkisi
- `runMatchedExitComparison` → aynı `MatchedEntryManifest`, farklı exit policy
- `runPr04ExitReplayWithOutcome` (üretim evaluator parity)
- Portföy getirisi çıkarılmaz

### B. Tam portföy replay
- Altyapı tanımlandı; kayıtlı market verisi olmadığı için **NOT_RUN**
- PR02/PR03 replay + router rekabeti Prompt 12’ye devredildi

## Metrikler (Piyasa Deneyi)

| Metrik | Sonuç |
|---|---|
| Varyant sayısı (planlı) | 15 (3 strateji × 5 exit) |
| Değerlendirilen bağımsız lifecycle | 0 (market blocked) |
| Kapalı işlem | 0 |
| Net expectancy | **N/A** |
| Win rate | **N/A** |
| Profit factor | **N/A** |
| CENSORED | N/A |

Mühendislik fixture (sentetik): altyapı doğrulandı, kârlılık kanıtı **üretilmedi**.

## Negatif Kontrol ve Maliyet Stresi

- Negatif kontrol: `shiftSignalBlocksWithSeed` — sentetik fixture’da çalışır; piyasa deneyinde NOT_RUN
- Maliyet stresi: `runCostStressEvaluation` — varsayımlar `measured=false`
- ER05 `runNegativeControlLabelShuffle` → hâlâ `NOT_IMPLEMENTED` (fail-closed)

## Aday Değerlendirme

- `OFFLINE_CANDIDATE_VERDICT=BLOCKED`
- `SELECTED_CANDIDATE_IDS=[]`
- Sebep: kayıtlı market replay paketi yok, holdout provenance bilinmiyor, min örnek eşiği karşılanmadı

## Eksik Veri Gereksinimi (Sonraki Toplama Planı)

1. **Kayıtlı tick/trade replay paketi** — eventAt + availableAt, venue BINANCE_TR
2. **Tarihsel evren üyeliği** — point-in-time listing metadata
3. **Entry/exit fill kayıtları** — fee asset, partial fill
4. **Bağımsız holdout aralığı** — önceki tuning’den ayrılmış provenance

## Test Kanıtı

| Komut | Exit | Sonuç |
|---|---|---|
| `tests/pr05-offline-comparison.test.ts` (×3) | 0 | 36/36 PASS |
| ER05 + PR01–PR04 regression | 0 | 177/177 PASS |
| `npm run typecheck` | 0 | PASS |
| `npm run build` | — | çalıştırıldı |

## Prompt 12 Doğrulama Listesi

- Piyasa deneyinin gerçekten çalışması için veri paketi
- Portföy replay tam entegrasyonu
- Holdout provenance bağımsızlığı
- DB-backed experiment result persistence
- Settlement join kanıtı (ER06-A)

## Artifact Yolları

- Rapor: `KRIPTO_PR05_OFFLINE_COMPARISON_AND_CANDIDATE_REPORT.md`
- JSON: `kripto-pr05-offline-comparison-and-candidate.json`
- Manifest: `artifacts/forensics/pr05-assessment-20260906T130700+0300/experiment-manifest.json`
- Split örneği: `artifacts/forensics/pr05-assessment-20260906T130700+0300/split-manifest-fixture.json`
- Veri envanteri: `artifacts/forensics/pr05-assessment-20260906T130700+0300/data-inventory.json`
