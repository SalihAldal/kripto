# Exchange Adapter — Workflow

Production exchange integration via normalized adapter layer (Binance TR primary).

## Problem Context (pr-task-004)

Dual exchange layers (`src/server/exchange/` vs `exchange-abstraction/`) lacked unified workflow, deployment evidence, and policy exposure for operators.

## Workflow

1. **Adapter resolution** — `getExchangeAdapter()` returns singleton Binance TR adapter.
2. **Symbol rules** — `getSymbolRules` / `normalizeFiltersAndPrecision` enforce tick/step/min notional.
3. **Order lifecycle** — place → status → cancel via normalized responses.
4. **Error mapping** — `mapError` converts provider errors to retryable/normalized codes.
5. **Service integration** — `services/binance.service.ts` uses adapter on critical paths.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/exchange/balance` | Account balances |
| GET | `/api/exchange/orderbook` | Order book snapshot |
| POST | `/api/exchange/orders/place` | Place order |
| POST | `/api/exchange/orders/cancel` | Cancel order |
| GET | `/api/exchange/orders/status` | Order status |
| GET | `/api/exchange/policy` | Adapter policy + deployment checks |

## Configuration

- **Environment:** exchange credentials via encrypted connection store / `.env`
- **Policy constants:** `EXCHANGE_ADAPTER_POLICY` in `src/server/exchange/adapter-factory.ts`

## Security

- Exchange routes require authentication tokens and rate limits per route implementation.
- Secrets never returned in policy snapshot responses.

## Required Tests

```bash
npm run test:run -- tests/binance-tr.adapter.test.ts tests/binance-provider-filters.test.ts
```

## Deployment

1. Configure exchange API credentials and connection status.
2. Smoke `GET /api/exchange/balance`.
3. Smoke `GET /api/exchange/policy`.
4. Run adapter unit tests before promoting to live.

## Required Deployment Evidence

- [ ] **Balance endpoint** — `GET /api/exchange/balance` returns `{ ok: true }`.
- [ ] **Policy endpoint** — `GET /api/exchange/policy` includes `gatePolicy.primaryVenue`.
- [ ] **Adapter tests** — Binance TR adapter tests pass.
