# KRIPTO — 5 Round Trade Evidence Validation

## 1. Preflight
- Verdict: READY
- Can start: true
- Attempt ID: trade-evidence-5r-preflight-1787003265666

## 2. Round-by-round summary
- Round 1: state=tur_basarisiz, failReason=AI_NO_RESPONSE, candidates=21, tdiApproved=0, executionReady=0, orders=0, fills=0, closedTrades=0
- Round 2: state=tur_basarisiz, failReason=SIM_TIGHT_FILTER_30m: non-pump kalite dusuk (composite=43.3, sentiment=42.6, mtf=22.3) | AI role consensus zayif (tech=32.6, sentiment=42.6, risk=54.7) | Sahte hour-only pump (tape=0.000%, hour=-0.162%) | EMA trend uyumsuz (EMA50=28920.3823, EMA200=28925.9387) | Hacim yetersiz (0.01x < 1.05x) | BTC EMA20 altinda (BTCTRY) | Kalite skoru dusuk (0/100 < 52), candidates=16, tdiApproved=0, executionReady=0, orders=0, fills=0, closedTrades=0
- Round 3: state=tur_basarisiz, failReason=round-runtime.patchJobActiveRound timed out after 15000ms, candidates=4, tdiApproved=0, executionReady=0, orders=0, fills=0, closedTrades=0
- Round 4: state=N/A, failReason=none, candidates=0, tdiApproved=0, executionReady=0, orders=0, fills=0, closedTrades=0
- Round 5: state=N/A, failReason=none, candidates=0, tdiApproved=0, executionReady=0, orders=0, fills=0, closedTrades=0

## 3. Aggregate funnel
- scannerCandidates=41
- tdiApproved=0, tdiWait=15, tdiRejected=0
- executionReady=0, orders=0, fills=0, closedTrades=0

## 4. AI parity
- Policy: VETO
- AI bypass detected: NO

## 5. Scanner/priority evidence
- priorityCandidates(total)=0
- priorityRescuedCount(total)=0

## 6. Entry timing
- entryTimingRecords(total)=0

## 7. Execution readiness
- executionReady=0, orders=0, fills=0

## 8. Position monitor evidence
- POSITION_MONITOR_PROVEN=NO

## 9. Exit evidence
- REAL_EXIT_PROVEN=NO

## 10. Fee reconciliation
- FEE_RECONCILIATION_PROVEN=YES
- grossPnL=0.00000000, totalFees=0.00000000, netPnL=0.00000000

## 11. PnL
- closedTrades=0
- netPnL=0.00000000

## 12. Runtime health
- jobStatus=FAILED
- lastError=round-runtime.patchJobActiveRound timed out after 15000ms
- schedulerCrashObserved=YES

## 13. Artifact completeness
- Per-round completeness is included in JSON output.

## 14. First blocking stage
- TDI

## 15. Remaining gaps
- 5-round request could not complete because engine failed at round 3 before rounds 4-5.
- No natural full trade lifecycle was completed in this run.

## Final Verdict
- VERDICT=FAIL
- TRADE_LIFECYCLE_PROVEN=NO
- POSITION_MONITOR_PROVEN=NO
- REAL_EXIT_PROVEN=NO
- FEE_RECONCILIATION_PROVEN=YES
- AI_PARITY_PROVEN=YES
- READY_FOR_30_50_ROUNDS=NO
