# KRIPTO — 8 Saatlik PAPER Campaign Raporu

> **Campaign:** `paper-8h-2026-09-07T0012Z` · **Job:** `cmtqhz77p000fun84lgcyuckv`
> **Oluşturulma:** 2026-09-07T08:24:09.339Z · **Mod:** PAPER (LIVE kapalı)

---

## Özet kartı

| | |
|---|---|
| **Durum** | ✅ Planlanan süre tamamlandı |
| **Wall-clock** | 2026-09-07T00:23:34.888Z → 2026-09-07T08:23:20.724Z (8sa 0dk) |
| **Tur kaydı** | 47 round · 46 completed · 0 failed |
| **İşlem** | 0 kapanan · 0 açık (max heartbeat: 0) |
| **PnL** | Realized 0 TRY · Unrealized 0 TRY · Net 0 TRY |
| **Sermaye (başlangıç)** | 100.000 TRY |
| **Profitability** | **inconclusive** — paper gözlemi, uzun vadeli garanti değil |

### Tek cümlelik hüküm

8 saat boyunca motor **47 tur** koştu; **hiç paper işlem açılmadı**. Dominant red: **Bilinmeyen / kayıt yok** (47 tur). Bu bir engineering/paper pipeline gözlemi; kârlılık kanıtı **inconclusive**.

---

## Zaman çizelgesi

| Olay | Zaman (UTC) | Not |
|------|-------------|-----|
| START | 2026-09-07T00:23:34.888Z | Job başlatıldı |
| İlk heartbeat | 2026-09-07T00:23:35.326Z | elapsed 0sa 0dk |
| Son heartbeat | 2026-09-07T08:19:26.551Z | openPos=0 |
| STOP | 2026-09-07T08:23:20.724Z | graceful=hayır |

---

## Funnel — adaydan işleme

```
Tur başlatıldı          47
  └─ Symbol seçildi      8  (17.0%)
       └─ buyPrice       0  (0.0%)
            └─ sell/PnL  0  (0.0%)
                 └─ job.completedRounds  46
```

### Red kategorileri (tur bazında)

| Kategori | Tur | Pay |
|----------|-----|-----|
| Bilinmeyen / kayıt yok | 47 | 100.0% |

### En çok seçilen semboller

- **ARBTRY** — 2 tur
- **XPLTRY** — 1 tur
- **AVAXTRY** — 1 tur
- **SUIUSDT** — 1 tur
- **ADAUSDT** — 1 tur
- **VETUSDT** — 1 tur
- **PUMPTRY** — 1 tur

---

## Örnek turlar (snapshot)

### Tur 1 · `—` · tur_tamamlandi

- **Runtime step:** NO_CANDIDATE
- **Süre:** 693s
- **Net PnL:** 0 TRY

### Tur 2 · `ARBTRY` · tur_tamamlandi

- **Seçim:** scanner + ai consensus
- **Runtime step:** NO_CANDIDATE
- **Süre:** 102s
- **Net PnL:** 0 TRY

### Tur 3 · `XPLTRY` · tur_tamamlandi

- **Seçim:** scanner + ai consensus
- **Runtime step:** NO_CANDIDATE
- **Süre:** 148s
- **Net PnL:** 0 TRY

### Tur 45 · `—` · tur_tamamlandi

- **Runtime step:** NO_CANDIDATE
- **Süre:** 702s
- **Net PnL:** 0 TRY

### Tur 46 · `—` · tur_tamamlandi

- **Runtime step:** NO_CANDIDATE
- **Süre:** 701s
- **Net PnL:** 0 TRY

### Tur 47 · `—` · tariyor

- **Runtime step:** FULL_SCAN

---

## Finansal tablo

| Kalem | TRY |
|-------|-----|
| Başlangıç sermaye (paper) | 100.000 TRY |
| Realized PnL | 0 TRY |
| Unrealized PnL | 0 TRY |
| Net equity delta | 0 TRY |
| Toplam fee (kapanan paper) | 0 TRY |

---

## Preflight & dondurulmuş config

- Preflight: **READY**
- Binance TR: BTCTRY ticker ok (3868224)
- configHash: `a19044544c7dccbb0b253ccb3c23beb7af1f8af86947b730574a6a4b2527d0c6`
- BUDGET_PER_TRADE: 1000 TRY · MAX_WAIT: 600s

---

## Artifact dizini

```
C:/Users/salih/Desktop/kripto-main/artifacts/paper-campaigns/paper-8h-2026-09-07T0012Z
  frozen-config.json
  preflight.json
  checkpoints.jsonl
  final-snapshot.json
```

---

*Bu rapor gerçek Binance TR piyasa verisi + paper simulator ile üretilmiştir. Pozitif veya negatif sonuç uzun vadeli kârlılık garantisi değildir.*