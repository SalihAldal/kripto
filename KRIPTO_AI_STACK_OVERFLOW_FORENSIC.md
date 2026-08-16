# KRIPTO P0 Forensic — AI Stack Overflow Under Concurrency

**Session:** `cmstdt3ww0007uncgmjwgvf6p`  
**Round:** 1  
**Run ID:** `cmstdt48d000luncg3wf3wki8`  
**Analysis date:** 2026-08-14  
**Method:** Artifact + log correlation, static call-chain analysis, deterministic stack probe  
**No code changes · No paper run**

---

## Executive Summary

**Root cause:** V8 **call-stack exhaustion** (not an infinite loop) in the **post-provider AI consensus hot path**. After all three provider lanes succeed remotely, synchronous work in `buildHybridDecision` and **8–10 redundant `buildIndicatorSnapshot` calls** per candidate exceeds the default Node stack. **`SCANNER_AI_CONCURRENCY=2`** amplifies failure rate (two deep stacks at once) but is not the sole mechanism.

**Classification:** `AI_ORCHESTRATOR` + `RECURSION` (stack depth)  
**Confidence:** **HIGH**  
**Forensic layer caused overflow:** **NO**  
**Provider blame:** **NO** (providers complete before overflow)

---

## 1. Exact Root Cause

The error is a native **`RangeError: Maximum call stack size exceeded`**. It is thrown **inside** `runAIConsensusFromInputImpl` **after** remote provider lanes return successfully, during synchronous consensus assembly — primarily **`buildHybridDecision`** and repeated **`buildIndicatorSnapshot`** invocations with nested indicator helpers (`ema`, `rsiSeries`, `clusterLevels`, `candleWickProfile`, etc.).

This is **stack depth exhaustion**, not:
- JSON circular serialization (`TypeError`, not `RangeError`)
- `failAiCandidate` re-entering evaluation (ruled out)
- Provider HTTP failure (providers succeed on FILTRY before overflow)

---

## 2. First Stack-Overflow Location

| Field | Value |
|-------|-------|
| **Time (UTC)** | `2026-08-14T20:12:51.158Z` |
| **Symbol** | FILTRY |
| **candidateId** | `ai:FILTRY:a963b84d` |
| **Runtime checkpoint** | `Scanner consensus 0/47` |
| **Captured at** | `scanner.service.ts:754` — `"AI evaluation skipped for candidate"` |
| **Probable throw site** | `hybrid-decision-engine.ts:649` — `buildIndicatorSnapshot(input.analysisInput)` inside `buildHybridDecision` |

**FILTRY timeline (proves post-provider failure):**

| Time | Event |
|------|-------|
| 20:12:35 | provider-3 risk — REMOTE OK (2320ms) |
| 20:12:35 | provider-1 technical — REMOTE OK (2689ms) |
| 20:12:35 | provider-1 momentum — REMOTE OK (3110ms) |
| 20:12:51 | **Stack overflow** — `AI_FAILED` |

Providers are not the failure point.

---

## 3. Every Stack-Overflow Site (Capture vs Throw)

### Error capture (all 38 events)

| File | Function | Line | Role |
|------|----------|------|------|
| `scanner.service.ts` | `mapWithConcurrency` worker | 717–757 | Catches error, calls `failAiCandidate`, logs warn |
| `ai-runtime.service.ts` | `failAiCandidate` | 220–272 | Terminalizes candidate (sink, not cause) |
| `candidate-lifecycle.service.ts` | `traceCandidateFailed` | 79–89 | Records lifecycle |
| `forensic-collector.service.ts` | `recordTerminalOutcome` | 35–52 | Appends to errors export |

### Probable throw chain (synchronous depth)

| # | File | Function | Notes |
|---|------|----------|-------|
| 1 | `scanner.service.ts` | `mapWithConcurrency` worker | concurrency=2 |
| 2 | `cancellable-work.service.ts` | `withCancellableBoundedAwait` | ×3 nested (context, format, consensus) |
| 3 | `cooperative-async.service.ts` | `runCooperativePool` | Worker wrapper + abort linkage |
| 4 | `analysis-orchestrator.ts` | `runAIConsensusFromInputImpl` | Post-lane assembly |
| 5 | `provider-1.adapter.ts` | `buildTechnicalSpecialistOutput` | `buildIndicatorSnapshot` ×1 per lane |
| 6 | `provider-3.adapter.ts` | risk lane adapter | `buildIndicatorSnapshot` ×1 |
| 7 | `hybrid-decision-engine.ts` | `buildHybridDecision` | ~1000 lines; `buildIndicatorSnapshot` ×3 (649, 327, 514) |
| 8 | `indicator-suite.ts` | `buildIndicatorSnapshot` | Deep nested helpers |
| 9 | `analysis-scorecard.service.ts` | `buildAnalysisScorecard` | Success path only (+1 snapshot via short-term-score) |
| 10 | `short-term-report.service.ts` | `buildShortTermReport` | Success path only (+2 snapshots) |

**Ruled-out cycles:** `failAiCandidate → evaluate`, error-handler loops, artifact-write loops, retry wrappers.

---

## 4. Candidate / Symbol Concentration

| Metric | Value |
|--------|-------|
| Stack overflow records | **38** |
| Unique symbols | **38** (one stack failure each in errors.json) |
| Strategy concentration | **None** — all ranked candidates entering full consensus |
| Lane concentration | **None** — all three lanes invoked before overflow |
| Provider concentration | **None** for stack overflow |

**Dual-outcome pattern:** 17 symbols show `COMPLETED` in `ai-progress.json` **and** stack overflow in `errors.json` (different `candidateId`). The round runs **multiple scanner/AI passes**; a symbol can fail in one pass and succeed in another.

**Only simultaneous pair:** `RESOLVTRY` + `QTUMTRY` at `2026-08-14T20:17:05.407Z` (concurrency=2 signature).

---

## 5. Provider Concentration

| Check | Result |
|-------|--------|
| Stack overflow before providers complete | **NO** |
| provider-1 remote calls (ai-trace) | 60 |
| provider-3 remote calls | 34 |
| provider-2 remote calls | 8 |
| provider-3 risk **timeouts** | 10 separate `AI_DEGRADED` events |

**provider-3 risk timeouts** are a **separate** degradation path (`AI timeout (provider-3:risk#0)`), not stack overflow. Do not conflate.

---

## 6. Concurrency Correlation

| Setting | Value |
|---------|-------|
| `SCANNER_AI_CONCURRENCY` | **2** |
| `SCANNER_CONTEXT_CONCURRENCY` | **6** |

**Deterministic probe (no paper run):**

| Test | Result |
|------|--------|
| `buildIndicatorSnapshot` ×1 | PASS |
| `buildIndicatorSnapshot` parallel ×2 | PASS |
| Full `buildHybridDecision` with mock | TypeError (incomplete mock — not stack overflow) |

**Conclusion:** Isolated snapshot survives concurrency 2. Overflow requires the **full orchestrator path** (providers + hybrid + wrappers). Concurrency **amplifies frequency** (2 workers building deep stacks simultaneously) but each overflow is **per-worker synchronous depth**.

**Prior sessions:** Same error appears 100+ times in `cmst8nza40007unvsi2211emo` round 3 — **recurring under load**, not session-specific.

---

## 7. Retry / Timeout / Cancellation

| Metric | Value |
|--------|-------|
| `AI_TIMEOUT` | **0** |
| `AI_FAILED` (ai-progress) | **17** |
| Stack overflow `reasonCode` | **`AI_FAILED`** |

**Why `AI_TIMEOUT=0`:** `scanner.service.ts:719–735` classifies `RangeError` message as `STALL_ERROR_CODES.AI_FAILED`, not timeout. Stack overflow is synchronous — not `CooperativeAsyncTimeoutError`, not abort.

**Retry interaction:** `withAiRetry` on provider lanes does not loop on stack overflow; error propagates once to scanner catch.

**Cancellation interaction:** `withCancellableBoundedAwait` / `linkAbortSignal` add stack frames before consensus runs; under budget pressure abort cascades add frames but do **not** create infinite recursion.

---

## 8. Forensic / Telemetry Correlation

**Forensic instrumentation did NOT cause the overflow.**

| Path | Verdict |
|------|---------|
| `failAiCandidate` | Runs **after** catch — terminal sink |
| `traceCandidateFailed` | Append-only |
| `bridgeAiProviderResult` | Succeeds before overflow on FILTRY |
| `errors.json` export | Records outcome; not in throw path |

**Secondary effect:** After FORMTRY overflow, Prisma `decisionTimelineEvent.createMany` hit **transaction timeout** (14099ms > 5000ms limit) — persistence backlog under load, not overflow root cause.

---

## 9. Stack Size / Recursion

| Item | Value |
|------|-------|
| `NODE_OPTIONS` | **null** (default V8 stack ~984KB) |
| Recursion type | **Deep synchronous call nesting**, not infinite async loop |
| JSON serialization | Ruled out (wrong error type) |

**Do not fix by increasing `--stack-size` alone.**

---

## 10. Why 38 Stack Overflows vs 17 AI Failed

| Source | Count | Scope |
|--------|-------|-------|
| `errors.json` stack messages | **38** | Full round — all scanner passes, all candidateIds |
| `ai-progress.json` failedCount | **17** | Main batch ring buffer only |
| `ai-progress.json` processed | **34** | success 17 + failed 17 |
| `AI_DEGRADED` (separate) | **23** | Provider timeout/degraded — not stack |

The round executes **multiple AI batches** (`Scanner consensus 0/47`, `0/13`, then main batch 83). Lifecycle export captures **every** stack failure; ai-progress counts only its in-memory batch window.

---

## 11. Exact Safe Fix Proposal (DO NOT IMPLEMENT YET)

### P0 — Structural stack reduction

1. **Memoize `buildIndicatorSnapshot(input)` once** per `runAIConsensusFromInputImpl` and pass the cached snapshot into:
   - `buildHybridDecision`
   - `buildAnalysisScorecard` / `buildShortTermReport`
   - Provider adapters (technical/momentum/risk)

2. **Split `buildHybridDecision`** (~1600 lines) — remove redundant `scoreTechnical` / `scoreRisk` snapshot rebuilds (lines 327, 514, 649).

### P1 — Wrapper / observability

3. **Flatten scanner AI worker** — reduce triple-nested `withCancellableBoundedAwait` to a single linked abort context.

4. **Strip deep objects from `logger.info`** at `analysis-orchestrator.ts:977` (`hybridPayload`, `roleScores`).

### Do NOT

- Increase Node stack size without structural fix
- Change strategy / thresholds / AI prompts
- Blame provider-3 for stack overflow

---

## 12. Regression Tests Required

1. Full mock consensus under `SCANNER_AI_CONCURRENCY=2` — must not throw `RangeError`
2. Spy: `buildIndicatorSnapshot` called **≤1×** per consensus invocation
3. Fixture replay from FILTRY timeline (providers OK → hybrid → no overflow)
4. Cooperative pool dual-worker stress with heavy consensus mock
5. Synthetic `RangeError` in worker → `failAiCandidate` terminalizes without re-evaluation

---

## Classification Matrix

| Category | Applies | Confidence |
|----------|---------|------------|
| AI_ORCHESTRATOR | **YES** | HIGH |
| RECURSION (stack depth) | **YES** | HIGH |
| CONCURRENCY | Amplifier | MEDIUM |
| AI_PROVIDER | NO | HIGH |
| RETRY | NO | HIGH |
| CANCELLATION | Contributor (frames) | LOW |
| FORENSIC_TELEMETRY | NO | HIGH |
| PERSISTENCE | Secondary stress only | MEDIUM |
| SERIALIZATION | NO | HIGH |
| UNKNOWN | NO | — |

---

## Artifacts

| File | Path |
|------|------|
| Machine JSON | [`kripto-ai-stack-overflow-forensic.json`](kripto-ai-stack-overflow-forensic.json) |
| errors | `artifacts/forensics/cmstdt3ww0007uncgmjwgvf6p/rounds/1/errors.json` |
| ai-progress | `artifacts/forensics/cmstdt3ww0007uncgmjwgvf6p/rounds/1/ai-progress.json` |
| ai-trace | `artifacts/forensics/cmstdt3ww0007uncgmjwgvf6p/rounds/1/ai-trace.json` |
| Live log | `artifacts/5round-stress-validation-live.log` |

**Next step:** Scoped P0 implementation from §11 — not started in this pass.
