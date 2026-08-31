# PHASE-03-OPPORTUNITY-ENGINE-REPORT

STATUS: **PARTIAL**

Canonical Opportunity Engine kuruldu, production candidate authority tek servise indirgendi, dört lane + signed feature model unit/integration testlerle doğrulandı. Global lightweight scan REST/AI yapmıyor. Live Binance all-market WebSocket üzerinde çok saatlik shadow oturumu bu oturumda çalıştırılmadı (Phase 2 ile aynı kısıt; canlı fon yok). Bu yüzden DONE işaretlenmedi.

Gerçek fon kullanılmadı.

---

## CANONICAL OPPORTUNITY FLOW

```
BINANCE SPOT WS (!miniTicker@arr)
  → MarketDataDaemon RAM / Redis snapshot
       → OpportunityEngine.scan()          // 1s, REST yok, AI yok, DB yok
            → ranked OpportunityCandidate[] (top-K + lane quota)
                 → HOT/PROMOTED ise subscribeDeep(aggTrade, bookTicker)
  → getBestFastEntry()                     // yalnız opportunity pool
  → round-selection.service                // source=opportunity
  → executeAnalyzeAndTrade
       → risk → execution-engine-v2
```

Scanner worker ayrı 1s timer ile `tickOpportunity()` çalıştırır. `runScannerPipeline` cycle symbol listesini Opportunity Engine ranked listesinden alır; 24h top-gainer discovery execution ranking’e giremez.

Call chain (canonical-pipeline.ts):

```
market-data-daemon
  → market-data-gateway
  → opportunity-engine
  → scanner.service (enrichment of top-K only)
  → signal-scoring / fast-entry
  → canonical-risk-decision
  → execution-orchestrator
  → execution-engine-v2
```

CANONICAL CANDIDATE AUTHORITY = **1** (`opportunity-engine`)

---

## OLD SCANNERS

| Servis | Runtime | Production candidate? |
|---|---|---|
| `OpportunityEngine` | CANONICAL | Evet — tek authority |
| `pump-early-catcher` worker | SHADOW_ONLY / SUPPORTING | Hayır |
| `getPumpFastEntry` / `selectPumpFastEntry` | SHADOW_ONLY | Hayır — round-selection artık çağırmıyor |
| `top-gainer-discovery` | SHADOW_ONLY | Hayır — scanner cycle 24h gainer ile doldurulmuyor |
| `runScannerPipeline` watchlist rotation | fallback only | Opportunity ranked boşsa rotation; `getBestFastEntry` bu path’ten execution candidate almaz |
| discovery / master-scanner | SHADOW_ONLY | Supporting enrichment |
| emergency scanner | yok | — |

`getBestFastEntry` opportunity pool boşsa **AI scanner fallback yapmaz**; `selected: null` döner.

---

## UNIVERSE

Engine, `MarketDataDaemon.getMarketSnapshot()` içindeki tradeable USDT (ve TRY) tickers’ı tarar.

- Stable/leveraged filtre: `universe-policy.ts` (`USDCUSDT`, `*UPUSDT`, `*DOWNUSDT`, …)
- Liquidity pre-filter: `quoteVolume24h >= OPPORTUNITY_MIN_QUOTE_VOLUME_24H` (default 500_000)
- Unit evidence: **700** symbol snapshot, p95 hedefi `< 250ms` (test PASS, ilk sırada erken mover `S0USDT`)
- Live universe size: Phase 2 live WS coverage ölçülmediği için production’da henüz kanıtlanmadı

---

## SCAN PERFORMANCE

| Metrik | Sonuç |
|---|---|
| 700-symbol evaluation | `< 250ms` (unit, `durationMs` assertion PASS) |
| p50 / p95 (live) | Ölçülmedi — live WS shadow yok |
| CPU | Ölçülmedi |
| memory | Phase 2 daemon 700-symbol bound test PASS; opportunity scan extra ring tutmaz |
| event-loop lag | Live ölçülmedi. Scan senkron ve RAM-only; 700-symbol test tüm Phase 3 suite içinde ~46–71ms |
| REST during scan | **0** — `countHotPathPublicMarketRestCalls()` + `OPPORTUNITY_SCAN_NETWORK_FORBIDDEN` guard |
| AI during scan | **0** — `aiCalls` her zaman 0 |
| DB during scan | Milestone journal **memory** (creation / lane / state / expire). Per-symbol/saniye Postgres yazılmaz |

---

## LANES

### EARLY

- Amaç: henüz küçük hareket (+0.12% … +4.2% 5m) + ivmelenme
- Feature ağırlıkları: acceleration 0.20, volume acceleration 0.18, RVOL 0.14, velocity 0.14, RS 0.12, compression/expansion 0.09
- Eligibility: `return5m ∈ (0.12, 4.2)` ve `priceAccelerationShort >= -0.05`
- Primary: STEADY ile çakışırsa acceleration `>= 1.0` (%/min fark) EARLY’yi zorlar
- Runtime count: live ölçülmedi. Unit: `earlyMover` + replay path EARLY
- 24h gain **ana metrik değil** — `change24h: 0.4` ile EARLY üretildi

### STEADY

- Amaç: düzenli, düşük noise pozitif slope
- Eligibility: `return5m ∈ (0.25, 3.8)`, `momentumConsistency > 0.35`, `maxRetracement < 1.2`, `priceAccelerationShort < 1.1`
- Ağırlık: consistency 0.20, retracement 0.16, RS 0.12, liquidity 0.10
- Unit: `STEADYUSDT` primaryLane = STEADY

### MOMENTUM

- Amaç: hareket başlamış (+2.4% … +12% 5m), exhaustion henüz yüksek değil
- Eligibility: `return5m ∈ (2.4, 12)` ve `exhaustionScore < 70`
- Ağırlık: velocity, breakout, exhaustion penalty
- Unit: `MOMUSDT` primaryLane = MOMENTUM

### CONTINUATION

- Amaç: ciddi hareket sonrası ikinci leg — **sırf +%20 yetmez**
- Eligibility: (`return15m > 8` veya `change24h > 10`) **ve** `volumeAcceleration > 0` **ve** `exhaustionScore < 50` **ve** `maxRetracement < 4.5`
- Chase control + exhaustion CONTINUATION ağırlığında en yüksek (0.16)
- Unit: sağlıklı `CONTUSDT` CONTINUATION; `PUMPUSDT` +%20 exhausted top rank değil

Lane quota (adaptive): EARLY 10 / STEADY 5 / MOMENTUM 8 / CONTINUATION 5. Score `>= 90` quota’yı bypass eder. Sonra global top-K (28) doldurulur.

---

## FEATURE MODEL

Phase 2 rolling + window’dan üretilir. Hepsi signed / deterministic.

| Feature | Kaynak | Normalization |
|---|---|---|
| return1s … return15m | snapshot.rolling | ham % |
| velocity5s/15s/30s/1m | return / dakika | `signedScore(v, 0.8)` |
| priceAccelerationShort/Medium | velocity farkı | `signedScore(mix, 0.45)` |
| accelerationConsistency | işaret oranı | consistency component |
| volume1m/3m/5m | quoteVolumeDelta / window | quote notional |
| rvol1m/3m/5m | winsorized median baseline | `signedScore(rvol-1, 2.2)` bound ±100 |
| volumeAcceleration | 2. fark (history) | scale `max(8000, 0.6*vol1m)` |
| relativeStrengthBTC1m/5m | coin − BTC | `signedScore(..., 0.55)` |
| relativeStrengthMarket | coin − median 1m | aynı |
| market breadth | pctPositive, median, top-decile | filter MARKET_WIDE_MOVE_ONLY |
| distanceTo3m/5mHigh, breakout3m/5m | rolling high | volume-confirmed boost |
| compressionScore / expansionScore | short/medium range ratio | bounded [0,1] |
| maxRetracement, retracementRatio, recoverySpeed | window peak/trough | STEADY/CONT weights |
| momentumConsistency | ardışık pozitif return oranı − spikeLike | signed |
| exhaustionScore / chaseRisk | fake spike, wick, +% chase | **negatif** component |
| tradeCountVelocity | yok (all-market light stream) | Phase 4 deep aggTrade |

24h `change24h` yalnız contextual; EARLY eligibility’de yok.

---

## SCORE MODEL

```
component = signedScore(feature, scale) ∈ [-100, +100]
laneScore = longBias + Σ(component_i * weight_i) * 0.42
longBias = 52  iff  return5m ≥ 0.25  OR  (return1m ≥ 0.15 AND accelShort > 0)
if return1m < 0 AND return5m < 0  →  score = min(0, weighted)   // LONG yok
clamp [-20, 100]
```

Breakdown telemetry’de görünür: velocity, acceleration, volumeAcceleration, RVOL, RS, breakout, compressionExpansion, consistency, retracementQuality, exhaustion (−), chaseControl (−), liquidity.

Reason codes: `EARLY_PRICE_ACCELERATION`, `EARLY_VOLUME_ACCELERATION`, `RVOL_SPIKE`, `RELATIVE_STRENGTH`, `BREAKOUT_NEAR`, `BREAKOUT_CONFIRMED`, `STEADY_TREND`, `MOMENTUM_PERSISTENCE`, `CONTINUATION_RECOVERY`, `COMPRESSION_EXPANSION`.

Filter codes: `LOW_LIQUIDITY`, `EXCLUDED_SYMBOL`, `STALE_DATA`, `NEGATIVE_DIRECTION`, `MARKET_WIDE_MOVE_ONLY`, `EXHAUSTED`.

---

## DIRECTIONALITY AUDIT

Kanıt: `tests/phase03-opportunity-engine.test.ts`

1. Pozitif return → `priceVelocity > 0`, EARLY score `> 0`
2. Negatif return1s…5m → `priceVelocity <= 0`, EARLY score `<= 0`
3. Engine negatif 1m+5m için candidate üretmez (`NEGATIVE_DIRECTION`)
4. Exhaustion/chase component’leri `−abs(signedScore(...))` — score artıramaz
5. `+20%` exhausted coin otomatik top-rank değil

---

## CANDIDATE LIFECYCLE

```
DISCOVERED  --score>=watch(58)-->  WATCHING
WATCHING    --score>=hot(72)---->  HOT
HOT         --sonraki scan------>  PROMOTED
HOT/PROMOTED --score < drop(52)-->  COOLING
COOLING     --hâlâ < drop------->  EXPIRED
TTL 8dk + score < watch          → EXPIRED
```

Hysteresis: promote `>= 72`, drop only `< 52`. Score 79/81/79/82 churn üretmez (unit PASS).

Score decay: 2 idle scan sonrası `score *= 0.94`.

---

## DEDUPE

- Bir symbol = bir session (`Map<symbol, OpportunityCandidate>`)
- `candidateId = ${symbol}:${firstDetectedAt}` lane değişince **aynı kalır**
- `secondaryEvidence[]` diğer eligible lane’ler
- Ranked listede symbol bir kez

---

## DYNAMIC SUBSCRIPTIONS

HOT veya PROMOTED + top-K içinde, limit 24:

```
subscribeDeep(symbol, "opportunity-engine", ["aggTrade", "bookTicker"])
```

`kline_1m` / `depth` **bilinçli olarak açılmaz** — daemon kline bootstrap REST yapardı; Phase 3 scan REST yasağını bozmamak için. Phase 4 microstructure kline/depth’i candidate-level açabilir.

Unit: daemon ingest → scan → HOT ise `deepSubscribed=true`, REST=0.

---

## SHADOW RESULTS

| | |
|---|---|
| Live WS shadow (saatler) | **Çalıştırılmadı** |
| Synthetic 700-universe | PASS; ranked > 0; erken mover 1. sıra |
| Daemon ingest chain | PASS; REST=0 |
| Duplicate count | 0 (aynı symbol 2 scan → 1 candidate) |
| Stale rejects | STALEUSDT unit PASS |
| Candidate churn | hysteresis unit PASS |
| Lane dağılımı (live) | yok |
| CPU/memory (live) | yok |

Telemetry API: `GET /api/opportunity/status` (ranked, breakdown, firstDetectedAt/Price, laneLeaders, filterSamples). UI redesign yok.

---

## REPLAY RESULTS

Historical Binance dump replay altyapısı Opportunity Engine’e bağlanmadı (mevcut replay stack decision/exit odaklı).

Sentetik accelerating path (unit):

- Symbol: `REPLAYUSDT`
- Path: `return5m = 0.08·step + 0.004·step²` (step 1…40)
- **first lane = EARLY**
- **firstDetection return5m < 4%** (hareket tamamlanmadan)
- Son fiyat `firstDetectionPrice` üstünde
- Aynı `candidateId` journey boyunca korunuyor

Bu, “+%10 olmuş coin’i sonradan yakalayan top-gainer filtresi” olmadığını unit düzeyinde gösterir. Live mover lead-time henüz yok.

---

## DETECTION EXAMPLES

### 1) Sentetik EARLY (unit `earlyMover`)

| | |
|---|---|
| first detected | scan anı (t0) |
| firstDetectionPrice | 100 |
| lane | EARLY |
| change24h | 0.4 (düşük — 24h gainer değil) |
| return5m | ~0.95% |
| sonraki hareket | test scope’unda tutulmuyor; replay örneği fiyatı yükseltiyor |

### 2) Replay accelerating

| | |
|---|---|
| first lane | EARLY |
| first return5m | < 4% |
| later | currentPrice > firstDetectionPrice |
| identity | tek candidateId |

### 3) Exhausted chase

| | |
|---|---|
| PUMPUSDT | +%22 24h, +%11 5m, volume desteklemiyor |
| sonuç | top rank değil |

Phase 5 MFE/MAE için `firstDetectedAt` / `firstDetectionPrice` session + milestone journal’da duruyor. False-positive silinmez; EXPIRED olana kadar identity korunur.

---

## NETWORK ASSERTION

Opportunity `scan()`:

- `countHotPathPublicMarketRestCalls()` değişirse throw `OPPORTUNITY_SCAN_NETWORK_FORBIDDEN`
- Unit: REST = 0, AI = 0
- Daemon ingest → scan REST = 0
- Phase 1/2 REST-first’e dönüş yok; gateway hot-path hâlâ `DATA_NOT_READY`

---

## TESTS

```
npx vitest run tests/phase03-opportunity-engine.test.ts tests/phase01-core-reset.test.ts tests/phase02-realtime-market-spine.test.ts tests/auto-round-engine.integration.test.ts tests/round-runtime.test.ts
```

**PASS** — 71 tests / 5 files

Phase 3 coverage (25):

1. Positive return → positive evidence
2. Negative return LONG score artırmaz
3. Positive acceleration EARLY yükseltir
4. Negative acceleration EARLY düşürür
5. Volume acceleration
6. RVOL bounded
7. Volume outlier score’u 100’e kilitlemez
8. BTC relative strength
9. Market-wide vs coin-specific
10. Breakout+volume > dry breakout
11. Exhaustion penalty
12. Stable/illiquid filter
13. Dedupe
14. Lane transition aynı candidateId
15. Hysteresis
16. Score decay
17. Deep sub yalnız HOT/PROMOTED
18–19. Scan REST=0, AI=0
20. Düşük 24h EARLY olabilir
21. +20% exhausted top değil
22. Stale reject
23. 700-symbol < 250ms
24. Dört lane sınıflaması
25. Replay early detection + daemon ingest chain

---

## BUILD

| | |
|---|---|
| `next build` compile (Turbopack) | **PASS** (~3.0 min) |
| Next TypeScript check | **FAIL / OOM** (`FATAL ERROR: heap out of memory`, exit 134) — Phase 1/2 ile aynı pre-existing tsc ölçeği |
| Opportunity + scanner + round-selection lint | temiz |
| Vitest typecheck (transform) | PASS |

BUILD: **PARTIAL** (compile OK, full-repo tsc OOM)

---

## KNOWN REMAINING RISKS

1. **Live all-market coverage yok** — Phase 2 PARTIAL. Engine boş snapshot’ta candidate üretemez; production’da WS daemon ayakta değilse ranked=0.
2. **Window-dependent feature’lar** (breakout distance, retracement, compression) `scan(snapshots)` unit path’te `window=[]`. Daemon ingest path ring buffer kullanır.
3. **Scanner worker hâlâ `runScannerPipeline` + opsiyonel AI** çalıştırır — opportunity top-K enrichment. Global opportunity scan AI çağırmaz; worker tick ayrı. `SCANNER_WORKER_WITH_AI=true` ise enrichment AI’si devam eder (execution candidate generator değil).
4. **Discovery batch** scanner pipeline içinde supporting olarak duruyor; canonical ranking’e giremez ama CPU/AI maliyeti kalabilir.
5. **Pump worker hâlâ process’te start edilebilir** (SUPPORTING). Execution’a candidate basamaz; shadow telemetry üretebilir.
6. **Milestone persist Postgres değil** — process restart identity kaybeder. Phase 5 MFE için process-local journal yeterli değil.
7. **Trade frequency** all-market light stream’de yok; Phase 4 aggTrade.
8. **Threshold’lar** henüz live-calibrate değil; EARLY flood veya sessizlik riski var.
9. Watchlist `discoverTopGainerSymbols` hâlâ watchlist inşasında; execution authority değil.

---

## PHASE 4 READINESS

**READY (with blockers below)**

Phase 4’ün kullanacağı yüzey hazır:

- Canonical candidate stream (`getRanked()`, `toScannerCandidates()`)
- `firstDetectedAt` / `firstDetectionPrice` / score breakdown / reason codes
- HOT/PROMOTED → `aggTrade` + `bookTicker` deep subscription
- Microstructure final score **bilinçli olarak yok**

---

## PHASE 4 BLOCKERS

1. Live MarketDataDaemon WS coverage kanıtı (Phase 2 residual) — deep streams ancak live WS ile dolar.
2. Process-local journal’ın Phase 5 MFE için disk/Redis persist’e ihtiyacı olabilir.
3. `kline_1m` / `depth` deep kinds Phase 3’te açılmıyor; Phase 4 REST-free bootstrap veya WS-only kline kullanmalı.
4. Full-repo `tsc` OOM — deploy pipeline’ı etkilemeye devam eder.

---

## PHASE 1 / 2 VERIFICATION (pre-change)

Raporlar okundu. Bu phase REST-first’e geri dönmedi.

| Şart | Durum |
|---|---|
| canonical trading pipeline = 1 | PASS (Phase 1 tests) |
| canonical market-data owner = 1 | PASS (`market-data-daemon`) |
| all-market realtime ticker | kod hazır; live coverage PARTIAL |
| scanner hot-path per-symbol REST yok | PASS (Phase 2 tests) |
| RAM/shared realtime state | PASS |
| Redis shared state | PASS (kod) |
| dynamic deep-subscription | PASS; Opportunity Engine bağlı |
| stale-data detection | PASS; opportunity STALE reject |
| scanner market-state network’suz | PASS |

Kritik Phase 1/2 blocker için ekstra düzeltme gerekmedi.

---

## DONE KRİTERLERİ

- [x] Tek canonical Opportunity Engine
- [x] Universe lightweight evaluation (snapshot; live 700+ WS kanıtı yok)
- [x] Global scan REST yok
- [x] Global scan AI yok
- [x] EARLY / STEADY / MOMENTUM / CONTINUATION
- [x] Velocity, acceleration, volume acceleration, RVOL
- [x] BTC/market RS, breakout proximity, compression/expansion
- [x] Consistency, retracement (window varsa)
- [x] Exhaustion signed penalty
- [x] Directional scoring
- [x] Liquidity + universe filter
- [x] Dedupe + lifecycle + hysteresis + decay
- [x] Global + lane ranking
- [x] Dynamic deep-sub trigger
- [x] Eski pump/top-gainer execution authority değil
- [x] Telemetry + firstDetectedAt/Price
- [x] Relevant tests PASS
- [ ] Typecheck PASS (tsc OOM)
- [ ] Production build PASS (compile OK, tsc OOM)
- [ ] Shadow runtime hours PASS (yapılmadı)
- [x] Gerçek fon kullanılmadı
- [x] Phase 4 candidate stream hazır (deep kinds kısıtlı)

**Kodun bulunması DONE değildir.** Live stream üzerinde saatlik shadow + coverage kanıtı olmadan Phase 3 tamamlanmış sayılmaz.
