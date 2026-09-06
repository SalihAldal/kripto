# KRIPTO FINAL QA — REQUIREMENT MATRIX

| Req ID | Phase | Expected | Production Path | Test | Evidence | Result |
|---|---|---|---|---|---|---|
| ER01-01 | ER01 | Structured ENTER/WAIT/REJECT | `er01-telemetry-verdict.ts` | `er01-telemetry-verdict.test.ts` | 28 tests | PASS |
| ER01-02 | ER01 | No fake PASS on missing evidence | `resolveTerminalEvidence` | er01 tests | Tested | PASS |
| ER02-01 | ER02 | Feature provenance to router | `er02-feature-contract.ts` → `routeStrategies` | er02 tests (30) | Tested | PASS |
| ER02-02 | ER02 | Missing data not neutralized | `buildFeatureContractSnapshot` | er02 + qa12-I | Tested | PASS |
| ER03-01 | ER03 | Single admission authority | `er03-canonical-policy.ts` | er03 + p1 tests | Tested | PASS |
| ER03-02 | ER03 | Paper skips only explicit execution diff | `resolveExecutionAuthorization` | er03 tests | Tested | PASS |
| ER04-01 | ER04 | StrategyId preserved | `execution-orchestrator.service.ts` | p0-paper-persistence | Tested | PASS |
| ER04-02 | ER04 | Durable claim | `execution-attempt-lock.service.ts` | er04 tests | Tested | PASS |
| ER04-03 | ER04 | Settlement crash/reconcile | `settleOpenPosition` | settlement.integration | DB missing | BLOCKED |
| ER05-01 | ER05 | Immutable first detection | `canonical-dataset.ts` | er05 + phase05 | Tested | PASS |
| ER05-02 | ER05 | Horizon boundary causal | `buildOutcomeHorizonRows` | qa12-N, phase05 | Tested | PASS |
| ER06-01 | ER06 | Fail-closed on BLOCKED checks | `qa12-final-assessment.ts` | er06 + qa12-Q | Tested | PARTIAL |
| ER06-02 | ER06 | Bounded smoke live | ER06 report path | — | Not run | NOT_RUN |
| PR01-01 | PR01 | Net economics separation | `pr01-economics.ts` | pr01 tests (39) | Fixture only | PARTIAL |
| PR01-02 | PR01 | Historical universe | `pr01-universe.ts` | pr01 tests | Metadata partial | PARTIAL |
| PR02-01 | PR02 | Early lifecycle causal | `pr02-early-evaluator.ts` | pr02 tests (38) | Fixture | PARTIAL |
| PR03-01 | PR03 | Breakout/momentum lifecycle | `pr03-*-evaluator.ts` | pr03 tests (45) | Fixture | PARTIAL |
| PR03-02 | PR03 | Invalidation at entry | `pr04-exit-bridge.ts` | qa12-M | QA12 fix | PASS |
| PR04-01 | PR04 | Exit policy snapshot frozen | `pr04-exit-evaluator.ts` | pr04 tests (45) | Tested | PASS |
| PR04-02 | PR04 | Trailing causal one-way | `pr04-trailing.ts` | pr04 tests | Tested | PASS |
| PR04-03 | PR04 | Partial close settlement | `pr04-exit-bridge.ts` | — | Not wired | BLOCKED |
| PR04-04 | PR04 | Live exit eval default off | `EXECUTION_PR04_EXIT_EVAL_ENABLED` | pr04-45, qa12-P | Tested | PASS |
| PR05-01 | PR05 | Locked experiment manifest | `pr05-experiment-manifest.ts` | pr05 tests | Tested | PASS |
| PR05-02 | PR05 | Market replay comparison | `pr05-offline-comparison.ts` | pr05 + qa12-O | No market data | BLOCKED |
| QA12-01 | QA12 | Integrated chain A–Q | `qa12-integrated-chain.test.ts` | 17 tests ×3 | Tested | PASS |

**Legend:** PASS = tested and holds; PARTIAL = code+tests OK, market/DB gap; BLOCKED = cannot verify; NOT_RUN = not executed.
