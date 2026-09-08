# KRIPTO Fast Historical Replay Report

## 1. Executive Summary

Bounded fast replay on real Binance 1m klines using production scanner scoring, real AI consensus on selected candidates (cap 50), production admission gates, and fee/slippage-aware trade simulation.

- **RUN_15H_PAPER:** NO
- **STRATEGY_VERDICT:** TOO_SELECTIVE
- **Dominant gate:** AI_NO_BUY
- **Duration:** 217s | Time budget reached: false

## 2. HEAD

`fbf5c721f17cb903517fccc626b7ac7eb07984f4`

## 3. Replay Methodology

- Candidate-first scan: production `scoreContext` + `rankPaperRoundCandidate` per 15m window
- AI only on deduped selected candidates (hourly bucket), max 50 calls
- Real `runAIConsensusFromInput` with response cache (symbol+timestamp+context fingerprint+config hash)
- Trade sim: next-candle open entry (lookahead-safe), TP=1.2% SL=0.8%, conservative SL on ambiguous intrabar

## 4. Lookahead Protection

- Context built with `buildMarketContextFromKlines({ idx })` — candles ≤ decision index only
- Entry at candle[idx+1].open after signal at idx close
- Future candles used only post-entry for exit/PnL

## 5. Dataset

| Field | Value |
|-------|-------|
| startTime | 2026-09-04T22:38:00.000Z |
| endTime | 2026-09-07T21:37:59.999Z |
| hours | 72 |
| symbols | 12 |
| candlesLoaded | 51852 |
| timeframe | 1m |
| dataSource | binance-public-klines |

## 6. Data Quality

Real Binance public klines; TRY+USDT universe via production `filterTradeableUniverse`. Volume-ranked symbol pick.

## 7. Production Strategy Parity

Scanner thresholds frozen (SCANNER_MIN_SCORE=40). Elite confidence 82% entry quality gate unchanged. No threshold relaxation.

## 8. Scanner Funnel

| Stage | Count | Conv % |
|-------|------:|-------:|
| Market windows | 284 | 100 |
| Scanner candidates | 1632 | 574.65 |
| Hot (QUALIFIED) | 1894 | 116.05 |
| Micro confirmed | 1876 | 99.05 |
| Execution ready (proxy gate) | 527 | 28.09 |
| Selected (top/window) | 284 | 100 |
| AI BUY | 0 | 0 |
| Entry pass | 0 | 0 |
| Risk pass | 0 | 0 |
| Sizing pass | 0 | 0 |
| Trades opened | 0 | 0 |
| Trades closed | 0 | — |

## 9. Candidate Funnel

Selected = top ranked candidate per stride window among QUALIFIED or proxy-gate-pass symbols.

## 10. AI Consensus

Real provider consensus: 50 API calls. Remote-healthy: 50/50. ALL_DEGRADED: 0. AI errors: 0.

## 10b. Proxy Backtest Supplement (non-production AI)

Scanner + proxy-AI paper-round lane on same dataset: 27 closed trades, net PnL -245.988. Gate passes: 32/46512.

## 11. AI BUY Analysis

- AI BUY: 0 (0% of selected)
- AI SELL: 0
- AI NO_TRADE/HOLD: 50

**Critical:** sufficient selected sample but AI BUY=0 — 15h PAPER value is low.

## 12. Entry Quality

Pass: 0 | Reject: 0 (82% elite + production gate)

## 13. Risk

Pass: 0 | Reject: 0

## 14. Sizing

Pass: 0 | Reject: 0 | Min notional: 500

## 15. Trades

No trades

## 16. Exit Results

TP/SL/TIMEOUT/AMBIGUOUS_INTRABAR per production conservative policy (SL wins on same-candle TP+SL).

## 17. Fees / Slippage

Taker fee rate: 0.0015 per leg. Slippage: 35 bps per side (0.35% production cap).

## 18. PnL

Gross: 0 | Fees: 0 | Net: 0

## 19. Win Rate

n/a% (0W / 0L)

## 20. Profit Factor

n/a

## 21. Expectancy

n/a

## 22. Drawdown

Max drawdown: 0

## 23. Rejection Histogram

{
  "AI_NO_BUY": 50
}

## 24. WHY_ZERO_TRADES

AI_NO_BUY

## 25. Sample Quality

NO_TRADE_SAMPLE

## 26. Strategy Verdict

TOO_SELECTIVE

## 27. 15H PAPER Decision

**RUN_15H_PAPER = NO**

## 28. Limitations

Fast screen only — not statistical certainty. REPLAY_CANDIDATE_CAP=50. Stride=15m subsampling. Historical order book/trades approximated from kline context.

## 29. Recommended Next Step

Do not commit 15h PAPER until AI BUY rate improves or strategy blockers addressed.

---
*Generated 2026-09-07T21:42:20.812Z*
