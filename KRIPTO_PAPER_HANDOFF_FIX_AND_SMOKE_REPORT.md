# KRIPTO — Paper Handoff Fix & 30m Smoke Report

> **Başlangıç HEAD:** `73b6d13cd1539af688adf1734e2e6ae127f71569` (referans)  
> **Çalışma HEAD:** `73b6d13` + yerel değişiklikler (commit edilmedi)  
> **30m smoke campaign:** `paper-30m-2026-09-07T11-15-57-378Z`  
> **30m job:** `cmtr5acps0009un8cgytzyg61`  
> **Rapor tarihi:** 2026-09-07

---

## Executive Summary

Canonical seçim → execution handoff kopukluğu **düzeltildi ve runtime'da doğrulandı**. 8 saatlik eski koşuda sembol seçimi sonrası anında `No tradeable candidate after scanner+AI` ile düşüyordu; 30 dakikalık smoke koşusunda **7/7 seçilen aday execution/AI değerlendirmesine ulaştı** ve meşru red nedenleri kaydedildi. İşlem açılmadı (0 trade) — bu beklenen ve kabul edilebilir; kârlılık kanıtı **INSUFFICIENT_DATA**.

| Verdict | Sonuç |
|---------|-------|
| CANONICAL_HANDOFF_CONTRACT | **PASS** |
| REAL_SELECTION_TO_ENTRY_CHAIN | **PASS** (runtime smoke) |
| TERMINAL_REASON_COVERAGE | **PASS** |
| CANDIDATE_PIPELINE_OBSERVABILITY | **PARTIAL** |
| PAPER_ACCOUNTING_AND_CAMPAIGN_ISOLATION | **PARTIAL** |
| GRACEFUL_STOP | **PASS** |
| SHORT_PAPER_RUNTIME | **PASS** |
| PROFITABILITY_EVIDENCE | **INSUFFICIENT_DATA** |

---

## 1. Doğrulanan Kök Nedenler

### CONFIRMED — Handoff AI eksikliği (8h campaign)

| Kanıt | Detay |
|-------|-------|
| Kod | `microstructure-engine.toScannerCandidates()` yalnızca `rank/context/score` döndürüyor; `ai` yok |
| Kod | `metadata.aiAdvisory` yazılıyor ama orchestrator okumuyordu |
| Kod | `execution-orchestrator` `!selected.ai` ile hard-reject |
| Log | 8h Tur 2 ARBTRY: seçim → 220ms içinde `No tradeable candidate after scanner+AI` |
| DB | 8 seçilen adayın tamamı aynı terminal; `executionId=null` |

`AiAdvisory` (mikro skor modifier) ≠ `AIConsensusResult` (provider consensus). Bunları birbirine map etmek yerine handoff sınırında gerçek `runAIConsensusFromInput` çağrısı veya advisory policy altında açık shell kullanıldı.

### CONFIRMED — Terminal telemetri yüzeyi

`completeNoTradeRound` `failReason` kolonunu set etmiyordu; rapor üreticisi yalnızca `failReason` okuyordu → “Bilinmeyen / kayıt yok (47)”.

### CONFIRMED — Runner kapanış eksikleri (8h)

- `checkpoints.jsonl` STOP/FINAL yoktu  
- Job `RUNNING` + Tur 47 `tariyor` kalıyordu  
- Campaign trade sayımı timestamp fallback ile tüm kullanıcı işlemlerini içerebiliyordu  

---

## 2. Yapılan Düzeltmeler ve Kod Yolları

### 2.1 Canonical handoff sözleşmesi

**Dosya:** `src/server/execution/canonical-handoff.service.ts`

- `CanonicalHandoffMetadata`: candidateId, symbol, venue, freshness, aiConsensusStatus, aiAdvisory
- `validateCanonicalHandoffRecord()`: stale/expired/state/identity kontrolleri
- `hydrateCanonicalHandoffCandidate()`: sınırda gerçek `runAIConsensusFromInput`; başarısızlıkta advisory shell (**NO_TRADE**, sahte BUY yok)
- `resolveExecutionConfidenceScore()`: canonical path'te scanner confidence kullanımı (AI confidence 0 ise)

### 2.2 Round selection handoff

**Dosya:** `src/server/execution/round-selection.service.ts`

- Seçim sonrası handoff metadata attach + validation + AI hydration
- `recordRoundPipelineTelemetry()` ile düşük maliyetli stage snapshot

### 2.3 Orchestrator

**Dosya:** `src/server/execution/execution-orchestrator.service.ts`

- `!selected.ai` hard gate kaldırıldı; canonical handoff path eklendi
- Legacy path: consensus olmadan reddedilir (`HANDOFF_AI_CONSENSUS_MISSING`)
- Confidence: `resolveExecutionConfidenceScore()`

### 2.4 Terminal outcome sözleşmesi

**Dosya:** `src/server/execution/round-terminal-outcome.service.ts`

Ayrık outcome türleri: `no_eligible_candidate`, `handoff_invalid`, `ai_missing`, `ai_rejected`, `execution_rejected`, `round_incomplete`, vb.

**Dosya:** `src/server/execution/auto-round-engine.service.ts`

- `completeNoTradeRound` → `failReason` + `terminalOutcome` persist
- Runtime step: `toRoundRuntimeStep()` mapping (seçilmiş adayda `NO_CANDIDATE` yanıltması azaltıldı)

### 2.5 Runner & rapor

- `scripts/paper-campaign-runner-core.ts`: preflight/job süre ayrımı, STOP/FINAL checkpoint, terminal wait, campaign-scoped PnL
- `scripts/run-30m-paper-smoke.ts`: 30 dk smoke
- `scripts/generate-8h-paper-final-report.ts`: `metadata.terminalReason` fallback, campaign izolasyonu

---

## 3. Eski QA İddiaları — Daraltma

| İddia | Durum |
|-------|-------|
| `final-engineering-production-chain.integration.test.ts` = canonical handoff kanıtı | **GEÇERSİZ** — `preselectedCandidate` elle `AIConsensusResult` fixture inject eder |
| Mock'lar | ai-execution-gate PASS, signal-quality ALLOW, orchestration ALLOW, scanner boş, candidate-store stub |
| Paper adapter gerçek | **DOĞRU** — paper-trading/order-manager mock değil |
| 8h “0 işlem = pipeline çalışmıyor” | **YANLIŞ** — pipeline handoff'ta kırılıyordu; smoke sonrası execution'a ulaşıyor |

---

## 4. Testler

### Komutlar ve sonuçlar

```bash
npm run typecheck                                    # PASS
npm run build                                        # PASS (exit 0, ~9 dk)
npx vitest run tests/canonical-handoff.service.test.ts tests/round-terminal-outcome.test.ts  # 9/9 PASS
npx vitest run tests/final-engineering-production-chain.integration.test.ts                 # 2/2 PASS
```

### Mock sınırları

| Test | Mock | Gerçek |
|------|------|--------|
| `canonical-handoff.service.test.ts` | `runAIConsensusFromInput`, `formatAIRequest` | Handoff contract, validation, shell≠BUY |
| `final-engineering-production-chain` | AI gate, orchestration, scanner, binance ticker | Paper adapter, DB, partial/stop path |

### Eksik (gelecek iş)

Tam disposable-PostgreSQL canonical→orchestrator→paper zincir entegrasyon testi (fixture'a `ai:BUY` eklemeden) ayrı PR kapsamında önerilir; unit + smoke runtime kanıtı mevcut.

---

## 5. Eski Campaign Düzeltilmiş Özet

**Kaynak:** `KRIPTO_8H_PAPER_CORRECTED_REPORT.md`, `KRIPTO_8H_PAPER_FORENSIC_BUNDLE.md`

| Metrik | Değer |
|--------|-------|
| Seçilen aday | 8 (ARBTRY×2, XPLTRY, AVAXTRY, SUIUSDT, ADAUSDT, VETUSDT, PUMPTRY) |
| Seçimsiz tamamlanan | 38 |
| Yarım round | 1 (Tur 47, deadline) |
| Kanıtlanan red (8 seçilen) | Handoff AI eksik → `No tradeable candidate after scanner+AI` |
| Round 10–46 tarihsel pipeline | **UNKNOWN** (canonical telemetry eksik) |

---

## 6. 30 Dakikalık Smoke Koşusu

### Zaman

| Alan | Değer |
|------|-------|
| Wall-clock başlangıç | 2026-09-07T11:15:57.379Z |
| Job başlangıç | 2026-09-07T11:16:05.582Z |
| Bitiş | 2026-09-07T11:47:40.725Z |
| Preflight | 1.218 s |
| Planlanan | 30 dk |
| Gerçek job süresi | 1.895.143 ms (~31,6 dk) |
| Stop | `deadline`, graceful=false |
| `reachedTerminal` | **true** |
| `finalJobStatus` | **STOPPED** |

### LIVE kapalı doğrulama

- `EXECUTION_MODE=paper`, `LIVE_TRADING_ENABLED=false`
- Binance provider `dryRun: true` (log)

### Funnel

| Aşama | Sayı |
|-------|------|
| Round kaydı | 8 |
| Symbol seçildi | 7 |
| Execution/AI değerlendirmesine ulaştı | **7** (8h'de 0 idi) |
| buyPrice / executionId | 0 |
| İşlem | 0 |

### Terminal neden dağılımı (smoke)

| Outcome | Tur | Semboller |
|---------|-----|-----------|
| `execution_rejected` | 4 | ZROUSDT×2, IOSTUSDT, LTCUSDT |
| `ai_rejected` | 3 | PUMPUSDT×3 |
| `no_eligible_candidate` | 1 | Tur 8 (deadline stop sırasında) |

**Örnek meşru red (Tur 3 PUMPUSDT):** AI NO_TRADE — sinyal çakışması, hacim düşük, güven 35 < 55. Handoff sonrası gerçek AI consensus çalıştı.

**Örnek execution red (Tur 1 ZROUSDT):** `Entry quality: elevated AI risk (100) without elite confidence (0% < 82%)` — strateji/admission path'e ulaşıldı.

### Seçilen aday izi (özet)

Tüm seçilen turlarda `failReason` ve `terminalOutcome` DB'de dolu — “Bilinmeyen” yok.

### Muhasebe

| Alan | Değer |
|------|-------|
| tradeCount (campaign-scoped) | 0 |
| realized/unrealized PnL | 0 |
| paperCashBefore/After | **null** (`AppSetting paper.account.<userId>` kaydı yok) |
| openPositionsBefore | 0 |

Paper cash snapshot eksikliği ayrı izleme gerektirir; campaign PnL izolasyonu campaignId ile çalışıyor.

### Profitability

**INSUFFICIENT_DATA** — 0 işlem; smoke amacı handoff doğrulamasıydı.

---

## 7. Kalan Açıklar

1. **Paper cash `AppSetting` kaydı** bu kullanıcıda yok — başlangıç/bitiş snapshot UNKNOWN
2. **Round 10–46 (8h)** canonical store telemetry tarihsel olarak kısmen eksik
3. **Tam entegrasyon testi** (handoff→paper, AI boundary mock only) henüz eklenmedi
4. **`UNCLASSIFIED_TERMINAL_REASON` prefix** hâlâ execution-failure-contract'tan geliyor — ayrı reason code iyileştirmesi yapılabilir

---

## 8. Değiştirilen / Eklenen Dosyalar

| Dosya | Amaç |
|-------|------|
| `src/server/execution/canonical-handoff.service.ts` | Handoff sözleşmesi |
| `src/server/execution/round-terminal-outcome.service.ts` | Terminal outcome |
| `src/server/execution/round-pipeline-telemetry.service.ts` | Pipeline telemetry |
| `src/server/execution/round-selection.service.ts` | Handoff + hydration |
| `src/server/execution/execution-orchestrator.service.ts` | Orchestrator gate |
| `src/server/execution/auto-round-engine.service.ts` | Terminal persist |
| `scripts/paper-campaign-runner-core.ts` | Runner core |
| `scripts/run-30m-paper-smoke.ts` | 30m smoke |
| `scripts/generate-8h-paper-final-report.ts` | Rapor fallback |
| `scripts/generate-corrected-8h-report.ts` | Eski campaign düzeltilmiş rapor |
| `tests/canonical-handoff.service.test.ts` | Unit tests |
| `tests/round-terminal-outcome.test.ts` | Terminal tests |
| `KRIPTO_8H_PAPER_CORRECTED_REPORT.md` | Tarihsel düzeltme |
| `kripto-30m-paper-smoke-result.json` | Smoke makine çıktısı |

---

## 9. Artifact Dizinleri

- 8h forensic: `artifacts/paper-campaigns/paper-8h-2026-09-07T0012Z/`
- 30m smoke: `artifacts/paper-campaigns/paper-30m-2026-09-07T11-15-57-378Z/`

---

*Smoke koşusu işlem açmayı garanti etmez; handoff'un runtime'da execution pipeline'a ulaştığını kanıtlar. Test PASS'i canlı piyasa kârlılığı iddiası değildir.*
