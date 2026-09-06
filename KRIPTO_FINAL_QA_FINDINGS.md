# KRIPTO FINAL QA — FINDINGS

## Fixed in QA12

### QA12-FIX-01 (HIGH)
- **Requirement:** PR04-INVALID-01
- **File:** `pr04-exit-bridge.ts`, `execution-orchestrator.service.ts`
- **Issue:** Orchestrator passed `invalidation: null` at position open
- **Fix:** `resolveInvalidationForSelectedStrategy()` for MOMENTUM/BREAKOUT
- **Regression:** `tests/qa12-integrated-chain.test.ts` (M)
- **Verification:** PASS

### QA12-FIX-02 (MEDIUM)
- **Requirement:** QA12 integrated scenarios
- **Files:** `tests/qa12-integrated-chain.test.ts`, `qa12-final-assessment.ts`
- **Fix:** 17-scenario chain test + verdict module
- **Verification:** 17/17 ×3 PASS

## Open — CRITICAL

### QA12-OPEN-01
- **Severity:** CRITICAL
- **Requirement:** ER04-03
- **Issue:** Disposable PostgreSQL unavailable (`localhost:5432`)
- **Impact:** Settlement integration, crash reconciliation unverified
- **Status:** BLOCKED

## Open — HIGH

### QA12-OPEN-02
- **Severity:** HIGH
- **Requirement:** PR05-02
- **Issue:** No recorded market replay package
- **Impact:** Profitability evidence cannot be established
- **Status:** BLOCKED

### QA12-OPEN-03
- **Severity:** HIGH
- **Requirement:** PR04-PERSIST-01
- **Issue:** Exit policy state in-memory only
- **Status:** OPEN

### QA12-OPEN-04
- **Severity:** HIGH
- **Requirement:** PR04-SETTLE-01
- **Issue:** Partial close not wired to settlement
- **Status:** OPEN

### QA12-OPEN-05
- **Severity:** HIGH
- **Requirement:** PR02 invalidation
- **Issue:** EARLY_ACCELERATION has no `InvalidationContract`
- **Status:** OPEN

## Open — MEDIUM

### QA12-OPEN-06
- Holdout provenance unknown
### QA12-OPEN-07
- ER05 negative control shuffle NOT_IMPLEMENTED (fail-closed by design)
### QA12-OPEN-08
- Full portfolio replay NOT_RUN
