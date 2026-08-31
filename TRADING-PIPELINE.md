# TRADING PIPELINE

1. **Market data** — `!miniTicker@arr` + deep `aggTrade`/`bookTicker` for HOT set. Scanner hot-path must not per-symbol REST poll.
2. **Opportunity** — RAM scan, signed features, top-K + hysteresis. 24h gainer is not the discovery metric.
3. **Microstructure** — only HOT/PROMOTED. Flow/book/exhaustion. Final score: opportunity + micro + liquidity + AI±8.
4. **Risk** — single authority: `evaluateCanonicalRiskDecision` + paper overlay kill switches.
5. **Execution** — paper adapter walks ask (BUY) / bid (SELL), applies filters, fees, partial fills, latency. Live adapter is locked.
6. **Position** — `PLANNED → OPENING → OPEN → REDUCING → CLOSING → CLOSED | ERROR`.
7. **Exit priority** — EMERGENCY → HARD_STOP → RISK_EXIT → TAKE_PROFIT → PARTIAL_TP → MOMENTUM_EXIT → TRAILING → TIME_EXIT. One close path (`exitLock`).
8. **Outcome** — Shadow MFE/MAE is theoretical; paper net PnL is after fee/spread/slippage.

Paper and future live must share 1–4 and 6–7. Only the execution adapter changes.
