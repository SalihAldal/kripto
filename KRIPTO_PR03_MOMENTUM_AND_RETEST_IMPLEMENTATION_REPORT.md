# KRIPTO PR03 — MOMENTUM CONTINUATION + BREAKOUT RETEST

## Executive Verdict

- `PROMPT9_ENGINEERING_VERDICT=PARTIAL`
- `MOMENTUM_LIFECYCLE_VERDICT=PASS`
- `BREAKOUT_RETEST_LIFECYCLE_VERDICT=PASS`
- `LEVEL_CAUSALITY_VERDICT=PASS`
- `STATE_IDEMPOTENCY_VERDICT=PASS`
- `ROUTER_INTEGRATION_VERDICT=PASS`
- `CAUSAL_REPLAY_VERDICT=PARTIAL`
- `MARKET_BEHAVIOR_ANALYSIS=NOT_RUN`
- `PROFITABILITY_EVIDENCE=NOT_ESTABLISHED`
- `STRATEGY_PROMOTION=NOT_EVALUATED`
- `OVERALL_QA_STATUS=QA_PENDING`
- `PAPER_CAMPAIGN_STARTED=false`
- `LIVE_AUTHORIZATION=DISABLED`

## Worktree Fingerprint

| Field | Start | End |
|---|---|---|
| HEAD | `a85a04677acc8dba27af3362f238f86a1d463ea5` | `a85a04677acc8dba27af3362f238f86a1d463ea5` |
| Branch | `main` | `main` |
| Worktree | `DIRTY` | `DIRTY` (PR03 + prior ER/PR changes) |

## Previous Behavior vs Fixes

| Issue | Before | After |
|---|---|---|
| BREAKOUT_RETEST | Single snapshot `breakoutHeld` boolean + score average | Causal lifecycle: pivot level → breakout → retest → hold → flow reacceleration trigger |
| MOMENTUM_CONTINUATION | `momentum/acceleration/flowRecovery` score average | Impulse → pause → resumption lifecycle with frozen impulse reference |
| Level generation | Implicit / retroactive | `computeConfirmedPivotLevel` with right-side confirmation; frozen at setup start |
| Future data | Risk via latest-candle-only logic | `availableAt`/`closed` filters; chronological `findFirstBreakoutAfterLevel` |
| Duplicate signals | Every evaluation could re-emit | Durable in-memory store + `signalId` suppression + rearm cooldown |
| Router path | Generic P4 scoring | PR03 evaluators; router fixture mode preserves ER02 compatibility without store mutation |
| EARLY overlap | Independent generic scores | All three strategies evaluated; P4 router authority unchanged |

## BREAKOUT_RETEST State Machine

| From | To | Reason (examples) |
|---|---|---|
| WARMUP | LEVEL_READY | `LEVEL_READY`, `WARMUP_COMPLETE` |
| LEVEL_READY | BREAKOUT_CONFIRMED | `BREAKOUT_CONFIRMED` |
| BREAKOUT_CONFIRMED | RETEST_PENDING | `RETEST_PENDING` |
| RETEST_PENDING | RETEST_OBSERVED | `RETEST_IN_BAND` |
| RETEST_OBSERVED | HOLD_CONFIRMED | `HOLD_ABOVE_LEVEL` |
| HOLD_CONFIRMED | TRIGGERED | `ENTRY_TRIGGER_FIRED` |
| * | INVALIDATED | `SETUP_INVALIDATED`, `RETEST_FAILED_HOLD` |
| * | EXPIRED | `SETUP_EXPIRED` |
| TRIGGERED | TRIGGERED | `DUPLICATE_SIGNAL_SUPPRESSED`, `REARM_COOLDOWN_ACTIVE` |

## MOMENTUM_CONTINUATION State Machine

| From | To | Reason (examples) |
|---|---|---|
| WARMUP | OBSERVING | `WARMUP_COMPLETE` |
| OBSERVING | IMPULSE_CONFIRMED | `IMPULSE_CONFIRMED` |
| IMPULSE_CONFIRMED | PAUSE_OBSERVED | `PAUSE_OBSERVED` |
| PAUSE_OBSERVED | RESUMPTION_ARMED | `RESUMPTION_ARMED` |
| RESUMPTION_ARMED | TRIGGERED | `ENTRY_TRIGGER_FIRED` |
| * | INVALIDATED | `SETUP_INVALIDATED`, extension breach |
| * | EXPIRED | `SETUP_EXPIRED` |

## Level / Feature Provenance

| Artifact | Source | Available when | Version |
|---|---|---|---|
| Pivot high level | Closed candles, 5m lookback | After right-side `PIVOT_CONFIRMATION_BARS` | `pivot-v1` |
| Breakout threshold | Level × (1 + 12bps) on closed close | Candle `availableAt <= T` | `pr03-momentum-and-retest-v1` |
| Retest band | Level ± 25bps on candle low | Strictly after breakout close | same |
| Hold band | Close ≥ level + tolerance for ≥2 post-retest candles | After retest close | same |
| Flow confirmation | Taker buy/sell notional 15s window | ≥3 trades | producer required |
| Impulse reference | First-window open → peak high | Frozen at `IMPULSE_CONFIRMED` | same |

## Time / Partial-Candle Rules

- Only `closed === true` and `availableAt <= asOfMs` candles participate.
- Retest cannot occur on the same candle as breakout (`closeTime > breakoutAtMs`).
- Unclosed breakout candle does not confirm breakout.
- Pivot requires confirmation bars with `availableAt <= asOfMs`.

## Production Call Chain

```
strategyContext (candles/trades/book)
  → pr03-causal-features (level/impulse/flow)
  → pr03-breakout-setup | pr03-momentum-setup (durable lifecycle when producer context present)
  → pr03-breakout-evaluator | pr03-momentum-evaluator
  → StrategyEvaluation
  → p4-regime-strategy-shadow.routeStrategies
  → ER02 feature contract / ER03 admission (unchanged)
  → ER04 claimCanonicalExecutionAttempt (duplicate execution guard)
  → ER05 replay via runPr03ReplayAnalysis (same evaluators)
```

## EARLY Conflict Resolution

- EARLY (PR02), MOMENTUM, BREAKOUT evaluated independently with distinct `strategyId` / `policyVersion`.
- Router scores and selects `preferredStrategy`; non-selected eligible strategies remain in `evaluations[]`.
- `claimCanonicalExecutionAttempt` prevents duplicate execution for same `candidateId`.
- Selected strategy identity flows via existing ER04 metadata path (unchanged in this prompt).

## Invalidation Contract (Prompt 10 Handoff)

Defined in `pr03-types.ts` → `InvalidationContract` and populated by evaluators:

- BREAKOUT: `LEVEL_HOLD_BREACH` at `level × (1 - 45bps)`
- MOMENTUM: `IMPULSE_STRUCTURE_BREACH` below impulse start open
- Fields: `referenceLevel`, `invalidationThreshold`, `reasonCode`, `computedAtMs`, `availableAtMs`, `validUntilMs`, `sourceObservations`
- Setup invalidation does **not** force-close open positions.

## Test Evidence

| Command | Exit | Result |
|---|---|---|
| `npm run test:run -- tests/pr03-momentum-and-retest.test.ts` (×3) | 0 | 45/45 PASS each |
| `npm run test:run -- tests/er02-feature-contract-and-router-input.test.ts tests/er03-canonical-policy.test.ts tests/er04-durable-execution-attempt-lock.test.ts tests/er05-canonical-dataset-persistence.test.ts tests/pr02-early-acceleration.test.ts tests/p4-regime-strategy-shadow.test.ts` | 0 | 85/85 PASS |
| `npm run typecheck` | 0 | PASS |
| `npm run build` | 0 | PASS (compile + TS; Turbopack warnings only) |

## Open Blockers

| ID | Severity | Reason |
|---|---|---|
| PR03-DATA-01 | P0 | No recorded market dataset → `MARKET_BEHAVIOR_ANALYSIS=NOT_RUN` |
| ER06-A | P0 | Disposable PostgreSQL unavailable for ER04 settlement joins |
| PR03-DATA-02 | P1 | Durable lifecycle store is in-memory only (test-isolated); production DB migration not run |

## Prompt 10 Handoff

- Entry trigger metadata: `StrategyTriggerResult` (`signalId`, `triggerAt`, `validUntil`)
- Invalidation: `InvalidationContract` on evaluation results
- Setup identity: `setupId`, `lifecycleId`, `policyVersion`
- Exit engine must consume invalidation separately from signal expiry and position timeout
