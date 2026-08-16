# Tur 13–14 İnceleme Raporu

> Oluşturulma: 08.08.2026 12:52 (TR)  
> Job: `cmsjh8fnv00r8un88bqo92arj`  
> Mod: Paper Learning (100 tur hedef)

---

## Özet (tek cümle)

**Tur 13** işlem açamadan AI analizinde takıldı ve recovery ile kesildi; **tur 14** pump taramasında hiç ilerlemeden ~5,7 dk sonra Prisma transaction timeout ile job tamamen çöktü. **13 turda da işlem açılmamasının** ana sebebi filtre reddi değil, sürekli recovery/heartbeat stall döngüsü ve seçim aşamasının hiç tamamlanamaması.

---

## Job genel durumu

| Metrik | Değer |
|--------|-------|
| Başlangıç | 08.08.2026 00:48:48 |
| Bitiş (FAILED) | 08.08.2026 03:40:48 |
| Tamamlanan tur | 0 |
| Başarısız tur | 13 |
| Kitlenen tur | 14 (`tariyor`, bitmemiş) |
| Açılan işlem | **0** |
| Son hata | Prisma transaction timeout (345 sn > 5 sn limit) |

---

## Tur 13 — Neden işlem açılmadı?

**Sembol:** GUNTRY  
**Süre:** 03:22:41 → 03:34:59 (~12 dk resmi; metadata 03:42:39’a kadar güncellenmiş)  
**Son durum:** `tariyor` / `failed` — **alim_yapildi aşamasına hiç gelinmedi**

### Ne oldu?

1. **03:22** — Tur başladı, scanner 40 aday keşfetti (GUNTRY dahil).
2. **03:23–03:29** — AI analiz pipeline’ı devreye girdi; 40 adayın sadece **2–4 tanesi** analiz edildi (`Scanner ai 3/40`, `Scanner consensus 2/40`).
3. **03:29–03:35 arası ~6 dk** — AI analizi **dondu** (ERATRY/GUNTRY üzerinde heartbeat aynı sayaçta kaldı: `3/40` → `2/40`).
4. **03:34:59** — Watchdog/recovery devreye girdi → `Recovery restart current stage` ile tur fail edildi.
5. **Execution aşamasına geçilmedi** → buyPrice, executionId, alim_yapildi yok.

### Kök neden (tur 13)

| # | Sebep | Detay |
|---|-------|-------|
| 1 | **AI pipeline tıkanması** | 40 adaylık scanner-full analizinde sadece %5 ilerleme (`aiProcessed: 2`, `candidatesRemaining: 38`) |
| 2 | **Heartbeat stall** | 03:29–03:35 arası AI adımında ilerleme yok; önceki turlarda da aynı pattern (296–344 sn stale) |
| 3 | **Recovery kesintisi** | Seçim tamamlanmadan recovery turu fail etti — filtre reddi değil, **zaman aşımı/stall** |
| 4 | **Filtre değil** | GUNTRY aday olarak seçildi; entry filter/execution gate’e ulaşılamadı |

### Tur 13 timeline (kritik anlar)

```
03:22:41  Tur 13 başladı
03:23:44  Scanner 40 aday keşfetti (GUNTRY #3)
03:28:59  AI analiz 2/40
03:29:00  GUNTRY aday olarak işaretlendi
03:29:09  Son AI ilerlemesi (3/40) — sonra 6 dk sessizlik
03:34:58  Recovery restart tetiklendi
03:34:59  Tur fail: "Recovery restart current stage"
03:35:01  Tur 14 başladı (tur 13 metadata hâlâ heartbeat atıyor — tutarsız state)
```

---

## Tur 14 — Neden 03:35’te kitlendi?

**Sembol:** yok (NO_TRADE)  
**Başlangıç:** 03:35:01  
**Son heartbeat:** 03:40:47  
**Bitiş:** yok (`endedAt: null`) — job 03:40:48’de FAILED

### Ne oldu?

1. **03:35:01** — Tur 14 seçim döngüsü başladı.
2. **03:35:01** — `PUMP_SCAN` adımına geçildi (`pump-cache` pipeline).
3. **03:35 → 03:40 (~5,7 dk)** — **Sıfır ilerleme:**
   - `candidatesProcessed: 0`
   - `promiseStarted: 0` (async pump taraması hiç başlamadı)
   - Heartbeat mesajı aynı telemetry’yi tekrarlıyor
4. **03:40:48** — Prisma interactive transaction **345 sn** sonra timeout:
   ```
   Transaction already closed: timeout was 5000 ms, however 345297 ms passed
   ```
5. Job status → **FAILED**, tur 14 `tariyor` state’inde kaldı.

### Kök neden (tur 14)

| # | Sebep | Detay |
|---|-------|-------|
| 1 | **PUMP_SCAN deadlock/ blok** | Cooperative async hiç promise başlatmadı (`promiseStarted: 0`) |
| 2 | **Uzun transaction** | Pump seçim kodu 5 sn limitli Prisma transaction içinde ~346 sn bloklandı |
| 3 | **Recovery devre dışı** | Escalation level 5 → `"Recovery escalation limit reached"` — watchdog recovery yapamadı |
| 4 | **Zombie state** | UI’da “tariyor” görünür ama motor ölmüş |

---

## 13 tur neden hiç işlem açmadı? (genel pattern)

Tüm 13 tur **execution öncesi** fail oldu. Hiçbiri `alim_yapildi` state’ine geçmedi.

| Tur | Sembol | Süre | Fail nedeni | Bucket |
|-----|--------|------|-------------|--------|
| 1 | ERATRY | 14 dk | Recovery restart | OTHER |
| 2 | ONDOTRY | 12 dk | Recovery restart | OTHER |
| 3 | 1000SATSTRY | 19 dk | Heartbeat stale (317s) | TIMEOUT |
| 4 | FETTRY | 8 dk | Recovery restart + filtreler | OTHER |
| 5 | PHATRY | 8 dk | Heartbeat stale (344s) | TIMEOUT |
| 6 | WTRY | 14 dk | Recovery restart | OTHER |
| 7 | GALATRY | 12 dk | Recovery restart | OTHER |
| 8 | RETRY | 8 dk | Heartbeat stale (296s) | TIMEOUT |
| 9 | XPLTRY | 6 dk | Recovery restart | OTHER |
| 10 | HEITRY | 24 dk | Seçim süresi doldu (1200s) | TIMEOUT |
| 11 | LUNCTRY | 9 dk | **Global kill switch + saat skew 120s** | OTHER |
| 12 | ADATRY | 19 dk | Recovery restart + çoklu filtre | OTHER |
| 13 | GUNTRY | 12 dk | Recovery restart (AI stall) | OTHER |

### Fail dağılımı

```
Recovery restart     ████████  8 tur  (62%)
Heartbeat stale      ███       3 tur  (23%)
Seçim timeout        █         1 tur  ( 8%)
Kill switch + clock  █         1 tur  ( 8%)
```

### Ana engeller (işlem açılmama)

1. **Recovery döngüsü (8/13)** — Watchdog sürekli `RESTART_CURRENT_STAGE` tetikledi; seçim/AI yarıda kesildi, execution’a hiç ulaşılmadı.
2. **Heartbeat stall (3/13)** — AI/scanner adımında 180 sn’den uzun sessizlik → tur fail.
3. **Aşırı seçim yükü** — 40 aday × AI consensus; tur başına 12–24 dk, çoğu AI’da takılıyor.
4. **Tur 11 kill switch** — `Global kill switch active, Clock synchronization failed (skew 120150ms)` geçici olarak tüm execution’ı durdurdu.
5. **Filtreler ikincil** — Birçok turda aday reddedildi (BTC EMA, kalite skoru, tape, EMA trend vb.) ama asıl öldüren şey **turun recovery/timeout ile sonlanması**, filtre tek başına değil.

---

## Recovery sistemi durumu

Job metadata’daki recovery audit:

- **Toplam recovery denemesi:** 108 (tek pencerede)
- **Escalation level:** 5 (maksimum)
- **Son karar:** `STOP_JOB` — `"Recovery escalation limit reached"`
- **Watchdog sonuçları:** `NO_ACTION / skipped` — `"Recovery blocked by policy limits or peer lease"`
- **Failure tipi:** `RUNTIME_STALL` / component: `heartbeat`

→ Recovery sistemi o kadar çok restart denedi ki limit doldu; tur 14 kitlenince müdahale edemedi.

---

## Sonuç ve öncelikli aksiyonlar

### Tur 13 (işlem yok)
- **Sebep:** AI analiz pipeline 40 adayda takıldı; 6 dk stall → recovery fail.
- **Filtre/strateji sorunu değil** — execution gate’e ulaşılamadı.

### Tur 14 (kitlenme 03:35)
- **Sebep:** `PUMP_SCAN` cooperative async başlamadan bloklandı; 346 sn transaction → job crash.
- **UI “tariyor” gösterir** ama motor ölü — zombie tur.

### Önerilen düzeltmeler (öncelik sırası)

| Öncelik | Düzeltme | Etki |
|---------|----------|------|
| P0 | PUMP_SCAN transaction timeout / async başlatma bug’ı | Tur 14 tipi kitlenmeyi önler |
| P0 | Prisma transaction süresini pump seçimden ayır veya 5 sn limitini artır | Job crash önlenir |
| P1 | AI analiz batch timeout (40 aday tek turda çok ağır) | Heartbeat stall azalır |
| P1 | Recovery escalation reset veya daha akıllı backoff | 8/13 recovery fail azalır |
| P2 | Kill switch + clock skew kontrolü (tur 11) | Gece ani durdurma azalır |
| P2 | Zombie tur temizliği (endedAt null + job FAILED) | UI doğru state gösterir |

---

## Teknik referanslar

- Job ID: `cmsjh8fnv00r8un88bqo92arj`
- Tur 13 Run: `cmsjmqijo0dz8un880ag138wj`
- Tur 14 Run: `cmsjn6d9m0eufun887zexrc5n`
- İlgili dosyalar:
  - `src/server/execution/auto-round-engine.service.ts`
  - `src/server/execution/round-selection.service.ts`
  - `src/server/execution/cooperative-async.service.ts`
  - `src/server/execution/scheduler-recovery.service.ts`
  - `src/server/execution/scheduler-watchdog.service.ts`
