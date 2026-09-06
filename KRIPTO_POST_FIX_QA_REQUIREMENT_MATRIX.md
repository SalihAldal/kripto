# KRIPTO POST-FIX QA — REQUIREMENT MATRIX

| Req ID | Phase | Expected | Production Path | Test | DB | Market | Result |
|---|---|---|---|---|---|---|---|
| FIX01-CTX-01 | FIX01 | Producer context reaches router without fixture fallback | execution-orchestrator.service.ts | fix01-strategy-context-and-invalidation.test.ts | N | N | PASS |
| FIX01-SIG-01 | FIX01 | Selected signal frozen to entry metadata | execution-orchestrator.service.ts | post-fix-final-qa.integration.test.ts | N | N | PASS |
| FIX01-INV-01 | FIX01 | EARLY structural invalidation at entry | pr04-exit-bridge.ts | post-fix-final-qa.integration.test.ts chain 5 | Y | N | PASS |
| FIX02-DB-01 | FIX02 | Exit state persists and restores from PostgreSQL | fix02-exit-routing.service.ts | fix02-durable-exit-and-settlement.integration.test.ts | Y | N | PASS |
| FIX02-SETTLE-01 | FIX02 | PR04 partial routes through canonical settlement | settleOpenPosition | fix02 + post-fix chain 5 | Y | N | PASS |
| FIX02-CLAIM-01 | FIX02 | Durable claim owner fence | claimDurableCanonicalExecutionAttempt | fix02 + post-fix chain 7 | Y | N | PASS |
| CHAIN-DB-01 | CHAIN | Context → DB position → exit → settlement single chain | post-fix-final-qa.integration.test.ts | post-fix chain 5 | Y | N | PASS |
| FIX03-LOADER-01 | FIX03 | Replay package schema/hash/path validation | loadPr05ReplayPackage | fix03-offline-pipeline-and-evidence.test.ts | N | N | PASS |
| FIX03-NC-01 | FIX03 | Causal entry shift negative control | runCausalEntryShiftNegativeControl | fix03 + post-fix chain 8 | N | N | PASS |
| FIX03-SPLIT-01 | FIX03 | Split-isolated aggregates | aggregateTradeOutcomes | fix03-offline-pipeline-and-evidence.test.ts | N | N | PASS |
| FIX03-PORT-01 | FIX03 | Capital-constrained portfolio replay | runPortfolioReplay | fix03-offline-pipeline-and-evidence.test.ts | N | N | PARTIAL |
| QA-ASSESS-01 | QA | Evidence-driven assessment blocks false PASS | buildQa12FinalAssessment | post-fix-final-qa.integration.test.ts chain 9 | N | N | PASS |
| PR05-MARKET-01 | PR05 | Recorded market profitability experiment | runPr05OfflineComparison | — | N | N | NOT_RUN |
| ER06-SMOKE-01 | ER06 | Bounded live smoke preflight | — | — | N | N | NOT_RUN |
| CRASH-FULL-01 | FIX02 | Process-level crash A–F injection on real DB | — | partial via fix02 | Y | N | PARTIAL |