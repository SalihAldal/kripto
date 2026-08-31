# KRIPTO P0 Final Stack and Liveness Fix

## 1) Stack Overflow Root Cause
- Root cause is **not** AI formula recursion in hybrid/indicator/scorecard/report phases.
- First synchronous crash point is in Prisma runtime serialization:
  - `@prisma/client/runtime/core/jsonProtocol/serializeJsonQuery.ts`
  - `serializeArgumentsValue` -> `serializeArgumentsObject` -> `serializeArgumentsArray`
- This path was triggered from AI decision observability payload persistence (deep/cyclic JSON candidate metadata paths).

## 2) Exact Offending Call Path
- `runAIConsensusFromInput(...)`
- `observeAiDecision(...)`
- `upsertDecisionLogRecord(...)`
- Prisma JSON serialization stack overflow (`Maximum call stack size exceeded`).

## 3) Stack-Safety Fixes Applied
- Added phase-level guarded execution telemetry in `analysis-orchestrator`:
  - `indicator_snapshot`
  - `technical_specialist`
  - `momentum_specialist`
  - `risk_specialist`
  - `hybrid_decision`
  - `analysis_scorecard`
  - `short_term_report`
  - `master_adjudication`
- Added deterministic stack-depth guard error type:
  - `AI_STACK_DEPTH_GUARD`
- Added phase trace telemetry fields:
  - `phase`, `freshStackUsed`, `phaseDurationMs`, `depthRiskStatus`, `stackDepth`
- Hardened AI decision observability path:
  - `observeAiDecision` failures no longer crash/abort consensus result.
- Added bounded/cycle-safe JSON sanitizer for decision log JSON fields before Prisma write.

## 4) Candidate Isolation
- Scanner AI failure mapping now includes:
  - `AI_STACK_DEPTH_GUARD`
  - stack-top capture (first trace lines)
- Candidate-level failure continues to release pool slot via existing cooperative pool isolation.

## 5) Long-Loop / Liveness Changes
- Extended runtime snapshot progress model with:
  - `lastMeaningfulProgressAt`
  - `lastPumpProgressAt`
  - `lastTDIProgressAt`
  - `aiStarted`, `aiFailed`, `tdiProcessed`, `executionReady`
- Added richer progress states:
  - `SCANNER_ACTIVE`, `AI_ACTIVE`, `TDI_ACTIVE`
  - `WAITING_FOR_RETRY`, `WAITING_FOR_PROVIDER`, `WAITING_FOR_DB`
  - `TERMINALIZING`, `BUDGET_EXCEEDED`
- Added `round-hang-snapshot.json` artifact writer and emitted manual safety snapshot for stalled run:
  - `artifacts/forensics/job-cmsz9hkmi0009un9wvgfystkf/rounds/1/round-hang-snapshot.json`

## 6) Tests
- Executed:
  - `tests/ai-stack-overflow.test.ts`
  - `tests/ai-cancellation.test.ts`
  - `tests/round-progress-state.test.ts`
- Result: PASS.
- Added/updated checks include:
  - guarded stack behavior
  - phase telemetry presence
  - concurrency isolation continuation
  - observability RangeError isolation from consensus result

## 7) Controlled 2-Round Validation
- Command:
  - `SCANNER_AI_CONCURRENCY=2 pnpm tsx scripts/_p1-scanner-entry-2round-validation.ts`
- Validation Run A (pre-observability-sanitizer patch):
  - `Maximum call stack size exceeded`: **12**
  - `AI evaluation skipped for candidate`: **6**
- Validation Run B (post patch):
  - `Maximum call stack size exceeded`: **0**
  - `AI evaluation skipped for candidate`: **0**
- Runtime outcome:
  - Round advanced deeply in round-1.
  - Round became non-productive before finishing 2/2 rounds.
  - Safety stop applied and job stopped cleanly.

## 8) Before / After Metrics
- RangeError count: `12 -> 0`
- AI orphan (`STARTED`) observed in targeted tests: `0`
- Round orphan (`RUNNING` unresolved after manual stop): risk remains in live validation
- Scanner progress gap: improved logging/phase visibility, but one non-productive window remained
- AI progress gap: phase traces present; no stack overflow in patched run
- Retry count: bounded in runtime persistence path
- Watchdog actions: manual safety stop still required in patched run
- Round completion: `0/2` in final validation run
- Manual stop count: `1`

## 9) Remaining Blockers
- 2/2 terminal round proof still missing.
- Non-productive RUNNING window still reproducible under long scan loop.
- Automatic stall terminalization did not preempt manual safety stop in this run.

## 10) Final Verdict
- AI_STACK_STABILITY = PASS
- ROUND_LIVENESS = PARTIAL
- SCANNER_RUNTIME = PARTIAL
- DB_RESILIENCE = PASS
- AI_PARITY = PASS
- TWO_ROUNDS_COMPLETED = NO
- MANUAL_STOP_REQUIRED = YES
- READY_FOR_5_ROUNDS = CONDITIONAL
- READY_FOR_30_50_ROUNDS = NO
- READY_FOR_50_ROUND_PAPER = NO
