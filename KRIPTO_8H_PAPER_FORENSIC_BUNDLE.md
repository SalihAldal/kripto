# KRIPTO — 8 Saatlik PAPER Forensic Kanıt Paketi

> **Campaign:** `paper-8h-2026-09-07T0012Z`  
> **Job ID:** `cmtqhz77p000fun84lgcyuckv`  
> **İnceleme tarihi:** 2026-09-07  
> **Kapsam:** Read-only; kod/config/DB değiştirilmedi, yeni koşu başlatılmadı.

---

## Executive Summary

| Soru | Yanıt |
|------|-------|
| Süre doğru mu? | **Evet (CONFIRMED):** ~8 saat (28.807.318 ms); `final-snapshot.json` ve `checkpoints.jsonl` START ile uyumlu. |
| 0 işlem doğrulanıyor mu? | **Evet (CONFIRMED):** Campaign penceresinde `positions=0`, `tradeOrders=0`, `paperTrades=0`; hiç `executionId` / `buyPrice` yok. |
| 8 seçilen adayın terminal nedeni biliniyor mu? | **8/8 biliniyor (CONFIRMED):** Hepsi `INTERNAL_ERROR:UNKNOWN:UNCLASSIFIED_TERMINAL_REASON No tradeable candidate after scanner+AI`. Raporun “Bilinmeyen” etiketi **yanlış alan** kaynaklı. |
| En güçlü kanıtlanmış engel | **CONFIRMED:** Canonical seçim `microstructure-engine.toScannerCandidates()` ile `.ai` alanını düşürüyor; `executeAnalyzeAndTrade` orchestrator `!selected.ai` ile anında reddediyor. Sembol seçimi ≠ execution onayı. |
| Telemetri eksikliği | `failReason` kolonu **tüm 47 turda null**; gerçek neden `metadata.terminalReason` / `metadata.closeReason` / `metadata.runtime.step` içinde. Rapor üreticisi yalnızca `failReason` okuyor. |
| Sonraki kısa doğrulama öncesi işler | (1) Handoff’ta `.ai` taşınması veya orchestrator’da preselected path düzeltmesi, (2) `completeNoTradeRound` / rapor üreticisinde `terminalReason` → `failReason` yüzeyi, (3) `NO_CANDIDATE` runtime step’inin sembol seçilmiş turlarda kullanılmaması, (4) campaign stop sonrası job `RUNNING` + round 47 `tariyor` reconciling. |

**Tek cümle:** 8 saatlik koşu tamamlandı, **hiç işlem açılmadı**; 8 sembol seçildi fakat execution pipeline’a **AI’sız aday** ile gidildi ve orchestrator reddetti; kalan 38 tur canonical store’da uygun aday bulamadı (~600 s seçim + ~90 s observe).

---

## 1. Kaynak Envanteri ve Fingerprint

### 1.1 Git / worktree

| Kaynak | Durum | Not |
|--------|-------|-----|
| `git rev-parse HEAD` | **Mevcut:** `73b6d13cd1539af688adf1734e2e6ae127f71569` | Campaign **bittikten sonra** push edilen commit (13:10 +0300). |
| Campaign sırasındaki kod | **Kısmen kanıtlanamıyor** | Runner ve 8h scriptleri bu commit’te; campaign 00:23–08:23 UTC arası çalıştı. Muhtemel baz: `3e8b39a` veya yerel working tree. Handoff bug’ı `microstructure-engine.ts` / `round-selection.service.ts` / `execution-orchestrator.service.ts` içinde **mevcut HEAD’de de aynı**. |
| Worktree | Çok sayıda untracked `artifacts/forensics/**` (round 10–11 export’ları) | Campaign artifact kökü commit dışı; korundu. |

### 1.2 Campaign artifact kökü

**Dizin:** `artifacts/paper-campaigns/paper-8h-2026-09-07T0012Z/`

| Dosya | Durum | Kayıt / zaman | İlişkilendirme |
|-------|-------|---------------|----------------|
| `frozen-config.json` | Mevcut | 1 obje; hash `a1904454…` | `CAMPAIGN_ID` + `configHash` |
| `preflight.json` | Mevcut | `READY`; 2026-09-07T00:23:33Z | `attemptId: paper-8h-…-preflight` |
| `checkpoints.jsonl` | Mevcut | **94 satır** (1 START + 93 HEARTBEAT); **STOP satırı yok** | `jobId` alanı |
| `final-snapshot.json` | Mevcut | `endedAt` 08:23:20Z | `jobId`, `campaignId` |
| `_forensic-round-summary.json` | Mevcut (bu inceleme sırasında üretildi) | 47 round özet | DB `autoRoundRun` |
| `_forensic-db-export.json` | Mevcut (UTF-16 BOM; Node `require` ile parse edilemez) | 47 round tam metadata | `jobId` |

### 1.3 Rapor ve runner çıktıları

| Dosya | Durum | Not |
|-------|-------|-----|
| `kripto-8h-paper-result.json` | Mevcut | `rejectCategories: {"Bilinmeyen / kayıt yok": 47}` — **hatalı özet** |
| `KRIPTO_8H_PAPER_REPORT.md` | Mevcut | Aynı `failReason` sapması |
| Terminal `879903.txt` | Mevcut | Campaign runner stdout; ~17k satır; ARBTRY Tur 2 execution reddi kanıtı |

### 1.4 Forensics round export

| Dizin | Durum |
|-------|-------|
| `artifacts/forensics/cmtqhz77p000fun84lgcyuckv/rounds/{1..11}/` | Git status’ta çok sayıda JSON; bu incelemede round 2 timeline DB metadata ile doğrulandı. Ayrı ZIP/JSON teslimi yapılmadı. |

### 1.5 DB (read-only)

| Tablo / model | Campaign penceresi | İlişkilendirme |
|---------------|-------------------|----------------|
| `AutoRoundJob` | 1 kayıt (`cmtqhz77p000fun84lgcyuckv`) | Doğrudan `id` |
| `AutoRoundRun` | 47 kayıt | `jobId` |
| `Position` | 0 | `userId` + `openedAt` window |
| `TradeOrder` | 0 | `userId` + `createdAt` window |
| `PaperTrade` | 0 | `userId` + `createdAt` window |
| `PaperPortfolio` | **Kayıt yok** (`findFirst` null) | `userId` — paper cash DB kanıtı eksik |

**Campaign ID:** DB `AutoRoundJob.campaignId` = **null**; metadata `campaignId: "cmp:cmtqhz77p000fun84lgcyuckv"`.

---

## 2. Zaman ve Kapanış Doğrulaması

### 2.1 Ham timestamp’ler

| Olay | UTC | Kaynak |
|------|-----|--------|
| Preflight | 2026-09-07T00:23:33.437Z | `preflight.json` |
| Job `startedAt` | 2026-09-07T00:23:34.210Z | DB export |
| Campaign START checkpoint | 2026-09-07T00:23:34.888Z | `checkpoints.jsonl:1` |
| İlk heartbeat | 2026-09-07T00:23:35.326Z | `checkpoints.jsonl:2` |
| Son heartbeat | 2026-09-07T08:19:26.551Z | `checkpoints.jsonl:94` |
| Final snapshot `endedAt` | 2026-09-07T08:23:20.724Z | `final-snapshot.json` |
| Rapor üretimi | 2026-09-07T08:24:09.434Z | `kripto-8h-paper-result.json` |

**Hesaplanan süre:** `08:23:20.724 − 00:23:34.888` ≈ **7s 59dk 46s** (snapshot `actualDurationMs: 28807318` ≈ 8h 0m 7s — START ile job create farkı).

**Son heartbeat → stop boşluğu:** `08:23:20.724 − 08:19:26.551` = **234,2 s** (~3,9 dk). Runner poll/heartbeat aralığından kaynaklı normal boşluk; ayrı crash kanıtı değil.

### 2.2 Round durum sayımı

| Kategori | Sayı | Kanıt |
|----------|------|-------|
| Tamamlanan (`tur_tamamlandi`) | **46** | DB `state` |
| Yarım / devam (`tariyor`) | **1** (Tur 47) | `state=tariyor`, `runtime.step=FULL_SCAN` |
| Failed (`tur_basarisiz` / `result=failed`) | **0** | `job.failedRounds=0` |
| Job counter “failed” | **0** | `kripto-8h-paper-result.json` |

**“0 failed” yorumu:** Counter yalnızca `failRound` / `tur_basarisiz` path’ini sayıyor. Tur 47 campaign deadline’da kesildi ama **failed sayılmadı**. `failReason` null olduğu için rapor tüm turları “bilinmeyen” gösterdi — **yarım turu gizlemez**, fakat **red nedenini gizler**.

### 2.3 İddia doğrulama tablosu

| İddia | Sonuç |
|-------|-------|
| 47 round kaydı | **CONFIRMED** |
| 46 completed | **CONFIRMED** (`tur_tamamlandi`) |
| 0 failed | **CONFIRMED** (counter); Tur 47 **incomplete**, failed değil |
| Son round FULL_SCAN / tariyor | **CONFIRMED** (Tur 47) |
| graceful=false | **CONFIRMED** (`gracefulStopRequested: false`) |
| ~8 saat | **CONFIRMED** |

### 2.4 Stop sebebi

| Alan | Değer |
|------|-------|
| Stop tetikleyici | **Campaign deadline** (`DURATION_HOURS=8`); `run-8h-paper-campaign.ts` while döngüsü bitti → `stopAutoRoundJob` |
| Graceful signal | Hayır |
| Process exit code | Terminal dosyasında yakalanmadı — **UNKNOWN** |
| `stopRequested` | `true` (DB) |
| `job.status` | Hâlâ **`RUNNING`** — stop sonrası terminal state reconcile eksik |

---

## 3. Tüm Roundların Tablosu (47)

**Kaynak:** DB read-only sorgu → `_forensic-round-summary.json` (2026-09-07).  
**Seçim yöntemi:** Tüm `autoRoundRun` where `jobId=cmtqhz77p000fun84lgcyuckv` order by `roundNo`.

| R# | Başlangıç (UTC) | Bitiş (UTC) | Süre (s) | State | Symbol | Runtime step | Terminal reason (metadata) | failReason | executionId | Kanıt |
|----|-----------------|-------------|----------|-------|--------|--------------|---------------------------|------------|-------------|-------|
| 1 | 00:23:34 | 00:35:07 | 693 | tur_tamamlandi | — | NO_CANDIDATE | INTERNAL_ERROR:NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 2 | 00:35:08 | 00:36:50 | 102 | tur_tamamlandi | ARBTRY | NO_CANDIDATE | …UNCLASSIFIED… No tradeable candidate after scanner+AI | null | null | DB+log |
| 3 | 00:36:51 | 00:39:19 | 148 | tur_tamamlandi | XPLTRY | NO_CANDIDATE | (aynı) | null | null | DB |
| 4 | 00:39:19 | 00:41:16 | 117 | tur_tamamlandi | ARBTRY | NO_CANDIDATE | (aynı) | null | null | DB |
| 5 | 00:41:16 | 00:44:39 | 202 | tur_tamamlandi | AVAXTRY | NO_CANDIDATE | (aynı) | null | null | DB |
| 6 | 00:44:39 | 00:49:17 | 278 | tur_tamamlandi | SUIUSDT | NO_CANDIDATE | (aynı) | null | null | DB |
| 7 | 00:49:17 | 00:51:41 | 144 | tur_tamamlandi | ADAUSDT | NO_CANDIDATE | (aynı) | null | null | DB |
| 8 | 00:51:41 | 00:57:47 | 366 | tur_tamamlandi | VETUSDT | NO_CANDIDATE | (aynı) | null | null | DB |
| 9 | 00:57:47 | 01:03:33 | 346 | tur_tamamlandi | PUMPTRY | NO_CANDIDATE | (aynı) | null | null | DB |
| 10 | 01:03:33 | 01:15:08 | 695 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 11 | 01:15:08 | 01:26:46 | 698 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 12 | 01:26:46 | 01:38:31 | 705 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 13 | 01:38:31 | 01:50:13 | 702 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 14 | 01:50:13 | 02:01:54 | 701 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 15 | 02:01:54 | 02:13:44 | 710 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 16 | 02:13:44 | 02:25:25 | 701 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 17 | 02:25:25 | 02:37:03 | 698 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 18 | 02:37:03 | 02:48:40 | 697 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 19 | 02:48:40 | 03:00:32 | 712 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 20 | 03:00:32 | 03:12:24 | 712 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 21 | 03:12:24 | 03:24:05 | 701 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 22 | 03:24:05 | 03:35:41 | 696 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 23 | 03:35:41 | 03:47:22 | 701 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 24 | 03:47:22 | 03:59:08 | 706 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 25 | 03:59:08 | 04:10:58 | 710 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 26 | 04:10:58 | 04:22:40 | 702 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 27 | 04:22:40 | 04:34:18 | 698 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 28 | 04:34:18 | 04:46:00 | 702 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 29 | 04:46:00 | 04:57:41 | 701 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 30 | 04:57:41 | 05:09:23 | 702 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 31 | 05:09:23 | 05:21:03 | 700 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 32 | 05:21:03 | 05:32:45 | 702 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 33 | 05:32:45 | 05:44:25 | 700 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 34 | 05:44:25 | 05:56:07 | 702 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 35 | 05:56:07 | 06:07:46 | 699 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 36 | 06:07:46 | 06:19:24 | 698 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 37 | 06:19:24 | 06:31:06 | 702 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 38 | 06:31:06 | 06:42:50 | 704 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 39 | 06:42:50 | 06:54:32 | 702 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 40 | 06:54:32 | 07:06:09 | 697 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 41 | 07:06:09 | 07:17:53 | 704 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 42 | 07:17:53 | 07:29:33 | 700 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 43 | 07:29:33 | 07:41:16 | 703 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 44 | 07:41:16 | 07:52:57 | 701 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 45 | 07:52:57 | 08:04:39 | 702 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 46 | 08:04:39 | 08:16:20 | 701 | tur_tamamlandi | — | NO_CANDIDATE | NO_ELIGIBLE_CANDIDATE | null | null | DB |
| 47 | 08:16:20 | — | — | **tariyor** | — | **FULL_SCAN** | kayıt yok | null | null | DB |

**Özet pattern:**
- **Tur 1, 10–46:** Sembol seçilmedi → `NO_ELIGIBLE_CANDIDATE` → süre ~693–712 s (= ~600 s canonical observation deadline + ~90 s `NO_CANDIDATE` observe + overhead).
- **Tur 2–9:** Sembol seçildi → execution anında reddedildi → kısa süre + 90 s observe.
- **Tur 47:** Deadline stop sırasında `FULL_SCAN` — tamamlanmadı.

### 3.1 `NO_CANDIDATE` kodunun üretildiği dallar

| Dal | Bu campaign’de? | Kanıt |
|-----|----------------|-------|
| Gerçekten aday bulunamaması | **Evet** (Tur 1, 10–46) | `terminalReason=NO_ELIGIBLE_CANDIDATE`, `symbol=null` |
| Seçim sonrası execution reddi (AI eksik) | **Evet** (Tur 2–9) | Log + orchestrator `!selected.ai`; runtime yine `NO_CANDIDATE` |
| Bekleme süresi dolması | **Kısmen** | `selectionDeadlineMs = min(budget, maxWait*1000)` = 600 s |
| Üst katman farklı hatayı aynı etikete çevirme | **Evet** | `noCandidateLike` + `completeNoTradeRound` → `runtime.step=NO_CANDIDATE` execution reddi için de |

**Kod — observation süresi (~90 s):**

```2191:2218:src/server/execution/auto-round-engine.service.ts
          const noCandidateObservationMs =
            process.env.NODE_ENV === "test"
              ? 2_000
              : Math.min(
                  120_000,
                  Math.max(30_000, Math.floor(Math.max(60, job.maxWaitSec) * 150)),
                );
          // ... step: NO_CANDIDATE observe loop ...
          await completeNoTradeRound({
            jobId,
            runId: run.id,
            reason: `${terminal.reasonCode}:${reason || "VALID_NO_CANDIDATE"}`,
```

`maxWaitSec=600` → `600*150=90000` ms = **90 s**.

**Kod — selection deadline (~600 s):**

```219:230:src/server/execution/round-selection.service.ts
  const configuredDeadline = Number(envMap.AUTO_ROUND_SELECTION_DEADLINE_MS ?? input.maxDurationSec * 1000);
  return {
    selectionDeadlineMs: Math.max(5_000, Math.min(input.selectionBudgetMs, configuredDeadline)),
  };
```

Frozen `MAX_WAIT_SEC=600` → deadline **600 s** (budget 1200 s olsa bile).

---

## 4. Seçilen 8 Adayın Tek Tek İzi

> **Uyarı:** Sembol seçimi alım onayı değildir. `aiFinalDecision` / `aiConsensusDecision` tüm 8 turda **boş string** — metadata’da AI çıktısı persist edilmedi.

### 4.1 ARBTRY — Tur 2

| Alan | Değer |
|------|-------|
| runId | `cmtqie2v20ygmun84mmewkp87` |
| Seçim zamanı | 2026-09-07T00:35:18.282Z (`SYMBOL_SELECTED` timeline) |
| Seçim kaynağı | Canonical opportunity engine (`pipeline: opportunity-engine`) |
| AI kararı | **Kayıt yok** (`aiFinalDecision=""`) |
| Strategy / router | **Bu aşamaya ulaşım doğrulanamadı** (execution %0) |
| Admission | **Doğrulanamadı** |
| Execution | `executeAnalyzeAndTrade` çağrıldı; **~220 ms içinde red** |
| Paper adapter | **Ulaşılmadı** (`executionId=null`, `progressExecution=0`) |
| Son kanıtlanmış aşama | Symbol bind + execution pre-check |
| İlk başarısız aşama | Orchestrator selection: `!selected.ai` |
| Red gerekçesi | `No tradeable candidate after scanner+AI` |

**Log örneği (terminal 879903.txt, seçim: Tur 2 satırları ~437–782, toplam ~17k satır):**

```
03:35:18 — ARBTRY canonical opportunity secimi
03:35:19 — Tur 2: ARBTRY secildi
03:35:19 — Onceden secilen aday dogrulaniyor (stage=scanner)
03:35:19 — Tradeable aday bulunamadi (NO_TRADE) (stage=selection, SKIPPED)
03:35:19 — rejectReason: "No tradeable candidate after scanner+AI"
03:36:50 — Tur tamamlandi (trade yok): INTERNAL_ERROR:UNKNOWN:UNCLASSIFIED_TERMINAL_REASON ...
```

### 4.2 XPLTRY — Tur 3

| Alan | Değer |
|------|-------|
| runId | `cmtqiga1711hlun8495e14vx2` |
| symbolSelectedAt | 2026-09-07T00:37:46.856Z |
| Süre | 148 s |
| Terminal | Aynı execution handoff reddi |
| executionId | null |

### 4.3 ARBTRY — Tur 4

| Alan | Değer |
|------|-------|
| runId | `cmtqijgeo16hwun84012t994n` |
| symbolSelectedAt | 2026-09-07T00:39:44.167Z |
| Süre | 117 s |
| Terminal | Aynı |

### 4.4 AVAXTRY — Tur 5

| Alan | Değer |
|------|-------|
| runId | `cmtqilz2n1ad6un84vcpewo68` |
| symbolSelectedAt | 2026-09-07T00:43:06.805Z |
| Süre | 202 s |

### 4.5 SUIUSDT — Tur 6

| Alan | Değer |
|------|-------|
| runId | `cmtqiqb8m1mvxun842aiz27ef` |
| symbolSelectedAt | 2026-09-07T00:47:44.910Z |
| Süre | 278 s |
| Not | USDT quote; execution’a ulaşmadan elendi — **venue/sizing kod yolu çalıştırılmadı** |

### 4.6 ADAUSDT — Tur 7

| runId | `cmtqiwabn2gwyun84qpno5kya` · seçim 00:50:10Z · 144 s · aynı terminal.

### 4.7 VETUSDT — Tur 8

| runId | `cmtqizdvm2soxun846k1qcjw9` · seçim 00:56:15Z · 366 s · aynı terminal.

### 4.8 PUMPTRY — Tur 9

| runId | `cmtqj78vc4lyuun842yqsxdlj` · seçim 01:02:02Z · 346 s · aynı terminal.

### 4.9 Ortak kök neden (CONFIRMED)

**Handoff:** `round-selection.service.ts` seçimi `getMicrostructureEngine().toScannerCandidates()` ile yapıyor:

```370:381:src/server/execution/round-selection.service.ts
      const selectedRecord = selectExecutionReadyRecord(store, excludedSymbols);
      const scannerCandidates = getMicrostructureEngine().toScannerCandidates();
      const selected = scannerCandidates.find(
        (row) => String(row.context.metadata.opportunityCandidateId ?? "") === selectedRecord.candidateId,
      );
```

**`toScannerCandidates()` AI taşımıyor:**

```150:156:src/server/microstructure/microstructure-engine.ts
  toScannerCandidates(): ScannerCandidate[] {
    return this.getExecutionReady().map((row, index) => ({
      rank: index + 1,
      context: toMarketContext(row),
      score: toScannerScore(row),
    }));
  }
```

**Orchestrator zorunlu AI kontrolü:**

```1537:1551:src/server/execution/execution-orchestrator.service.ts
    if (!selected || !selected.ai) {
      publishExecutionEvent({ stage: "selection", status: "SKIPPED", message: "Tradeable aday bulunamadi (NO_TRADE)" });
      return finishExecution({
        opened: false,
        rejected: true,
        rejectReason: "No tradeable candidate after scanner+AI",
      });
    }
```

`preselectedCandidate` path’inde yeniden scan yapılmıyor; AI yoksa fallback de yok.

---

## 5. Gerçek Funnel ve Telemetri Boşlukları

### 5.1 Aşama sayıları (campaign penceresi)

| Aşama | Sayı | Güven |
|-------|------|-------|
| Round başlatıldı | 47 | CONFIRMED |
| Canonical scan döngüsü | 47 | CONFIRMED |
| Symbol seçildi (DB `symbol` not null) | **8** | CONFIRMED |
| Strategy evaluated (ayrı telemetry) | **UNKNOWN** | Ayrı counter yok |
| Router selected | **UNKNOWN** | — |
| AI consensus kayıtlı | **0** (metadata boş) | CONFIRMED |
| `executeAnalyzeAndTrade` çağrısı | **≥8** (log) | SUPPORTED — tam sayı log parse edilmedi |
| Admission accepted | **0** | CONFIRMED (execution %0) |
| Execution authorized / submit | **0** | CONFIRMED |
| Fill / position / exit | **0** | CONFIRMED |

### 5.2 “Bilinmeyen / kayıt yok = 47” kaynağı

| Katman | Alan | Bu campaign |
|--------|------|-------------|
| Üretici | `completeNoTradeRound` → `metadata.terminalReason` | **Dolu** |
| Üretici | `AutoRoundRun.failReason` | **Her zaman null** |
| Persist | `runPatch.failReason` set edilmiyor | Evet |
| Rapor | `categorizeFail(r.failReason)` | null → “Bilinmeyen” |
| Runtime step | `NO_CANDIDATE` | Sembol seçilmiş turlarda **yanıltıcı** |

```37:38:scripts/generate-8h-paper-final-report.ts
function categorizeFail(reason: string | null): string {
  if (!reason) return "Bilinmeyen / kayıt yok";
```

### 5.3 Reason code eşleme tablosu

| Üretim yeri | Alan adı | Raporlanan yer | Rapor alanı | Geri kazanım |
|-------------|----------|----------------|-------------|--------------|
| `execution-orchestrator` | `rejectReason` | `formatExecutionRejectReason` → `lastRejectReason` | — | Log + terminalReason |
| `auto-round-engine` | `completeNoTradeRound.reason` | `metadata.terminalReason` | **Okunmuyor** | DB metadata |
| `auto-round-engine` | `closeReason: VALID_NO_CANDIDATE` | `metadata.closeReason` | **Okunmuyor** | DB metadata |
| `auto-round-engine` | `runtime.step` | `metadata.runtime.step` | Kısmen (8H rapor örnekleri) | DB metadata |
| Forensic export | `failReason` param | `AutoRoundRun.failReason` | **null** | Kalıcı kayıp yüzey |

**Tarihsel neden geri kazanımı:** `metadata.terminalReason` **46/46 tamamlanan turda mevcut** — rapor hatası düzeltilirse %100 geri kazanılır. `failReason` kolonu bu koşu için kalıcı boş.

---

## 6. Venue, Symbol ve Para Birimi

### 6.1 TRY + USDT birlikte görünmesi

| Kaynak | Değer |
|--------|-------|
| Platform | `BINANCE_PLATFORM=tr` (preflight `resolvedConfig.exchange: binance`) |
| Scanner universe | `SCANNER_UNIVERSE` default `ALL_SPOT` — TR ve global spot karışık evren |
| Seçilen semboller | 4× TRY (ARB, XPL, AVAX, PUMP), 3× USDT (SUI, ADA, VET) |
| Execution venue | Orchestrator erken red — **venue routing çalışmadı** |
| USDT sizing | `requestedQuoteAmountTry` + `USDTTRY` ticker path — **bu koşuda tetiklenmedi** |

```2797:2807:src/server/execution/execution-orchestrator.service.ts
    } else if (requestedQuoteAmountTry > 0 && estimatedEntryPrice > 0) {
      if (useGlobalLeverageVenue) {
        const usdtTryTicker = await getTicker("USDTTRY").catch(() => null);
        // ... reject if kur alınamaz
```

**Sonuç:** Karışık quote **tek başına hata kanıtı değil**; bu campaign’de asıl kopuş **AI handoff** — USDT çiftleri TRY bütçesine dönüştürülmeden elendi.

### 6.2 Bütçe

- Frozen: `BUDGET_PER_TRADE=1000` (TRY olarak `requestedQuoteAmountTry` ile geçirildi).
- `buyPrice` / qty: tüm turlarda null/0.

---

## 7. Runtime Config ve Preflight

### 7.1 Frozen config (secret-free)

| Anahtar | Frozen değer | Runtime (DB job) | Güncel repo default |
|---------|--------------|------------------|---------------------|
| EXECUTION_MODE | paper | paper (preflight) | paper |
| LIVE_TRADING_ENABLED | false | — | false |
| LIVE_AUTHORIZATION | DISABLED | — | DISABLED |
| PAPER_INITIAL_BALANCE_TRY | 100000 | — | 100000 |
| BUDGET_PER_TRADE | 1000 | 1000 | runner arg |
| MAX_WAIT_SEC | 600 | 600 | 600 |
| DURATION_HOURS | 8 | — | 8 |
| configHash | a1904454… | aynı | — |

**Hash üretimi:** `sha256(JSON.stringify(configSnapshot))` — `run-8h-paper-campaign.ts:81`. Mevcut `frozen-config.json` ile **doğrulanabilir**.

**Frozen’da olmayan ama etkili olanlar (repo default / env):**

| Parametre | Tipik değer | Etki |
|-----------|-------------|------|
| AUTO_ROUND_SELECTION_BUDGET_SEC | 1200 (cap) | Deadline 600 s ile sınırlı |
| AUTO_ROUND_SELECTION_DEADLINE_MS | unset → maxWait*1000 | 600 s |
| aiMode | `learning` | Learning lane advisory |
| coinSelectionMode | `scanner_best` | Canonical path |
| SCANNER_UNIVERSE | ALL_SPOT | TRY+USDT evren |

### 7.2 Preflight kapsamı

| Kontrol | Sonuç |
|---------|-------|
| PostgreSQL | PASS |
| Binance TR ticker (BTCTRY) | PASS — **tek sembol** |
| AI providers configured | PASS (3 provider) |
| Emergency stop | PASS |
| Active jobs / zombies | PASS |
| Worker locks | PASS |
| **Scanner pipeline** | **Yapılmadı** |
| **Router / admission** | **Yapılmadı** |
| **Paper simulator fill** | **Yapılmadı** |
| **End-to-end handoff** | **Yapılmadı** |

`overallVerdict: READY` = altyapı erişilebilir; **işlem açabilir** iddiası değil.

---

## 8. DB, Emir ve Muhasebe Kanıtı

### 8.1 Read-only sorgular

```sql
-- Pencere: 2026-09-07T00:23:13.406Z .. 2026-09-07T08:23:30.000Z
-- userId: cmtqhz23t0000un84a460hu19

SELECT COUNT(*) FROM "Position"
 WHERE "userId" = 'cmtqhz23t0000un84a460hu19'
   AND "openedAt" BETWEEN '2026-09-07T00:23:13.406Z' AND '2026-09-07T08:23:30.000Z';
-- → 0

SELECT COUNT(*) FROM "TradeOrder"
 WHERE "userId" = 'cmtqhz23t0000un84a460hu19'
   AND "createdAt" BETWEEN ...;
-- → 0

SELECT COUNT(*) FROM "PaperTrade"
 WHERE "userId" = 'cmtqhz23t0000un84a460hu19'
   AND "createdAt" BETWEEN ...;
-- → 0
```

Prisma script çıktısı: `{ positions: 0, tradeOrders: 0, paperTrades: 0 }`.

### 8.2 Job / muhasebe özeti

| Kayıt | Sayı |
|-------|------|
| Execution attempts (DB model) | Sorgulanmadı — ayrı model; `executionId` round’larda null |
| Orders | 0 |
| Fills | 0 |
| Positions | 0 |
| Paper trades | 0 |
| Settlement fills (export) | 0 |
| PaperPortfolio | **null** — başlangıç/bitiş cash DB’den doğrulanamadı |

**“0 işlem” iddiası:** DB ile **çapraz doğrulandı**.  
**Muhasebe PASS:** Rapor yalnızca sıfır PnL’den PASS çıkarmamalı — burada **hareket yok** kanıtı var, fakat **portfolio satırı eksik**.

---

## 9. Hata, Gecikme ve Veri Sağlığı

| Kategori | Bu pencerede | Etki |
|----------|--------------|------|
| API 429/418 | Terminal taramasında **örnek bulunamadı** | — |
| Auth / IP | Yok | — |
| WebSocket disconnect | Logda aranmadı (tam tarama yok) | UNKNOWN |
| Stale quote | Canonical store 60 s stale filtresi aktif | Tur 10+ uzun NO_ELIGIBLE |
| AI timeout/parse | AI çağrısı execution’a ulaşmadan bitti | Handoff |
| DB/Redis | Preflight DB PASS; round transaction hatası yok | — |
| Worker exception | Job `lastError: null` | — |
| Watchdog | `recoveryAudit`: SCHEDULER_CRASH (NO_ACTION), RUNTIME_STALL (RETRY skipped) campaign sonuna yakın | Tur 47 kesintisi ile örtüşebilir |
| ~700 s round | `600s deadline + 90s observe` | Tur 1, 10–46 |
| ~100–370 s round (seçimli) | Hızlı seçim + execution red + 90s observe | Tur 2–9 |

**600 s bekleme kodu:** `resolveEventDrivenConfig.selectionDeadlineMs` (yukarıda).  
**90 s ek:** `noCandidateObservationMs` (yukarıda). Süre benzerliği tek başına kök neden değil; bu campaign’de **kod sabitleri ile örtüşüyor**.

---

## 10. Sonuç ve En Küçük Düzeltme Kapsamı

### F1 — AI handoff kopukluğu (CONFIRMED · KRİTİK)

- **Etki:** 8 sembol seçildi, 0 execution.
- **Kanıt:** Tur 2 terminal log; `toScannerCandidates()` AI yok; orchestrator `!selected.ai`.
- **Kod yolu:** `round-selection.service.ts` → `microstructure-engine.ts` → `auto-round-engine.service.ts` → `execution-orchestrator.service.ts`.
- **En küçük düzeltme:** `toScannerCandidates()` içine `ai: row.ai` ekle **veya** orchestrator’da `preselectedCandidate` varsa AI’sız red yerine canonical record’dan AI hydrate et.

### F2 — Yanlış telemetry yüzeyi (CONFIRMED · YÜKSEK)

- **Etki:** `KRIPTO_8H_PAPER_REPORT` “Bilinmeyen 47” — operasyonel kördüğüm.
- **Kanıt:** `failReason` null; `generate-8h-paper-final-report.ts:categorizeFail`.
- **Düzeltme:** `completeNoTradeRound` içinde `failReason: input.reason` persist; rapor `metadata.terminalReason` fallback.

### F3 — `NO_CANDIDATE` runtime step yanıltıcı (CONFIRMED · ORTA)

- **Etki:** Sembol seçilmiş turlarda funnel “no candidate” gösteriyor.
- **Kanıt:** Tur 2 `runtime.step=NO_CANDIDATE` + `symbol=ARBTRY`.
- **Düzeltme:** Execution reddi için `EXECUTION_REJECTED` veya `HANDOFF_AI_MISSING` step kullan.

### F4 — Canonical store boş dönem (SUPPORTED_HYPOTHESIS · ORTA)

- **Etki:** Tur 10–46 hiç sembol seçmedi (~7 saat).
- **Kanıt:** `NO_ELIGIBLE_CANDIDATE`, symbol null, süre ~700 s.
- **Hipotez:** EXECUTION_READY aday yok veya 60 s stale filtresi; **round bazlı canonical telemetry export bu bundle’da sayılmadı**.
- **Gözlem:** Kısa smoke test + canonical store telemetry snapshot.

### F5 — Campaign stop cleanup (CONFIRMED · DÜŞÜK)

- **Etki:** Job `RUNNING`, Tur 47 `tariyor`.
- **Düzeltme:** Deadline stop sonrası job `STOPPED` + açık round reconcile.

### F6 — USDT/TRY karışımı (UNKNOWN bu koşuda · DÜŞÜK)

- Execution’a ulaşılmadı; ayrı doğrulama gerekir.

---

## Eksik Kaynaklar

1. `checkpoints.jsonl` STOP/FINAL satırı yok.
2. `PaperPortfolio` DB kaydı yok — cash kanıtı eksik.
3. Campaign anı exact git commit SHA kaydedilmedi.
4. `artifacts/forensics/.../rounds/*` tam sayımlı analiz edilmedi (DB metadata yeterli bulundu).
5. Round 47 için terminal log kesiti ayrıca çıkarılmadı.
6. `_forensic-db-export.json` UTF-16 BOM — otomatik parse başarısız.

---

## Yapılan Sorgular / İnceleme Komutları

```bash
git log -1 --format="%H %ci %s"
npx tsx scripts/_forensic-round-summary.ts
npx tsx scripts/_forensic-db-counts.ts
# DB: AutoRoundRun findMany jobId=cmtqhz77p000fun84lgcyuckv
# Grep: terminals/879903.txt — "No tradeable", "ARBTRY"
```

---

## İncelenen Dosyalar (seçilmiş)

- `artifacts/paper-campaigns/paper-8h-2026-09-07T0012Z/*`
- `kripto-8h-paper-result.json`, `KRIPTO_8H_PAPER_REPORT.md`
- `scripts/run-8h-paper-campaign.ts`, `scripts/generate-8h-paper-final-report.ts`
- `src/server/execution/auto-round-engine.service.ts`
- `src/server/execution/round-selection.service.ts`
- `src/server/execution/execution-orchestrator.service.ts`
- `src/server/microstructure/microstructure-engine.ts`
- `src/server/execution/execution-failure-contract.ts`
- `lib/config.ts`
- Terminal: `terminals/879903.txt`

---

## Bu İncelemede Doğrulanamayan İddialar

| İddia | Durum |
|-------|-------|
| Campaign sırasında tam commit SHA | UNKNOWN |
| Strateji eşiklerinin reddi (TDI/router/admission) | Doğrulanamadı — execution’a ulaşılmadı |
| AI provider gerçekten çağrıldı mı (seçim anında) | Metadata boş; micro engine iç AI var ama handoff’ta düşüyor |
| Paper başlangıç 100.000 TRY DB bakiyesi | Portfolio kaydı yok |
| Process exit code | UNKNOWN |
| Kârlılık / strateji kalitesi | N/A — 0 işlem |

---

*Bu dosya tek başına okunabilir forensic bundle’dır. Ayrı JSON/ZIP teslimi gerekmez.*
