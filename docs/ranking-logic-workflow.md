# Ranking Logic — Workflow

Candidate ranking orders scored symbols before AI consensus and execution.

## Problem Context (pr-task-006)

Multiple ranking engines (scanner, discovery-v2, strategy-selector) lacked documented precedence and policy exposure.

## Workflow

1. **Score** — Each symbol receives `ScannerScore` from `scoreContext`.
2. **Primary rank** — `rankCandidates` sorts by score + optional top-gainer boost.
3. **Discovery integration** — When enabled, discovery-v2 symbols merge into scanner batch.
4. **Top-N cut** — `SCANNER_TOP_CANDIDATES` limits AI evaluation cost.
5. **Downstream** — AI consensus + quality gate operate on ranked list only.

## Canonical Ranker

**Scanner `rankCandidates` is the pre-AI canonical ranker** for live execution path. Other ranking APIs (discovery, strategy-selector, performance optimizer) are analytics/benchmark surfaces.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/scanner/ranking/policy` | Ranking policy snapshot |
| GET | `/api/trading-core/discovery/rankings` | Persisted discovery rankings |
| GET | `/api/trading-core/s2/ranking` | Discovery V2 snapshot |

## Configuration

| Variable | Role |
| --- | --- |
| `SCANNER_TOP_CANDIDATES` | Top-N after ranking |
| `DISCOVERY_V2_INTEGRATE_SCANNER` | Merge discovery into scanner |
| `TRADING_CORE_S2_ENABLED` | Enable S2 discovery path |

**Policy constants:** `RANKING_LOGIC_POLICY` in `src/server/scanner/candidate-ranking.service.ts`

## Required Tests

```bash
npm run test:run -- tests/scanner.test.ts
```

## Deployment

1. Configure ranking env vars.
2. Smoke `GET /api/scanner/ranking/policy`.
3. Verify scanner tests pass.

## Required Deployment Evidence

- [ ] **Policy endpoint** — Returns `RANKING_LOGIC_POLICY`.
- [ ] **Discovery rankings** — `GET /api/trading-core/discovery/rankings` reachable.
- [ ] **Unit tests** — Scanner ranking tests pass.
