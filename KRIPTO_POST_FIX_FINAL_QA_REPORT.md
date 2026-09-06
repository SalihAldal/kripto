# KRIPTO POST-FIX FINAL QA REPORT

## Fingerprints

| Field | Value |
|---|---|
| HEAD | `695c9f07ee475d5b4a338cfade769e8825e4ac98` |
| Worktree | DIRTY_POST_FIX_QA |
| Content fingerprint | `c6bc56708984b7c2` |
| Node/NPM | v24.13.0 / 11.6.2 |
| Test DB | kripto_fix02_* (disposable via Docker) |
| Data packages | engineering-synthetic-v1 (synthetic, NOT_FIT market) |

## Executive Verdicts

- `FINAL_ENGINEERING_VERDICT` = PARTIAL
- `STRATEGY_CONTEXT_AND_IDENTITY_VERDICT` = PASS
- `DURABLE_EXIT_AND_SETTLEMENT_VERDICT` = PASS
- `CRASH_RECONCILIATION_VERDICT` = PARTIAL
- `DATA_INGESTION_AND_REPLAY_VERDICT` = PARTIAL
- `NEGATIVE_CONTROL_IMPLEMENTATION_VERDICT` = PASS
- `ASSESSMENT_TRUSTWORTHINESS_VERDICT` = PASS
- `FULL_CHAIN_DB_VERDICT` = PASS
- `REQUIRED_CHECKS_NOT_RUN` = PR05-MARKET-01,FIX03-PORT-01,ER06-SMOKE-01
- `OPEN_CRITICAL_COUNT` = 0
- `OPEN_HIGH_COUNT` = 0
- `PROFITABILITY_EVIDENCE` = INSUFFICIENT_DATA
- `OVERALL_QA_STATUS` = QA_PENDING
- `PAPER_CAMPAIGN_STARTED` = false
- `LIVE_AUTHORIZATION` = DISABLED

## Test Runs

| Command | Exit | Passed | Failed | Duration |
|---|---|---|---|---|
| `post-fix-final-qa.integration.test.ts x3` | 0 | 27 | 0 | 34987ms |
| `fix02-durable-exit-and-settlement.integration.test.ts x3` | 0 | 24 | 0 | 38269ms |
| `fix01+fix03+pr05+qa12+er04+er05 regression` | 0 | 104 | 0 | 2470ms |
| `npm run typecheck` | 0 | 0 | 0 | 15716ms |
| `npm run build` | 0 | 0 | 0 | 575426ms |

## Report Validity

- **KRIPTO_FIX01_STRATEGY_CONTEXT_AND_INVALIDATION_REPORT.md**: PARTIALLY_VALID
- **KRIPTO_FIX02_DURABLE_EXIT_AND_SETTLEMENT_REPORT.md**: PARTIALLY_VALID
- **KRIPTO_FIX03_OFFLINE_PIPELINE_AND_EVIDENCE_REPORT.md**: VALID
- **KRIPTO_FINAL_QA_12_REPORT.md**: SUPERSEDED
- **KRIPTO_FINAL_QA_FINDINGS.md**: SUPERSEDED

## Integration Chains Verified

1. **EARLY** — producer context → trigger → `freezeSelectedStrategySignal` → `structuralInvalidation` in entry metadata
2. **Empty context** — PR02/PR03 strategies not triggered; `selectedSignal=null` (no fixture fallback)
3. **BREAKOUT** — router → frozen signal → `LEVEL_HOLD_BREACH` in snapshot
4. **PostgreSQL** — EARLY invalidation → `bootstrapExitPersistenceAtEntry` → restart restore → partial settlement
5. **Idempotency** — duplicate `settlementFillId` does not double-account
6. **Claim fence** — wrong owner cannot release durable lock
7. **FIX03** — loader → engineering comparison → causal NC → assessment (no PnL shuffle)

## Engineering vs Market Evidence

| Layer | Status |
|---|---|
| Production code wiring (FIX01–03) | Verified on real modules |
| Disposable PostgreSQL E2E | PASS (`kripto-main-postgres-1`) |
| Recorded market replay | NOT_RUN |
| Profitability claim | INSUFFICIENT_DATA |

## Safe Commands

```bash
npm run test:run -- tests/post-fix-final-qa.integration.test.ts
npm run test:run -- tests/fix02-durable-exit-and-settlement.integration.test.ts
POST_FIX_QA_EVIDENCE_ONLY=1 POST_FIX_QA_SKIP_BUILD=1 npx tsx scripts/generate-post-fix-final-qa.ts
```

## Superseded Claims

- QA12-OPEN-03 exit state in-memory only (FIX02 DB persistence)
- QA12-OPEN-04 partial close not wired (FIX02 settlement path)
- QA12-OPEN-05 EARLY lacks invalidation (FIX01 buildEarlyStructuralInvalidation)
- QA12 placeholder expect(true) durable claim
- PR05 shuffle-only negative control
- buildQa12FinalAssessment hardcoded phase verdicts
- QA12-OPEN-01 disposable PostgreSQL unavailable (re-verified available in post-fix QA)