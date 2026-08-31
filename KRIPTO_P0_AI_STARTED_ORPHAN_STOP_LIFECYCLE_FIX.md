# KRIPTO P0/P1 — AI_STARTED ORPHAN + STOP LIFECYCLE FIX

## Scope
- Runtime lifecycle correctness fix only; no new paper run.
- TDI/momentum/confidence/risk/sizing/exit/Variant_D/policy untouched.

## Root Cause
- AI_STARTED_orphan was created by pre-AI spread early return without terminal state and by stop/finalization paths missing deterministic terminal sweep for in-flight STARTED AI records.

## Exact Answers
1. `AI_STARTED` write function: `startAiCandidate()` (`src/server/forensics/ai-runtime.service.ts`), caller scanner AI worker (`src/server/scanner/scanner.service.ts`).
2. AI `STARTED` kalma nedeni: pre-AI spread gate erken return + stop/finalization path sweep eksigi.
3. Kritik Promise/Abort/Retry patikasi: scanner AI worker -> pre-AI context/spread gate return; stop pathte job terminalize olurken AI row STARTED kalabiliyordu.
4. `stopRequested` artik aktif/queued AI'ya ulasiyor: job stop ve round finalize pathlerinde sweep eklendi.
5. Stop sonrasinda AI retry baslayamaz (test 17 PASS).
6. Persistence race mumkun: gec gelen completion/fail callback; guard ile open-row yoksa no-op yapildi.
7. Orphan ureten order: stop/job terminalize -> clear/cancel -> AI STARTED row sweep edilmeme.
8. Minimum fix: pre-AI terminal write + centralized sweep helper + finally sweep + idempotent transition guard.
9. Startup/preflight reconciliation bozulmadi; canonical orphan kriteriyle sweep uyumlu.
10. 17 lifecycle senaryosu PASS.
11. TDI/AI policy/risk/sizing degismedi.
12. Yeni 5-round hazirlik: YES.

## Final Verdict
- ROOT_CAUSE = AI_STARTED_orphan was created by pre-AI spread early return without terminal state and by stop/finalization paths missing deterministic terminal sweep for in-flight STARTED AI records.
- FIX_IMPLEMENTED = YES
- AI_STARTED_ORPHAN_BEFORE = 53
- AI_STARTED_ORPHAN_AFTER = 0
- STOP_PROPAGATION = PASS
- ABORT_PROPAGATION = PASS
- RETRY_AFTER_STOP = NO
- PERSISTENCE_RACE = YES
- TERMINALIZATION_ORDER_FIXED = YES
- ORPHAN_RECONCILIATION = PASS
- LIFECYCLE_TESTS = 17/17
- TDI_UNCHANGED = YES
- AI_POLICY_UNCHANGED = YES
- RISK_SIZING_UNCHANGED = YES
- READY_FOR_5_ROUND = YES
- NEXT_STEP = ayrik bir task ile yeni 5-round paper validation baslatilabilir.
