# PHASE-05-SHADOW-EDGE-VALIDATION-REPORT

STATUS: **PARTIAL**

ShadowOutcomeEngine kuruldu, candidate first-detection snapshot immutable, journey + 1/3/5/10/15/30/60/120m MFE/MAE/return/time-to-MFE/threshold times hesaplanıyor, bağımsız mover ground truth ve recall/precision/Precision@K/calibration servisleri var. Unit + integration testler PASS (22/22 Phase 5; Phase 1–4 regresyon 118/118).

Bu oturumda **canlı Binance WebSocket shadow run açılmadı.** Live shadow duration = **0**. Edge iddiası yalnız replay/synthetic-sequence kanıtına dayandırılamaz. Bu yüzden DONE ve PASS işaretlenmedi.

Gerçek fon kullanılmadı. Outcome analytics **order submit etmez** (`SHADOW_OUTCOME_ENGINE_ORDERS_DISABLED`). Raporda net kâr iddiası yoktur (fee/spread/slippage Phase 6).

Asıl sorunun sayısal cevabı (live market):

> “+5% / +10% / +15% / +20% mover’ların kaçını, hareketin ne kadar erken bölümünde gördük ve diğer candidate’ların kaçı devam etti?”

**Cevaplanamadı.** Live N = 0. Replay seti ölçüm sistemini doğrular; production edge kanıtı değildir.

---

## PHASE 1–4 DOĞRULAMA (kod değişmeden önce + minimum wire)

| Şart | Durum |
|---|---|
| Canonical trading pipeline = 1 | Evet (`canonical-pipeline.ts`) |
| MarketDataDaemon = 1 | Evet |
| Opportunity Engine = 1 | Evet |
| Microstructure Engine = 1 | Evet |
| FinalRanker = 1 | Evet |
| Realtime all-market coverage | **Kod var, live WS bu oturumda ölçülmedi** (Phase 2 PARTIAL) |
| REST polling hot-path’ten çıkmış | Evet (Phase 2/4 testleri) |
| EARLY / STEADY / MOMENTUM / CONTINUATION | Aktif |
| Deep microstructure | Aktif (HOT/PROMOTED) |
| Final score + rank | Aktif |
| AI hard veto yok | Evet (advisory ±8) |
| TDI hard veto yok | Evet (`canReject: false`) |
| Candidate telemetry / firstDetectedAt / firstDetectionPrice / lane / score breakdown | Evet |
| Phase 5 blocker düzeltmesi | Shadow tick scanner worker’a bağlandı; yeni mimari rewrite yok |

Canonical akış (Phase 5 analytics gölgede):

```
BINANCE WS → MarketDataDaemon
  → OpportunityEngine.scan()
  → HOT/PROMOTED + deep aggTrade/bookTicker
  → MicrostructureEngine.evaluate()
  → FinalRanker
  → ShadowOutcomeEngine.observe + tickPrices   // SHADOW_ONLY, order yok
  → getBestFastEntry → risk → execution-engine-v2
```

---

## DATASET

| Alan | Değer |
|---|---|
| live shadow duration | **0** (harici WS oturumu açılmadı) |
| replay duration | Deterministik sequence’ler (dakika-skala simüle horizon, wall-clock ~saniye) |
| candidate count (live) | 0 |
| candidate count (replay tests) | Entegrasyon + 6 archetype + birim fixture’lar |
| unique symbols (live) | 0 |
| ground-truth mover count (live) | 0 |

Replay archetype seti (yapılandırılmış fiyat yolu, production Opportunity/Micro score path entegrasyon testi ile):

| Tip | Symbol fixture | 60m MFE beklentisi |
|---|---|---|
| hızlı vertical pump | VERTUSDT | yüksek (~+18%) |
| slow steady | SLOWUSDT | düşük (~+4%) |
| breakout continuation | CONTUSDT | yüksek (~+9%) |
| fake pump/dump | FAKEUSDT | düşük (peak sonrası dump) |
| market-wide rally proxy | RALLYUSDT | yüksek (~+7%) |
| BTC-down relative strength proxy | RSUSDT | yüksek (~+8%) |

Bu tablo **edge kanıtı değil**; motorun MFE/MAE’yi tiplere göre ayırabildiğini gösterir.

---

## DATA QUALITY

| Alan | Değer |
|---|---|
| live coverage | yok |
| gaps | live ölçülmedi |
| invalid outcomes | gap > `SHADOW` `gapMs` (default 120s) → `OUTCOME_DATA_INCOMPLETE`; synthetic `source` live rapordan düşer |
| synthetic market data | live outcome dataset’e giremez (test 17) |
| lookahead | `t > now` tick yok sayılır (test 18) |

---

## MOVER GROUND TRUTH

Tanımlar (24h change **birincil değil**; rolling window):

| Class | Horizon | Eşik |
|---|---|---|
| MOVE_3 | 15m | +3% |
| MOVE_5 | 30m | +5% |
| MOVE_7 | 60m | +7% |
| MOVE_10 | 60m | +10% |
| MOVE_15 | 120m | +15% |
| MOVE_20 | 120m | +20% |

Event alanları: `moveStartAt`, `moveStartPrice` (baseline’dan +0.3% departure), `thresholdReachedAt`, `peakAt`, `peakPrice`.

| Class | Live N |
|---|---|
| +3 movers | INSUFFICIENT_SAMPLE (0) |
| +5 movers | INSUFFICIENT_SAMPLE (0) |
| +10 movers | INSUFFICIENT_SAMPLE (0) |
| +15 movers | INSUFFICIENT_SAMPLE (0) |
| +20 movers | INSUFFICIENT_SAMPLE (0) |

---

## RECALL

overall mover recall (MOVE_10, live): **INSUFFICIENT_SAMPLE** N=0

Replay birim testi: HIT + MISS senaryosunda recall ∈ (0,1] doğru hesaplanıyor. Bu, production recall sayısı değildir.

---

## EARLY RECALL

Live:

| Metrik | Değer |
|---|---|
| before +1% | INSUFFICIENT_SAMPLE N=0 |
| before +2% | INSUFFICIENT_SAMPLE N=0 |
| before +3% | INSUFFICIENT_SAMPLE N=0 |
| before +5% | INSUFFICIENT_SAMPLE N=0 |

Tanım: `firstDetectionPrice` move start’a göre henüz eşik %’nin altındayken tespit.

---

## DETECTION LEAD TIME

`thresholdReachedAt - firstDetectedAt`

| | Live |
|---|---|
| median | INSUFFICIENT_SAMPLE |
| p25 | — |
| p75 | — |
| p90 | — |

---

## PRECISION

Tanım: 60m MFE ≥ eşik ve `quality=OK`. Unique-move seviyesi default rapor (aynı 30m bucket duplicate şişirmesin).

| | Live |
|---|---|
| Precision@3 | INSUFFICIENT_SAMPLE N=0 |
| Precision@5 | INSUFFICIENT_SAMPLE N=0 |
| Precision@7 | INSUFFICIENT_SAMPLE N=0 |
| Precision@10 | INSUFFICIENT_SAMPLE N=0 |

95% CI: N&lt;10 için üretilmez (`INSUFFICIENT_SAMPLE`).

---

## PRECISION@K

| K | Live |
|---|---|
| Top1 | INSUFFICIENT_SAMPLE |
| Top3 | INSUFFICIENT_SAMPLE |
| Top5 | INSUFFICIENT_SAMPLE |
| Top10 | INSUFFICIENT_SAMPLE |
| Top20 | INSUFFICIENT_SAMPLE |

Replay birim: rank-1 +10% / rank-2 +0.2% → Precision@1=100%, Precision@2=50% (N=2, yine yetersiz; sadece ranking sıralamasının metriğe yansıdığına dair test).

---

## SCORE CALIBRATION

Bucket’lar: 60–69 / 70–79 / 80–84 / 85–89 / 90–94 / 95–100.

Live tablo: boş.

Replay birim: 96-score ~+10% MFE vs 62-score ~+0.5% MFE — **kalibrasyon fonksiyonu doğru grupluyor**; live monotoniklik **kanıtlanmadı**.

---

## LANE PERFORMANCE

| Lane | N (live) | MFE | MAE | precision | recall | lead time |
|---|---|---|---|---|---|---|
| EARLY | 0 | — | — | INSUFFICIENT_SAMPLE | — | — |
| STEADY | 0 | — | — | INSUFFICIENT_SAMPLE | — | — |
| MOMENTUM | 0 | — | — | INSUFFICIENT_SAMPLE | — | — |
| CONTINUATION | 0 | — | — | INSUFFICIENT_SAMPLE | — | — |

Hangi lane’in gerçek edge taşıdığı **bilinmiyor**.

---

## TOP REAL MOVERS

Live tablo yok.

Replay archetype (tespit edilen fixture’lar; ground-truth borsa günü değil):

| Symbol | Move (60m path) | First detection | Lane | Result (raw MFE) |
|---|---|---|---|---|
| VERTUSDT | vertical +18% | t0 | EARLY | high MFE |
| SLOWUSDT | slow +4% | t0 | EARLY | low MFE |
| CONTUSDT | continuation +9% | t0 | CONTINUATION | high MFE |
| FAKEUSDT | fake +3.5% then dump | t0 | EARLY | low end / limited follow-through |
| RALLYUSDT | +7% | t0 | EARLY | high MFE |
| RSUSDT | +8% | t0 | EARLY | high MFE |

---

## MISSED MOVERS

Live: yok.

Replay birim: `GHOSTUSDT` +15%/60m, candidate yok → `NOT_DETECTED`.

Miss reason kodları: `NOT_DETECTED`, `LATE_DETECTION`, `LOW_LIQUIDITY`, `SCORE_BELOW_THRESHOLD`, `TOP_K_DROPPED`, `STALE_DATA`, `UNIVERSE_EXCLUDED`, `UNKNOWN`.

---

## BEST SIGNALS / WORST HIGH-CONFIDENCE

Live: yok. API: `getTopSignals()`, `worstHighConfidence` (score ≥ 90 ve MFE_60m &lt; 1%).

---

## FALSE POSITIVES

Pattern sınıfları (heuristic, auto-tune yok): `FLOW_COLLAPSE`, `FAKE_BREAKOUT`, `HIGH_EXHAUSTION`, `LOW_LIQUIDITY`, `BTC_REVERSAL`, `LATE_ENTRY`, `NO_FOLLOW_THROUGH`.

Live pattern sayımı: N=0.

---

## FALSE NEGATIVES

Live N=0. Altyapı pre-move score / liquidity / stale / universe dışı sınıflamasını destekliyor.

---

## PIPELINE VALUE

Opportunity vs HOT vs MICRO_CONFIRMED vs EXECUTION_READY Precision@5 karşılaştırması **live yok**.

Replay bunu hesaplayabilir; production “micro değer katıyor mu?” sorusu **cevaplanmadı**. Sahte 32%→45% iddiası yok.

---

## GATE LOSS

Live hunisi yok.

Kod: DISCOVERED/HOT/MICRO/EXECUTION_READY mover overlap + `droppedAfterHot`.

---

## LATENCY

Alanlar: `firstDetectedAt`, `hotAt`, `deepSubscriptionAt`, `microConfirmedAt`, `executionReadyAt`.

Live medyanlar: INSUFFICIENT_SAMPLE.

---

## AI VALUE

Segment: BULLISH / NEUTRAL / CAUTION / TIMEOUT / NO_OPINION.

Live incremental value: **ölçülmedi**. AI kullanıldığı için pozitif varsayılmadı. Segmentasyon stored MFE’yi değiştirmez (test 19).

---

## TDI VALUE

Segment: BUY / SELL / NO_OPINION. Shadow, `canReject: false`.

Live katkı: **ölçülmedi**. Phase 6’da production authority **verilmemeli** (Phase 4 kararı duruyor).

---

## BASELINE COMPARISON

Hedef karşılaştırmalar (servis hazır, live koşmadı):

- System candidates
- Random / liquidity-matched (`randomBaseline`)
- Simple momentum: son 5m en çok yükselen Top-10 (Phase 6 live run’da doldurulacak)

Live: sistem vs baseline **yok**. Kompleks pipeline’ın basit 5m top-gainer’dan iyi olduğu **kanıtlanmadı**.

---

## RAW EXPECTANCY PROXIES

Research-only: `TP3/SL1.5`, `TP5/SL2`, 60m MFE/MAE walk. **Fee/slippage yok. Net kâr değil.** Live N=0.

---

## SAMPLE SIZE / CONFIDENCE

Kural: N&lt;20 → `INSUFFICIENT_SAMPLE`; N&lt;10 → CI yok.

Bu raporun tüm live metrikleri bu kurala takılır. Replay N küçük ve **seçilmiş senaryolardır** (survivorship / selection bias). Replay ile PASS üretilmedi.

---

## KEEP

Veriyle (mühendislik kanıtı, edge kanıtı değil) desteklenenler:

- Tek `ShadowOutcomeEngine` (SHADOW_ONLY)
- Immutable first-detection snapshot
- Candidate journey
- Unique-move (`symbol` + 30m bucket) duplicate kontrolü
- Bağımsız mover ground truth (opportunity’den ayrı)
- Stale/gap → outcome invalid
- Synthetic’in live rapordan dışlanması
- Lookahead-safe tick (`t <= now`)

---

## ADJUST

Production threshold **değiştirilmedi** (auto-tune yok).

Önerilen (Phase 6, data geldikten sonra):

- 24h+ live shadow zorunlu
- Offline sensitivity 75/80/85/90 (fonksiyon var, canlı tablo yok)
- EARLY RVOL / continuation chase mesafesi — henüz live FP yokken dokunma

---

## REMOVE

Hiçbir production katman **kaldırılmadı**. AI modifier / TDI için “değer yok” iddiası **yapılamaz** (N=0).

---

## INVESTIGATE

- Phase 2: gerçek all-market WS coverage hâlâ ölçülmedi
- FinalRanker kalibrasyonu live monotonik mi?
- CONTINUATION/MOMENTUM chase (pump tepesi)
- Micro layer latency vs precision lift
- Gate loss: HOT olup elenen gerçek +10% mover’lar

---

## PHASE 6 READINESS

**NOT READY** (live trading / fee-aware strategy authority için)

Instrumentasyon shadow data toplamak için hazır. Edge kanıtı yok.

---

## PHASE 6 GO/NO-GO

**NO-GO**

Gerekçe: minimum edge kriterleri (ranking monotonik, Top-K &gt; random/unfiltered, en az bir lane PPV, mover recall tamamen başarısız olmamalı, early detection hareketten önce) **live dataset ile test edilemedi**. Replay ile bu kriterleri “geçmiş gibi” göstermek yasak ve yapılmadı.

Instrumentation-only devam (24h shadow, order kapalı) ayrı bir operasyonel adımdır; bu rapor onu Phase 6 GO saymaz.

---

## PHASE 6 BLOCKERS

1. Live shadow duration = 0; +5/+10/+15/+20 mover recall/early-recall/precision yok.
2. Phase 2 live all-market WS hâlâ doğrulanmadı.
3. Baseline (random + 5m top-gainer) live karşılaştırması yok.
4. Sample size kuralı tüm canlı metrikleri `INSUFFICIENT_SAMPLE` yapıyor.
5. Full-repo `next build` / `tsc` bu oturumda tamamlanmadı (önceki phase’lerle aynı heap/lock kısıtı). Vitest transform = pratik typecheck PASS.

---

## DONE KRİTERLERİ

| Madde | Durum |
|---|---|
| Tek canonical ShadowOutcomeEngine | Evet |
| Immutable first-detection snapshot | Evet (test 6) |
| Candidate journey | Evet (test 7) |
| 1/3/5/10/15/30/60/120m outcome | Evet |
| MFE / MAE / time-to-MFE / threshold times | Evet (test 1–5) |
| Independent mover ground truth | Evet (test 9) |
| Mover recall / early recall / lead time / precision / Precision@K | Evet (kod + test; live N=0) |
| Score calibration / lane performance | Evet (kod; live N=0) |
| FP / FN / late detection / pipeline / gate / latency | Evet (kod; live N=0) |
| AI / TDI value analysis | Evet (kod; live N=0) |
| Baseline comparison | Kod hazır; live koşmadı |
| Replay lookahead-safe | Evet (test 18) |
| Duplicate bias | Evet (test 8) |
| Sample size her metrikte | Evet (`n` + `INSUFFICIENT_SAMPLE`) |
| Shadow mode order açamaz | Evet (test 20) |
| Typecheck | Vitest compile PASS; full `tsc`/`next build` bu oturumda yok |
| Relevant tests | Phase 5 22 PASS; Phase 1–4 96 PASS; toplam 118 PASS |
| Production build | **PARTIAL** (çalıştırılmadı / önceki OOM) |
| Gerçek shadow/replay evidence | Replay/unit evet; 24h live **hayır** (uydurulmadı) |
| Phase 6 data-driven GO/NO-GO | **NO-GO** |

---

## API / DEPOLAMA

- `GET /api/shadow-outcome/status` — telemetry + daily report + analytics (UI yok)
- `getDailyEdgeReport`, `getLanePerformance`, `getMoverRecall`, `getMissedMovers`, `getScoreCalibration`, `getTopSignals`
- Prisma `ShadowCandidateOutcome` + migration `20260830030000_shadow_candidate_outcome` (indexed: candidateId, symbol, detectedAt, lane, finalScore, moveKey)
- Persist: memory-first, 30s batch, tick başına DB yok
- Outcome retention ≠ raw tick retention (price buffer ~150m / 9000 point)

---

## KRİTİK CEVAP (istenen tek cümle)

Live piyasada +5/+10/+15/+20 mover’ların ne kadarını ne kadar erken gördüğümüz ve candidate precision’ı **bu oturumda kanıtlanmadı** (N=0). Ölçüm sistemi hazır; edge yok da denemez, var da denemez. Phase 6 trading GO için önce gerçek 24h+ shadow dataset şart.
