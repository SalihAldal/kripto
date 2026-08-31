# 100 Tur Paper — Tur 18 Durma + İşlem Açmama Derin Forensic Raporu

**Job ID:** `cmtasbdi60029unbwdxrckdxb`  
**Rapor:** 2026-08-27 (güncellenmiş derin analiz)  
**Final status:** `STOPPED` | `stopRequested: true` | `lastError: Recovery escalation limit reached`  
**Özet:** 17 kayıtlı tur, **0 başarılı tur**, **0 açık işlem** — hiç `alim_yapildi` / pozisyon yok.

---

## 0. Executive Summary — Neden Hiç İşlem Açılmadı?

Bu job'da execution (`executeAnalyzeAndTrade`) **hiçbir turda tetiklenmedi**. Tüm reddler funnel'ın **üst katmanlarında** oldu:

| Engel katmanı | Kod yolu | Tur sayısı | Ne yapıyor? |
|---------------|----------|------------|-------------|
| **AI Execution Gate VETO** | `ai-execution-gate.service.ts` → `evaluateAiExecutionGate` | 3 | Sembol seçildi, AI `BUY` demedi → hard block |
| **SIM Tight Filter (paper)** | `auto-round-engine.service.ts` → `evaluateAutoRoundLearningCandidate` | 2 | Learning lane adayı kalite eşiklerini geçmedi |
| **Paper NO_TRADE (lane boş)** | `fast-entry.service.ts` → `getBestFastEntry` paper profile | 8 | Pump-lane veya steady-gain lane adayı yok |
| **Runtime stall** | Round progress watchdog 180s | 2 | AI batch uzun → heartbeat kesildi |
| **DB tx timeout** | `auto-round-integrity.repository.ts` 25s | 1 | Round finalize transaction expire |
| **Operator stop** | `stopAutoRoundJob` / `finalizeStoppedAutoRoundJob` | 1 | `stopRequested` → tur motoru durduruldu |

**Agent bu job'ı durdurmadı** — sadece watchdog process restart edildi. Kalıcı `STOPPED` nedeni: recovery escalation (`REGISTRY_INTEGRITY` level 5).

---

## 1. Funnel Haritası (Kod Yolu)

```
┌─────────────────────────────────────────────────────────────────┐
│ PUMP_SCAN / FULL_SCAN (100 sembol)                              │
│   fast-entry.service.ts — scanner + AI consensus batch            │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┴───────────────────┐
        │ Paper profile: isPaperApprovedLane()   │
        │ → pump-lane VEYA steady-gain lane      │
        │   (PUMP_CONTINUATION, steady-gain=…)   │
        └───────────────────┬───────────────────┘
                            │ NO → "Paper NO_TRADE: pump ve steady-gain adayi yok"
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ SYMBOL_SELECTED (coin_secildi)                                  │
│   evaluateAutoRoundLearningCandidate()                          │
│   → resolvePaperRoundProfile(15m) + SIM tight filter           │
└───────────────────────────┬─────────────────────────────────────┘
                            │ fail → SIM_TIGHT_FILTER_15m: …
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ ai-execution-gate.service.ts                                    │
│   policy: VETO (paper'da da VETO — advisory kapalı)              │
│   BLOCKING: NO_TRADE, HOLD, REJECT, WAIT → AI_VETO              │
└───────────────────────────┬─────────────────────────────────────┘
                            │ fail → AI_GATE_BLOCK: AI_VETO
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ executeAnalyzeAndTrade() — BU JOB'DA HİÇ ULAŞILMADI            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Policy Eşikleri (Paper 15m Profili)

`resolvePaperRoundProfile` (`paper-round-gates.ts`) base 15m eşiklerini paper için gevşetir:

| Parametre | Base 15m | Paper sonrası (yaklaşık) |
|-----------|----------|---------------------------|
| minConfidence | 58 | **48** |
| minScannerScore | 52 | **44** (tur 7'de 32.88 < 34 reddi — adaptive threshold) |
| minScannerConfidence | 54 | **46** (tur 7: 19.59 < 36) |
| minMtfAlignment | 48 | **0** (paper'da MTF min kapalı) |
| maxPumpRisk | 62 | **92** (tur 7: 100 capped > 96 reddi) |
| maxSpreadPercent | 0.12 | ~0.20 |

**SIM tight filter** ek olarak kontrol eder:
- `riskyNonPumpQuality`: composite, sentiment, MTF, momentum/flow
- `evaluatePaperEntryQuality`: kalite skoru min (tur 4: 0/100 < 40, tur 7: 26/100 < 32)
- `roleConsensusWeak`: tech/sentiment/risk role < 38–42

**AI gate** (`resolveAiExecutionGatePolicy`):
- Paper modda bile policy = **`VETO`** (advisory override yok, audited override yok)
- `finalDecision` ∈ {NO_TRADE, HOLD, REJECT, WAIT} → `reasonCode: AI_VETO`

---

## 3. Tur Bazlı Detay — Sembol, Gate, Neden İşlem Yok

### Tur 1 — XLMTRY | 607 sn | AI VETO

| Alan | Değer |
|------|-------|
| Sembol | **XLMTRY** |
| Son state | `tur_basarisiz` |
| Fail | `AI_GATE_BLOCK: AI_VETO` |

**Ne oldu:**
1. Scanner 64 sembol AI analizi tamamlandı (~10 dk).
2. **XLMTRY** pump/steady lane'den seçildi (`coin_secildi`).
3. `evaluateAiExecutionGate` çağrıldı — AI `finalDecision` muhtemelen **HOLD** veya **NO_TRADE** (BUY değil).
4. `BLOCKING_DECISIONS` set'i (`NO_TRADE`, `HOLD`, `REJECT`, `WAIT`) → `reasonCode: AI_VETO`.
5. Execution gate **hard block** — emir açılmadı.

**Kullanılan kural:** `ai-execution-gate.service.ts` satır 20 — paper'da bile VETO policy; BUY olmayan her karar blok.

---

### Tur 2 — PLUMETRY | 635 sn | AI VETO

| Alan | Değer |
|------|-------|
| Sembol | **PLUMETRY** |
| Fail | `AI_GATE_BLOCK: AI_VETO` |

**Ne oldu:** Tur 1 ile aynı zincir. Sembol seçildi, execution pre-check (`SYMBOL_SELECTED`), AI consensus BUY vermedi → VETO.

**Not:** Watchdog log'da tur 2 PLUMETRY `execution pre-check` görünüyor — funnel seçimi geçti, gate kapattı.

---

### Tur 3 — PLUMETRY | 290 sn | AI VETO

| Alan | Değer |
|------|-------|
| Sembol | **PLUMETRY** (tekrar) |
| Fail | `AI_GATE_BLOCK: AI_VETO` |

**Ne oldu:** Aynı sembol tekrar seçildi; yine AI BUY onayı yok. `usedSymbols` boş tutulmuş olabilir veya pump lane tekrar PLUMETRY'yi öne çıkardı.

---

### Tur 4 — MIRATRY | 646 sn | SIM TIGHT FILTER

| Alan | Değer |
|------|-------|
| Sembol | **MIRATRY** |
| Fail | `SIM_TIGHT_FILTER_15m` |

**Parçalanmış red nedenleri (failReason'dan):**

| Koşul | Değer | Eşik | Sonuç |
|-------|-------|------|-------|
| non-pump kalite | composite=**44.8**, sentiment=**33.7**, mtf=**0.0** | composite paper ~46+, sentiment ~48+ | **RED** |
| AI role consensus | tech=**37.2**, sentiment=**33.7**, risk=**63.5** | tech/sentiment < 38 veto | **RED** |
| Kalite skoru | **0/100** | min **40** (`entryQuality`) | **RED** |

**Kullanılan fonksiyon:** `evaluateAutoRoundLearningCandidate` → `riskyNonPumpQuality` + `evaluatePaperEntryQuality`.

**Neden işlem yok:** Sembol funnel'dan geçti ama **paper SIM tight filter** learning lane kalite paketini reddi. MTF 0.0 = AI MTF alignment yok veya 0 (teknik uyum verisi zayıf).

---

### Tur 5 — AUDIOTRY | 224 sn | NO_TRADE (lane boş)

| Alan | Değer |
|------|-------|
| Sembol | AUDIOTRY (kayıt var ama fail lane) |
| Fail | `Paper NO_TRADE: pump ve steady-gain adayi yok (scanned=100, candidates=20)` |

**Kullanılan kod:** `fast-entry.service.ts` ~1999 — paper profile aktif, `isPaperApprovedLane(candidate)` false.

**Lane şartları (özet):**
- **Pump-lane:** `topGainerDiscovery` / `pumpContinuationMode` + explanation'da `PUMP_CONTINUATION` / `PUMP_INTRADAY` / `PUMP_EARLY` VEYA change24h ≥ pump intraday min
- **Steady-gain:** explanation'da `steady-gain=1h` vb.

100 sembol tarandı, 20 candidate var ama **hiçbiri pump veya steady-gain lane'ine düşmedi**. Last-resort lane de (`passesPaperLastResortQuality`) boş.

---

### Tur 6 — (sembol yok) | 174 sn | NO_TRADE

Scanner tamamlandı, lane adayı yok — sembol seçilmedi (`symbol: ""`).

---

### Tur 7 — PENGUTRY | 160 sn | SIM TIGHT FILTER

| Alan | Değer |
|------|-------|
| Sembol | **PENGUTRY** |

**Parçalanmış red nedenleri:**

| Koşul | Değer | Eşik | Sonuç |
|-------|-------|------|-------|
| composite / sentiment / mtf | 46.0 / 38.0 / **0.0** | non-pump kalite | **RED** |
| scanner score | **32.88** | **< 34** (adaptive minScannerScore) | **RED** |
| scanner confidence | **19.59** | **< 36** (adaptive minScannerConfidence) | **RED** |
| pump risk | **100.00** (raw=**1808.49**, capped) | max **96** (paper profile) | **RED** |
| kalite skoru | **26/100** | min **32** | **RED** |

**Pump risk 100:** `market-context-builder.ts` formülü spread×120 + fakeSpike×18 + … → 1808 raw → **100 clamp**. Bu sentinel değil; gerçek formül sonucu cap — yüksek spread/volatilite.

---

### Tur 8 — TSTTRY | 270 sn | NO_TRADE

Lane boş (scanned=100, candidates=20). TSTTRY kayıtlı sembol ama pump/steady lane'e girmemiş.

---

### Tur 9 — DODOTRY | 316 sn | NO_TRADE

Lane boş.

---

### Tur 10 — SOLTRY | 392 sn | NO_TRADE

Lane boş. SOLTRY büyük coin ama paper lane (pump/steady) şartlarına uymadı.

---

### Tur 11 — 1000CATTRY | 384 sn | NO_TRADE

Lane boş.

---

### Tur 12 — KAYIT YOK

Round registry'de tur 12 yok — tur 11→13 atlandı (muhtemelen recovery/restart sırasında roundNo sıçraması).

---

### Tur 13 — DYDXTRY | 292 sn | RUNTIME STALL

| Alan | Değer |
|------|-------|
| Sembol | DYDXTRY |
| Fail | `No heartbeat/progress within stall threshold (180s)` |

**Engineering:** AI_ANALYSIS veya SCANNING aşamasında **180 saniye** heartbeat güncellenmedi. Watchdog turu fail etti — policy değil, **runtime stall**.

**Bağlam:** Watchdog log cycle 39–42 tur 14 öncesi 260–627s stale heartbeat — recovery sonrası tur 16'ya geçildi.

---

### Tur 14 — (sembol yok) | 644 sn | NO_TRADE

Lane boş. Uzun süre (644s) scanner/AI batch.

---

### Tur 15 — DODOTRY | 106 sn | NO_TRADE

Lane boş — hızlı fail (106s), muhtemelen erken NO_TRADE döngüsü.

---

### Tur 16 — (sembol yok) | 381 sn | HEARTBEAT TIMEOUT

| Fail | `Tur heartbeat zaman asimi (heartbeatAge=181s)` |

**Engineering:** `state=tariyor` — AI/scan devam ediyor ama heartbeat 181s → stall watchdog.

---

### Tur 17 — HOTTRY | 53 sn | DB TX TIMEOUT

| Alan | Değer |
|------|-------|
| Sembol | **HOTTRY** |
| Fail | Prisma transaction **25000ms** timeout, iş **30210ms** |

**Engineering P0:** `runInstrumentedTransaction` hot-path (`HOT_PATH_TX = 25s`) — `transactionallyCompleteRound` veya `failRound` içinde DB işi 30s+ sürdü → tx expired → tur crash.

Watchdog **02:02:43** job `FAILED` gördü, tur 19'a resume etti.

---

### Tur 18 — (sembol yok) | 380 sn | OPERATOR STOP

| Fail | `Tur motoru durduruldu` |

**Ne oldu:**
1. `stopRequested = true` set edildi (UI stop butonu veya `stopAutoRoundJob` API).
2. `finalizeStoppedAutoRoundJob` aktif turları `Tur motoru durduruldu` ile fail etti.
3. Watchdog **02:08:53** `STOP_REQUESTED` kaydetti.

**Bu agent stop komutu değil** — watchdog log'da operator stop.

---

## 4. Kategori Özeti Tablosu

| Tur | Sembol | Süre | Kategori | Birincil gate | İşlem neden açılmadı |
|-----|--------|------|----------|---------------|----------------------|
| 1 | XLMTRY | 607s | VETO | AI gate | AI BUY demedi |
| 2 | PLUMETRY | 635s | VETO | AI gate | AI BUY demedi |
| 3 | PLUMETRY | 290s | VETO | AI gate | AI BUY demedi |
| 4 | MIRATRY | 646s | SIM | Learning candidate | composite/sentiment/MTF/kalite 0 |
| 5 | AUDIOTRY | 224s | NO_TRADE | fast-entry lane | pump/steady lane boş |
| 6 | — | 174s | NO_TRADE | fast-entry lane | lane boş |
| 7 | PENGUTRY | 160s | SIM | Learning candidate | scanner+pumpRisk+k kalite |
| 8 | TSTTRY | 270s | NO_TRADE | fast-entry lane | lane boş |
| 9 | DODOTRY | 316s | NO_TRADE | fast-entry lane | lane boş |
| 10 | SOLTRY | 392s | NO_TRADE | fast-entry lane | lane boş |
| 11 | 1000CATTRY | 384s | NO_TRADE | fast-entry lane | lane boş |
| 13 | DYDXTRY | 292s | STALL | 180s watchdog | heartbeat kesildi |
| 14 | — | 644s | NO_TRADE | fast-entry lane | lane boş |
| 15 | DODOTRY | 106s | NO_TRADE | fast-entry lane | lane boş |
| 16 | — | 381s | STALL | heartbeat 181s | AI batch takıldı |
| 17 | HOTTRY | 53s | TX TIMEOUT | Prisma 25s | finalize crash |
| 18 | — | 380s | STOP | stopRequested | manuel/otomatik durdurma |

---

## 5. Tur 18 ve Job Durması — Tam Zincir

```
Tur 16: heartbeat stall (181s AI batch)
  → Tur 17: HOTTRY seçildi, 53s içinde Prisma tx timeout
  → Job FAILED (02:02:43 UTC)
  → Watchdog resume → currentRound 19
  → Tur 18 devam ederken stopRequested (02:08:36 "Tur motoru durduruldu")
  → Watchdog STOP_REQUESTED (02:08:53)
  → Sonraki saatler: REGISTRY_INTEGRITY recovery × N
  → escalation level 5 → STOP_JOB
  → lastError: "Recovery escalation limit reached"
```

**UI'da "Tur motoru durdu" mesajı:** `auto-round-engine.service.ts` → `setJobState(..., "Tur motoru durduruldu")` veya `finalizeStoppedAutoRoundJob` — `stopRequested` sonrası normal metin.

---

## 6. Watchdog Log Özeti (`100round-paper-watch.jsonl`)

| Zaman (UTC) | Olay |
|-------------|------|
| 00:30–01:20 | Tight phase 2dk, blocker yok, tur 1→9 |
| 01:38–01:52 | Tur 14 stale heartbeat 260–627s, recovery tetiklendi |
| 02:00 | Tur 16 TIMEOUT step |
| 02:02:43 | Job FAILED tx timeout → resume round 19 |
| 02:08:53 | STOP_REQUESTED → watchdog complete |
| 02:32:44 | Son tick STOPPED |

---

## 7. Engineering vs Policy Ayrımı

### Policy (beklenen — motor devam eder, tur fail)

- **AI_VETO (3):** Risk/consensus BUY onaylamadı — gate tasarımı.
- **NO_TRADE (8):** Piyasa koşulu pump/steady lane üretmedi — `fast-entry` paper profile.
- **SIM_TIGHT (2):** Paper kalite paketi — composite, scanner, pump risk, entryQuality.

### Engineering (düzeltilmeli — motor kırılır veya stall)

- **P0-TX-001:** 25s tx limit, 30s+ iş (tur 17, job FAILED).
- **P0-STALL-001:** 180s heartbeat vs 64–100 sembol AI batch (tur 13, 16).
- **P0-RECOVERY-001:** REGISTRY_INTEGRITY → escalation 5 → STOP_JOB.

---

## 8. Açık P0 Fix Listesi

| ID | Sorun | Dosya | Öneri |
|----|-------|-------|-------|
| P0-TX-001 | Tx 25s timeout | `auto-round-integrity.repository.ts` HOT_PATH_TX | 45s veya tx split |
| P0-STALL-001 | 180s stall vs uzun AI | `round-progress-watchdog` | AI_ANALYSIS için uzun eşik veya ara heartbeat |
| P0-RECOVERY-001 | Registry escalation | `scheduler-recovery.service.ts` | Reconcile before STOP_JOB |
| P1-LANE-001 | 8/17 tur lane boş | `fast-entry.service.ts` paper profile | Lane genişletme veya last-resort (policy kararı) |
| P1-GATE-001 | 3 tur VETO after select | `ai-execution-gate` paper VETO | Learning lane advisory (policy kararı) |

---

## 9. Sonuç

1. **Hiç işlem açılmadı** çünkü execution satırına ulaşılmadı — 3 tur AI VETO, 2 tur SIM filter, 8 tur lane boş.
2. **Tur 18 "Tur motoru durduruldu"** = `stopRequested` işlendi; agent watchdog kill değil.
3. **Kalıcı STOP** = tx timeout + stall zinciri → recovery escalation limit.
4. **Tur 12 eksik** — registry sıçraması.

**Resume için:** `resume-failed-paper-job.ts` + P0 tx/stall fix önerilir.

---

*Veri kaynağı: `kripto-18round-stop-forensic.json`, `100round-paper-watch.jsonl`, kod: `ai-execution-gate.service.ts`, `fast-entry.service.ts`, `paper-round-gates.ts`, `auto-round-engine.service.ts`.*
