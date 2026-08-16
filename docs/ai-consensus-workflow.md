# AI Consensus — Decision Workflow

Spot trading AI consensus layer. Aggregates multi-provider outputs into a single `finalDecision` before execution.

## Problem Context (pr-task-003)

Over-strict consensus rules (hard 2-vote directional block after soft acceptance) caused valid single-provider directional setups to become `NO_TRADE`. Policy now allows **soft directional acceptance** without a post-hoc vote veto.

## Workflow

1. Providers return standardized outputs (`BUY` / `SELL` / `HOLD` / `NO_TRADE`).
2. `rejectUnsafeTrade` applies majority high-risk veto (requires 2 providers above `AI_MAX_RISK_SCORE`).
3. `summarizeConsensus` computes weighted score and directional decision.
4. Confidence gate uses tiered thresholds (majority / soft / degraded).
5. Strict analyst mode adds remote-provider and unanimity checks when enabled.
6. Execution pipeline consumes `finalDecision`.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/ai/consensus` | Run live consensus for symbol (token required) |
| GET | `/api/ai/consensus/policy` | Policy snapshot, config thresholds, deployment checks |

## Configuration

- **Environment:** `AI_MIN_CONFIDENCE`, `AI_MAX_RISK_SCORE`, `AI_STRICT_ANALYST_MODE`, `AI_MIN_HEALTHY_PROVIDER_COUNT`, `AI_REQUIRE_UNANIMOUS_BUY_SELL`, `AI_QUALITY_PROFILE`
- **Policy constants:** `AI_CONSENSUS_POLICY` in `src/server/ai/consensus-engine.ts`

## Required Tests

```bash
npm run test:run -- tests/consensus-engine.test.ts
```

Covers:
- `scoreTradeOpportunity` averaging
- `rejectUnsafeTrade` majority veto
- Soft single-provider BUY acceptance (no hard vote block)

## Deployment

Before live execution:

1. Configure AI provider keys in `.env` (server-side only).
2. Verify `GET /api/ai/consensus/policy` returns policy snapshot.
3. Smoke `POST /api/ai/consensus` with known symbol.
4. Run consensus unit tests in CI/staging gate.

## Required Deployment Evidence

- Consensus policy endpoint reachable from ops tooling.
- Provider health visible in consensus explanation string.
- Unit test suite includes `tests/consensus-engine.test.ts`.
