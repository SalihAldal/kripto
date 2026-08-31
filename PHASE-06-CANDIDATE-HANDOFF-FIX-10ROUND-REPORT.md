# PHASE-06-CANDIDATE-HANDOFF-FIX-10ROUND-REPORT

## STATUS
- Completed: critical handoff refactor + 15m real Binance handoff diagnostic + exact 10-round paper run.
- Validation artifact: `kripto-10round-paper-validation.json`
- Session: `cmtg3ej3m0009un64fed4ig3e`

## ROOT CAUSE
- Primary root cause was **preflight/round pipeline drift** and **selection path contract mismatch**.
- Round harness was expecting immediate candidate output from selection path and was not consistently observing canonical lifecycle transitions over the same canonical runtime path used in preflight.
- Secondary issue: no-candidate retry/observation behavior produced long/unstable round semantics and masked handoff telemetry.

## PREFLIGHT VS ROUND DIFFERENCE
- Preflight (same codebase) showed market viability and micro confirmations.
- Round path initially diverged in execution contract (scan call path + observation semantics + retry behavior).
- Fixed: unified round selection to canonical observation loop and removed repeated no-candidate retry loop inflation.

## INSTANCE OWNERSHIP
- Added runtime `instanceId` telemetry to canonical components and surfaced in artifacts.
- Latest run `canonical.instanceOwnership`:
  - `marketDataDaemonInstanceId`: `market-data-daemon:122044:1:omdto7`
  - `dynamicSubscriptionManagerInstanceId`: `dynamic-sub-manager:122044:yhqqur`
  - `opportunityEngineInstanceId`: `opportunity-engine:122044:1:9i5orf`
  - `candidateStoreInstanceId`: `candidate-store:122044:1:mbd54s`
  - `microstructureEngineInstanceId`: `microstructure-engine:122044:1:jnrrfq`
  - `finalRankerInstanceId`: `final-ranker:122044:1:d50w38`
  - `riskEngineInstanceId`: `risk-engine:122044:1:8jwzal`
  - `paperExecutionAdapterInstanceId`: `paper-execution-adapter:122044:1:jknrp9`

## CANDIDATE STORE BEFORE
- Candidate state was effectively consumed per-step by local runtime flow and not exposed as a strict canonical lifecycle authority for round observation.

## CANDIDATE STORE AFTER
- Added canonical store: `src/server/candidate/candidate-store.service.ts`
- Implemented required APIs:
  - `createCandidate()`
  - `updateCandidate()`
  - `getCandidate()`
  - `getActiveCandidates()`
  - `transitionCandidate()`
  - `expireCandidate()`
  - `getExecutionReadyCandidates()`
- Opportunity + Micro + Execution now write lifecycle transitions into same canonical store.

## CROSS-PROCESS STATE
- Store is currently singleton authority for the active runtime process and is now explicitly instance-tagged.
- For this validation run, diagnostic and 10-round execution were run in the **same process runtime envelope** to avoid process-local visibility drift.
- Redis-backed shared lifecycle propagation is still a recommended next hardening step for multi-process deployments.

## CANDIDATE LIFECYCLE
- Lifecycle states wired:
  - `DISCOVERED -> WATCHING/HOT -> MICRO_ANALYZED -> (MICRO_REJECTED | NOT_EXECUTION_READY | EXECUTION_READY) -> RISK_* -> PAPER_*`
- Silent drop risk reduced via transition journaling (`recentTransitions`).

## MICRO→FINALRANK HANDOFF
- Micro evaluation now ingests directly into canonical store and emits explicit transition outcomes.
- Semantic cleanup added for reject-like reason labeling:
  - e.g. `MICRO_INSUFFICIENT_BID_SUPPORT`, `MICRO_NO_ASK_DEPLETION`, `MICRO_WARMUP_INCOMPLETE`.

## FINALRANK→EXECUTIONREADY HANDOFF
- Explicit terminalization in store:
  - `EXECUTION_READY` or `NOT_EXECUTION_READY`.
- In this run, `EXECUTION_READY = 0`, `NOT_EXECUTION_READY > 0`.

## ROUND HARNESS BEFORE/AFTER
- Before: scanner-like immediate selection expectation and unstable no-candidate retry behavior.
- After:
  - canonical observation loop
  - fixed no-candidate retry inflation
  - bounded observation window semantics
  - no independent legacy scanner authority

## DEEP SUBSCRIPTION LIFECYCLE
- 15m diagnostic showed deep activity present (`deepActiveMax=14`), confirming deep stream infrastructure viability.

## MICRO WARMING BEHAVIOR
- Warming is now tracked as non-terminal semantic (`MICRO_WARMUP_INCOMPLETE` evidence).
- However many candidates still end in `NOT_EXECUTION_READY` after micro analysis.

## MICRO STALE ROOT CAUSE
- Diagnostic still observed stale/warming pressure patterns in reject evidence.
- Dominant downstream blocker is no conversion from analyzed/warm pool into confirmed+ready inside round windows.

## WS 1008 ROOT CAUSE
- 1008 events were previously observed on deep stream control path; manager now runs with dedupe/ref-count logic and canonical runtime remained stable in final run.
- No run-ending WS fault occurred in the final 10-round session.

## DIAGNOSTIC RESULT
- Handoff diagnostic (same execution script pre-round gate):
  - `opportunityEvaluations=24917`
  - `discovered=3091`
  - `hot=398`
  - `microAnalyzed=398`
  - `microConfirmed=4`
  - `deepActiveMax=14`
  - pass: all required checks true, legacy scanner invocation/persist both zero.

## ROUND 1..10
- Classification: all `COMPLETED_NO_TRADE`
- Per-round no-candidate terminal (from runtime log reasons):
  - R1: discovered=46, hot=0, microConfirmed=0, ready=0
  - R2: discovered=42, hot=0, microConfirmed=0, ready=0
  - R3: discovered=26, hot=0, microConfirmed=0, ready=0
  - R4: discovered=26, hot=0, microConfirmed=0, ready=0
  - R5: discovered=25, hot=0, microConfirmed=0, ready=0
  - R6: discovered=24, hot=0, microConfirmed=0, ready=0
  - R7: discovered=22, hot=0, microConfirmed=0, ready=0
  - R8: discovered=23, hot=0, microConfirmed=0, ready=0
  - R9: discovered=18, hot=0, microConfirmed=0, ready=0
  - R10: discovered=20, hot=0, microConfirmed=0, ready=0

## TOTAL FUNNEL
- `DISCOVERED=33`
- `WATCHING=431`
- `HOT=12`
- `MICRO_ANALYZED=12`
- `MICRO_REJECTED=2`
- `NOT_EXECUTION_READY=10`
- `MICRO_CONFIRMED=0` (round-final state accounting)
- `EXECUTION_READY=0`
- `RISK_ALLOW=0`
- `PAPER_OPENED=0`

## FUNNEL INVARIANT AUDIT
- No count-loss hard error found in the final artifact (`criticalFailures=[]`).
- Remaining semantic gap: round-level cumulative funnel attribution still needs per-window transition materialization for all rounds (early rounds currently under-reported in `rounds[].funnel` snapshot).

## EARLY FUNNEL
- Early lane had observed `HOT` and `MICRO_ANALYZED` transitions in total funnel.

## STEADY FUNNEL
- Steady dominated discovery/watch transitions.
- Steady also reached `HOT` and `MICRO_ANALYZED`, but did not reach `EXECUTION_READY`.

## MOMENTUM FUNNEL
- Momentum low-volume presence, stayed at discovered/watching levels.

## CONTINUATION FUNNEL
- Continuation mostly discovered/watching, not propagated to ready.

## MICRO REJECT HISTOGRAM
- Frequent negative semantics in this phase:
  - `MICRO_WARMUP_INCOMPLETE`
  - `MICRO_LOW_ACTIVITY`
  - `MICRO_DATA_STALE`
  - `MICRO_INSUFFICIENT_BID_SUPPORT`
  - `MICRO_NO_ASK_DEPLETION`

## NOT_EXECUTION_READY HISTOGRAM
- Dominant reasons:
  - warmup incomplete
  - stale/low-activity signatures
  - insufficient bid support / no ask depletion evidence

## RISK HISTOGRAM
- No risk-stage traffic in final 10-round (`EXECUTION_READY=0`).

## GROUND-TRUTH MOVERS
- Independent tracker active: `shadow.movers=6`.

## MFE/MAE
- Shadow tracking active: `shadow.tracked=406`.
- Candidate outcome tracking no longer zeroed even when trades are zero.

## MISSED PROFITABLE OPPORTUNITIES
- Requires next-step explicit join of mover-events vs candidate terminal reasons in the final report query script for quantified missed-profit matrix.

## PAPER TRADES
- Opened: `0`
- Closed: `0`

## PAPER ECONOMICS
- Net PnL: `0`
- Fees: `0`
- Gross: `0`

## TESTS
- Added: `tests/candidate-handoff-invariants.test.ts` (4/4 pass).
- Covers:
  - discovered write
  - micro->final->ready chain
  - risk->paper identity continuity
  - round-boundary state survival

## KNOWN ISSUES
- Round-level `funnel` detail is still sparse for early rounds due transition-window projection limits.
- Multi-process Redis-shared candidate lifecycle authority should be completed for strict process-isolation scenarios.

## FINAL VERDICT
- Canonical handoff observability and lifecycle authority are materially improved.
- Legacy scanner contamination remains zero.
- Discovery drift is fixed (round discovered > 0).
- Current real bottleneck has shifted to **DISCOVERED/WATCHING → HOT/MICRO_CONFIRMED/EXECUTION_READY conversion** under round-time execution context, not scanner sensitivity.

---

## FINAL QUESTIONS (1-20)
1. Evet, preflight/round artık aynı canonical runtime path ile çalıştırıldı (aynı process envelope içinde gate+run).
2. Evet, CandidateStore authority tek canonical servis olarak eklendi.
3. Evet, round boundary’de state korunuyor (test ve transition journal ile doğrulandı).
4. Evet, DISCOVERED adaylar Microstructure’e ulaşıyor (total funnel `MICRO_ANALYZED=12`).
5. Evet, warming terminal değil; yeniden değerlendirme semantiği korunuyor.
6. Kısmi: diagnosticte microConfirmed görüldü, final 10-round’da microConfirmed terminal-state’e taşınmadı.
7. Kısmi: microConfirmed için explicit outcome üretim mantığı var; bu koşuda confirmed sayısı 0 olduğundan gerçek örnek yok.
8. Evet, model explicit `EXECUTION_READY`/`NOT_EXECUTION_READY` üretiyor; bu koşuda `NOT_EXECUTION_READY` baskın.
9. Bu koşuda hayır (`EXECUTION_READY=0`).
10. Bu koşuda hayır (`RISK_ALLOW=0`).
11. Evet, ShadowOutcome kayıtları oluşuyor (`tracked=406`).
12. Evet, GroundTruthMovers bağımsız çalışıyor (`movers=6`).
13. EARLY: discovered/hot/micro analyzed var, execution-ready yok.
14. STEADY: en yoğun lane; hot/micro analyzed var, execution-ready yok.
15. MOMENTUM: düşük, çoğunluk discovered/watching.
16. CONTINUATION: discovered/watching ağırlıklı.
17. Hayır, paper trade açılmadı.
18. 0 adet.
19. Net PnL: 0.
20. En büyük gerçek darboğaz: **HOT/MICRO analizinden EXECUTION_READY’ye geçişin round-time koşullarında üretilememesi** (özellikle warmup/stale/activity kaynaklı not-ready terminalizasyonu).
