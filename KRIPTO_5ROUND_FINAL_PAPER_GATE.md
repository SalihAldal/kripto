# KRIPTO Final 5-Round Controlled Paper Gate

## 1. Preflight
- Attempt: `final-5round-gate-preflight-2026-08-19T06-40-35-953Z`
- Verdict: `READY` (`canStart=true`)
- DB/Prisma: `PASS` (`DB_HEALTHY`)
- Binance TR: `PASS` (`BTCTRY ticker ok`)
- Clock sync: `PASS` (`clockSkewMs=1562`, `apiLatencyMs=150`)
- AI providers: `PASS` (3 providers configured)
- Emergency stop: `PASS` (inactive)
- Active jobs / duplicate jobs / zombie rounds / worker locks: all `PASS`
- Resolved config: `PASS` (`executionMode=paper`, exchange resolved)

## 2. Round-by-round results
- Validation id: `5round-2026-08-19T06-40-48-478Z`
- Session id: `cmszq381m0009unq0g7suctl8`
- Target rounds: `5`
- Executed rounds: `1`
- Round 1:
  - `roundId=1`, `symbol=LINEATRY`
  - duration: `1200268 ms` (~20.00m)
  - terminal state: `tur_basarisiz`
  - fail reason: `scanner-ai pool aborted: Selection budget elapsed (1200s >= 1200s)`

## 3. Aggregate funnel
- Scanner candidates: `248`
- Trade count: `0`
- First blocking stage: `selection budget expiry in scanner-ai pool`
- Rejection highlights: `TDI_REJECTED=307`, `CONSENSUS_REJECT=187`, `SELECTION_BUDGET_EXCEEDED=17`, `AI_TIMEOUT=2`

## 4. Scanner / pump health
- Scanner ran and produced broad candidate coverage; no crash.
- Pump lifecycle exported and bounded; no pump timeout event.
- Pump fallback activity observed (`fallbackCount=10` in lifecycle events).
- Scanner/pump did not produce terminal safety bypass; round ended by budget.

## 5. TDI health
- TDI verdicts (runtime): `APPROVED=0`, `WAIT=22`, `REJECTED=0`
- WAIT distribution: `NEUTRAL=22`
- No missing TDI wait reason detected in exported summary.

## 6. AI parity
- AI invoked and completed partially under degraded mode:
  - invoked: `69`
  - success: `52`
  - degraded calls observed (`degradedCount=94`, remote calls `0`)
- No AI veto bypass event found.

## 7. Runtime / liveness
- Round reached terminal state automatically (no manual stop).
- Job status ended as `FAILED` after round 1 (did not continue to rounds 2-5).
- Zombie rounds after completion: `0`
- Watchdog export exists (`round-watchdog.json`), decision `NONE` at final snapshot.

## 8. Entry timing
- `entry-timing.json` exported.
- Entry timing records: `0`
- Classification counts: none (`CHASING=0`, `EDGE_DECAY=0`, `GOOD_ENTRY=0`, `NORMAL=0`)

## 9. Execution readiness
- Execution ready count: `0`
- Orders: `0`
- Fills: `0`
- Simulated trades: `0`

## 10. Trade lifecycle
- No natural trade opened.
- Full lifecycle chain (entry->exit->settlement) not observed in this run.

## 11. Exit
- Exit forensics files exported.
- No exit event (`tradeCount=0`, no position monitor terminal exit reason).

## 12. Fees / PnL
- `grossPnL=0`, `totalFees=0`, `netPnL=0`
- Consistency check: `netPnL = grossPnL - totalFees` holds (`0 = 0 - 0`)
- No PnL/fee mismatch failure.

## 13. Artifact completeness
- Core round forensic artifacts exported for round 1.
- Additional requested gate artifact gap:
  - `round-liveness.json` was not found under round directory.
- `missingArtifacts` list in validator output was empty (its expected list does not include every gate-requested file).

## 14. Failures / warnings
- Critical stop triggers observed: none (`AI_VETO_BYPASS=0`, PnL mismatch none, zombie none).
- Main gate failure: 5-round objective not met; session terminated after first round due to selection budget expiry.

## 15. First blocking stage per round
- Round 1: `SCANNER/AI selection budget exhausted` (20m cap reached).
- Rounds 2-5: not executed (job ended `FAILED` after round 1).

## 16. Readiness assessment
- Gate outcome: **FAIL** for 5-round requirement (not 5/5 terminal rounds).
- Safety posture: no bypass evidence, no manual stop, no zombies, no RangeError evidence in this run.
- Campaign readiness: not ready for 30-50 expansion based on incomplete 5-round gate.

## Final Verdict
- FIVE_ROUNDS_COMPLETED = **NO**
- RUNTIME_STABLE = **NO**
- AI_PARITY = **PARTIAL**
- SCANNER_STABLE = **PARTIAL**
- TDI_CORRECT = **PARTIAL**
- EXIT_RUNTIME_PROVEN = **NO**
- FEE_RECONCILIATION_PROVEN = **NO**
- TRADE_LIFECYCLE_PROVEN = **NO**
- PROFITABILITY_PROVEN = **NOT_PROVEN**
- READY_FOR_30_50_ROUNDS = **NO**
- READY_FOR_50_ROUND_PAPER = **NO**
