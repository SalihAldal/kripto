# KRIPTO FIX01 — Strategy Context & Invalidation Report

## Fingerprints

| | Value |
|---|---|
| Baseline commit (review) | `695c9f07ee475d5b4a338cfade769e8825e4ac98` |
| Final worktree | `695c9f0` + uncommitted FIX01 delta |
| Schema | `fix01-strategy-context-v1`, `fix01-selected-signal-v1` |

## Producer → Entry Call Chain

```
MarketDataDaemon.getDeepState(symbol)
  → buildStrategyEvaluationContexts()          [fix01-strategy-context-builder.ts]
  → merge earlyContext + strategyContext into StrategyInput
  → routeStrategiesWithDetails()             [p4-regime-strategy-shadow.ts]
  → evaluateEarly/Momentum/Breakout (producer path only)
  → buildSelectedStrategySignal()            [fix01-selected-signal.ts]
  → buildPr04ExitMetadataFromSelectedSignal() [pr04-exit-bridge.ts]
  → position metadata (no evaluator re-run)
```

Orchestrator wiring: `execution-orchestrator.service.ts` after `buildFeatureContractSnapshot`, before canonical admission.

## Removed Fixture Fallback

| Before | After |
|---|---|
| PR02 `routerFixtureMode` (tradeCount=0 → scalar fallback) | `PRODUCER_CONTEXT_MISSING` → no trigger |
| PR03 momentum/breakout empty context → legacy scalar thresholds | `PRODUCER_CONTEXT_MISSING` → no trigger |
| `resolveInvalidationForSelectedStrategy` re-evaluated evaluator | Reads frozen `selectedSignal` only |
| QA12 accepted `null` invalidation as pass | Positive invalidation + frozen snapshot assertions |

Production evaluators no longer contain `routerFixtureMode` or `ROUTER_FIXTURE_*` paths.

## Strategy Context & Invalidation Sources

| Strategy | Context source | Invalidation source |
|---|---|---|
| EARLY_ACCELERATION | `recentTrades` + `bookTicker` from deep state | `buildEarlyStructuralInvalidation()` — min(baseline, firstDetection) × 0.995 |
| MOMENTUM_CONTINUATION | `klines1m` + trades (causal candles) | Frozen impulse start price (`IMPULSE_STRUCTURE_BREACH`) |
| BREAKOUT_RETEST | `klines1m` + trades | Frozen pivot level (`LEVEL_HOLD_BREACH`) |

Causal rules: `availableAt <= decisionAtMs`; open candles capped to known open only; no future close/high/low.

## Selected Signal Immutability

`SelectedStrategySignal` carries: `strategyId`, `policyVersion`, `candidateId`, `lifecycleId`, `setupId`, `signalId`, `featureSnapshotId`, `setupState`, `triggerAt`, `validUntil`, cloned `invalidation`, `evaluationId`, `frozenAt`.

Router detailed result caches evaluator output; entry bridge consumes snapshot — no second evaluation.

## Test & Build Evidence

| Command | Result |
|---|---|
| `tests/fix01-strategy-context-and-invalidation.test.ts` ×3 | **32/32 PASS** each run |
| Regression bundle (ER02, ER03, PR02–PR04, QA12, FIX01) | **211/211 PASS** |
| `npm run typecheck` | **exit 0** |
| `npm run build` | **exit 0** (~13.8 min, Turbopack warnings) |

## NOT_RUN / BLOCKED

| Check | Status |
|---|---|
| Disposable PostgreSQL settlement integration | **BLOCKED** (ER06-A) |
| Live market replay with recorded package | **NOT_RUN** |
| DB-backed lifecycle persistence across restart | **NOT_RUN** (in-memory warmup only) |
| Paper/live campaign | **NOT_RUN** |

## Verdicts

| Field | Value |
|---|---|
| FIX01_ENGINEERING_VERDICT | **PARTIAL** |
| PRODUCTION_CONTEXT_WIRING_VERDICT | **PASS** |
| FIXTURE_ISOLATION_VERDICT | **PASS** |
| STRATEGY_LIFECYCLE_VERDICT | **PARTIAL** |
| SELECTED_SIGNAL_IDENTITY_VERDICT | **PASS** |
| INVALIDATION_ENTRY_BRIDGE_VERDICT | **PASS** |
| REQUIRED_CHECKS_NOT_RUN | `DB_SETTLEMENT_INTEGRATION`, `RECORDED_MARKET_REPLAY`, `EXIT_STATE_DB_PERSISTENCE` |
| PROFITABILITY_EVIDENCE | **NOT_EVALUATED** |
| PAPER_CAMPAIGN_STARTED | **false** |
| LIVE_AUTHORIZATION | **DISABLED** |
| OVERALL_QA_STATUS | **QA_PENDING** |

## Düzeltme 2 Handoff (Exit Snapshot / Persistence)

Entry now binds:

- `ExitPolicySnapshot.entrySignalId` ← selected `signalId` (not `executionId`)
- `ExitPolicySnapshot.setupId` ← strategy `setupId`
- `ExitPolicySnapshot.structuralInvalidation` ← frozen invalidation clone
- `entryPolicyVersion` ← strategy `policyVersion`

FIX02 should persist `SelectedStrategySignal` + `ExitPolicyState` durably, reconcile restart, and wire partial close → `settleOpenPosition` without re-deriving invalidation from live market ticks.
