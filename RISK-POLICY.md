# RISK POLICY

Authority: `src/server/risk/canonical-risk-decision.service.ts` plus in-memory paper overlay (`paper-runtime/risk-overlay.ts`). Hard risk ≠ signal quality.

## Conservative defaults (paper / any future canary)

| Limit | Default |
|---|---|
| Sizing | risk-per-trade 0.5% / stop distance, capped |
| Max position | 10% equity and 250 USDT notional |
| Max open positions | 3 |
| Max gross exposure | 25% equity |
| Daily loss cap | 5% → new entries disabled |
| Max drawdown | 12% → new entries disabled |
| Consecutive losses | 3 → cooldown (no martingale) |
| BTC shock | BTC 1m ≤ -1.2% → no new longs |
| Correlation | max 2 meme-cluster names |
| Stale data | age > 15s → reject |
| WS not UP | reject + stabilization window on recovery |
| Redis/DB down | new entries disabled |
| 429 / 418 | new entries disabled, no request storm |

Existing open positions may still exit. New entries stop.

Martingale, loss chasing, and unlimited exposure are forbidden.
