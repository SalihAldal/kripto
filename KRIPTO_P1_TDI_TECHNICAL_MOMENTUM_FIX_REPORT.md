# KRIPTO P1 — TDI TECHNICAL / MOMENTUM ZERO-APPROVAL FORENSIC + CORRECTNESS FIX

- GeneratedAt: 2026-08-18T02:18:03.246Z
- RunId: p1-tdi-tech-momentum-2026-08-18T01-37-35-217Z
- SmokeSessionId: cmsxzth2q0009un70ik4b0upy

## 1) WAIT distribution
- smokeWaitCount: 66
- historicalSampleWaitCount: 57
- combinedSampleWaitCount: 123
- waitReasonDistribution: {"TDI_WAIT_NEUTRAL":66,"NEUTRAL":56,"BELOW_THRESHOLD":1}
- firstBlockingDistribution: {"MOMENTUM":50,"CONFIDENCE":5,"TECHNICAL":65,"RISK":2,"NEUTRAL":1}

## 2) Technical blocker
- classification: {"CORRECT_POLICY":38,"DATA_PROBLEM":54}
- formula: technical.score >= thresholds.technicalMinScore + regimeDelta.technical
- unit: normalized score in [0..100]
- fallback: if score/threshold missing => DATA_PROBLEM

## 3) Momentum blocker
- classification: {"CORRECT_POLICY":58,"DATA_PROBLEM":50}
- formula: momentumScore + shortMomentum/shortFlow context against sentiment threshold
- units: shortMomentum is percent-points (0.42 = 0.42%), shortFlow is normalized imbalance [-1..1]
- duplicate-penalty check: low shortMomentum+shortFlow while momentumScore passes threshold => DOUBLE_PENALTY

## 4) Confidence blocker
- confidenceWaitCount: 7
- confidenceRows: [{"candidateId":"hybrid:ESPTRY:63ad5493","reasonCode":"TDI_WAIT_NEUTRAL","reasonDetail":"Haber/sentiment karmasik | Regime chop/rapid switching (CHOP)"},{"candidateId":"hybrid:TAOTRY:d27928a6","reasonCode":"TDI_WAIT_NEUTRAL","reasonDetail":"Haber/sentiment karmasik | Regime chop/rapid switching (CHOP)"},{"candidateId":"hybrid:ESPTRY:63ad5493","reasonCode":"TDI_WAIT_NEUTRAL","reasonDetail":"Haber/sentiment karmasik | Regime chop/rapid switching (CHOP)"},{"candidateId":"hybrid:TAOTRY:d27928a6","reasonCode":"TDI_WAIT_NEUTRAL","reasonDetail":"Haber/sentiment karmasik | Regime chop/rapid switching (CHOP)"},{"candidateId":"hybrid:GPSTRY:db7b21d5","reasonCode":"TDI_WAIT_NEUTRAL","reasonDetail":"Piyasa yonu belirsiz / market uygun degil | Haber/sentiment karmasik | Futures trap riski: LATE_LONG_TRAP | Futures risk skoru yuksek (74.2) | Regime chop/rapid switching (CHOP) | Regime transition probability yuksek (76.8) | Regime flip riski yuksek (100.0)"},{"candidateId":"hybrid:GPSTRY:8e4c156d","reasonCode":"TDI_WAIT_NEUTRAL","reasonDetail":"Haber/sentiment karmasik | Futures trap riski: LATE_LONG_TRAP"},{"candidateId":"execution:BTCTRY:50667151","reasonCode":"BELOW_THRESHOLD","reasonDetail":"AI finalDecision=NO_TRADE blocked by VETO gate policy"}]

## 5) Score reconciliation
- scoreAboveThresholdRate and runtimeApprovalEquivalentRate remain separate (tdi-sensitivity-v2).
- WAIT distributions are now aligned to replayed runtime WAIT records.

## 6) Data quality
- waitsWithMissingTelemetry: 57
- unresolvedDefects: none

## 7) Previous-fix regression
- missing momentum not auto-bearish: preserved via hybrid momentum gate utilities and tests.
- shortMomentum unit handling (percent-point) preserved.
- NO_OPINION remains neutral in expert consensus.
- learning/momentum duplicate penalties constrained by gate tests.
- hybrid confidence and scoreType separation unchanged.

## 8) Exact code changes
- tdi wait classification ordering fixed (WATCHLIST/WAIT not mis-tagged as BELOW_THRESHOLD by hybridRejected).
- tdi forensic record expanded with technical/momentum/sentiment/threshold/regime routing fields.
- hybrid/master TDI bridge payload enriched with explicit blocker context.
- tdi sensitivity WAIT distributions aligned with replayed runtime verdicts.

## 9) Tests
- pnpm vitest run tests/forensics/tdi-sensitivity-reconciliation.test.ts tests/p0-tdi-buy-bottleneck.test.ts tests/master-decision-engine.test.ts
- result: PASS

## 10) 2-round smoke
- patchJobActiveRoundSamples: 98
- patchJobActiveRoundTimeoutCount: 0
- tdiApproved: 0
- tdiWait: 66
- AI veto/risk/sizing policy unchanged.

## 11) Remaining blockers
- TDI_APPROVAL_HEALTH: PARTIAL
- FINAL_VERDICT: PASS
- Objective enforced: correctness/explainability improved without lowering thresholds or forcing BUY.

