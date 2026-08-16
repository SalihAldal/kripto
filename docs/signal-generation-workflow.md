# Signal Generation — Scanner Workflow

Spot trading signal generation pipeline. Pre-trade scoring runs before AI consensus and execution.

## Problem Context (pr-task-001)

Fragmented scanner APIs and missing institutional workflow evidence caused operational blind spots during signal acceptance tuning.

## Workflow

Pre-trade signal generation sequence:

1. **Universe selection** — Watchlist / scanner universe resolves candidate symbols.
2. **Context build** — `buildMarketContext(symbol)` loads price, volume, spread, regime metadata.
3. **Score** — `scoreContext(context)` applies momentum, liquidity, spread, pump/regime penalties.
4. **Rank** — `rankCandidates(rows, topN)` orders qualified candidates (discovery boost optional).
5. **AI consensus** — Optional multi-provider consensus on top candidates.
6. **Quality gate** — `signal-quality-gate` validates post-AI acceptance.
7. **Persist / execute** — `persistCandidateSignal` and execution fast-entry when approved.

**Dry-run debugging:** `POST /api/scanner/evaluate` runs steps 2–3 for one symbol without placing orders.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/market/scan` | UI/worker scanner snapshot (rate limited) |
| POST | `/api/scanner/run` | Force full pipeline (token required) |
| GET | `/api/scanner/policy` | Policy snapshot + configuration thresholds |
| POST | `/api/scanner/evaluate` | Dry-run score for one symbol |
| POST | `/api/trades/fast-entry` | Scan + execute best candidate (secured roles) |

## Configuration

| Variable | Role |
| --- | --- |
| `SCANNER_MIN_SCORE` | Minimum qualified score |
| `SCANNER_MIN_VOLUME_24H` | Liquidity floor |
| `SCANNER_MAX_SPREAD_PERCENT` | Spread ceiling |
| `SCANNER_TOP_CANDIDATES` | Rank cap before AI |
| `SCANNER_WORKER_ENABLED` | Background worker snapshot mode |

**Policy constants:** `SIGNAL_GENERATION_POLICY` in `src/server/scanner/signal-scoring.engine.ts`

## Security

| Endpoint | Control |
| --- | --- |
| `/api/market/scan` | Rate limit + worker throttling |
| `/api/scanner/run` | `APP_TOKEN` / bearer |
| `/api/scanner/policy`, `/api/scanner/evaluate` | `secureRoute` (`ADMIN` / `VIEWER`) |
| `/api/trades/fast-entry` | `secureRoute` (`ADMIN` / `TRADER`) |

## Deployment

Run in order before live signal-driven execution:

1. Configure `SCANNER_*` env vars in server-side `.env`.
2. Enable worker if using snapshot mode (`SCANNER_WORKER_ENABLED=true`).
3. Smoke `GET /api/market/scan`.
4. Smoke `GET /api/scanner/policy` and `POST /api/scanner/evaluate`.
5. Run `npm run test:run -- tests/scanner.test.ts`.

## Required Deployment Evidence

- [ ] **Health / worker** — Scanner worker snapshot updating (`GET /api/market/scan` non-empty or fresh pipeline).
- [ ] **Policy endpoint** — `GET /api/scanner/policy` returns `gatePolicy`.
- [ ] **Evaluate smoke** — `POST /api/scanner/evaluate` returns `{ ok, score, gatePolicy }`.
- [ ] **Unit tests** — `tests/scanner.test.ts` passes in CI/staging gate.
