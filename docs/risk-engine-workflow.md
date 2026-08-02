# Risk Engine — Pre-Trade Workflow

Spot trading platform risk gate. Pre-trade evaluation runs before order release (domain rule: pre-trade risk must pass before order release).

## Problem Context (pr-task-001)

Over-aggressive consecutive-loss auto-pause caused valid candidates to stay rejected. Consecutive losses are **telemetry only**; they do not hard-block new entries. API failures use a **time-bounded cooldown** only while `blockedUntil` is active.

## Workflow

Pre-trade risk gate sequence. Order release is blocked until the gate passes (domain rule: pre-trade risk must pass before order release).

1. **Candidate selection** — Scanner or execution pipeline selects a symbol and metric payload.
2. **Evaluate** — `evaluatePreTradeRisk(userId, metrics)` loads bounded effective config via `getEffectiveRiskConfig` and runtime state (pause flag, daily/weekly PnL, open positions, consecutive-loss telemetry, API cooldown window).
3. **Rules** — `evaluateRiskRules(config, metrics, state)` evaluates hard breakers and returns blocking reason strings.
4. **Pass / fail decision**
   - **Pass:** `reasons` is empty → `ok: true` → execution may proceed to order release.
   - **Fail:** `reasons` is non-empty → `ok: false` → order release blocked; `reasons` lists which breakers fired.
5. **Runtime monitoring** — Open positions use `evaluateRuntimeRisk` for volatility breakers and manual pause (separate from the pre-trade gate).

**Dry-run debugging:** `POST /api/risk/evaluate` runs steps 2–4 without placing an order.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/risk/status` | Current pause state, PnL summaries, persisted + effective config, and `gatePolicy` |
| GET/PUT | `/api/risk/config` | Read/update persisted risk configuration (`RiskConfig`) |
| POST | `/api/risk/system-control` | Manual pause/resume (token required; optional `reason`, `minutes`) |
| POST | `/api/risk/evaluate` | Dry-run pre-trade gate for a symbol/metrics payload |

### Evaluate request example

```json
POST /api/risk/evaluate
{
  "symbol": "BTCTRY",
  "confidencePercent": 72,
  "spreadPercent": 0.12,
  "liquidity24h": 15000000,
  "expectedProfitPercent": 0.5,
  "slippagePercent": 0.15,
  "volatilityPercent": 1.2,
  "riskPerTradePercent": 0.8,
  "stopLossConfigured": true
}
```

### Evaluate / status response notes

Dry-run evaluate and status payloads include:

| Field | Description |
| --- | --- |
| `ok` | Pre-trade gate pass (`true`) or fail (`false`) |
| `reasons` | Blocking reason strings; empty array when passed |
| `gatePolicy` | Stable `RISK_GATE_POLICY` constants exported from the Risk Engine service |

Status (`GET /api/risk/status`) wraps the above fields with live runtime snapshots (`paused`, `daily`, `weekly`, `consecutiveLosses`, `apiFailures`, `config`, `effective`).

## Configuration

Risk Engine runtime settings come from environment variables (server-side `.env` only) and persisted `RiskConfig` rows updated via `/api/risk/config`.

### Required environment variables

| Variable | Role in Risk Engine |
| --- | --- |
| `RISK_MAX_DAILY_LOSS_PERCENT` | Daily loss breaker threshold (% of reference capital) |
| `RISK_MAX_WEEKLY_LOSS_PERCENT` | Weekly loss breaker threshold (% of reference capital) |
| `RISK_TOTAL_CAPITAL_TRY` | Reference capital (TRY) used to compute daily/weekly loss percentages |
| `EXECUTION_MAX_OPEN_POSITIONS` | Maximum concurrent open positions enforced by pre-trade gate |
| `EXECUTION_FAST_MIN_CONFIDENCE` | Live min-confidence cap used when bounding stale DB thresholds |
| `AI_MIN_CONFIDENCE` | Default min-confidence fallback when DB metadata omits `minConfidenceThreshold` |

Optional but relevant for ultra-strict modes:

| Variable | Role |
| --- | --- |
| `AI_ULTRA_PRECISION_MODE` | When `true`, uses ultra min-confidence floor instead of live cap |
| `AI_SPOT_MIN_CONFIDENCE_ULTRA` | Ultra-mode min-confidence floor |

### Database configuration

Persisted via `RiskConfig` (`GET/PUT /api/risk/config`). Common metadata keys consumed by `getEffectiveRiskConfig`:

- `minConfidenceThreshold`, `maxRiskPerTrade`, `maxSpreadThreshold`, `minLiquidityThreshold`
- `minExpectedProfitThreshold`, `maxSlippageThreshold`, `consecutiveLossBreaker`, `apiFailureBreaker`
- `abnormalVolatilityThreshold`, `dailyLossReferenceTry`, `weeklyLossReferenceTry`

Stale strict DB confidence values are bounded at runtime (see `boundMinConfidenceThreshold`).

### Policy constants

`RISK_GATE_POLICY` in `src/server/risk/risk-evaluation.service.ts` — exported contract surfaced on status and evaluate API responses.

## Deployment

Run these steps **in order** before enabling live execution with the Risk Engine gate active:

1. **Configure environment** — Set the required `RISK_*`, `EXECUTION_*`, and `AI_MIN_CONFIDENCE` variables in server-side `.env` (never commit secrets).
2. **Apply database migrations** — `npm run prisma:migrate:deploy` so `RiskConfig` and related tables exist.
3. **Smoke status endpoint** — `GET /api/risk/status` must return `{ ok: true, data: { ... gatePolicy ... } }` with current pause/PnL snapshots.
4. **Smoke evaluate endpoint** — `POST /api/risk/evaluate` with a known-good candidate payload; expect `{ ok: true, data: { ok: true, reasons: [], gatePolicy: { ... } } }`.
5. **Verify controlled reject messages** — Trigger a deliberate fail payload (e.g. low confidence); confirm API returns user-safe reason strings with no internal stack traces.

## Required Deployment Evidence

Mandatory pre-live evidence items. Capture artifacts (response JSON, screenshot, or runbook log line) for each item before promoting to live execution.

- [ ] **Health ready check** — `GET /api/health/ready` returns `{ ok: true }` with dependency checks passing (database, required services).
- [ ] **Risk status endpoint** — `GET /api/risk/status` is reachable from the operations panel or staging curl; response includes `gatePolicy`, `effective`, and current `paused` state.
- [ ] **Evaluate smoke** — `POST /api/risk/evaluate` with a known-good candidate returns `{ ok: true, data: { ok: true, reasons: [], gatePolicy: { consecutiveLossBlocksEntry: false, ... } } }`; a deliberate fail payload returns controlled `reasons` with no stack traces.
