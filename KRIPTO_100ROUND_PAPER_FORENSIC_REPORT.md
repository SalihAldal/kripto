# 100 Tur Paper Simülasyon — Tam Forensic Rapor

**Oluşturma:** 2026-08-29T10:34:24.877Z
**Job ID:** cmtdla29j0009unhogsjcmoea

---

## 1. Executive Özet

| Alan | Değer |
|------|-------|
| Durum | STOPPED |
| Hedef tur | 100 |
| Mevcut tur | 79 |
| Tamamlanan (başarılı işlem) | **0** |
| Başarısız tur | 79 |
| Son hata | — |
| Bütçe/işlem | 1000 TRY |
| Hedef kâr | 2% |
| Stop loss | 1% |
| Max bekleme | 600s |
| Coin seçim | scanner_best |
| AI modu | learning |
| Başlangıç | 2026-08-28T23:34:59.573Z |

### Kritik bulgu

**77 tur kaydı var, 0 başarılı işlem, 0 alım fiyatı kaydı.** Hiçbir turda `alim_yapildi` / satış aşamasına geçilmedi. Coin seçildi (26 tur) ama execution pipeline işlem açmadan tur fail etti.

---

## 2. Neden işlem açılmıyor? (Funnel)

| Aşama | Tur sayısı | Açıklama |
|-------|------------|----------|
| DB'de round kaydı | 77 | Scheduler tur başlattı |
| Symbol seçildi | 26 | Scanner/decision engine coin atadı |
| Runtime EXECUTING | 0 | Meta: "işlem açılıyor" mesajı |
| buyPrice dolu | 0 | **Gerçek paper alım yok** |
| Tamamlanan | 0 | Satış + PnL yok |

**Ana sebep zinciri:**
1. Scanner coin buluyor → coin seçiliyor
2. AI gate / SIM tight filter / learning lane → **VETO veya HARD REJECT**
3. Veya pump/steady-gain adayı yok → **NO_TRADE**
4. Veya dev kesintisi → tur **zaman aşımı** (1021s)
5. Veya DB transaction abort → **25P02** cascade fail

---

## 3. Hata kategorileri (özet)

| Kategori | Tur | % |
|----------|-----|---|
| Paper NO_TRADE (aday yok) | 30 | 39.0% |
| Diğer | 28 | 36.4% |
| Zaman aşımı (runtime/dev kesintisi) | 16 | 20.8% |
| Job version conflict (DB) | 2 | 2.6% |
| AI VETO (AI kapısı) | 1 | 1.3% |

### Kategori açıklamaları

- **AI VETO:** Learning/consensus AI pipeline işlemi veto etti (`AI_GATE_BLOCK: AI_VETO`). Policy — bug değil.
- **SIM Tight Filter:** 15m non-pump kalite, scanner confidence, pump risk, kalite skoru eşikleri.
- **Learning Lane:** TDI/veri kalitesi hard reject (`data quality issue`).
- **Paper NO_TRADE:** 100+ coin tarandı, pump/steady-gain adayı 0.
- **Zaman aşımı:** Dev kapandı veya scheduler stall; tur 1021s sonra fail.
- **DB 25P02:** Önceki transaction fail sonrası aborted state; cascade Prisma hataları.
- **Version conflict:** Optimistic concurrency — hızlı fail döngüsünde job persistVersion çakışması.

**Eksik tur kayıtları (currentRound içinde DB'de yok):** 12, 18, 36

---

## 4. Final state dağılımı

- `tur_basarisiz`: 52 tur
- `coin_secildi`: 16 tur
- `tariyor`: 9 tur

---

## 5. Tur bazında detay (A→Z)

### Tur 1

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 445s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: EMPTY (SOMITRY)
```

---

### Tur 2

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 532s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: EMPTY (ARKMTRY)
```

---

### Tur 3

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 391s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: EMPTY (XLMTRY)
```

---

### Tur 4

| Alan | Değer |
|------|-------|
| State | coin_secildi |
| Symbol | RVNTRY |
| Süre | 544s |
| Kategori | Job version conflict (DB) |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
transactionallyFailRound job version conflict
```

---

### Tur 5

| Alan | Değer |
|------|-------|
| State | coin_secildi |
| Symbol | DASHTRY |
| Süre | 722s |
| Kategori | Zaman aşımı (runtime/dev kesintisi) |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
Tur zaman asimi (state=tariyor, age=721s)
```

---

### Tur 6

| Alan | Değer |
|------|-------|
| State | coin_secildi |
| Symbol | RENDERTRY |
| Süre | 757s |
| Kategori | Zaman aşımı (runtime/dev kesintisi) |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
Tur zaman asimi (state=tariyor, age=756s)
```

---

### Tur 7

| Alan | Değer |
|------|-------|
| State | coin_secildi |
| Symbol | DASHTRY |
| Süre | 932s |
| Kategori | Zaman aşımı (runtime/dev kesintisi) |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
Tur zaman asimi (state=tariyor, age=932s)
```

---

### Tur 8

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 303s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: NO_TRADE (DASHTRY)
```

---

### Tur 9

| Alan | Değer |
|------|-------|
| State | coin_secildi |
| Symbol | ZKTRY |
| Süre | 721s |
| Kategori | Zaman aşımı (runtime/dev kesintisi) |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
Tur zaman asimi (state=tariyor, age=721s)
```

---

### Tur 10

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 646s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 11

| Alan | Değer |
|------|-------|
| State | tariyor |
| Symbol | ALTTRY |
| Süre | 721s |
| Kategori | Zaman aşımı (runtime/dev kesintisi) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Tur zaman asimi (state=tariyor, age=721s)
```

---

### Tur 13

| Alan | Değer |
|------|-------|
| State | coin_secildi |
| Symbol | DASHTRY |
| Süre | 1547s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: NO_TRADE (SEITRY)
```

---

### Tur 14

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 452s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: NO_TRADE (PNUTTRY)
```

---

### Tur 15

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 329s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: EMPTY (PIXELTRY)
```

---

### Tur 16

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 57s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=108, candidates=0).
```

---

### Tur 17

| Alan | Değer |
|------|-------|
| State | tariyor |
| Symbol | VANATRY |
| Süre | 723s |
| Kategori | Zaman aşımı (runtime/dev kesintisi) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Tur zaman asimi (state=tariyor, age=722s)
```

---

### Tur 19

| Alan | Değer |
|------|-------|
| State | coin_secildi |
| Symbol | COWTRY |
| Süre | 196s |
| Kategori | AI VETO (AI kapısı) |
| Runtime step | SYMBOL_SELECTED |
| Seçim gerekçesi | SELL resolved by master decision engine. Overall confidence 15. Supported by NEWS. Blocked/reduced by LEARNING and MOMENTUM. Risk remains elevated. |

**Fail reason:**

```
AI_GATE_BLOCK: AI_DECISION_CONFLICT
```

---

### Tur 20

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 656s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: NO_TRADE (SANDTRY)
```

---

### Tur 21

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 490s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: NO_TRADE (SAHARATRY)
```

---

### Tur 22

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 378s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 23

| Alan | Değer |
|------|-------|
| State | coin_secildi |
| Symbol | PARTITRY |
| Süre | 722s |
| Kategori | Zaman aşımı (runtime/dev kesintisi) |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
Tur zaman asimi (state=tariyor, age=722s)
```

---

### Tur 24

| Alan | Değer |
|------|-------|
| State | tariyor |
| Symbol | CYBERTRY |
| Süre | 721s |
| Kategori | Zaman aşımı (runtime/dev kesintisi) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Tur zaman asimi (state=tariyor, age=721s)
```

---

### Tur 25

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 215s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 26

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 309s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 27

| Alan | Değer |
|------|-------|
| State | coin_secildi |
| Symbol | SAHARATRY |
| Süre | 721s |
| Kategori | Zaman aşımı (runtime/dev kesintisi) |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
Tur zaman asimi (state=tariyor, age=721s)
```

---

### Tur 28

| Alan | Değer |
|------|-------|
| State | coin_secildi |
| Symbol | USTCTRY |
| Süre | 510s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: NO_TRADE (ROBOTRY)
```

---

### Tur 29

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 363s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: NO_TRADE (MEGATRY)
```

---

### Tur 30

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 320s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 31

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 243s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: EMPTY (SIGNTRY)
```

---

### Tur 32

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 700s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: NO_TRADE (RESOLVTRY)
```

---

### Tur 33

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 356s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 34

| Alan | Değer |
|------|-------|
| State | tariyor |
| Symbol | RVNTRY |
| Süre | 349s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 34

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 218s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 35

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 219s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 37

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 350s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 38

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 332s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 39

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 424s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: NO_TRADE (OGNTRY)
```

---

### Tur 40

| Alan | Değer |
|------|-------|
| State | coin_secildi |
| Symbol | KITETRY |
| Süre | 725s |
| Kategori | Job version conflict (DB) |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
transactionallyFailRound job version conflict
```

---

### Tur 41

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 420s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 42

| Alan | Değer |
|------|-------|
| State | coin_secildi |
| Symbol | ETHTRY |
| Süre | 721s |
| Kategori | Zaman aşımı (runtime/dev kesintisi) |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
Tur zaman asimi (state=tariyor, age=721s)
```

---

### Tur 43

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 597s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: NO_TRADE (HOTTRY)
```

---

### Tur 44

| Alan | Değer |
|------|-------|
| State | coin_secildi |
| Symbol | ONDOTRY |
| Süre | 722s |
| Kategori | Zaman aşımı (runtime/dev kesintisi) |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
Tur zaman asimi (state=tariyor, age=722s)
```

---

### Tur 45

| Alan | Değer |
|------|-------|
| State | coin_secildi |
| Symbol | GIGGLETRY |
| Süre | 908s |
| Kategori | Zaman aşımı (runtime/dev kesintisi) |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
Tur zaman asimi (state=tariyor, age=907s)
```

---

### Tur 46

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 375s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: NO_TRADE (GIGGLETRY)
```

---

### Tur 47

| Alan | Değer |
|------|-------|
| State | coin_secildi |
| Symbol | GRTTRY |
| Süre | 722s |
| Kategori | Zaman aşımı (runtime/dev kesintisi) |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
Tur zaman asimi (state=tariyor, age=722s)
```

---

### Tur 48

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 509s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: NO_TRADE (GIGGLETRY)
```

---

### Tur 49

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 319s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 50

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 345s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 51

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 318s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 52

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 286s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 53

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 335s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 54

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 327s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 55

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 353s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 56

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 303s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: EMPTY (TURBOTRY)
```

---

### Tur 57

| Alan | Değer |
|------|-------|
| State | tariyor |
| Symbol | HYPERTRY |
| Süre | 722s |
| Kategori | Zaman aşımı (runtime/dev kesintisi) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Tur zaman asimi (state=tariyor, age=722s)
```

---

### Tur 58

| Alan | Değer |
|------|-------|
| State | tariyor |
| Symbol | MEMETRY |
| Süre | 747s |
| Kategori | Zaman aşımı (runtime/dev kesintisi) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Tur zaman asimi (state=tariyor, age=746s)
```

---

### Tur 59

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 345s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 60

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 386s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 61

| Alan | Değer |
|------|-------|
| State | tariyor |
| Symbol | LINKTRY |
| Süre | 375s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 62

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 373s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 63

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 309s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 64

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 337s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 65

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 694s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: EMPTY (ENSOTRY)
```

---

### Tur 66

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 515s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: NO_TRADE (DASHTRY)
```

---

### Tur 67

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 656s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 68

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 332s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 69

| Alan | Değer |
|------|-------|
| State | tariyor |
| Symbol | JASMYTRY |
| Süre | 438s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 70

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 612s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: NO_TRADE (UNITRY)
```

---

### Tur 71

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 372s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: NO_TRADE (TAOTRY)
```

---

### Tur 72

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 357s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: NO_TRADE (TRXTRY)
```

---

### Tur 73

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 416s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: EMPTY (STRAXTRY)
```

---

### Tur 74

| Alan | Değer |
|------|-------|
| State | tariyor |
| Symbol | ARTRY |
| Süre | 721s |
| Kategori | Zaman aşımı (runtime/dev kesintisi) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Tur zaman asimi (state=tariyor, age=721s)
```

---

### Tur 75

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 732s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: NO_TRADE (ENATRY)
```

---

### Tur 76

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 297s |
| Kategori | Paper NO_TRADE (aday yok) |
| Runtime step | AI_ANALYSIS |

**Fail reason:**

```
Paper NO_TRADE: pump ve steady-gain adayi yok (tur 1/1, scanned=100, candidates=20).
```

---

### Tur 77

| Alan | Değer |
|------|-------|
| State | coin_secildi |
| Symbol | SCRTRY |
| Süre | 1052s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: NO_TRADE (APETRY)
```

---

### Tur 78

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | — |
| Süre | 333s |
| Kategori | Diğer |
| Runtime step | SYMBOL_SELECTED |

**Fail reason:**

```
NON_EXECUTABLE_DECISION: NO_TRADE (ALLOTRY)
```

---

### Tur 79

| Alan | Değer |
|------|-------|
| State | tur_basarisiz |
| Symbol | RONINTRY |
| Süre | 1378s |
| Kategori | Diğer |
| Runtime step | TIMEOUT |

**Fail reason:**

```
Tur motoru durduruldu
```

---

## 6. Tekrarlayan pattern'ler

### 6.1 MTF = 0.0 (çoğu SIM_TIGHT_FILTER turunda)
Multi-timeframe momentum verisi 0 — TDI/MTF pipeline eksik veya stale. Bu tek başına kalite skorunu düşürüyor.

### 6.2 Pump risk 100 > 96
Paper modda pump risk skoru sürekli 100 görünüyor; eşik 96 — neredeyse her non-pump coin otomatik red.

### 6.3 Scanner confidence ~15–28 vs eşik 36–40
Momentum/confidence kalibrasyonu paper ortamında düşük; scanner adayları eşiği geçemiyor.

### 6.4 selectedReason = NO_TRADE ama symbol atanmış
Master decision engine NO_TRADE derken round yine symbol alıyor; sonra AI gate veto ediyor. Funnel tutarsızlığı.

### 6.5 Tur 1–2: 1021s timeout (state=tariyor)
İlk gece dev kesintisi; coin seçildi (SENTTRY, TAOTRY) ama EXECUTING'de takılı kaldı, alım yapılmadı.

## 7. Önerilen aksiyonlar (policy değiştirmeden)

1. **Runtime stabilitesi:** `npm run dev` tek instance, port 3000; watchdog recovery test.
2. **DB 25P02:** `transactionallyFailRound` retry + transaction isolation audit.
3. **MTF/TDI veri:** Paper modda MTF=0 root cause — veri feed veya cache.
4. **Pump risk 100:** Paper shadow'da risk skoru kalibrasyonu (forensic only).
5. **NO_TRADE + symbol:** Decision engine ve round state sync.

## 8. Ham veri

JSON export: `artifacts/paper-100-round-raw.json` (script: `scripts/_extract-paper-job-report.ts`)
