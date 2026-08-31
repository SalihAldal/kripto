# SYSTEM ARCHITECTURE

Canonical production path (spot, long-only momentum):

```
Binance public WS
  → MarketDataDaemon (single market owner, RAM)
  → OpportunityEngine (EARLY / STEADY / MOMENTUM / CONTINUATION)
  → MicrostructureEngine + FinalRanker (HOT/PROMOTED only)
  → ShadowOutcomeEngine (analytics, no orders)
  → Canonical Risk (ALLOW | REJECT + reasonCodes)
  → ExecutionOrchestrator
       → PaperExecutionAdapter   (default / paper / dry-run)
       → BinanceLiveExecutionAdapter (HARD LOCKED unless multi-flag ACK)
  → Position state machine
  → Exit (priority-ordered)
  → PnL / equity / paper performance
```

Runtime classes: `CANONICAL` | `LEGACY` | `SHADOW_ONLY` | `RESEARCH_ONLY` | `DISABLED`.

Live order submission requires **all** of:

1. `EXECUTION_MODE=live`
2. `LIVE_TRADING_ENABLED=true`
3. `LIVE_TRADING_ACK=I_UNDERSTAND_LIVE_FUNDS`

`EXECUTION_MODE=live` alone is not enough.

AI = advisory (no hard veto). TDI = shadow (`canReject: false`).
