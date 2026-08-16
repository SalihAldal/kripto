# Feature Pipeline — Workflow

Feature engineering spans Python runtime analysis, quant research DB, and learning engine registries.

## Problem Context (pr-task-005)

Feature logic is split across Python microservice and TypeScript research modules without a single workflow contract.

## Workflow

1. **Runtime features** — Python `market-analysis-service` engineers live features from OHLCV/order flow.
2. **Research features** — `feature-research.service.ts` ranks importance from `LearningFeature` history.
3. **Learning registry** — `feature-importance.service.ts` tracks ongoing feature performance.
4. **Consumption** — Trading-core AI modules and quant research APIs read ranked features.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/trading-core/quant-research/feature-ranking` | Feature leaderboard |
| GET | `/api/trading-core/quant-research/feature-pipeline/policy` | Pipeline policy snapshot |

## Configuration

| Variable | Role |
| --- | --- |
| `MARKET_ANALYSIS_SERVICE_URL` | Python service base URL (default `http://127.0.0.1:8010`) |
| `MARKET_ANALYSIS_TIMEOUT_MS` | Client timeout (default `1200`) |

**Policy constants:** `FEATURE_PIPELINE_POLICY` in `src/server/quant-research/feature-research.service.ts`

## Deployment

1. Start Python `market-analysis-service` when runtime features required.
2. Smoke feature ranking API.
3. Smoke `GET /api/trading-core/quant-research/feature-pipeline/policy`.

## Required Deployment Evidence

- [ ] **Python service** — Health endpoint reachable at configured URL.
- [ ] **Policy endpoint** — Returns `FEATURE_PIPELINE_POLICY` snapshot.
- [ ] **Feature ranking** — `GET /api/trading-core/quant-research/feature-ranking` responds.
