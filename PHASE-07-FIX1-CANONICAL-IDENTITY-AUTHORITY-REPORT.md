# PHASE 07 - FIX1 CANONICAL IDENTITY AUTHORITY REPORT

## STATUS

- FIX 1 kapsaminda canonical identity/authority katmani sertlestirildi.
- Uzun paper validation baslatilmadi.
- Live order kilidi korunuyor (`LIVE_TRADING_ENABLED=false`).

## BEFORE ARCHITECTURE

- `execution-orchestrator` icinde `candidateId` yoksa `symbol` ile fallback vardI.
- `CandidateStore` micro ingest asamasinda eksik kaydi yeniden olusturabiliyordu.
- Transition kurallari strict degildi; illegal gecis runtime'da engellenmiyordu.
- AI policy env'den `VETO` olarak degisebiliyordu.

## FINAL CANONICAL AUTHORITY MATRIX

- OpportunityEngine: candidate discovery authority
- MicrostructureEngine: micro quality authority
- FinalRanker: final quality/rank authority
- RiskEngine (`evaluateCanonicalRiskDecision`): hard safety authority
- PaperExecutionAdapter / paper runtime: paper execution authority
- PositionManager: position authority
- ShadowOutcomeEngine: outcome/measurement authority
- AI/TDI/Learning: advisory/shadow authority

## CANDIDATE IDENTITY BEFORE

- `opportunityCandidateId` yoksa execution tarafinda symbol tabanli eslestirme yapiliyordu.
- Micro ingest, missing candidate icin local create yaparak identity zincirini bozabiliyordu.

## CANDIDATE IDENTITY AFTER

- `candidateId` bos ise execution `HANDOFF_IDENTITY_MISSING` ile sonlanir.
- `candidateId` var ama store'da yoksa `HANDOFF_CANDIDATE_NOT_FOUND` ile sonlanir.
- Micro ingest artik yeni candidate yaratmaz; sadece existing canonical kaydi gunceller.
- `candidateId` immutable: symbol/lane/candidateId mismatch `HANDOFF_STATE_MISMATCH`.

## SYMBOL FALLBACK REMOVAL

- Kaldirildi:
  - `src/server/execution/execution-orchestrator.service.ts`
  - `src/server/execution/round-selection.service.ts`
- Symbol tabanli lifecycle handoff yerine strict `candidateId` kullaniliyor.

## CANDIDATE STORE AUTHORITY

- `CandidateStore` state machine + illegal transition guard ile tek lifecycle authority haline getirildi.
- Runtime handoff error taxonomy eklendi.
- `registerExecutionIntent()` ile candidate-bazli idempotency anahtari eklendi.

## LOCAL/PARALLEL STATE AUDIT

- `OpportunityEngine.sessions` -> DERIVED_READ_CACHE (discovery working set)
- `MicrostructureEngine.sessions` -> DERIVED_READ_CACHE (micro scoring cache)
- `ShadowOutcomeEngine.tracked` -> CANONICAL_OUTCOME_CACHE (measurement authority domaini)
- `CandidateStore.rows` -> CANONICAL (lifecycle source of truth)
- Legacy scanner telemetry -> LEGACY (counter-only, canonical modda 0/0 hedefi)

## CANDIDATE LIFECYCLE

- Enforced states:
  - DISCOVERED -> WATCHING/HOT/MICRO_WARMING
  - MICRO_ANALYZED -> MICRO_CONFIRMED/MICRO_REJECTED/EXPIRED/ERROR
  - FINAL_RANKED -> EXECUTION_READY/NOT_EXECUTION_READY
  - EXECUTION_READY -> RISK_PENDING
  - RISK_PENDING -> RISK_ALLOWED/RISK_REJECTED
  - RISK_ALLOWED -> PAPER_ATTEMPT -> PAPER_OPENED/PAPER_REJECTED -> PAPER_CLOSED

## FUNNEL INVARIANTS

- CandidateStore transition sayaçlari ile asagidaki invariantlar kontrol ediliyor:
  - MICRO_ANALYZED >= MICRO_CONFIRMED + MICRO_REJECTED
  - MICRO_CONFIRMED >= FINAL_RANKED
  - FINAL_RANKED >= EXECUTION_READY + NOT_EXECUTION_READY
  - EXECUTION_READY >= RISK_PENDING
  - RISK_PENDING >= RISK_ALLOWED + RISK_REJECTED
  - RISK_ALLOWED >= PAPER_ATTEMPT
  - PAPER_ATTEMPT >= PAPER_OPENED + PAPER_REJECTED
- Ihlal olursa `PIPELINE_INVARIANT_VIOLATION` kaydedilir.

## HANDOFF ERROR TAXONOMY

- Eklendi:
  - `HANDOFF_IDENTITY_MISSING`
  - `HANDOFF_CANDIDATE_NOT_FOUND`
  - `HANDOFF_ILLEGAL_TRANSITION`
  - `HANDOFF_DUPLICATE_EXECUTION`
  - `HANDOFF_STATE_MISMATCH`
  - `PIPELINE_INVARIANT_VIOLATION`

## AI AUTHORITY BEFORE/AFTER

- Before: runtime policy `EXECUTION_AI_GATE_POLICY` ile `VETO` olabiliyordu.
- After: `resolveAiExecutionGatePolicy()` tum modlarda `ADVISORY` doner.
- AI kararlar execution hard gate degil; advisory telemetry olarak akar.

## AI HARD VETO COUNT

- Test kosumunda: `aiHardVetoCount = 0`

## TDI AUTHORITY BEFORE/AFTER

- TDI shadow modeli korunuyor (`canReject=false`).
- Runtime hard-veto yolu yok; reject/wait sadece advisory opinion.

## TDI HARD VETO COUNT

- Test kosumunda: `tdiHardVetoCount = 0`

## LEARNING AUTHORITY BEFORE/AFTER

- Learning lane hard reject authority degil.
- `recordLearningEvaluation()` ile advisory reject ayri, hard veto ayri sayiliyor.

## LEARNING HARD VETO COUNT

- Test kosumunda: `learningHardVetoCount = 0`

## DATA QUALITY AUTHORITY

- Hard data rejection canonical risk kararinda:
  - `RISK_DATA_UNAVAILABLE`
  - `RISK_SYNTHETIC_DATA`
  - `RISK_INVALID_PRICE`
  - `RISK_STALE_DATA`

## RISK AUTHORITY

- Deterministic hard safety verdict sadece `evaluateCanonicalRiskDecision()` sonucu ile veriliyor (`ALLOW`/`REJECT`).

## EXECUTION INTENT IDENTITY

- `CandidateStore.registerExecutionIntent()` eklendi.
- Ayni `candidateId + strategyContext` icin ikinci farkli intent `HANDOFF_DUPLICATE_EXECUTION`.

## POSITION IDENTITY

- `ExecutionIntent` zorunlu alanlar:
  - `candidateId`
  - `executionIntentId`
- `ManagedPosition` zorunlu alanlar:
  - `candidateId`
  - `executionIntentId`
  - `executionReference`

## SHADOW OUTCOME IDENTITY

- Shadow tracking zaten `candidateId` keyed `Map` ile calisiyor.
- Bu fixte execution lifecycle tarafinda symbol fallback temizlendi.

## LEGACY SCANNER ASSERTION

- Runtime counter bridging eklendi (`setLegacyScannerCounters`).
- Canonical secimde legacy invocation/persist artarsa round `CANCELLED` edilir.

## MULTI-PROCESS READINESS

- Mevcut `CandidateStore` global singleton/process-local.
- Degerlendirme: `SINGLE_PROCESS_SAFE`.
- Multi-process deployment icin shared state (Redis vb.) gerekir; bu FIX1 scope'unda rewrite yapilmadi.

## TESTS

- Calisan suite:
  - `tests/canonical-identity-authority.test.ts` (11/11)
  - `tests/candidate-handoff-invariants.test.ts` (6/6)
  - `tests/micro-lifecycle-fix.test.ts` (3/3)
  - `tests/phase06-paper-production.test.ts` (27/27)
- Ek regression:
  - `phase03`, `phase04`, `hot-executionready` PASS
  - `phase05-shadow-outcome` 1 test FAIL (asagida)

## TYPECHECK

- `npx tsc --noEmit` sonucu: FAIL (Node heap OOM, exit 134)

## BUILD

- `npm run build` sonucu: FAIL
- Hata: `NODE_OPTIONS` icinde gecersiz arguman (`--r=`) nedeniyle worker baslatma reddi.

## KNOWN ISSUES

- `tests/phase05-shadow-outcome.test.ts` icinde:
  - `first-detection snapshot is immutable` testi baseline beklentisiyle uyusmuyor (finalScore 70 beklerken 91 geldi).
- Project-wide typecheck memory limiti asiliyor.
- Build ortaminda `NODE_OPTIONS` kirliligi var.

## FIX 2 READINESS

- Identity ve authority katmaninda FIX1 ana hedefleri uygulandi.
- FIX2 (venue/breaker/websocket hardening) icin ayrik devam edilebilir.
