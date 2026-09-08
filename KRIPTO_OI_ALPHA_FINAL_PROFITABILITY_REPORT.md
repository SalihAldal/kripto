# KRIPTO OI Impulse Alpha — Final Profitability Report

## Executive Summary

OI_IMPULSE_LONG treated as **PROMISING_BUT_UNPROVEN**. Deep historical OI gate: **FAIL**.

- Provider: `binance-futures` (credential present: false)
- OI coverage: {"start":"2025-09-08T15:59:53.725Z","end":"2026-09-08T15:59:53.725Z","symbols":10,"oiCoverageDays":{"avgDays":20.79,"minDays":20.79,"perSymbol":[20.791666666666668]}}
- Blocker: **DEEP_HISTORICAL_OI_DATA_REQUIRED**
- 3H Paper: NOT STARTED
- `LIVE_TRADING_ENABLED=false`

## V1 Contract

```json
{
  "alphaId": "OI_IMPULSE_LONG",
  "entry": {
    "priceReturn4hPctMin": 0.3,
    "oiDeltaPctMin": 1.5,
    "fundingRateMax": 0.0003
  },
  "holdHours": 8,
  "side": "LONG",
  "note": "PRICE_UP_OI_UP",
  "exit": "time-based hold",
  "cost": "FUTURES realistic round-trip"
}
```

## Walk-Forward Results

| Alpha | WF Pass | Folds+ | Trades | Exp | PF | Fail reasons |
|-------|---------|--------|--------|-----|-----|--------------|
| OI_IMPULSE_LONG | false | 0/0 | 0 | 0 | 0 | INSUFFICIENT_FOLDS,POSITIVE_FOLD_RATIO,EXPECTANCY,PROFIT_FACTOR,NET_PNL,LOW_SAMPLE |
| OI_IMPULSE_LONG_V2 | false | 0/0 | 0 | 0 | 0 | INSUFFICIENT_FOLDS,POSITIVE_FOLD_RATIO,EXPECTANCY,PROFIT_FACTOR,NET_PNL,LOW_SAMPLE |
| OI_IMPULSE_LONG_V2_FUNDING | false | 0/0 | 0 | 0 | 0 | INSUFFICIENT_FOLDS,POSITIVE_FOLD_RATIO,EXPECTANCY,PROFIT_FACTOR,NET_PNL,LOW_SAMPLE |
| OI_IMPULSE_SHORT_V2 | false | 0/0 | 0 | 0 | 0 | INSUFFICIENT_FOLDS,POSITIVE_FOLD_RATIO,EXPECTANCY,PROFIT_FACTOR,NET_PNL,LOW_SAMPLE |

## OI State Matrix (sample)

[
  {
    "symbol": "BTCUSDT",
    "matrix": [
      {
        "state": "PRICE_DOWN_OI_UP",
        "samples": 30,
        "longExpectancy": 0.24032369227276554,
        "shortExpectancy": -0.24032369227276554,
        "avgMfe": 0.8466135350240189,
        "avgMae": -0.5788531249753055
      },
      {
        "state": "PRICE_UP_OI_UP",
        "samples": 32,
        "longExpectancy": 0.09993985019254566,
        "shortExpectancy": -0.09993985019254566,
        "avgMfe": 1.1128069934430438,
        "avgMae": -1.0548816689526213
      },
      {
        "state": "PRICE_UP_OI_DOWN",
        "samples": 45,
        "longExpectancy": 0.5254143823834945,
        "shortExpectancy": -0.5254143823834945,
        "avgMfe": 1.4251362004653265,
        "avgMae": -0.8512554408033026
      },
      {
        "state": "PRICE_DOWN_OI_DOWN",
        "samples": 33,
        "longExpectancy": 0.22842558954759998,
        "shortExpectancy": -0.22842558954759998,
        "avgMfe": 0.9935241642904932,
        "avgMae": -0.7478499072730108
      }
    ]
  },
  {
    "symbol": "ETHUSDT",
    "matrix": [
      {
        "state": "PRICE_DOWN_OI_DOWN",
        "samples": 36,
        "longExpectancy": 0.33604603481873796,
        "shortExpectancy": -0.33604603481873796,
        "avgMfe": 1.3627471949383796,
        "avgMae": -1.0596521181331586
      },
      {
        "state": "PRICE_UP_OI_DOWN",
        "samples": 29,
        "longExpectancy": 0.10121580245735179,
        "shortExpectancy": -0.10121580245735179,
        "avgMfe": 1.163765174188113,
        "avgMae": -0.9483617752203082
      },
      {
        "state": "PRICE_DOWN_OI_UP",
        "samples": 23,
        "longExpectancy": 0.11586268652658614,
        "shortExpectancy": -0.11586268652658614,
        "avgMfe": 0.9165715215175014,
        "avgMae": -0.6746652476880312
      },
      {
        "state": "PRICE_UP_OI_UP",
        "samples": 49,
        "longExpectancy": 0.6930809349579656,
        "shortExpectancy": -0.6930809349579656,
        "avgMfe": 2.0629567243406193,
        "avgMae": -1.3303678651905317
      }
    ]
  },
  {
    "symbol": "SOLUSDT",
    "matrix": [
      {
        "state": "PRICE_DOWN_OI_DOWN",
        "samples": 41,
        "longExpectancy": 0.5443184727123541,
        "shortExpectancy": -0.5443184727123541,
        "avgMfe": 1.5338384298244732,
        "avgMae": -1.0189933067421082
      },
      {
        "state": "PRICE_UP_OI_DOWN",
        "samples": 46,
        "longExpectancy": 0.18161694304988069,
        "shortExpectancy": -0.18161694304988069,
        "avgMfe": 1.8426593681016181,
        "avgMae": -1.6154396695130284
      },
      {
        "state": "PRICE_DOWN_OI_UP",
        "samples": 28,
        "longExpectancy": 0.4377841321707338,
        "shortExpectancy": -0.4377841321707338,
        "avgMfe": 1.8774365200307517,
        "avgMae": -1.276440025837433
      },
      {
        "state": "PRICE_UP_OI_UP",
        "samples": 38,
        "longExpectancy": 0.5924538316334754,
        "shortExpectancy": -0.5924538316334754,
        "avgMfe": 2.2953788364151717,
        "avgMae": -1.6276910427913691
      }
    ]
  }
]

## Required Deep Data (if blocked)

{
  "directory": "artifacts/deep-oi-data/",
  "format": "JSON per symbol",
  "fields": [
    "symbol",
    "bars[]",
    "funding[]",
    "basis[]",
    "openInterest[{timestamp,openInterest}]",
    "aggTrades?(optional)"
  ],
  "minOiDays": 120,
  "providers": [
    "TARDIS_API_KEY",
    "COINALYZE_API_KEY",
    "COINAPI_KEY",
    "DEEP_OI_DATA_DIR file import"
  ]
}

## Verdict

- DEEP_DATA_GATE: FAIL
- OI Program: BLOCKED_NO_DEEP_DATA
- TRADING_PROGRAM: CLOSED

## FINAL FORMAT

```text
Starting HEAD: 4c38c29
Final HEAD: 6fd9779
Commits: cc8a6a5, 6fd9779
Push: origin/main synced

Historical provider: binance-futures (fallback; no TARDIS/COINALYZE/COINAPI credentials)
Dataset: Binance public futures API (30d window diagnostic replay)
Days: 20.79 (OI min) — DEEP_DATA_GATE=FAIL (< 120d required)
Symbols: BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, DOGEUSDT, ADAUSDT, AVAXUSDT, LINKUSDT, SUIUSDT

OI coverage: ~21 days (Binance openInterestHist limit)
Funding coverage: available on 30d window
Basis coverage: available on 30d window
AggTrade coverage: ~2 days (Binance limit) — UNAVAILABLE for deep WF
Liquidation coverage: UNAVAILABLE
OrderBook coverage: UNAVAILABLE

OI Long V2: NOT VALIDATED (blocked by deep data gate)
OI Short V2: NOT VALIDATED (blocked by deep data gate)

WF folds: 0 (requires >=120d OI for 45/15/15 with >=6 folds)
Positive: 0
Negative: 0
WF trades: 0
WF net PnL: 0
WF expectancy: 0
WF PF: 0

Top fold concentration: N/A (no folds)
Top day concentration: N/A
Top symbol concentration: N/A

Fresh trades: NOT RUN
Fresh net PnL: NOT RUN
Fresh expectancy: NOT RUN
Fresh PF: NOT RUN

Robustness periods: NOT RUN
Positive: N/A
Negative: N/A

BEST_ALPHA: OI_IMPULSE_LONG (prior research: PROMISING_BUT_UNPROVEN; 62 trades, exp +8.28, PF 2.31 on ~30d with 99.99% fold concentration)

Cost sensitivity: NOT RUN
Holding horizon: NOT RUN

AI overlay: DISABLED (systematic gates not passed)

Smoke started: false
Smoke PASS: false

3H PAPER STARTED: false
Campaign: N/A
Runtime: N/A
Completed: N/A

LONG: N/A
SHORT: N/A
CASH: N/A

Orders: 0
Fills: 0
Trades: 0
Wins: 0
Losses: 0

Price PnL: 0
Funding PnL: 0
Fees: 0
Slippage: 0
Net PnL: 0

Expectancy: N/A
PF: N/A
Max Drawdown: N/A

HISTORICAL_EDGE_VERDICT: FAIL (DEEP_DATA_GATE)
PAPER_FORWARD_VERDICT: NOT_STARTED
PROFITABILITY_VERDICT: BLOCKED

LIVE_TRADING_ENABLED: false
NEXT_PHASE: PROVIDE_DEEP_OI_DATA (TARDIS_API_KEY / COINALYZE_API_KEY / COINAPI_KEY or artifacts/deep-oi-data/ JSON import >=120d)

Report: KRIPTO_OI_ALPHA_FINAL_PROFITABILITY_REPORT.md
JSON: kripto-oi-alpha-final-profitability-result.json
Artifact: artifacts/oi-alpha-final/
Git status: see post-commit
```

## BLOCKER

**BLOCKER=DEEP_HISTORICAL_OI_DATA_REQUIRED**

Binance public API yalnızca ~21 günlük OI history sağlıyor. Walk-forward (45/15/15, min 6 fold) ve fresh unseen (30–60d) için **>=120 gün gerçek OI** şart.

### Gerekli veri şeması

`artifacts/deep-oi-data/<SYMBOL>.json`:

```json
{
  "symbol": "BTCUSDT",
  "bars": [{ "openTime": 0, "closeTime": 0, "open": 0, "high": 0, "low": 0, "close": 0, "volume": 0, "quoteVolume": 0, "takerBuyQuote": 0 }],
  "funding": [{ "fundingTime": 0, "fundingRate": 0 }],
  "basis": [{ "closeTime": 0, "premium": 0 }],
  "openInterest": [{ "timestamp": 0, "openInterest": 0 }],
  "aggTrades": []
}
```

Alternatif: `.env` içine `TARDIS_API_KEY`, `COINALYZE_API_KEY` veya `COINAPI_KEY` ekleyin.

---
*Generated 2026-09-08T16:02:17.165Z*
