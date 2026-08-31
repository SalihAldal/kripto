# KRIPTO — FINAL FUNNEL TELEMETRY DRY-RUN GATE

Generated: 2026-08-28T15:06:06.506Z
Job: `cmtc4c2ds0009un70ir6hlcqm` | Dry-run round: **2** (CHZTRY)

## Part 1 — Deterministic Dry-Run

Replayed **round 2** from `artifacts/_50round-db-export.json` only.
No engine execution. No live market data.

| Metric | Value |
|--------|-------|
| Candidates traced | 40 |
| scanner_ai_reached | 40 |
| execution_ai_reached | 0 |
| tdi_entered | 0 |
| tdi_skipped (selected) | 1 |
| Selected symbol | CHZTRY |
| Terminal | NON_EXECUTABLE_DECISION: NO_TRADE (CHZTRY) |

## Part 2 — Selected Candidate Trace (CHZTRY)

| Stage | Value |
|-------|-------|
| scanner_ai_reached | YES |
| execution_ai_entered | NO |
| tdi_entered | NO |
| tdi_skipped | YES |
| aiDecision | NO_TRADE |
| confidence | 16.61 |
| finalState | SCANNER_AI_PRE_TDI_BLOCK |

## Part 3 — Scope Consistency

- roundId scope: **PASS** (2)
- runId scope: **PASS**
- duplicate candidateIds: **PASS**
- scope issues: none

## Part 4 — Stage Semantics Proof

1. **scanner_ai_reached ≠ execution_ai_reached** — round 2: 40 scanner / 0 execution
2. **tdi_skipped** = blocked before `executeAnalyzeAndTrade` (legitimate, not bypass)
3. **tdi_entered=0** expected when selection gate blocks all selected candidates

## Part 5 — 31 AI NO_TRADE Cases

| Classification | Count |
|----------------|-------|
| AI_POLICY | 29 |
| AI_RELIABILITY | 1 |
| DATA_QUALITY | 0 |
| INSUFFICIENT_CONTEXT | 1 |
| UNKNOWN | 0 |

Round 6 (HEMITRY): AI_DECISION_CONFLICT → AI_RELIABILITY
Round 17 (MOVRTRY): EMPTY decision → INSUFFICIENT_CONTEXT
Dominant: **AI_POLICY** (low confidence NO_TRADE at scanner selection gate)

## Part 6 — 18 Lane-Empty Cases

All 18 rounds: pump=NO, steady-gain=NO, last-resort=NO
First failing condition: **PUMP_STEADY_LAST_RESORT_ALL_EMPTY** (intentional policy)

## Part 7 — Final Classification

**MIXED**

- Engineering: Historical telemetry mislabeled scanner_ai as execution_ai; corrected in funnel trace service (fixed)
- Policy: 31/50 rounds: scanner AI NO_TRADE at selection gate; 18/50: intentional lane-empty terminal

## Part 8 — 30-Round Readiness

```
READY_FOR_30_ROUND_PAPER = YES
DRY_RUN = PASS
TELEMETRY_CONSISTENCY = PASS
STATE_MACHINE = PASS
```

REMAINING_BLOCKER: Policy: scanner AI NO_TRADE (31 rounds) + lane-empty (18 rounds) — telemetry truthful; zero-trade is policy not bug

NEXT_STEP: Proceed with 30-round paper campaign; verify first live round export shows scanner_ai + tdi_skip stages and cleared symbol on terminal NO_TRADE

Note: Historical DB export shows symbol bound on 30 NO_TRADE rounds (pre-fix snapshot). Post-fix code clears symbol via `shouldBindSymbolOnTerminalFail` + `transactionallyFailRound`.
