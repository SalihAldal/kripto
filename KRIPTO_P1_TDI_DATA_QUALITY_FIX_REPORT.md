# KRIPTO_P1_TDI_DATA_QUALITY_FIX_REPORT

- generatedAt: 2026-08-18T08:26:31.688Z
- runId: p1-tdi-data-quality-2026-08-18T08-26-29-586Z
- smokeSessionId: cmsyd5spj000bund4xns2j4yh

## 1. Missing telemetry inventory
- beforeMissingTelemetryCount: 57
- afterMissingTelemetryCount: 0
- missingFieldRollup: []

## 2. Root cause by field
- rootCauseCounts: {}

## 3. Technical data issues
- technicalDataProblemCount: 0

## 4. Momentum data issues
- momentumDataProblemCount: 0

## 5. Confidence data issues
- confidenceDataProblemCount: 0

## 6. Paper/live routing
- execution WAIT bridge now propagates technical/momentum/sentiment/shortMomentum/shortFlow into TDI record.

## 7. Cache/freshness
- stale context is surfaced in tdiInputContract status instead of implicit neutral fallback.

## 8. Abort/timeout impact
- patchJobActiveRoundSamples: 98
- patchJobActiveRoundTimeoutCount: 1

## 9. Runtime/artifact reconciliation
- Runtime TDI rows now export tdi-data-quality, tdi-input-contract and tdi-missing-telemetry-report artifacts per round.

## 10. Exact fixes
- Added explicit TDI input contract with field statuses (AVAILABLE/MISSING/STALE/INVALID/NOT_APPLICABLE/UNKNOWN).
- Added data quality issue inference and block classification (DATA_QUALITY_BLOCK vs POLICY_BLOCK).
- Fixed WAIT taxonomy and replay alignment for wait distributions.

## 11. Tests
- tests/forensics/tdi-data-quality.test.ts
- tests/forensics/tdi-sensitivity-reconciliation.test.ts

## 12. 2-round smoke
- tdiApproved: 0
- tdiWait: 76
- tdiRejected: 500
- firstBlockingDistribution: {"MOMENTUM":58,"TECHNICAL":18}

## 13. Before/after missing telemetry
- before: 57
- after: 0

## 14. Before/after DATA_QUALITY_BLOCK vs POLICY_BLOCK
- beforeDataQualityBlockCount: 57
- afterDataQualityBlockCount: 0
- afterPolicyBlockCount: 76

## 15. Remaining blockers
- unresolvedMissingRows: 0
- verdict: PARTIAL

## 16. TDI readiness verdict
- TDI_DATA_QUALITY_READINESS: PARTIAL
- objective kept: no threshold lowering, no BUY forcing, no safety gate weakening.

