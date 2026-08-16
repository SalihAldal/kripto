# KRIPTO — 5 Round Stress Paper Validation

**Validation ID:** `5round-stress-2026-08-14T17-46-20-544Z`
**Session ID:** `cmst8nza40007unvsi2211emo`
**Started:** 2026-08-14T17:46:29.957Z
**Completed:** 2026-08-14T19:31:31.973Z
**Production readiness:** **NOT_READY**

## 1. Preflight

| Check | Status | Detail |
|-------|--------|--------|
| Overall | READY | canStart=true |
| Database | DB_HEALTHY | PostgreSQL reachable and AutoRound schema accessible |
| Binance TR | BINANCE_TR_HEALTHY | BTCTRY ticker ok (3014043) |
| Clock sync | CLOCK_SYNC_OK | skewMs=N/A threshold=5000 |
| AI providers | AI_CONFIGURED | 3 enabled AI provider(s) |
| Emergency stop | EMERGENCY_STOP_INACTIVE | |
| Artifact | `C:\Users\salih\Desktop\kripto-main\artifacts\forensics\cmst8nza40007unvsi2211emo\preflight.json` | |

## 2. Round-by-round

| Round | Duration (min) | Outcome | Candidates | TDI appr/wait | Sizing +/- | Exec ready | AI (remote) | Risk +/- | Orders | Fills | Closed | Gross | Fees | Net | Recovery | Terminal | Fail reason |
|-------|----------------|---------|------------|---------------|------------|------------|-------------|----------|--------|-------|--------|-------|------|-----|----------|----------|-------------|
| 1 | 10.62 | LEGITIMATE_ZERO_TRADE | 6 | 0/6 | 0/0 | 0 | 2 (18) | 0/0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | tur_basarisiz | AI_GATE_BLOCK: NO_TRADE |
| 2 | 21.72 | LEGITIMATE_ZERO_TRADE | 46 | 0/27 | 0/0 | 0 | 44 (91) | 0/0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | tur_basarisiz | Tur secim suresi doldu (1200s) |
| 3 | 21.72 | LEGITIMATE_ZERO_TRADE | 38 | 1/40 | 0/0 | 0 | 2 (156) | 0/0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | tur_basarisiz | AI_GATE_BLOCK: NO_TRADE |
| 4 | 50.32 | LEGITIMATE_ZERO_TRADE | 0 | 0/0 | 0/0 | 0 | 4 (0) | 0/0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | tur_basarisiz | Stale RUNNING job reconciled before paper start (S |

**Job status:** STOPPED | completed=0 failed=4 | terminal rounds=4/4

## 3. Scheduler stress results

- Progress samples: 2
- Recovery snapshots: 0
- RESTART_CURRENT_STAGE total: **0**
- Premature restart on healthy progress: **NO**
- Progress state distribution: `{"UNKNOWN":2}`

## 4. AI gate results

- Policy: `VETO`
- NO_TRADE / HOLD / REJECT / WAIT → orders: **0** (must be 0)
- VETO bypass count: **0**
- AI gate contradictions: **0**
- Remote AI calls (aggregate): **265**
- Degraded AI calls (aggregate): **56**

## 5. Clock / API results

- Skew ms — min: N/A | avg: N/A | max: N/A (0 samples)
- API latency ms — min: N/A | avg: N/A | max: N/A (0 samples)
- Clock safety blocks observed: **0**

## 6. Exit results

- Exit reasons: `{}`
- Exit models: `{}`
- EXIT_EDGE_NOT_PROVEN: **YES (no TP/SL/STRATEGY/TIME exits observed)**

## 7. Fee results

| Gross | Fees | Net | Reconciliation |
|-------|------|-----|----------------|
| 0 | 0 | 0 | PASS |

## 8. P1/P2 artifact results

- Mean reversion entries: 0 | complete audit rows: 4
- Scanner qualification rejections: 0
- Entry timing records: 0
- EV calibration rounds with data: 0
- TDI WAIT distribution: `{"NEUTRAL":69,"BELOW_THRESHOLD":4}`
- Slot report rows: 9
- Fee-aware policy evaluations: 0

## 9. Runtime health

- Zombie rounds at job end: **0**
- Worker / recovery audits (job metadata): 10
- Watchdog NO_ACTION (scheduler crash checks): 10
- Validation runner DB disconnect: YES (postprocess used)

## 10. Runtime ↔ artifact ↔ DB consistency

- Trade consistency: **NO_TRADES** — Zero trades across rounds — pipeline blocking stage analysis required
- Failed-round consistency: **AGREE**
  - Round 1: failReason, terminalState, endedAt aligned

## 11. Failures / warnings

- **ARTIFACTS_MISSING**: Round 4 missing minimum artifacts: round-summary.json, recovery-decisions.json, recovery-telemetry.json (round 4)

## 12. Production readiness

**Verdict: NOT_READY**

### Profitability (classification: NOT_PROVEN)

| Trades | Wins | Losses | Gross | Fees | Net | Note |
|--------|------|--------|-------|------|-----|------|
| 0 | 0 | 0 | 0 | 0 | 0 | Stress run — not strategy certification |

### Readiness criteria

- Critical safety tests: PASS
- All rounds terminal: NO (4/5)
- Forensic minimum exports: PARTIAL
- Scheduler false restart: NONE

