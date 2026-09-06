# KRIPTO PR04 — ÇIKIŞ VE POZİSYON YÖNETİMİ

## Executive Verdict

- `PROMPT10_ENGINEERING_VERDICT=PARTIAL`
- `EXIT_POLICY_CONTRACT_VERDICT=PASS`
- `STRUCTURAL_STOP_VERDICT=PASS`
- `TRAILING_CAUSALITY_VERDICT=PASS`
- `PARTIAL_EXIT_ACCOUNTING_VERDICT=PASS`
- `EXIT_IDEMPOTENCY_AND_RECOVERY_VERDICT=PARTIAL`
- `MATCHED_ENTRY_REPLAY_VERDICT=PASS`
- `MARKET_BEHAVIOR_ANALYSIS=NOT_RUN`
- `PROFITABILITY_EVIDENCE=NOT_ESTABLISHED`
- `EXIT_POLICY_WINNER=NOT_SELECTED`
- `STRATEGY_PROMOTION=NOT_EVALUATED`
- `OVERALL_QA_STATUS=QA_PENDING`
- `PAPER_CAMPAIGN_STARTED=false`
- `LIVE_AUTHORIZATION=DISABLED`

## Worktree Fingerprint

| Field | Start | End |
|---|---|---|
| HEAD | `a85a04677acc8dba27af3362f238f86a1d463ea5` | `a85a04677acc8dba27af3362f238f86a1d463ea5` |
| Branch | `main` | `main` |
| Worktree | `DIRTY` | `DIRTY` (PR04 + prior ER/PR changes) |

## Previous Behavior vs Fixes

| Issue | Before | After |
|---|---|---|
| Exit policy versioning | Implicit TP/SL in monitor only | Versioned `ExitPolicySnapshot` bound at entry; frozen on open position |
| Structural stop | PR02/PR03 invalidation not consumed at exit | `resolveStructuralStopFromInvalidation` maps `InvalidationContract` → stop level |
| Trailing | Scattered monitor logic; future-high risk | `updateCausalTrailing`: one-way long, high-water from post-entry observations, duplicate suppression |
| Partial TP | Event-only in monitor | `computePartialLegQuantity` with step-size/min-notional; fraction-of-initial base |
| Exit coordination | Multiple paths could race | `pickHighestPriorityDecision` + `shouldSuppressDuplicateExit` + reserved quantity contract |
| Matched entry compare | None | `MatchedEntryManifest` + `runPr04ExitReplayAnalysis` for Prompt 11 |
| Production activation | N/A | Shadow hook only; `EXECUTION_PR04_EXIT_EVAL_ENABLED` default **false** |

## Exit Authority Map (Production Chain)

```
execution-orchestrator (fill)
  → buildPr04ExitMetadataAtEntry (snapshot bound, experimentalMode=false by default)
  → bootstrapPr04ExitStateFromEntry (skipped unless flag enabled)
  → attachPositionMonitor
  → onTick → evaluatePr04ExitShadowTick (non-blocking, flag-gated)
  → [canonical] tp-sl-evaluator / smart-exit / timeout-closer / settleOpenPosition
  → paper-close-persistence / ER04 settlement
```

**Key findings:**
- Multiple monitors: single `startPositionMonitor` per `positionId`; PR04 shadow does not submit orders.
- Strategy identity: `selectedStrategyId` authoritative (ER04); exit policy uses `strategyId` on snapshot.
- Stop/trailing/TP race: PR04 coordinator defines priority; live path still uses existing monitor until flag enabled.
- Timeout: existing `closeByTimeoutWithExtension`; PR04 does not blind-retry on timeout.
- Partial fill: `applyExitFill` tracks `remainingQuantity`; settlement partial-close wiring **BLOCKED** (see blockers).
- Trailing: causal high-water only; unclosed candle does not arm trailing stop hit.
- Fees: `buildExitPnlSnapshot` / `allocateFeeAcrossFills`; third-asset fee → UNKNOWN.
- Restart: in-memory PR04 store; durable restore **BLOCKED** without DB migration.

## Exit Policy Family (A–E)

| ID | Hypothesis | Structural | Target | Trailing | Partial | Time |
|---|---|---|---|---|---|---|
| `BASELINE_FIXED_TP_SL` (A) | Current fixed TP/SL | No | Yes | No | No | No |
| `STRUCTURAL_STOP_TARGET` (B) | PR invalidation + fixed target | Yes | Yes | No | No | No |
| `STRUCTURAL_STOP_TRAIL` (C) | Structural + causal trailing | Yes | No | Yes (1.2% / 0.45%) | No | No |
| `STRUCTURAL_PARTIAL_TRAIL` (D) | 25% @ +2.5%, trail remainder | Yes | No | Yes (1.5% / 0.4%) | Yes | No |
| `STRUCTURAL_TIME_DECAY` (E) | Structural + 90m decay if progress < 0.5% | Yes | No | No | No | Yes |

All provisional parameters: `parameterSource=PROVISIONAL_CONFIG`. **No winner selected.**

## Risk / R Reference

- `buildRiskReference`: entry price, initial stop, quantity, entry fee; `includesFeesInBreakEven=true`.
- Price risk vs monetary risk separated; zero risk → R-multiple `UNKNOWN`.
- Initial R frozen after entry; trailing does not mutate `riskReference`.

## Production Integration (Shadow)

- `execution-orchestrator.service.ts`: snapshot metadata at position open.
- `position-monitor.service.ts`: `evaluatePr04ExitShadowTick` on tick (try/catch, non-blocking).
- `pr04-exit-bridge.ts`: `EXECUTION_PR04_EXIT_EVAL_ENABLED` env gate (default false).
- `experiment-registry.ts`: `pr04-exit-and-position-management-v1` (`PLANNED`, 5 variants).

## Matched Entry Manifest (Prompt 11)

Contract: `src/server/profitability/pr04-matched-entry-manifest.ts`

- `entrySignalId`, `strategyId`, `entryPolicyVersion`, fills, `riskReference`, `invalidation`, `featureEvidenceIds`, `replayWindow`, `manifestHash`.
- Variants share manifest; state stores isolated per `positionId` + policy.
- Portfolio outcome requires separate replay — not inferred from matched-exit-only stats.

## Test Evidence

| Command | Exit | Result |
|---|---|---|
| `npm run test:run -- tests/pr04-exit-and-position-management.test.ts` (×3) | 0 | 45/45 PASS each |
| `npm run test:run -- tests/er02-feature-contract-and-router-input.test.ts tests/er03-canonical-policy.test.ts tests/er04-durable-execution-attempt-lock.test.ts tests/er05-canonical-dataset-persistence.test.ts tests/pr01-opportunity-universe-and-net-economics.test.ts tests/pr02-early-acceleration.test.ts tests/pr03-momentum-and-retest.test.ts tests/p4-regime-strategy-shadow.test.ts` | 0 | 169/169 PASS |
| `npm run typecheck` | 0 | PASS |
| `npm run build` | 0 | PASS (compile + TS; Turbopack warnings only) |

## Open Blockers

| ID | Severity | Reason |
|---|---|---|
| PR04-DATA-01 | P0 | No recorded market dataset → full replay comparison `NOT_RUN` |
| PR04-PERSIST-01 | P1 | Exit policy state in-memory only; crash restart restore not DB-backed |
| PR04-SETTLE-01 | P1 | Partial close not wired to `settleOpenPosition` / `resolvePr04CloseQuantity` in live path |
| PR04-INVALID-01 | P1 | Orchestrator passes `invalidation: null` at entry; structural stop requires evaluator handoff |
| ER06-A | P0 | Disposable PostgreSQL unavailable for settlement integration tests |

## Prompt 11 Handoff

- Manifest builder: `src/server/profitability/pr04-matched-entry-manifest.ts`
- Policy registry: `src/server/profitability/pr04-policy-registry.ts`
- Replay harness: `src/server/profitability/pr04-replay.ts`
- Experiment: `pr04-exit-and-position-management-v1`
- JSON evidence: `kripto-pr04-exit-and-position-management.json`
- Forensics: `artifacts/forensics/pr04-assessment-20260906T125300+0300/`
