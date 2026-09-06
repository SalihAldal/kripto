# KRIPTO CORRECTIONS FINAL QA — FINDINGS

## CFQA-OPEN-01 (HIGH) — OPEN
- **Requirement:** EXEC-FULL-ATOMIC-01
- **File:** post-trade-settlement.service.ts / settleOpenPosition
- **Reproduction:** Full position close via STRUCTURAL_STOP_TARGET routes legacy settlement
- **Expected:** Full close uses applyCanonicalPartialSettlementFill or equivalent atomic tx
- **Actual:** Partial canonical; full close separate legacy path
- **Root cause:** Correction scope limited partial path only
- **Impact:** Full-close crash window may leave inconsistent order/position state
- **Fix:** Route full close through canonical settlement transaction
- **Regression:** NOT_RUN — full-close atomic test missing

## CFQA-OPEN-02 (HIGH) — NOT_RUN
- **Requirement:** EXEC-RECONCILE-01
- **File:** fix02-exit-routing.service.ts RECONCILE_REQUIRED
- **Reproduction:** Submit ack lost scenario
- **Expected:** Consumer resolves order and ingests fill or releases reservation
- **Actual:** Flag written; end-to-end consumer not exercised in QA
- **Root cause:** Reconciliation consumer not in test harness
- **Impact:** Stuck reservation or orphan reconcile state under ack loss
- **Fix:** Add controlled exchange boundary test driving reconcile consumer
- **Regression:** NOT_RUN

## CFQA-OPEN-03 (MEDIUM) — OPEN
- **Requirement:** EXEC-CRASH-01
- **File:** tests/helpers — ensureSingleActiveExitOrder mock
- **Reproduction:** Integration tests mock ensureSingleActiveExitOrder allowed:true
- **Expected:** Concurrent stop+TP race without mock proves no oversell
- **Actual:** Race F/G scenarios use coordinator mock
- **Root cause:** Test isolation avoids live order manager
- **Impact:** Double-sell protection not proven at integration layer
- **Fix:** Disposable DB test with real order-manager policy or documented BLOCKED
- **Regression:** execution-correction E partial

## CFQA-OPEN-04 (MEDIUM) — OPEN
- **Requirement:** CHAIN-SETTLE-01
- **File:** execution-orchestrator.service.ts
- **Reproduction:** ADV-STOP-01 seeds position manually
- **Expected:** Full production chain context→entry→partial→stop
- **Actual:** Settlement integration from seeded position only
- **Root cause:** Scope limit — no paper campaign
- **Impact:** Entry orchestrator wiring not re-verified in this QA
- **Fix:** Future QA with fixture market + orchestrator (out of scope)
- **Regression:** ADV-STOP-01 PASS for settlement slice

## CFQA-FIXED-01 (CRITICAL) — FIXED
- **Requirement:** EXEC-STOP-01
- **File:** pr04-exit-coordinator.ts shouldSuppressDuplicateExit
- **Reproduction:** Partial 0.5 terminal then stop at 90
- **Expected:** Stop fires for remaining 0.5 without ORDER_IN_FLIGHT
- **Actual:** ADV-STOP-01 PASS — STRUCTURAL_STOP, CLOSED, PnL rows
- **Root cause:** PARTIALLY_FILLED treated as blocking in-flight for completed partial
- **Impact:** Original bug blocked all post-partial stops
- **Fix:** releaseCompletedExitOrder + reservedSellQuantity guard
- **Regression:** corrections-final-qa ADV-STOP-01 + execution-correction A

## CFQA-FIXED-02 (HIGH) — FIXED
- **Requirement:** CHAIN-SETTLE-01
- **File:** execution.repository.ts closePositionRecord
- **Reproduction:** ADV-STOP-01 stop after partial: status CLOSED but quantity remained 1.5
- **Expected:** Terminal close zeros position quantity in DB
- **Actual:** closePositionRecord now sets quantity: 0
- **Root cause:** Legacy close path updated status only
- **Impact:** Closed positions reported open exposure in DB queries
- **Fix:** quantity: 0 on closePositionRecord
- **Regression:** ADV-STOP-01 PASS

## CFQA-FIXED-03 (MEDIUM) — FIXED
- **Requirement:** EXEC-CRASH-01
- **File:** tests/helpers/fix02-disposable-postgres.ts
- **Reproduction:** Integration tests saw missing table / concurrent FAILED
- **Expected:** Disposable DB migrate + fresh Prisma client per suite
- **Actual:** resetPrismaClientForFix02Tests clears global.__prisma__
- **Root cause:** Stale global Prisma singleton before DATABASE_URL swap
- **Impact:** False FAIL on otherwise valid settlement tests
- **Fix:** resetPrismaClientForFix02Tests in createFix02DisposablePostgres
- **Regression:** execution-correction F + ADV-CONCURRENT-01
