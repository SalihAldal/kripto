# KRIPTO P2/P0 — SCANNER BOTTLENECK + SIM_TIGHT_FILTER + TELEMETRY CONSISTENCY FIX

## Final Verdict
ROOT_CAUSE = ROUND-UNSCOPED FORENSIC COUNTERS + AI_NO_RESPONSE EARLY TERMINALIZATION
PRIMARY_FIX = ROUND-SCOPED FORENSIC FILTERING FOR CANDIDATE/TDI/AI COUNTERS
FIX_IMPLEMENTED = YES
SIM_TIGHT_FILTER_CLASS = MIXED
HISTORICAL_PROFITABLE_BLOCKED = 42
HISTORICAL_LOSING_BLOCKED = 206
CURRENT_2278_PASS = 0
CURRENT_2278_FAIL = 2278
CURRENT_2278_FALSE_DATA_BLOCK = 2278
AI_NO_RESPONSE_FIXED = PARTIAL
TELEMETRY_CONSISTENCY = FAIL
THRESHOLDS_CHANGED = NO
AI_VETO_PRESERVED = YES
RISK_PRESERVED = YES
SIZING_PRESERVED = YES
TESTS = PASS
READY_FOR_5_ROUND = NO
NEXT_STEP = Run controlled 5-round paper validation in separate task only if READY_FOR_5_ROUND=YES.

## Answers
1) SIM_TIGHT_FILTER first blocker because entry candidate fails quality stack before TDI approval handoff in round loop.
2) Strictness is mixed: some true-quality filters, some duplicate/downstream overlap, some missing/stale-data interpretation.
3) Duplicate-gate evidence exists on confidence/scanner-score overlap with downstream TDI WAIT/REJECT.
4) Missing/stale telemetry contributes to false rejection in replay classes MISSING_DATA_INTERPRETED_AS_BAD and STALE_TELEMETRY_BLOCK.
5) Blocked in profitable 42 cohort: 42.
6) Blocked in losing cohort: 206.
7) Current 2278 replay pass/fail: 0/2278.
8) One fix implemented: ROUND-SCOPED FORENSIC FILTERING FOR CANDIDATE/TDI/AI COUNTERS.
9) Threshold change: NO.
10) AI_NO_RESPONSE: REQUIRES_RECOVERY.
11) candidateCount=0 with TDI/AI>0 source: COUNTER_SCOPE.
12) Same-round counter consistency now depends on new scope filter (see code patch + regression test).
13) 5-round readiness: NO.

## Artifacts
- kripto-p2-sim-tight-filter-code-path.json
- kripto-p2-scanner-2278-replay.csv
- kripto-p2-historical-scanner-replay.csv
- kripto-p2-scanner-rejection-classification.csv
- kripto-p2-ai-no-response-forensics.json
- kripto-p2-candidate-count-consistency.json
- kripto-p2-scanner-bottleneck-fix.json
