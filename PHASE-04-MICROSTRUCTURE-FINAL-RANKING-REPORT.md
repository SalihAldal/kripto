# PHASE-04-MICROSTRUCTURE-FINAL-RANKING-REPORT

STATUS: **PARTIAL**

Canonical Microstructure Engine + FinalRanker kuruldu. HOT/PROMOTED opportunity candidate’ları aggTrade/bookTicker ile signed order-flow doğrulamasından geçiyor. AI advisory (max ±8, timeout=0, hard veto yok). TDI shadow. Unit/integration testler PASS. Live Binance deep-stream shadow ve full-repo `tsc` bu oturumda yine tamamlanmadı (Phase 2/3 ile aynı kısıt; canlı fon yok).

Gerçek fon kullanılmadı.

---

## CANONICAL FLOW

```
ALL MARKET WS (!miniTicker@arr)
  → OpportunityEngine.scan()
       → HOT / PROMOTED
            → subscribeDeep(aggTrade, bookTicker)
  → MicrostructureEngine.evaluate()     // yalnız HOT/PROMOTED, REST polling yok
       → flow / book / exhaustion / liquidity
  → FinalRanker                          // opportunity + micro + liquidity + AI±8
       → MICRO_CONFIRMED / EXECUTION_READY
  → getBestFastEntry                     // yalnız micro-confirmed pool
  → canonical-risk-decision
  → execution-engine-v2
```

Tek deep-analysis owner: `microstructure-engine`  
Tek final ranking owner: `final-ranker`

Bu katman ikinci bir scanner değildir. Universe taramaz.

---

## ACTIVE DEEP STREAMS

| Stream | Phase 4 kullanımı |
|---|---|
| `aggTrade` | Canonical flow (taker buy/sell, rate, size) |
| `bookTicker` | Spread, top imbalance, ask/bid persistence |
| `depth` | Local book varsa bps-band imbalance. Evaluate içinde REST poll yok. Initial depth snapshot yalnız daemon recovery path’inde (Phase 2 kuralı) |
| `kline_1m` | Phase 4 hot-path’te açılmaz (REST bootstrap yasağı) |

Top-K: `MICRO_DEEP_LIMIT` default 24.

---

## MICRO FEATURES

Flow: `takerBuy/SellVolume` 1s/5s/15s/60s, `netTakerFlow`, `takerBuyRatio`, `flowImbalance` 3s/5s/15s/60s, `buy/sell/netFlowAcceleration`

Activity: `tradeRate` 1s/5s/15s, `tradeRateAcceleration` (tiny-spam dampened), `avgTradeNotional` 5s/15s/60s, relative `largeBuy/Sell` (p90 threshold, sabit $50k yok)

Book: `spreadBps`, `topBookImbalance`, `depthImbalance` 5/10/25 bps, `askDepletionRate`, `askReloadRate`, `bidPersistence`, `bidWithdrawal`, spoof-like pulse flags (iddia değil, penalty)

Impact: `priceChangePerBuyNotional`, `sellAbsorption`, `buyAbsorption`

Cross-layer: `crossLayerConfirmation`, `priceFlow/Volume/BookDivergence`, `microExhaustion`, `breakoutHoldTime`, `postBreakoutFlow`, `failedBreakout`, `expectedSlippageBps`, `depthToIntendedSize`

Freshness: `lastAggTradeAt`, `lastBookTickerAt`, `lastDepthAt`

---

## FLOW MODEL

Binance `m` (buyerMaker): `true` → taker SELL, `false` → taker BUY.

```
flowImbalance = (buy - sell) / (buy + sell)   ∈ [-1, +1]
tiny volume (< $1 total) → 0
```

78% BUY ve 22% BUY aynı score alamaz. Net sell + negative imbalance LONG bias **yok** (`buyBias` yalnız `flowImbalance5s > 0`).

Kanıt: unit “strong taker sell does not raise LONG micro score”.

---

## BOOK MODEL

- Spread quality: `signedScore(18 - spreadBps, 18)` — 2 bps iyi, 180 bps ceza
- Top imbalance ağırlığı düşük (spoof)
- Depth bands: mid ±5/10/25 bps notional, bid ve ask ayrı, `Math.abs` yok
- Ask depletion: book history first→last ask notional düşüşü
- Ask reload: tersi; continuation score düşer
- Bid withdrawal: warning `MICRO_BID_WITHDRAWAL`

Extreme spread ≥ 400 bps → hard reject `MICRO_EXTREME_SPREAD`. 80–400 bps score penalty.

---

## EXHAUSTION

`microExhaustion` toplanır (cap 1):

- velocity down (Phase 3 acceleration)
- buy ratio drop
- trade rate deceleration
- ask reload
- price/flow divergence
- retracement from local high

Breakdown `exhaustion` ve `divergence` **signed negative**. Score artıramaz.

Failed breakout: local high’a ulaşıldı, sonra retrace + sell flow.

---

## LANE-SPECIFIC BEHAVIOR

| Lane | Yüksek ağırlık |
|---|---|
| EARLY | buyFlowAcceleration 0.18, tradeAcceleration 0.14, askDepletion 0.14 |
| STEADY | bidSupport 0.16, spreadQuality 0.16 |
| MOMENTUM | takerBuyRatio 0.16, breakoutAcceptance 0.14, exhaustion 0.12 |
| CONTINUATION | exhaustion 0.16, breakoutAcceptance 0.14, divergence 0.12 |

---

## FINAL SCORE

```
final = opportunity * 0.42
      + micro       * 0.38
      + liquidity   * 0.20
      + aiModifier     ∈ [-8, +8]
smoothed = 0.65 * prev + 0.35 * final
```

Ayrı output: `executionQuality` (spread + slippage vs intended notional, default $50).

States: `WARMING` → `MICRO_CONFIRMED` (≥62 micro, ≥ drop) → `EXECUTION_READY` (final ≥70, executionQuality ≥58, spread < 80 bps).

Warmup: `MICRO_WARMUP_MS` 400ms **veya** `MICRO_WARMUP_TRADES` 8.

Hard reject (az, data-quality): stale trades, crossed/invalid book, zero liquidity, extreme spread. Exhaustion/AI caution **hard reject değil**.

---

## AI

| | Önce | Şimdi |
|---|---|---|
| Rol | EXECUTION_AI_GATE_POLICY=ADVISORY (Phase 1) | Ranking **modifier only** |
| Hard veto | 0 | 0 |
| Timeout | fail-open riski vardı | **fail-neutral, modifier=0**, pipeline devam |
| NO_OPINION / invalid | — | modifier=0, `AI_INVALID_RESPONSE` |
| Max etki | — | ±8 (`MICRO_AI_MAX_MODIFIER`) |
| Context | — | compact JSON (symbol, lane, scores, windows, flow, spread). Raw trades/book yok |
| Çağrı | scanner enrichment hâlâ ayrı | Micro evaluate AI beklemez. `applyAi()` sonraki tick |

CAUTION tek başına HARD_REJECT yapamaz (unit PASS).

---

## TDI

`TDI_RUNTIME_ROLE` default SHADOW. `tdiShadow.canReject = false`. REJECT/VETO string’i telemetry’de kalır, execution authority değil (unit PASS).

---

## RANKING

- Global rank `smoothedScore` desc
- Leader hysteresis: yeni 1. ile eski 1. farkı < 2.2 ise flip yok
- TTL 8 dk; HOT listesinden düşünce session EXPIRED, `microstructure-engine` deep sub release
- Duplicate symbol: tek `candidateId` session
- Journal: son 800 final snapshot (rejected/expired silinmez) — Phase 5 MFE için process-local

`getBestFastEntry` artık ham opportunity pool değil; yalnız `MICRO_CONFIRMED` / `EXECUTION_READY`.

---

## PERFORMANCE

| | |
|---|---|
| HOT → micro ready p50/p95 (live) | Ölçülmedi |
| Unit evaluatePrepared | milisaniye |
| Warm stream hedefi | < 1s (kod: 400ms veya 8 trade) |
| New sub p95 < 3s | Live kanıt yok |
| AI wait | 0 — timeout pipeline’ı durdurmaz |

---

## RESOURCE

Deep limit 24. Overload: en düşük rank `syncSubscriptions` keep set’inden çıkar, unsubscribe.

Live CPU/memory/event-loop: ölçülmedi. Trade buffer deep slot 2048 (universe-wide ticker slot trade tutmaz).

---

## NETWORK

Evaluate sırasında `countHotPathPublicMarketRestCalls()` artarsa throw `MICROSTRUCTURE_HOT_PATH_NETWORK_FORBIDDEN`.

Unit: REST = 0. Daemon ingest → features REST = 0.

recentTrades/depth/ticker/kline **polling yok**.

---

## SHADOW RESULTS

Live saatlik shadow **çalıştırılmadı**.

Synthetic:

| | |
|---|---|
| HOT input | evaluate yalnız HOT/PROMOTED |
| Healthy buy-flow | GOODUSDT rank 1 |
| Failed pump dump | DUMPUSDT daha düşük final (opportunity 92 olsa bile) |
| AI timeout | modifier 0, ranked üretilir |
| Expired | ranked 0, subs release |

Telemetry: `GET /api/microstructure/status`

---

## REPLAY RESULTS

Historical Binance dump bağlanmadı.

Sentetik:

- Successful mover: sürekli taker BUY + tight spread → yüksek micro + confirmation
- Failed pump: kısa BUY spike → SELL dump + wide spread → rank düşer
- Detection timing: warmup 0–400ms (dakika değil)

---

## TESTS

```
npx vitest run tests/phase04-microstructure-engine.test.ts tests/phase03-opportunity-engine.test.ts tests/phase01-core-reset.test.ts tests/phase02-realtime-market-spine.test.ts tests/auto-round-engine.integration.test.ts
```

**PASS** — Phase 4: 33/33. Phase 1+3: 76. Phase 2 + auto-round: PASS.

Kapsanan maddeler: taker buy/sell direction, imbalance, flow/trade acceleration, tiny-spam, relative large trade, spread, depth sign, ask depletion/reload, bid withdrawal, divergence, failed/accepted breakout, exhaustion, AI timeout/NO_OPINION/no hard reject, TDI no hard reject, stale not execution-ready, deduped subs, expiration release, rank hysteresis, deterministic combine, no abs-flip, no REST, integration AI timeout, failed-pump replay, compact AI context.

---

## BUILD

| | |
|---|---|
| Vitest transform/typecheck | PASS |
| `next build` full tsc | Bilinen OOM (Phase 3 PARTIAL) — bu oturumda tekrar koşulmadı |
| Lint (touched files) | temiz |

BUILD: **PARTIAL**

---

## KNOWN REMAINING RISKS

1. Live WS coverage hâlâ Phase 2 residual — deep aggTrade ısınmazsa her candidate WARMING/stale kalır, execution aday sayısı 0 olur.
2. Depth full book Phase 4 evaluate’de REST ile çekilmez; imbalance çoğu zaman top-of-book + 2 seviye.
3. Process-local journal restart’ta kaybolur (Phase 5 persist blocker).
4. Scanner worker `runScannerPipeline` AI enrichment’ı ayrı çalışmaya devam edebilir; **final ranking AI beklemez**.
5. Threshold’lar live-calibrate değil.
6. `getBestFastEntry` micro-confirmed yoksa null — warmup sırasında round retry’ye bağlı.

---

## PHASE 5 READINESS

**READY (with blockers)**

Phase 5 için duran state:

- `candidateId`, firstDetectedAt/Price, opportunity+micro+final scores, breakdowns, reason codes, rank, state, journal (expired dahil)

---

## PHASE 5 BLOCKERS

1. Live shadow + HOT→micro ready latency p50/p95
2. Journal’ın disk/Redis persist’i (process restart)
3. Full-repo tsc/build OOM
4. Gerçek historical mover replay (opsiyonel ama lead-time iddiası için gerekli)

---

## PHASE 1–3 VERIFICATION

Raporlar okundu. REST-first’e dönüş yok. AI/TDI hard veto 0. Opportunity canonical. Minimum düzeltme: bozulmuş `OpportunityScanResult` tipi restore edildi; trade buffer 2048 (deep candidate 60s window).

**Kodun bulunması DONE değildir.** Live/replay üzerinde Opportunity → Microstructure → Final Rank zincirinin saniyeler içinde çalıştığı kanıtlanmadan Phase 4 tamamlanmış sayılmaz.
