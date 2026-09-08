# KRIPTO Futures / Microstructure Alpha Research Report

## 1. Executive Summary

Fresh dataset **2026-06-15 → 2026-07-15** üzerinde futures funding, basis/premium ve taker-flow proxy (futures kline takerBuy) ile **13** hypothesis test edildi.

- **ALPHA_FOUND:** false
- **VERDICT:** PARTIAL
- **PRODUCTION_READY:** false (research phase)
- **RUN_15H_PAPER:** NO
- **NEXT_PHASE:** EXTERNAL_ALPHA_OR_DIFFERENT_BUSINESS_MODEL

Prior spot/intraday paradigms NO_EDGE — bu phase yeni veri kaynaklarına odaklandı.

## 2. Starting HEAD

`fbf5c721f17cb903517fccc626b7ac7eb07984f4`

## 3. Prior No-Edge Evidence

```text
INTRADAY_MOMENTUM = NO_EDGE
RANKING_V2 = FAIL
DISCOVERY_V2 = FAIL
MULTI_SETUP_INTRADAY = FAIL
ALTERNATIVE_SPOT_PARADIGMS = FAIL (0/7 validation)
```

## 4. Data Availability

| Dataset | Historical | Live | Granularity | Source | Limit |
|---------|:----------:|:----:|-------------|--------|-------|
| fundingRate | YES | YES | 8h | fapi/v1/fundingRate | 1000/page |
| premiumIndexKlines (basis) | YES | YES | 1h | fapi/v1/premiumIndexKlines | paginated |
| futuresKlines + takerBuy | YES | YES | 1h | fapi/v1/klines | paginated |
| openInterestHist | NO | YES | 5m | futures/data/openInterestHist | NOT_AVAILABLE_FROM_CURRENT_PROVIDER (~30d rolling) |
| globalLongShortAccountRatio | NO | YES | 5m | futures/data/globalLongShortAccountRatio | NOT_AVAILABLE_FROM_CURRENT_PROVIDER |
| orderBook depth | NO | YES | snapshot | ws depth / REST | ORDER_BOOK_HISTORICAL_TEST=NOT_AVAILABLE |
| liquidations (allForceOrders) | NO | NO | event | fapi/v1/allForceOrders | NOT_AVAILABLE_FROM_CURRENT_PROVIDER |
| aggTrades (full history) | YES | YES | tick | api/v3/aggTrades | heavy; proxy via futures kline takerBuy |
| markPriceKlines | YES | YES | 1h | fapi/v1/markPriceKlines | paginated |
| indexPriceKlines | YES | YES | 1h | fapi/v1/indexPriceKlines | paginated |

**OI / Long-Short / Liquidations / Order Book:** Target period için historical OI ve LS **NOT_AVAILABLE_FROM_CURRENT_PROVIDER** (~30 gün rolling window). Order book ve liquidation historical test yapılmadı (fake data yok).

## 5. Historical Dataset

{
  "start": "2026-06-15T00:00:00.000Z",
  "end": "2026-07-15T00:00:00.000Z",
  "trainEnd": "2026-06-30T00:00:00.000Z",
  "valEnd": "2026-07-07T12:00:00.000Z",
  "symbols": 10,
  "overlapWithPriorPhases": false
}

Split: TRAIN 50% / VALIDATION 25% / FINAL TEST 25%

## 6. Futures Universe

BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, DOGEUSDT, ADAUSDT, AVAXUSDT, LINKUSDT, SUIUSDT

## 7. Cost Model (1x, realistic)

{
  "takerFeePerSidePct": 0.04,
  "makerFeePerSidePct": 0.02,
  "assumedTakerRoundTripFeePct": 0.08,
  "realisticSlippageRtPct": 0.14,
  "realisticRoundTripPct": 0.22,
  "stressSlippageRtPct": 0.7,
  "stressRoundTripPct": 0.78,
  "leverageBaseline": 1
}

Funding PnL hypothesis hold süresindeki gerçek funding event'lerinden hesaplandı. Leverage = 1x baseline.

## 8. Funding Research

Best: **FUNDING_ACCELERATION_FADE**

## 9. Open Interest Research

Historical OI target window için mevcut değil. OI quadrant analizi: {"status":"NOT_AVAILABLE_FROM_CURRENT_PROVIDER"}

## 10. Funding + OI

Best combo: **FUNDING_BASIS_CONFLUENCE_LONG** (OI data limitation applies)

## 11. Liquidation Flow

ORDER_BOOK_HISTORICAL_TEST=NOT_AVAILABLE — Binance allForceOrders endpoint historical erişim sağlamıyor.

## 12. Order Book Imbalance

Live telemetry mevcut (microstructure-engine) ancak historical depth yok → offline test yapılmadı.

## 13. CVD / Aggressor Flow

Proxy: futures 1h kline `takerBuyQuote/quoteVolume`. Best: **CVD_DIVERGENCE_LONG**

## 14. Basis / Premium

premiumIndexKlines kullanıldı. Best: **BASIS_EXTREME_DISCOUNT_LONG**

## 15. Long-Short Ratio

Historical NOT_AVAILABLE for target period.

## 16. Hypothesis Table

| Alpha | VAL Exp | VAL PF | VAL Net | TEST Exp | TEST PF | TEST Net | Pass |
|-------|--------:|-------:|--------:|---------:|--------:|---------:|------|
| FUNDING_EXTREME_NEGATIVE_LONG | 0 | 0 | 0 | 0 | 0 | 0 | false/false |
| FUNDING_EXTREME_POSITIVE_SHORT | 0 | 0 | 0 | 0 | 0 | 0 | false/false |
| FUNDING_MEAN_REVERSION | 0 | 0 | 0 | 0 | 0 | 0 | false/false |
| FUNDING_ACCELERATION_FADE | 4.0511 | 4.9476 | 24.31 | -0.0125 | 0.9977 | -0.22 | false/false |
| BASIS_EXTREME_DISCOUNT_LONG | 27.1265 | 999 | 54.25 | -2.1478 | 0.4108 | -8.59 | false/false |
| BASIS_EXTREME_PREMIUM_SHORT | 6.3169 | 999 | 6.32 | 0 | 0 | 0 | false/false |
| BASIS_NORMALIZATION_FADE | 0 | 0 | 0 | 0 | 0 | 0 | false/false |
| TAKER_IMBALANCE_LONG | -2.2483 | 0.6165 | -150.63 | -2.2082 | 0.5311 | -150.16 | false/false |
| TAKER_IMBALANCE_SHORT | -3.7598 | 0.4337 | -334.62 | -3.4483 | 0.3681 | -344.83 | false/false |
| CVD_DIVERGENCE_SHORT | -8.4712 | 0.1517 | -135.54 | 5.4419 | 3.4336 | 114.28 | false/false |
| CVD_DIVERGENCE_LONG | 6.9898 | 3.1606 | 153.78 | -3.3262 | 0.3671 | -39.91 | true/false |
| FUNDING_BASIS_CONFLUENCE_LONG | 0 | 0 | 0 | 2.6739 | 999 | 2.67 | false/false |
| FUNDING_BASIS_CONFLUENCE_SHORT | 0 | 0 | 0 | 0 | 0 | 0 | false/false |

## 17. Validation Results

Passing: CVD_DIVERGENCE_LONG

## 18. Passing Alphas

- CVD_DIVERGENCE_LONG

## 19. Final Test

No hypothesis passed both validation and final test

## 20. Regime Robustness

{
  "DOWNTREND": {
    "trades": 3,
    "expectancy": 1.7965
  },
  "UPTREND": {
    "trades": 3,
    "expectancy": -0.2745
  }
}

## 21. Cross-Period Robustness

{
  "periodsTested": 0,
  "positivePeriods": 0,
  "details": []
}

## 22. Signal Decay

[
  {
    "horizonHours": 1,
    "note": "screen on best hypothesis if any"
  },
  {
    "horizonHours": 4,
    "note": "screen on best hypothesis if any"
  },
  {
    "horizonHours": 8,
    "note": "screen on best hypothesis if any"
  },
  {
    "horizonHours": 24,
    "note": "screen on best hypothesis if any"
  }
]

## 23. Combined Alpha

Combined multi-signal model **not tested** — no individual alpha passed validation gate.

## 24. 1x Performance

Best final test stats: trades=0, netPnl=0, expectancy=0, PF=0

## 25. Risk / Drawdown

Max DD (best final): 0%

## 26. Futures Architecture Proposal

```text
Futures market data → alpha engine → LONG/SHORT/CASH → risk sizing → leverage cap → futures PAPER execution → funding accounting → liquidation protection → exit
```

REQUIRES_FUTURES_EXECUTION_ARCHITECTURE=true — spot long-only deploy edilemez.

## 27. Paper Validation Proposal

N/A — no alpha to forward validate

## 28. Business Model Decision

Edge yok → alternatif: market intelligence dashboard, signal research platform, AI crypto analytics, alerting system, portfolio risk monitor, scanner SaaS

## 29. Final Verdict

```text
ALPHA_FOUND=false
DO_NOT_CONTINUE_BLIND_TUNING=true
REQUIRES_FUTURES=true
PRODUCTION_READY=false
RUN_15H_PAPER=NO
```

## 30. Next Phase

**EXTERNAL_ALPHA_OR_DIFFERENT_BUSINESS_MODEL**

---
*Generated 2026-09-07T23:35:53.133Z*
