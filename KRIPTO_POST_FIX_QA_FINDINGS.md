# KRIPTO POST-FIX QA — FINDINGS

## PFQA-FIXED-01 (HIGH) — FIXED
- **Requirement:** FIX01-INV-01
- **File:** pr02-early-evaluator.ts:buildEarlyStructuralInvalidation
- **Expected:** EARLY_BASELINE_STRUCTURE_BREACH invalidation at entry
- **Actual:** Implemented and DB-persisted in chain 5
- **Impact:** Exit policy lacked structural stop reference
- **Fix:** buildEarlyStructuralInvalidation + freezeSelectedStrategySignal
- **Regression:** post-fix-final-qa.integration.test.ts chain 5

## PFQA-FIXED-02 (HIGH) — FIXED
- **Requirement:** FIX02-SETTLE-01
- **File:** fix02-exit-routing.service.ts
- **Expected:** Partial close via settleOpenPosition
- **Actual:** OPEN position with reduced quantity after partial
- **Impact:** Accounting divergence
- **Fix:** processFix02Pr04ExitTick → settleOpenPosition
- **Regression:** fix02-durable-exit-and-settlement.integration.test.ts

## PFQA-FIXED-03 (HIGH) — FIXED
- **Requirement:** FIX02-DB-01
- **File:** fix02-exit-persistence.service.ts
- **Expected:** PostgreSQL snapshot + mutable state
- **Actual:** PositionExitPersistedState with version conflict detection
- **Impact:** Restart lost exit state
- **Fix:** bootstrapExitPersistenceAtEntry + restoreExitPolicyStateFromDb
- **Regression:** fix02 test 1-2

## PFQA-OPEN-01 (MEDIUM) — OPEN
- **Requirement:** CRASH-FULL-01
- **File:** fix02 integration harness
- **Expected:** Independent process restart from DB
- **Actual:** In-process restart/restore + idempotency covered; no forked worker crash injection
- **Impact:** Residual reconciliation risk under hard kill
- **Fix:** Future dedicated crash-injection harness
- **Regression:** PARTIAL — fix02 subset

## PFQA-OPEN-02 (HIGH) — NOT_RUN
- **Requirement:** PR05-MARKET-01
- **File:** pr05-data-inventory.ts
- **Expected:** Recorded market replay for profitability
- **Actual:** engineering-synthetic-v1 only (NOT_FIT for market experiment)
- **Impact:** PROFITABILITY_EVIDENCE cannot be established
- **Fix:** Data collection out of scope
- **Regression:** N/A

## PFQA-OPEN-03 (MEDIUM) — NOT_RUN
- **Requirement:** FIX03-PORT-01
- **File:** pr05-portfolio-replay.ts
- **Expected:** Full portfolio replay on recorded data
- **Actual:** Engineering fixture with capital constraint verified
- **Impact:** Portfolio-level market evidence missing
- **Fix:** Requires recorded package
- **Regression:** fix03 test 27
