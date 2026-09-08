# KRIPTO AI Zero-BUY Calibration Report

## 1. Executive Summary

Production AI path shows **0 final BUY** on 50 real consensus analyses despite **13 hybrid BUY** signals. Root cause is **post-hybrid master adjudication + hybrid preservation threshold (65%)**, not provider failure.

- **RUN_15H_PAPER:** NO
- **CALIBRATION_APPLIED:** false (evidence does not justify threshold relaxation)
- **Scanner TP-first rate (284 windows):** 22.54%

## 2. Starting HEAD

`fbf5c721f17cb903517fccc626b7ac7eb07984f4`

## 3. Historical replay baseline

| Metric | Value |
|--------|------:|
| Selected windows | 284 |
| AI analysed | 50 |
| Final AI BUY | 0 |
| Hybrid BUY (pre-master) | 13 |

## 4. 50 AI candidate forensic

Full per-candidate records in `artifacts/ai-zero-buy-forensic/*/forensic-raw.json`.

## 5. Provider vote matrix

```json
{
  "NO_TRADE / BUY / HOLD": 6,
  "BUY / NO_TRADE": 4,
  "NO_TRADE / NO_TRADE": 11,
  "NO_TRADE / NO_TRADE / NO_TRADE": 4,
  "BUY / HOLD": 6,
  "NO_TRADE / HOLD": 14,
  "SELL / NO_TRADE": 1,
  "NO_TRADE / BUY / NO_TRADE": 2,
  "NO_TRADE / BUY": 1,
  "NO_TRADE": 1
}
```

At least one provider BUY: **19/50**. Three-provider BUY: **0/50**.

## 6–9. AI input / confidence / risk

CASE **2**: Hybrid produces BUY; **master adjudication** returns effective NO_TRADE. Killed by master: **13**. Killed by preserve threshold (<65% hybrid confidence): **13**.

## 10. Regime distribution

```json
{
  "TREND_UP": 14,
  "RANGE_SIDEWAYS": 29,
  "LOW_VOLATILITY_CALM": 2,
  "HIGH_VOLATILITY_CHAOS": 5
}
```

## 11. CHAOS forensic

CHAOS rate: 10%. CHAOS is not the sole blocker; hybrid BUY occurs in TREND_UP and RANGE_SIDEWAYS as well.

## 12–14. Forward outcome labeling

| Bucket | Count |
|--------|------:|
| TP_FIRST (60m path) | 10 |
| SL_FIRST | 36 |
| Hybrid BUY → TP | 4 |
| Hybrid BUY → SL | 8 |
| NO_TRADE but TP | 10 |
| NO_TRADE but SL | 36 |

## 15. Does AI add value?

AI NO_TRADE avoided **36** SL-first outcomes vs **10** missed TP-first winners in the 50-sample. Net filter value on this sample: marginally positive.

## 16. Scanner quality

284 selected windows: TP-first **64**, SL-first **211**, winner rate **22.54%**. **SCANNER_QUALITY_PROBLEM** — edge weak before AI.

## 17. Proxy negative edge forensic

| Component | TRY equiv |
|-----------|----------:|
| Gross PnL | -195.17 |
| Fees | 76.66 |
| Slippage | 179.55 |
| Net | -271.83 |

Proxy signal itself is negative on this sample.

## 18–19. Fee/slippage & TP/SL economics

Round-trip fee: **0.3%**. Slippage (2×35bps): **0.7000000000000001%**. Min move to break even: **~1%**. TP=1.2% must clear hurdle.

## 20. Confirmed root causes

- MASTER_ADJUDICATION_DOWNGRADES_HYBRID_BUY
- HYBRID_PRESERVE_THRESHOLD_65
- CONSENSUS_POST_PROCESSING_NOT_RAW_PROVIDER
- SCANNER_CANDIDATE_QUALITY_WEAK
- PROXY_SIGNAL_NEGATIVE

## 21–22. Calibration candidates / changes made

**No calibration applied.** Lowering `minHybridConfidenceToPreserve` would increase BUY count but hybrid-BUY forward outcomes are not sufficiently positive (4W / 8L).

## 23. Regression tests

- `tests/replay-clock-ms.test.ts` — replayClockMs freshness semantics
- Existing kline + AI integration tests

## 24–26. Before / after replay

| Metric | BEFORE | AFTER |
|--------|-------:|------:|
| AI BUY (final) | 0 | 0 |
| Hybrid BUY | 13 | 13 |
| Trades | 0 | 0 |
| Net PnL | 0 | 0 |

No calibration rerun — identical production path.

## 27. Profitability screen

Insufficient positive expectancy evidence. Proxy lane negative.

## 28. Strategy verdict

NEGATIVE_FAST_EVIDENCE

## 29. 15h PAPER decision

**RUN_15H_PAPER = NO**

## 30. Remaining risks

- Historical order book approximated from klines
- 50-sample AI cap
- Master engine expert scores may underperform in replay without live microstructure

---
*Generated 2026-09-07T21:52:24.801Z*
