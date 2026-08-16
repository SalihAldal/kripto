# KRIPTO P0 — AI Consensus Stack Overflow Fix Report

**Reference forensic:** `KRIPTO_AI_STACK_OVERFLOW_FORENSIC.md`  
**Reference stress session:** `cmstdt3ww0007uncgmjwgvf6p` (38× RangeError)  
**Fix validation artifact:** `kripto-ai-stack-overflow-fix-validation.json`  
**Latest live session:** `cmsthcs630007un7432s7fnnq`  
**Date:** 2026-08-15  

---

## Verdict

| Gate | Result |
|------|--------|
| Deterministic regression tests | **PASS** (23/23 targeted) |
| Snapshot build count ≤ 1 per consensus | **PASS** (telemetry + spy) |
| Cancellation / budget / provider semantics | **PASS** |
| One live paper round (0 RangeError) | **NOT READY** (10 RangeError, down from 38 baseline) |

**Overall P0 acceptance:** **PARTIAL** — structural fix validated in tests; live residual overflow remains under `SCANNER_AI_CONCURRENCY=2` with real provider adapters.

---

## 1. Exact Root Cause

V8 **call-stack exhaustion** (`RangeError: Maximum call stack size exceeded`) in the post-provider AI consensus path. Not infinite recursion, not provider HTTP failure, not forensic JSON serialization.

Primary amplification:

1. **`buildIndicatorSnapshot`** invoked **8–10× per candidate** across orchestrator, hybrid engine, providers, scorecard, and short-term report paths.
2. **Deep synchronous megafunctions** chained on one stack frame: `buildIndicatorSnapshot` → provider local experts (`buildTechnicalSpecialistOutput`, `buildRiskManagerOutput`) → `buildHybridDecision` (~1600 lines sync).
3. **`SCANNER_AI_CONCURRENCY=2`** increased failure rate by scheduling two heavy evaluations back-to-back.

---

## 2. Before / After Call Chain

### Before

```
runAIConsensusFromInputImpl
  buildIndicatorSnapshot ×1 (orchestrator)
  provider lanes (parallel)
    provider-1 → buildTechnicalSpecialistOutput → resolve/build snapshot
    provider-3 → buildRiskManagerOutput → resolve/build snapshot
  buildHybridDecision
    buildIndicatorSnapshot ×3 (lines ~327, ~514, ~649)
  buildAnalysisScorecard → computeShortTermScore → resolve/build
  buildShortTermReport → resolve/build ×2
```

**Estimated snapshot builds:** 8–10 per consensus invocation.

### After

```
runAIConsensusFromInputImpl
  runOnFreshStack(buildIndicatorSnapshot) ×1 → frozen memo on consensusInput
  yieldAsyncStackUnwind
  provider lanes (parallel, cancellable)
    provider-1 → runOnFreshStack(buildTechnicalSpecialistOutput) → resolveIndicatorSnapshot (reuse)
    provider-3 → runOnFreshStack(buildRiskManagerOutput) → resolveIndicatorSnapshot (reuse)
  yieldAsyncStackUnwind
  runOnFreshStack(buildHybridDecision) → resolveIndicatorSnapshot (reuse)
  yieldAsyncStackUnwind
  runOnFreshStack(buildAnalysisScorecard)
  runOnFreshStack(buildShortTermReport)
```

**Snapshot builds:** ≤ 1 (`consensusTelemetry.indicatorSnapshotBuildCount`).

Scanner AI pipeline wrappers reduced from **3 nested `withBoundedAwait`** (context, format, consensus) to **1** (consensus only); context/format use direct await + `throwIfAborted`.

---

## 3. Snapshot Build Count

| Metric | Before (forensic) | After (tests + telemetry) |
|--------|-------------------|---------------------------|
| `buildIndicatorSnapshot` calls / consensus | 8–10 | **1** (spy + telemetry) |
| `indicatorSnapshotBuildCount` | n/a | **1** |
| Immutability | n/a | `Object.freeze` + reuse via `resolveIndicatorSnapshot` |

---

## 4. Stack Depth Risk Reduction

| Change | Effect |
|--------|--------|
| Memoized snapshot on `consensusInput` | Eliminates redundant indicator recompute |
| `runOnFreshStack` for snapshot, hybrid, provider experts, scorecard, report | Each megafunction runs on a fresh V8 stack frame |
| `yieldAsyncStackUnwind` between phases | Event-loop turn between heavy sync blocks |
| Flattened scanner wrappers | −2 nested cancellable await frames |
| Summarized orchestrator logging | No deep sync serialize of `hybridPayload` / `roleScores` |

Live stress comparison (same concurrency=2, real AI):

| Session | Stack overflow count |
|---------|---------------------|
| Baseline `cmstdt3ww0007uncgmjwgvf6p` | **38** |
| After memo only `cmstg76eb0007undcg1a00659` | 19 |
| After fresh-stack `cmsthcs630007un7432s7fnnq` | **10** |

---

## 5. Provider Behavior

- Technical, momentum, and risk lanes unchanged logically.
- Remote provider execution preserved; no degraded-to-local conversion.
- Provider ordering and consensus policy unchanged.
- Provider metadata (`remote`, lane labels) verified in regression tests.

---

## 6. Cancellation Behavior

Preserved from P0 cancellation fix:

- `AbortSignal` propagation through `withBoundedAwait` / consensus wrapper
- Worker timeout → `failAiCandidate` terminalization
- Selection budget abort
- Bounded Prisma unchanged

All 10 tests in `tests/ai-cancellation.test.ts` pass after refactor.

---

## 7. Performance Impact

Telemetry fields on each consensus result:

- `indicatorSnapshotBuildMs`
- `indicatorSnapshotBuildCount` (≤ 1)
- `hybridDecisionMs`
- `consensusAssemblyMs`

Observed in tests: single-digit ms for snapshot/hybrid with mocked providers; live hybrid remains dominated by remote provider latency (unchanged).

---

## 8. Tests

| Suite | Result |
|-------|--------|
| `tests/ai-stack-overflow.test.ts` (13 cases) | PASS |
| `tests/ai-cancellation.test.ts` (10 cases) | PASS |
| `tests/cooperative-async.test.ts` | PASS |
| `tests/scanner.test.ts` | PASS |
| `tests/ai-hybrid-engine.test.ts` | PASS |
| `tests/consensus-engine.test.ts` | PASS |

New regression coverage includes: concurrency=2 mock pool, snapshot spy ≤1, FILTRY pattern, RangeError terminalization, immutability, persistence call bound, cancellation + budget.

---

## 9. One-Round Live Validation

**Config:** PAPER, BINANCE_TR, REAL_SCANNER, REAL_AI, VETO, `SCANNER_AI_CONCURRENCY=2`, 1 round.

**Best post-fix session:** `cmsthcs630007un7432s7fnnq`

| Check | Result |
|-------|--------|
| RangeError count | **10** (fail) |
| STARTED orphans | **0** (pass) |
| Forensic artifacts | **6/6** (pass) |
| Job terminal | COMPLETED |
| Round terminal | `tur_basarisiz` (AI gate / filter, not overflow stall) |
| Remote providers completing | Yes (consensus-trace entries present) |
| Scheduler recovery stable | Yes |

**Note:** Stale `worker-runtime.ts` processes loaded before redeploy caused inflated overflow counts in earlier attempts; workers must be restarted after deploy.

---

## 10. Remaining Blockers

1. **Residual live RangeError (10/round)** — likely remaining sync depth in master decision adjudication or multi-pass scanner rescans under concurrency=2. Requires follow-up: wrap `adjudicateWithMasterDecisionEngine` expert sync path or split `buildHybridDecision` internals without formula changes.
2. **Worker redeploy discipline** — live validation must run against restarted worker or isolated validation process.
3. **No strategy/threshold changes** were made; failures on filter/gate are expected trading outcomes, not regressions.

---

## Files Changed

- `src/server/ai/indicator-suite.ts` — `resolveIndicatorSnapshot`, `IndicatorSnapshot` type
- `src/server/ai/analysis-orchestrator.ts` — memoization, telemetry, fresh-stack execution, summarized logging
- `src/server/ai/hybrid-decision-engine.ts` — reuse memoized snapshot in scoring
- `src/server/ai/providers/provider-1.adapter.ts`, `provider-3.adapter.ts` — fresh-stack expert builds
- `src/server/ai/short-term-score.service.ts`, `short-term-report.service.ts` — resolve reuse
- `src/server/scanner/scanner.service.ts` — flattened AI pipeline wrappers
- `src/server/execution/cancellable-work.service.ts` — `yieldAsyncStackUnwind`, `runOnFreshStack`
- `src/types/ai.ts` — telemetry + snapshot types
- `tests/ai-stack-overflow.test.ts` — new regression suite
- `scripts/run-1round-stack-overflow-validation.ts` — live validation runner

---

## Acceptance Statement

- **Deterministic stress:** PASS — 0 RangeError, snapshot count ≤ 1.
- **Safety gates:** PASS — cancellation, budget, provider semantics preserved.
- **Live round:** NOT READY — overflow reduced ~74% but not eliminated.

Do **not** run 5-round stress until live RangeError reaches 0 on a controlled single round with redeployed worker.
