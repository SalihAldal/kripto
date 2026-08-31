# KRIPTO Final Selection Throughput + AI Remote + TDI Reconciliation Fix

- Fix ID: selection-throughput-2026-08-21T20-33-25-430Z
- Baseline session: cmszwci4l0009unywvfufbuj9
- Validation session: cmt3epoap0009un5od3he1qce
- Primary bottleneck: MIXED

## Before/After Core Metrics
- candidatesPerMinuteBefore: 5.5462
- candidatesPerMinuteAfter: 10.5121
- aiCandidatesPerMinuteBefore: 1.6988
- aiCandidatesPerMinuteAfter: 4.1388
- remoteCallsBefore: 129
- remoteCallsAfter: 592
- degradedCallsBefore: 133
- degradedCallsAfter: 8
- runtimeTdiRejectedBefore: 152
- runtimeTdiRejectedAfter: 815
- aggregateTdiRejectedBefore: 152
- aggregateTdiRejectedAfter: 642

## Final Verdict
- SELECTION_THROUGHPUT = PARTIAL
- AI_REMOTE_HEALTH = PASS
- TDI_METRIC_RECONCILIATION = PASS
- SCANNER_RUNTIME = PASS
- ROUND_LIVENESS = PASS
- TWO_ROUNDS_COMPLETED = YES
- READY_FOR_5_ROUNDS = CONDITIONAL
- READY_FOR_30_50_ROUNDS = NO
- READY_FOR_50_ROUND_PAPER = NO

