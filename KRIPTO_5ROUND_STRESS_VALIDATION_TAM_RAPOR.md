# KRIPTO — 5 Round Stress Paper Validation — Tam Durum Raporu

**Rapor tarihi:** 2026-08-14 (TR, UTC+3)  
**Session ID:** `cmst8nza40007unvsi2211emo`  
**Validation ID:** `5round-stress-2026-08-14T17-46-20-544Z`  
**Durum:** **TAMAMLANMADI** — Job hâlâ `RUNNING`, Tur 4/5 devam ediyor (veya takılmış olabilir)

> Bu rapor, stress validation koşusunun tüm turlarını, çökme nedenlerini, artifact durumunu, güvenlik testlerini ve eksik kalan deliverable'ları tek dokümanda toplar.  
> **Nihai production verdict verilemez** — 5 tur terminal olmadan.

---

## 1. Executive Summary

| Alan | Değer |
|------|-------|
| Hedef | 5 paper tur, tur başına ~20 dk operational tavan |
| Başlangıç | 2026-08-14 20:46 TR (17:46 UTC) |
| Job status | **`RUNNING`** |
| Terminal turlar | **3 / 5** |
| Tamamlanan (başarılı trade) | **0** |
| Toplam trade | **0** |
| Validation runner | **~57. dk'da çöktü** (Postgres kopması) |
| Trading engine | **Çalışmaya devam etti** |
| Scheduler false restart | **Yok** (`RESTART_CURRENT_STAGE = 0`) |
| AI VETO bypass | **Yok** |
| Forensic export (Tur 1–3) | **Tam** (~35 dosya/tur) |
| Production readiness (şu an) | **`NOT_READY`** |

**Kısa yorum:** P0/P1/P2 güvenlik katmanları (AI gate, clock sync, recovery watchdog) Tur 1–3 verisinde **bypass üretmedi**. Ancak Tur 4'te 91 sembollük full-scanner AI fazında **ilerleme durmuş / çok yavaş** görünüyor; Tur 5 hiç başlamadı. Validation script'i DB kopunca durdu, engine ayakta kaldı.

---

## 2. Koşu Konfigürasyonu

| Parametre | Değer |
|-----------|-------|
| Mode | PAPER |
| Exchange | BINANCE_TR |
| Scanner | REAL_SCANNER |
| AI | REAL_AI (3 provider: OpenAI x2, Gemini) |
| AI Gate Policy | `EXECUTION_AI_GATE_POLICY=VETO` |
| Tur sayısı | 5 |
| selectionBudgetMs | 1.200.000 (20 dk) |
| maxWaitSec | 600 |
| budgetPerTrade | 1000 TRY |
| targetProfitPct | 2% |
| stopLossPct | 1% |
| coinSelectionMode | scanner_best |

**Değiştirilmedi:** BrainOS, strategy/TDI/EV/sizing threshold'ları, risk limitleri, SL/TP, fee varsayımları, Binance safety gate'leri.

---

## 3. Zaman Çizelgesi

```
17:46:29  Preflight PASS → Job başlatıldı
17:46:32  Tur 1 başladı
17:57:09  Tur 1 bitti (AI_GATE_BLOCK: NO_TRADE)
17:57:09  Tur 2 başladı
18:18:52  Tur 2 bitti (selection timeout 1200s)
18:18:52  Tur 3 başladı
18:40:35  Tur 3 bitti (AI_GATE_BLOCK: NO_TRADE)
18:40:35  Tur 4 başladı
18:42:06  Tur 4 AI fazı başladı (91 sembol)
18:43:04  Tur 4 son heartbeat (AI 5/91)
~18:43+   Validation runner Postgres kopması → exit 1
          Engine devam etti
18:47:39  Erken finalize (test) → kısmi JSON/MD yazıldı (NİHAİ DEĞİL)
```

**Toplam geçen süre (Tur 1–3):** ~54 dk  
**Tur 4 açık süre (son snapshot):** ~75+ dk (heartbeat 18:43'ten sonra güncellenmemiş olabilir)

---

## 4. Preflight Sonuçları

**Artifact:** `artifacts/forensics/cmst8nza40007unvsi2211emo/preflight.json`  
**Verdict:** `READY` | `canStart: true`

| Kontrol | Sonuç | Detay |
|---------|-------|-------|
| PostgreSQL / Prisma | PASS | DB_HEALTHY |
| Binance TR | PASS | BTCTRY ticker ok |
| Clock sync | PASS | skew **58ms** (threshold 5000ms), fresh `/api/v3/time` |
| API latency | PASS | 193ms |
| AI providers | PASS | 3 enabled (gpt-4o-mini x2, gemini-1.5-flash) |
| Emergency stop | PASS | inactive |
| Active jobs | PASS | no blocking job |
| Zombie rounds | PASS | none at start |
| Worker locks | PASS | clear |
| Resolved config | PASS | paper mode |

---

## 5. Tur Bazlı Detay

### Tur 1 — `LEGITIMATE_ZERO_TRADE`

| Alan | Değer |
|------|-------|
| Run ID | `cmst8o0rw000lunvscf8sygmd` |
| Symbol | SHELLTRY |
| Süre | **10.6 dk** (636.825 ms) |
| Terminal state | `tur_basarisiz` |
| Fail reason | **`AI_GATE_BLOCK: NO_TRADE`** |
| Candidates | 6 |
| Trades | 0 |
| Forensic export | **COMPLETED** (failed-round-partial) |

**Funnel (red rejection):**

| Stage | Red |
|-------|-----|
| scanner | 5 |
| decision | 15 |
| consensus | 6 |
| ai | 6 |
| ev | 1 |
| candidate | 11 |
| execution | 2 |

**Öne çıkan reason code'lar:** SCANNER_REJECT, CONSENSUS_REJECT, TDI_REJECTED, AI_FAILED, PUMP_NOT_EARLY_OR_CONTINUATION, PUMP_CONFIRM_NO_TRADE, **AI_GATE_BLOCK: NO_TRADE**

**TDI:** 13 karar — 0 approve, 6 WAIT (NEUTRAL/BELOW_THRESHOLD), 0 reject (TDI_REJECTED ayrı stage'de)

**Remote AI (ai-trace):** **18** REMOTE çağrı, degraded minimal

**Sınıflandırma:** Pipeline çalıştı, AI VETO trade'i engelledi → **sistem hatası değil**, sıfır trade meşru.

---

### Tur 2 — `LEGITIMATE_ZERO_TRADE` (selection timeout)

| Alan | Değer |
|------|-------|
| Run ID | `cmst91o9r02rjunvsrbrqfgxx` |
| Symbol | JASMYUSDT (seçim sürecinde) |
| Süre | **21.7 dk** (1.303.239 ms) |
| Terminal state | `tur_basarisiz` |
| Fail reason | **`Tur secim suresi doldu (1200s)`** |
| Candidates | 46 |
| Trades | 0 |
| Forensic export | **COMPLETED** |

**Watchdog kararı (`round-watchdog.json`):**

```json
{
  "decision": "FAIL_ROUND",
  "action": "ROUND_STALLED",
  "reasonDetail": "No stage progress for 1303s while heartbeat continued"
}
```

**Yorum:** 20 dk selection budget (1200s) aşıldı. Watchdog heartbeat devam ederken stage progress olmadığını tespit etti → tur fail. Bu, stress testin **beklenen bounded failure** davranışı; premature recovery restart yok.

**Funnel:** 281 failure event — yoğun scanner/AI/consensus aktivitesi (46 aday, 75 TDI kararı)

**Remote AI:** **91** REMOTE çağrı, **20** degraded (`AI_DEGRADED` reason 20x funnel'da)

**Recovery decisions:** boş (`records: []`) — **RESTART_CURRENT_STAGE yok**

**Sınıflandırma:** **SAFETY_BLOCK / bounded timeout** — 91 sembol full scan + AI consensus stress'i budget'ı doldurdu.

---

### Tur 3 — `LEGITIMATE_ZERO_TRADE`

| Alan | Değer |
|------|-------|
| Run ID | `cmst9tlxx064zunvst352o1s5` |
| Symbol | CRVTRY |
| Süre | **21.7 dk** (1.302.787 ms) |
| Terminal state | `tur_basarisiz` |
| Fail reason | **`AI_GATE_BLOCK: NO_TRADE`** |
| Candidates | 38 |
| Trades | 0 |
| Forensic export | **COMPLETED** |

**Funnel:** 493 failure event — Tur 2'den daha yoğun AI/consensus reddi

**Öne çıkan reason'lar:** AI_FAILED (89), AI_DEGRADED (36), EV_REJECT (25), AI_GATE_BLOCK (2), AI_TIMEOUT (1)

**Remote AI:** **100** REMOTE çağrı

**TDI:** 130 karar — 1 approve, 40 WAIT, geri kalan reject pipeline

**Sınıflandırma:** Tam pipeline + VETO gate → sıfır trade meşru.

---

### Tur 4 — **NON_TERMINAL / MUHTEMEL TAKILMA**

| Alan | Değer |
|------|-------|
| Run ID | `cmstaljbi09zsunvsk1hn8ik0` |
| DB state | `tariyor` |
| Active step | `AI_ANALYSIS` |
| DB message | `Scanner ai 5/91` |
| Son heartbeat | `2026-08-14T18:43:04.004Z` |
| Forensic export | **EKSİK** (sadece `ai-progress.json`) |

**ai-progress.json snapshot:**

| Metrik | Değer |
|--------|-------|
| processed / total | 6 / 91 |
| success / failed | 3 / 3 |
| concurrency | 2 |
| lastProgressAt | 18:43:03.827Z |
| currentCandidate | **PIXELTRY** |
| currentStage | ai |
| PIXELTRY status | **STARTED** (completedAt yok — 18:42:44'ten beri) |

**Tur 4 analizi:**

1. Full scanner 91 sembol keşfetti (discovery/ranking tamamlandı — job metadata'da discovery 0/91 → 91/91 logları mevcut).
2. AI fazına geçildi; sadece **6 aday işlendi**.
3. **PIXELTRY** adayında AI çağrısı `STARTED` durumunda kalmış görünüyor — son heartbeat'ten sonra **saatlerce ilerleme yok**.
4. Tur 2'deki gibi 1200s selection timeout **henüz tetiklenmemiş veya engine farklı davranıyor** (Tur 4 ~75+ dk açık).
5. Recovery audit: `SCHEDULER_CRASH` trigger → **`NO_ACTION`** (10 kez) — validation runner çökmesinden sonra watchdog uyandı ama recoverable issue bulamadı.

**Olası kök nedenler (inceleme gerekir, hot-patch yapılmadı):**

- PIXELTRY remote AI çağrısında hang / timeout handling eksikliği
- Concurrency=2 ile bir slot'un kapanmaması
- Selection budget enforcement Tur 4 AI full-scan path'inde farklı hesaplanıyor olabilir
- Postgres runner kopması engine'i doğrudan etkilemedi; engine kendi loop'unda stuck kalmış olabilir

**Eksik minimum artifact'ler:** `round-summary.json`, `recovery-decisions.json`, `recovery-telemetry.json`

---

### Tur 5 — **BAŞLAMADI**

Job `currentRound: 4`, Tur 5'e geçilmedi.

---

## 6. Validation Runner Çöküşü

### Ne oldu?

~57. dakikada `scripts/run-5round-stress-validation.ts` poll loop'u sırasında **PostgreSQL bağlantı kopması** (`localhost:5432`) → script **exit code 1** ile sonlandı.

**Zincir:** `getAutoRoundStatus()` → `getAutoRoundJobStats()` → `prisma.autoRoundRun.count()` fail

### Ne olmadı?

- Trading engine **durmadı** — worker process ayakta kaldı
- Job DB'de **`RUNNING`** kaldı
- Tur 1–3 forensic export'ları **zaten yazılmıştı**

### Sonradan yapılan düzeltmeler (koşu sırasında engine'e dokunulmadı)

| Dosya | Amaç |
|-------|------|
| `scripts/run-5round-stress-validation.ts` | Poll loop DB try/catch, `finalizeStressSession()` export |
| `scripts/run-5round-stress-postprocess.ts` | Job bitince DB+artifact analizi, nihai rapor |
| `scripts/query-job-status.ts` | Job durumu sorgu helper |

**Postprocess komutu (job terminal olunca):**

```powershell
npx tsx scripts/run-5round-stress-postprocess.ts cmst8nza40007unvsi2211emo
```

---

## 7. Scheduler / Recovery Stress Sonuçları

| Metrik | Tur 1–3 + snapshot | Beklenti |
|--------|-------------------|----------|
| RESTART_CURRENT_STAGE | **0** | Premature restart olmamalı ✓ |
| recovery-decisions (Tur 1–3) | boş records | NO_ACTION ✓ |
| recoveryAudit (job metadata) | 10x NO_ACTION | SCHEDULER_CRASH trigger, skip ✓ |
| Premature restart detected | **NO** | ✓ |
| Progress states | ACTIVE_PROGRESS / HEARTBEAT_ONLY gözlemlendi | Grace ile devam ✓ |

**Tur 2 watchdog:** `ROUND_STALLED` → `FAIL_ROUND` — budget aşımı, recovery restart değil.

**Sonuç:** P0 scheduler recovery fix **Tur 1–3 için PASS** — sağlıklı progress'te false `RESTART_CURRENT_STAGE` yok.

---

## 8. Kritik Güvenlik Testleri

### AI VETO Gate (`EXECUTION_AI_GATE_POLICY=VETO`)

| Test | Sonuç |
|------|-------|
| NO_TRADE → order | **0 order** ✓ |
| HOLD/REJECT/WAIT → order | **0 order** ✓ |
| VETO bypass | **0** ✓ |
| AI_GATE_CONTRADICTION | **0** ✓ |

Tur 1 ve 3 **`AI_GATE_BLOCK: NO_TRADE`** ile kapandı — gate doğru çalıştı.

### Clock / API Safety

| Metrik | Değer |
|--------|-------|
| Preflight clockSkewMs | 58ms |
| skewThresholdMs | 5000ms |
| Fresh time endpoint | `/api/v3/time` ✓ |
| Clock safety block (Tur 1–3) | **0** |
| Stale exchangeInfo serverTime reuse | **Gözlenmedi** ✓ |

### PnL / Fee Reconciliation

Trade olmadığı için reconcile edilecek kapalı pozisyon yok. Ledger boş — **N/A**, mismatch yok.

### Exit Stress (P0)

| Exit tipi | Sayı |
|-----------|------|
| TAKE_PROFIT | 0 |
| STOP_LOSS | 0 |
| STRATEGY_EXIT | 0 |
| TIME_EXIT | 0 |
| END_OF_REPLAY | 0 (trade yok) |

**EXIT_EDGE_NOT_PROVEN** — trade olmadığı için exit edge kanıtlanamadı (failure değil).

### Runtime ↔ Artifact ↔ DB

| Karşılaştırma | Sonuç |
|---------------|-------|
| Failed round (Tur 1) | **AGREE** — failReason, terminalState, endedAt hizalı |
| Completed trade | **NO_TRADES** — karşılaştırma yapılamadı |

---

## 9. P1 / P2 Artifact Özeti (Tur 1–3)

| Alan | Değer |
|------|-------|
| TDI WAIT dağılımı | NEUTRAL: 69, BELOW_THRESHOLD: 4 |
| TDI WAIT reason codes | NO_SLOT, RISK, COOLDOWN, OTHER bu koşuda baskın değil |
| Slot report rows | 9 |
| Scanner qualification rejections | 0 |
| Mean reversion audit entries | 0 (MR complete flag tur bazında var) |
| Entry timing records | 0 |
| EV calibration | minimal |
| Fee-aware policy evaluations | 0 |

**Remote AI gerçek kullanım (artifact ai-trace, executionMode=REMOTE):**

| Tur | REMOTE calls | Degraded |
|-----|-------------|----------|
| 1 | 18 | ~minimal |
| 2 | 91 | 20 |
| 3 | 100 | 36 (funnel) |
| 4 | devam ediyor | 3 fail / 3 success (ai-progress) |

> Erken finalize raporundaki `remoteCount: 0` **analiz script bug'ıydı** (`remote` field yerine `executionMode: REMOTE` kullanılıyor). Artifact'lerde remote AI **mevcut**.

---

## 10. Forensic Artifact Envanteri

**Session root:** `artifacts/forensics/cmst8nza40007unvsi2211emo/`

| Tur | round-summary | Minimum bundle | Toplam dosya |
|-----|---------------|----------------|--------------|
| 1 | ✓ | ✓ | ~35 |
| 2 | ✓ | ✓ | ~35 |
| 3 | ✓ | ✓ | ~35 |
| 4 | ✗ | ✗ (eksik) | 1 (`ai-progress.json`) |
| 5 | — | — | — |

**Preflight:** ✓ `preflight.json`  
**Job snapshot:** ✓ `job-status-snapshot.json` (bu rapor için alındı)

**Tur 1–3 tipik artifact seti:** scanner-summary, candidate-lifecycle, ai-trace, decision-trace, consensus-trace, execution-trace, exit-trace, pnl-ledger, recovery-telemetry, recovery-decisions, tdi-decisions, slot-opportunity-report, mean-reversion-audit, round-watchdog, stage-timings, resolved-config, …

---

## 11. Üretilen Deliverable'lar

| Dosya | Durum | Not |
|-------|-------|-----|
| `KRIPTO_5ROUND_STRESS_PAPER_VALIDATION.md` | **Kısmi / erken** | Job RUNNING iken yazıldı — güncellenmeli |
| `kripto-5round-stress-validation.json` | **Kısmi / erken** | Aynı |
| `KRIPTO_5ROUND_STRESS_VALIDATION_TAM_RAPOR.md` | **Bu dosya** | Tam durum özeti |
| Nihai 5-tur raporu | **BEKLİYOR** | Job terminal + postprocess |

---

## 12. Karlılık (NOT_PROVEN)

| Metrik | Değer |
|--------|-------|
| Trades | 0 |
| Wins / Losses | 0 / 0 |
| Gross PnL | 0 |
| Fees | 0 |
| Net PnL | 0 |
| Sınıflandırma | **NOT_PROVEN** |

Stress validation amacı karlılık kanıtlamak değil — sistem stabilitesi.

---

## 13. Production Readiness (Güncel)

### Verdict: **`NOT_READY`**

| Kriter | Durum |
|--------|-------|
| 5 tur terminal | ✗ (3/5) |
| AI VETO bypass yok | ✓ |
| Clock bypass yok | ✓ |
| PnL mismatch yok | N/A |
| DB/artifact contradiction | ✓ (Tur 1 agree) |
| Zombie round | ⚠ Tur 4 açık (`tariyor`) |
| Scheduler false restart | ✓ |
| Forensic export complete | ✗ Tur 4–5 eksik |
| Validation runner tamamlandı | ✗ DB kopması |

**Koşullu hazır olabilir mi?** Tur 1–3 güvenlik verisi olumlu → **`CONDITIONAL_READY` ancak job bitince**; şu an **`NOT_READY`**.

---

## 14. Bilinen Sorunlar ve Açık Kalemler

### A. Validation runner DB kopması
- **Etki:** Poll/monitoring durdu, nihai JSON/MD otomatik yazılmadı
- **Engine etkisi:** Yok (engine devam etti)
- **Fix:** Poll retry eklendi; postprocess script hazır

### B. Tur 4 AI fazında takılma / aşırı yavaşlık
- **Belirti:** 6/91 AI, PIXELTRY STARTED, heartbeat 18:43'ten sonra stale
- **Etki:** Tur 5 başlamadı, 20 dk stress tavanı aşıldı
- **Aksiyon:** Root cause analizi gerekir (AI hang, budget enforcement, concurrency)
- **Not:** Validation sırasında hot-patch yapılmadı (talimat gereği)

### C. Erken finalize raporu
- **Belirti:** `CONDITIONAL_READY` yazıldı ama job bitmemişti
- **Aksiyon:** Job terminal olunca postprocess ile overwrite

### D. remoteCount analiz bug'ı (script)
- **Belirti:** `AI_DEGRADED without remote` false positive
- **Fix:** `executionMode === "REMOTE"` sayımı eklendi (postprocess'te düzeltilmiş)

---

## 15. Sonraki Adımlar

1. **Job durumunu kontrol et** — hâlâ RUNNING mi, Tur 4 terminal mi?
2. Eğer Tur 4 stuck ise: engine log + PIXELTRY AI trace incelemesi (kod değişikliği ayrı task)
3. Job `COMPLETED|FAILED|STOPPED` olunca:
   ```powershell
   npx tsx scripts/run-5round-stress-postprocess.ts cmst8nza40007unvsi2211emo
   ```
4. Nihai `KRIPTO_5ROUND_STRESS_PAPER_VALIDATION.md` + `kripto-5round-stress-validation.json` üret
5. Tur 4 root cause bulunursa ayrı fix PR — validation pass için hot-patch yapma

---

## 16. Hızlı Referans — Tur Özet Tablosu

| Tur | Süre | Sonuç sınıfı | Fail reason | Candidates | REMOTE AI | Trade | Export |
|-----|------|--------------|-------------|------------|-----------|-------|--------|
| 1 | 10.6 dk | LEGITIMATE_ZERO_TRADE | AI_GATE_BLOCK: NO_TRADE | 6 | 18 | 0 | ✓ |
| 2 | 21.7 dk | LEGITIMATE_ZERO_TRADE | Selection timeout 1200s | 46 | 91 | 0 | ✓ |
| 3 | 21.7 dk | LEGITIMATE_ZERO_TRADE | AI_GATE_BLOCK: NO_TRADE | 38 | 100 | 0 | ✓ |
| 4 | 75+ dk? | NON_TERMINAL | — (devam/stuck) | 91 scan | 6 proc. | 0 | ✗ |
| 5 | — | — | — | — | — | — | — |

---

## 17. İlgili Dosyalar

- Preflight: `artifacts/forensics/cmst8nza40007unvsi2211emo/preflight.json`
- Tur artifact'leri: `artifacts/forensics/cmst8nza40007unvsi2211emo/rounds/{1,2,3,4}/`
- Job snapshot: `artifacts/forensics/cmst8nza40007unvsi2211emo/job-status-snapshot.json`
- Validation script: `scripts/run-5round-stress-validation.ts`
- Postprocess: `scripts/run-5round-stress-postprocess.ts`
- Önceki fix raporları: `KRIPTO_CLOCK_AND_FORENSIC_FIX_REPORT.md`, `KRIPTO_P0_SCHEDULER_RECOVERY_FIX.md`, `KRIPTO_SINGLE_ROUND_RECOVERY_VALIDATION.md`

---

*Rapor, job terminal olmadan güncel snapshot verilerine dayanır. Job tamamlandığında Bölüm 5 (Tur 4–5), 10, 12 ve 13 postprocess ile güncellenmelidir.*
