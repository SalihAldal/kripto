# KRIPTO PR02 — EARLY ACCELERATION IMPLEMENTATION

## Executive Verdict

- `PROMPT8_ENGINEERING_VERDICT=PARTIAL`
- `EARLY_FEATURE_PROVENANCE_VERDICT=PASS`
- `EARLY_SETUP_LIFECYCLE_VERDICT=PASS`
- `EARLY_ROUTER_INTEGRATION_VERDICT=PASS`
- `CAUSAL_REPLAY_VERDICT=PARTIAL`
- `MARKET_BEHAVIOR_ANALYSIS=NOT_RUN`
- `PROFITABILITY_EVIDENCE=NOT_ESTABLISHED`
- `STRATEGY_PROMOTION=NOT_EVALUATED`
- `OVERALL_QA_STATUS=QA_PENDING`
- `PAPER_CAMPAIGN_STARTED=false`
- `LIVE_AUTHORIZATION=DISABLED`

## Prompt 7 Dependency Check

| Contract | Status | Note |
|---|---|---|
| PR01 universe/eligibility | VERIFIED_TEST | `evaluatePointInTimeUniverse` reused |
| ER02 feature contract | VERIFIED_TEST | Router adapter preserved |
| ER03 admission/authorization | VERIFIED_TEST | No bypass introduced |
| ER04 strategy identity | VERIFIED_TEST | `strategyId`, `policyVersion`, `featureSnapshotId` carried |
| ER05 replay harness | PARTIAL | Same production evaluator via `runEarlyReplayAnalysis` |
| PR01 economics | VERIFIED_TEST | `buildTradeEconomicsRecord` attached |

## Policy

- Strategy: `EARLY_ACCELERATION`
- Policy version: `pr02-early-acceleration-v1`
- Schema version: `pr02-early-acceleration-v1`
- Production activation: unchanged (`shadowOnly: true`)

## Implemented Modules

| Module | Responsibility |
|---|---|
| `pr02-early-features.ts` | Causal feature producer from trades/book + ER02 fallback |
| `pr02-early-setup.ts` | Setup lifecycle store (WARMUP→OBSERVING→ARMED→TRIGGERED→INVALIDATED/EXPIRED) |
| `pr02-early-evaluator.ts` | Authoritative EARLY evaluation + router mapping |
| `pr02-early-replay.ts` | Offline replay/behavior report using same evaluator |
| `p4-regime-strategy-shadow.ts` | Delegates `EARLY_ACCELERATION` to PR02 evaluator |

## Feature Table (summary)

| Feature | Unit | Window | Source | Missing behavior |
|---|---|---|---|---|
| `priceReturnShortPct` | percent | 5s | trade prices | INSUFFICIENT_DATA / ER02 fallback |
| `priceAcceleration` | percent_delta | 5s vs 15s | trade prices | INSUFFICIENT_DATA |
| `tradeRate5s` | trades/sec | 5s | trade count | INSUFFICIENT_DATA |
| `tradeRateAcceleration` | trades/sec_delta | 5s-15s | trade count | INSUFFICIENT_DATA |
| `flowImbalance5s` | signed_ratio | 5s | taker buy/sell notional | required in producer mode |
| `relativeActivity` | ratio | 5s | trade rate vs baseline | zero baseline → null |
| `spreadBps` | bps | snapshot | book ticker | STALE if book old |
| `depthCoverage` | ratio | snapshot | top-of-book vs notional | MISSING if no book |
| `relativeStrength` | ratio | optional | benchmark metadata | optional missing reported |

## Setup / Trigger / Ranking Separation

- Data validity: warmup + required feature coverage
- Universe eligibility: PR01 contract (not auto-promoted)
- Setup qualification: price move + flow confirmation (producer mode requires signed buy flow)
- Entry trigger: setup qualified + positive acceleration + flow threshold + not exhausted
- Ranking score: separate composite (`rankingScore`)
- Economics evidence: PR01 `buildTradeEconomicsRecord` (`KNOWN` only with explicit cost/move inputs)
- Execution authorization: ER03 unchanged

## Lifecycle Rules

- Duplicate `signalId` → `DUPLICATE_SIGNAL_SUPPRESSED`
- Rearm only via explicit setup re-qualification (`REARM_SETUP_QUALIFIED`)
- `EXPIRED` / `INVALIDATED` terminal states block new triggers
- Router-only evaluations (no trades in context) do not mutate durable lifecycle store

## Economics

- Setup validity and economics evidence are separate
- AI score is not used as expected move
- Unknown cost → economics `UNKNOWN`; no net edge claim
- MFE not used as ex-ante expected move

## Recorded Market Data

- `MARKET_BEHAVIOR_ANALYSIS=NOT_RUN`
- Synthetic fixture replay used for contract/determinism tests only

## Test / Typecheck / Build

- `tests/pr02-early-acceleration.test.ts` → 38/38 PASS (3 consecutive runs)
- PR01 + ER01–ER03 + P4 regression bundle → 147/147 PASS
- `npm run typecheck` → exit 0
- `npm run build` → exit 0

## Open Blockers

| ID | Severity | Reason |
|---|---|---|
| PR02-DATA-01 | P0 | No provenance-recorded market dataset for behavior analysis |
| ER06-A | P0 | Disposable PostgreSQL unavailable for ER04 realized-net joins |
| PR02-DATA-02 | P1 | Historical listing metadata still partial for full point-in-time universe |

## Handoff

### Prompt 9 (MOMENTUM/RETEST)
- Shared lifecycle transition contract from `pr02-early-setup.ts`
- Feature producer pattern from `pr02-early-features.ts`
- Router delegation pattern in P4

### Prompt 10 (Exit models)
- `invalidationReason`, exhaustion assessments, `validUntil` on triggers
- Economics UNKNOWN separation preserved for exit comparison
