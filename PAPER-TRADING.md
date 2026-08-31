# PAPER TRADING

Paper is not “signal → lastPrice fill”.

## Fill model

- Market BUY consumes **asks** (VWAP walk). Market SELL consumes **bids**.
- Remaining size is **not invented**. Insufficient depth → `PARTIALLY_FILLED` or `REJECT_INSUFFICIENT_LIQUIDITY`.
- Fill uses **execution-time** book (latency), not detection lastPrice.
- Fees: config-driven taker (default 15 bps) on entry and exit.
- Filters: tickSize, stepSize, minQty, maxQty, minNotional (local snapshot; live uses exchangeInfo).
- Limit orders (if used): conservative **traded-through** only, not “touched = fill”.

## Adapter

`ExecutionPort` → `PaperExecutionAdapter` (no Binance order endpoints).

`BinanceLiveExecutionAdapter.submit()` throws `LIVE_ADAPTER_HARD_LOCKED`.

## Metrics

Gross PnL, fees, spread cost, slippage cost, net PnL, expectancy, profit factor, max drawdown. N always shown. N&lt;20 = `INSUFFICIENT_SAMPLE`.

Phase 5 MFE ≠ paper net. Capture ratio = paper captured % / theoretical move %.
