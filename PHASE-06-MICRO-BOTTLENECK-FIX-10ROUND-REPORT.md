# PHASE-06 MICRO BOTTLENECK FIX - 30 ROUND COMPREHENSIVE FORENSIC REPORT

## 1) EXECUTIVE STATUS

- Bu rapor onceki `8/10 partial` kosunun yerine, tamamlanmis `30/30` paper validation kosusunun final forensic ozetidir.
- Validation run process seviyesi basariyla bitmistir (`exit_code: 0`), fakat round sonuc dagilimi agirlikli olarak `failed` tir.
- Genel sonuc:
  - `30` round planlandi, `30` round calisti.
  - `29` round `failed`
  - `1` round `no_trade`
  - `0` paper trade open/fill

## 2) RUN IDENTITY AND WINDOW

- `validationId`: `30round-hot-execready-2026-08-30T23-41-48-106Z`
- `sessionId / jobId`: `cmtggy3zk07r0un80l4se6owk`
- `mode`: `PAPER`
- `exchange`: `tr`
- `aiGatePolicy`: `VETO`
- `totalRounds`: `30`
- `startedAt`: `2026-08-30T23:41:55.537Z`
- `completedAt`: `2026-08-31T00:12:45.329Z`
- Yaklasik run suresi: `~30.8 dakika`

## 3) TOPLINE OUTCOME

- Round-level sonuc dagilimi:
  - `failed`: `29`
  - `no_trade`: `1` (Round `25`)
- Job-level durum:
  - `status`: `COMPLETED` (orchestrator tum roundlari bitirdi)
  - `completedRounds`: `1`
  - `failedRounds`: `29`
  - `lastError`: `Binance API failure breaker`

Not: `job.status=COMPLETED`, scheduler'in 30 round dongusunu tamamladigini; `completedRounds=1` ise business-level basarili/no-trade terminal round sayisini ifade eder.

## 4) FAILURE TAXONOMY (ROUND FAIL REASONS)

Round fail reason dagilimi:

- `Binance API failure breaker`: `26`
- `Execution flow failed`: `2`
- `LEARNING_LANE_HARD_REJECT: data quality issue`: `1`

Yorum:
- Ana dominan hata acik ara `Binance API failure breaker` olup, sistem davranisini run boyunca belirleyen ana terminal fail modudur.
- Ilk 3 roundda farkli fail tipleri gorulmus, sonrasinda fail paterni buyuk olcude tek tipe oturmustur.

## 5) ROUND TIMELINE SNAPSHOT

- Round `1`: `failed` (`Execution flow failed`)
- Round `2`: `failed` (`LEARNING_LANE_HARD_REJECT: data quality issue`)
- Round `3`: `failed` (`Execution flow failed`)
- Round `4-24`: buyuk olcude `failed` (`Binance API failure breaker`)
- Round `25`: `no_trade` (`state=tur_tamamlandi`, `netPnl=0`)
- Round `26-30`: tekrar `failed` (`Binance API failure breaker`)

## 6) SYMBOL CONCENTRATION (ROUND TARGETS)

Roundlarda en cok tekrar eden semboller:

- `REUSDT`: `9`
- `MUBARAKUSDT`: `4`
- `ONGUSDT`: `3`
- `ZKPTRY`: `3`
- `TRUMPTRY`: `2`
- `PUMPUSDT`: `2`
- Digerleri tekil gorunumler (`EDENUSDT`, `XPLUSDT`, `BROCCOLI714USDT`, `XAUTUSDT`, `ESPUSDT`, `WLFIUSDT`)
- `1` roundda `symbol=null` (Round `25`, `no_trade`)

Yorum:
- Sembol dagilimi genis, ancak `REUSDT` belirgin sekilde sik tekrar etmis.
- Buna ragmen islem acilisa donusen bir execution/fill hattina gecis olmamistir.

## 7) HANDOFF + PIPELINE DIAGNOSTIC (RUN SIRASINDA)

`handoffDiagnostic` ozet metrikleri:

- `durationSec`: `1848`
- `opportunityEvaluations`: `30873`
- `discovered`: `2897`
- `hot`: `600`
- `microAnalyzed`: `600`
- `microConfirmed`: `20`
- `deepActiveMax`: `36`
- `pass flags`: tum kritik checkler `true` (`opportunityEvaluations`, `discovered`, `hot`, `microInput`, `legacyInvocationZero`, `legacyPersistZero`, `shadowTracked`, `moverActive`)

Yorum:
- Opportunity ve micro girisi var; yani sistem "aday bulma" tarafinda tamamen kilitli degil.
- Ancak bu throughput, round-level execution basarisina donusmemis.

## 8) CANDIDATE STORE SNAPSHOTS

### 8.1 Handoff anindaki candidate store

- `active`: `426`
- `executionReady`: `0`
- `transitions`: `4105`
- `created`: `724`
- `expired`: `231`
- `byState`:
  - `WATCHING`: `359`
  - `MICRO_WARMING`: `32`
  - `MICRO_REJECTED`: `67`
  - `NOT_EXECUTION_READY`: `6`
  - `DISCOVERED`: `29`

### 8.2 Run sonu canonical candidate store

- `created`: `1453`
- `transitions`: `35989`
- `active`: `445`
- `executionReady`: `1`
- `byState`:
  - `EXPIRED`: `800`
  - `WATCHING`: `326`
  - `MICRO_REJECTED`: `208`
  - `MICRO_WARMING`: `64`
  - `NOT_EXECUTION_READY`: `2`
  - `DISCOVERED`: `51`
  - `HOT`: `1`
  - `EXECUTION_READY`: `1`

Yorum:
- Run sonunda `EXECUTION_READY=1` gorulmesine ragmen trade/fill gerceklesmemistir.
- `WATCHING` + `MICRO_REJECTED` yogunlugu, phase-06 kapsamindaki mikro darbogazin hala etkin oldugunu gosterir.

## 9) EXECUTION / PNL OUTCOME

- Round detaylarinda `ordersCreatedCount > 0` yok.
- `fillsCount > 0` yok.
- `positionsOpened > 0` yok.
- `tradeCount > 0` yok.
- Gozlenen tek no-trade terminal round (Round `25`) da `netPnl=0`.

Sonuc:
- Pipeline aday uretiyor ancak order/fill katmanina gecis neredeyse sifir.
- Islem acilmadan terminal fail/no_trade ile dongu kapanmis.

## 10) PRIMARY BOTTLENECK CONCLUSION (PHASE-06)

Bu 30-round kosunun nihai resmi:

1. Dominant terminal fail modu: `Binance API failure breaker` (`26/29 fail`).
2. Micro-to-execution conversion zayif:
   - Opportunity/HOT/micro aktivitesi var.
   - Fakat `EXECUTION_READY` neredeyse hic trade'e donmuyor (`1 ready`, `0 order`, `0 fill`).
3. WATCHING ve MICRO_REJECTED birikimi:
   - Candidate store dagilimi, darbogazin entry-oncesi filtrelerde yigildigini destekliyor.

## 11) ACTIONABLE FOLLOW-UP

Oncelik sirasiyla onerilen takip adimlari:

1. `Binance API failure breaker` icin
   - breaker tetikleme kosullari,
   - retry/backoff stratejisi,
   - circuit reset kosullari
   ayrintili olarak ayrik incelenmeli.
2. `Round 25 (no_trade)` artifact'lari referans alinarak
   - neden fail yerine no_trade ile tamamlandigi,
   - o roundda fark yaratan kontrol yolu
   karsilastirmali analiz edilmeli.
3. `WATCHING -> HOT -> MICRO_CONFIRMED -> EXECUTION_READY -> ORDER`
   zincirinde her adim icin drop-off oranlari yeniden hesaplanmali.
4. `MICRO_REJECTED` reason histogrami (ozellikle `MICRO_LOW_ACTIVITY`, `MICRO_DATA_STALE`) round-bazli ayrilmali.

## 12) ARTIFACT PATHS

- Ana forensic kok:
  - `C:\Users\salih\Desktop\kripto-main\artifacts\forensics\cmtggy3zk07r0un80l4se6owk`
- Preflight:
  - `C:\Users\salih\Desktop\kripto-main\artifacts\forensics\cmtggy3zk07r0un80l4se6owk\preflight.json`
- Round artifact klasorleri:
  - `C:\Users\salih\Desktop\kripto-main\artifacts\forensics\cmtggy3zk07r0un80l4se6owk\rounds\1 ... rounds\30`

## 13) NOTE ON DATA SOURCE

Bu rapor, tamamlanan 30-round validation terminal ciktilari ve ilgili forensic JSON bloklarindan uretilmistir. Onceki dosyada bulunan `8/10 manual stop` notu artik gecersizdir ve bu belge final run bulgularini temsil eder.
