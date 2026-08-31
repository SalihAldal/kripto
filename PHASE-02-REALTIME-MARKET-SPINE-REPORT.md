# PHASE-02-REALTIME-MARKET-SPINE-REPORT

STATUS: **PARTIAL**

WebSocket-first market-data omurgası kuruldu. Scanner hot-path artık RAM/shared state okuyor; public market REST polling bu path’ten çıkarıldı. Bu, instrumented unit/runtime assertion testleriyle kanıtlandı (`countHotPathPublicMarketRestCalls() === 0`).

Live Binance all-market coverage, 429 load test ve paper/shadow worker’ın gerçek borsaya bağlanması bu oturumda çalıştırılmadı (canlı fon yok; harici WS oturumu açılmadı). Bu yüzden DONE işaretlenmedi.

Gerçek fon kullanılmadı.

---

## BEFORE ARCHITECTURE

REST-first:

```
Scanner cycle
  → marketDataGateway
    → MarketDataOrchestrator cache
      → BinanceProvider.getTicker / listTickers24h / getKlines / getOrderBook / getRecentTrades
        → GET /api/v3/ticker/price + /api/v3/ticker/24hr  (getTicker)
        → GET /api/v3/ticker/24hr (all)
        → GET /api/v3/klines
        → GET /api/v3/depth
        → GET /api/v3/trades
```

`getTicker(symbol)` production’da `prices()` + `dailyStats(symbol)` (veya TR eşdeğeri iki public REST) yapıyordu. Scanner her cycle’da onlarca/yüzlerce symbol için bunu tekrarlıyordu. 429’un kök nedeni buydu.

Process-local `weightWindow[]` limiter canonical’dı. HIGH/CRITICAL Phase 1’de budget’ı bypass etmiyordu ama REST polling durmuyordu.

Mevcut `trading-core` WebSocket (`binance-market-stream.ts`) per-symbol `@ticker` açıyordu, production freeze’de kapalıydı, scanner owner değildi.

---

## AFTER ARCHITECTURE

```
BINANCE SPOT WS
  !miniTicker@arr          (LEVEL 1 — all-market light)
  combined deep streams    (LEVEL 2 — candidate aggTrade / bookTicker / kline_1m / depth)
        ↓
MarketDataDaemon  (tek owner)
  normalize → RAM MarketStateStore (ring buffer + snapshot)
  Redis HASH md:snap  (batched, tick spam yok)
        ↓
MarketDataGateway  (hot-path network yok)
        ↓
Scanner / opportunity consumers
```

REST yalnızca:

- universe `exchangeInfo` (startup / uzun TTL)
- candidate deep seed (`klines` / depth snapshot) — explicit recovery
- `options.recovery === true`

Hot-path’te data yoksa REST otomatik çağrılmaz → `DATA_NOT_READY`.

---

## MARKET DATA OWNER

| | |
|---|---|
| Process | background worker (`APP_ROLE=worker`) |
| Service | `MarketDataDaemon` |
| Worker id | `market-data-daemon` (CRITICAL) |
| Ownership | `MARKET_DATA` |
| Public market WS opener | **1** |

CRITICAL workers artık:

1. `market-data-daemon`
2. `scanner`
3. `execution-engine-v2`

Scanner kendi Binance WebSocket’ini açmaz.

---

## ACTIVE STREAMS

| Stream | Level | Kullanım |
|---|---|---|
| `!miniTicker@arr` | L1 all-market | symbol, lastPrice, open, high/low, base/quote volume, eventTime |
| `{symbol}@aggTrade` | L2 candidate | trade flow, taker direction |
| `{symbol}@bookTicker` | L2 candidate | best bid/ask, spread bps |
| `{symbol}@kline_1m` | L2 candidate | 1m candle incremental |
| `{symbol}@depth@100ms` | L2 optional | local book + gap/resync |

WS base: `wss://stream.binance.com:9443` (`BINANCE_WS_BASE` ile override). TR platform’da public market stream global Binance WS üzerinden (REST hâlâ TR/global fallback).

---

## UNIVERSE

Startup/kontrollü refresh: `exchangeInfo` → SPOT `TRADING` + quote `USDT` (TR’de `TRY,USDT`) − leveraged token − stable base.

Redis key: `md:universe` (TTL ~6h).

**Live coverage (bu oturum):** ölçülmedi (gerçek Binance WS bağlanmadı).

Unit: 700 symbol ingest, ring bounded, snapshot read < 50ms.

---

## DEEP SUBSCRIPTIONS

`DynamicSubscriptionManager`:

- ref-count + owner (`early` / `momentum` / `scanner-context` / `scanner-ai`)
- duplicate SUBSCRIBE yok (0→1 geçişinde gönderilir)
- bir owner ayrılınca diğerinin stream’i kapanmaz
- reconnect sonrası `restoreDeepSubscriptions()`
- Binance 1024 stream/connection limiti kontrol edilir
- subscribe komutları ~5 msg/s kuyruğu ile gönderilir

---

## REST USAGE

Hâlâ REST (recovery/bootstrap only):

| Call | When | File |
|---|---|---|
| `exchangeInfo` | daemon universe refresh | `market-data-daemon.ts` `refreshUniverse` |
| `klines` 1m seed | candidate deep subscribe | `bootstrapKlines` |
| `depth` snapshot | book gap/resync | `bootstrapDepth` + `OrderBookAssembler` |
| orchestrator methods | `options.recovery === true` | `market-data-orchestrator.service.ts` |
| account/order REST | execution, not scanner | `binance.provider.ts` signed endpoints |

`getTicker` / `listTickers24h` / per-symbol klines/depth/trades **scanner hot-path’te yok**.

---

## REST HOT-PATH AUDIT

Scanner cycle call chain:

```
scanner-worker.tick
  → runScannerPipeline
    → discoverTopGainerSymbols → marketDataGateway.listTickers24h()  // RAM
    → buildMarketContext(lite:true) → marketDataGateway.fetchContextBundle()  // RAM
    → formatAIRequest → gateway getKlines/getOrderBook/getRecentTrades  // RAM or DATA_NOT_READY, no REST
```

Instrumented test (`tests/phase02-realtime-market-spine.test.ts`):

- `exchangeMocks.getTicker/getKlines/getOrderBook/getRecentTrades/listTickers24h` throw if called
- `countHotPathPublicMarketRestCalls() === 0`

**Kalan REST (scanner dışı, production freeze’de SUPPORTING/LEGACY):**

- `src/server/ai/analysis-orchestrator.ts` — SHADOW_ONLY, hâlâ provider REST (production scanner path değil)
- `src/server/execution/position-monitor.service.ts` — execution, ticker REST (Phase 2 scope dışı; mark-to-market)
- `binance.provider.ts` `getTicker` — legacy function duruyor, scanner onu çağırmıyor

---

## RATE LIMIT

| | Before (mimari) | After |
|---|---|---|
| Scanner public market req/min | per-symbol ticker+klines+depth+trades (yüzlerce) | **0** (hot-path) |
| Request weight/min (scan) | `getTicker` ≈ 2+ endpoint / symbol | **0** scan; bootstrap `exchangeInfo` seyrek |
| Limiter | process-local `weightWindow[]` | Redis-backed `DistributedRestLimiter` (`binance:rest:weight:{minute}`) |
| Actual weight | estimated only | `X-MBX-USED-WEIGHT-1M` reconcile |
| 429 | Retry-After parse + jitter (Phase 1) | shared backoff; Retry-After header + message; no immediate retry |
| 418 | IP ban parse (`ip banned until`) | shared `ban_until`, circuit, recovery spam yok |
| HIGH/CRITICAL bypass | Phase 1’de kapatıldı | distributed limiter priority ignore; test: bypass edemiyor |

Bu oturumda canlı 429/418 count = n/a (Binance’e load test yok).

---

## WEBSOCKET

Lifecycle: `CONNECTING | CONNECTED | DEGRADED | RECONNECTING | STALE | FAILED`

- exponential backoff + jitter
- max reconnect burst → FAILED
- stale: mesaj yoksa `STALE`
- planned reconnect ~23h (Binance 24h limit)
- ping/pong: runtime WebSocket frame handling (Node global WS)

Uptime / reconnect / event rate: telemetry `GET /api/market-data/spine` ve health payload `marketDataSpine`.

Live values: n/a this session.

---

## REDIS

Canonical source: **daemon RAM**.

Redis rolü: cross-process snapshot / recovery.

| Key | Role |
|---|---|
| `md:snap` HASH | compact latest `{s,p,o,c,q,v,h,l,e,t}` batched ~400ms |
| `md:universe` | tradeable symbol list |
| `md:telemetry` | last telemetry blob |
| `md:tick` pub/sub | flush count, full JSON spam yok |
| `binance:rest:*` | shared weight, actual weight, backoff, ban, single-flight locks |

Redis yoksa in-process `MemoryKv` (degraded, tek process).

---

## MEMORY

- Per-symbol ring capacity **1024** (1s…15m pencereleri için yeterli)
- Trades cap 256, klines 180
- 700 symbol × 40 tick test: `maxRingSize <= 1024`, estimated bytes < 80MB, snapshot < 50ms

---

## RESILIENCE TESTS

| Scenario | Result |
|---|---|
| 1–2 WS disconnect/reconnect + restore | unit: restoreDeepSubscriptions re-SUBSCRIBE |
| 3–4 Redis down/up | daemon MemoryKv fallback; flush errors queued |
| 5 stale symbol | `isFresh=false`, gateway `DATA_STALE` |
| 6 kline gap | `hasKlineGap` mark |
| 7 order-book gap | `OrderBookAssembler` GAP → snapshot resync |
| 8 duplicate WS subscribe | ref-count, second add = [] |
| 9 multi-owner same symbol | unsubscribe one keeps stream |
| 10 candidate unsubscribe | ref 2→1 no UNSUBSCRIBE of remaining |
| 11 process restart | universe refresh + WS reconnect (code path) |
| 12–13 429 + Retry-After | limiter BACKOFF, retryAt honored |
| 14 418 ban | IP_BAN circuit, subsequent canSpend fail |
| 15 WS burst | latest-ticker ingest, no await Redis/DB in loop |

Uncontrolled request storm: tests throw if REST called on hot-path.

---

## PERFORMANCE

| Metric | Target | Measured (unit) |
|---|---|---|
| ticker → RAM ingest p95 | < 100ms | ingest path synchronous, samples in `ingestionP95Ms` |
| global snapshot read | < 50ms | 700 symbol snapshot < 50ms in test |
| deep-state read | < 50ms | in-memory map |

Event-loop: ingest does not `await` Redis/DB. Redis flush 400ms interval.

---

## TESTS

```
npx vitest run tests/phase02-realtime-market-spine.test.ts tests/phase01-core-reset.test.ts tests/market-data-orchestrator.test.ts
```

| Suite | Result |
|---|---|
| `tests/phase02-realtime-market-spine.test.ts` | **20/20 PASS** |
| `tests/phase01-core-reset.test.ts` | **18/18 PASS** |
| `tests/market-data-orchestrator.test.ts` | **5/5 PASS** |

Covered: normalize ticker, state update, stale, bounded ring, scanner read no network, no duplicate WS sub, reconnect restore, aggTrade direction, bookTicker spread, Redis snapshot, distributed limiter, no high-priority bypass, Retry-After, 418 circuit, REST single-flight, hot-path REST=0, 700-symbol memory.

---

## BUILD

| Command | Result |
|---|---|
| `npx tsc --noEmit` (Phase 2 files filtered) | Phase 2 path’lerinde eşleşen TS error yok. Repo genelinde önceden var olan `scripts/` / `brainos-lab` hataları duruyor. |
| `node node_modules/next/dist/bin/next build` | **Compile succeeded** (~89s). TypeScript phase **OOM** (`FATAL ERROR: heap out of memory`, exit 134). Pre-existing `npm run build` `NODE_OPTIONS --r=` hatası da duruyor (`node -r ./scripts/load-dotenv.cjs`). |

BUILD: **PARTIAL** (compile OK, full `npm run build` script / tsc heap pre-existing).

---

## KNOWN REMAINING RISKS

1. **Live WS coverage doğrulanmadı.** Worker production’da `!miniTicker@arr` bağlanmadan scanner `DATA_NOT_READY` üretir (doğru fail-closed; trade açılmaz).
2. **Binance TR public WS** resmi olarak global stream’e map edildi. TR-only pair’ler global miniTicker’da yoksa coverage düşer; `BINANCE_WS_BASE` ile düzeltilmeli.
3. **Execution / position-monitor** hâlâ REST ticker kullanabilir (scanner değil). 429 riski execution sıklığına bağlı kalır.
4. **AI `analysis-orchestrator`** SHADOW path’te multi-TF REST klines duruyor. Production freeze’de CRITICAL değil.
5. **Kline historical seed** candidate subscribe olunca bir kez REST atar. Aynı anda çok candidate ısınırsa kısa recovery burst olabilir (single-flight + shared limiter).
6. **Redis yokken** limiter process-local’e düşer; multi-process 429 koruması zayıflar.
7. **Full next build tsc OOM** bu phase’in tipi değil; deploy pipeline’ı etkilemeye devam eder.

---

## PHASE 3 READINESS

**READY** (infrastructure)

Phase 3 Opportunity Engine şunları RAM’den okuyabilir:

- `getMarketSnapshot()` — tüm universe, network yok
- `getLatest(symbol)` / `getWindow(symbol, ms)` / rolling `return1s…return5m`, `volumeDelta`
- `getDeepState(symbol)` — aggTrade / bookTicker / 1m kline
- `subscribeDeep` / `unsubscribeDeep` + ref-count
- `isFresh` → risk hard reject için

Phase 3’te yazılmayacak olanlar bu phase’de yok: pump scoring, EARLY/MOMENTUM production algorithm, AI strategy.

---

## PHASE 3 BLOCKERS

Yok (kod). Operasyonel:

1. Worker runtime’da daemon’un Binance WS’e bağlandığını bir paper/shadow oturumunda doğrula (`GET /api/market-data/spine`: `liveSymbols`, `coveragePct`, `wsLightState=CONNECTED`).
2. Universe coverage %’yi gerçek tradeable USDT/TRY setine karşı raporla.

---

## DONE KRİTERLERİ

| Criterion | Status |
|---|---|
| Tek authoritative MarketDataDaemon | **PASS** |
| All-market WS stream kodu | **PASS** (live connect n/a) |
| Tradeable USDT universe filtresi | **PASS** |
| Scanner per-symbol REST polling | **PASS** (test evidence) |
| RAM market state | **PASS** |
| Redis shared snapshot | **PASS** (unit) |
| Bounded ring buffer | **PASS** |
| Dynamic deep subscription + ref-count | **PASS** |
| aggTrade / bookTicker / kline / depth gap | **PASS** |
| Reconnect + restore | **PASS** (unit) |
| Stale detection | **PASS** |
| Redis REST limiter + header weight | **PASS** |
| Retry-After / 418 circuit | **PASS** |
| Typecheck (phase files) | **PASS** |
| Relevant tests | **PASS** |
| Production build | **PARTIAL** |
| Paper/shadow live network | **NOT RUN** |
| Canlı fon | **NOT USED** |
| Phase 3 state hazır | **PASS** |

PHASE 2 **DONE değil** — başarı tanımı “scanner çalışırken Binance public market REST poll = 0” unit/instrumentation ile kanıtlandı; canlı paper/shadow WS coverage henüz ölçülmedi.
