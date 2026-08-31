# KRIPTO — 5 Round × 20 Minute Full Stress Paper Validation (FINAL)

**Validation ID:** `5round-stress-2026-08-22T20-39-59-778Z`
**Session ID:** `cmt4udz4u0009un3k9mndd8ki`
**Started:** 2026-08-22T20:40:01.637Z
**Completed:** 2026-08-22T20:44:22.671Z
**Production readiness:** **NOT_READY**

## 1. Preflight

| Check | Status | Detail |
|-------|--------|--------|
| Overall | READY | canStart=true |
| Database | DB_HEALTHY | PostgreSQL reachable and AutoRound schema accessible |
| Binance TR | BINANCE_TR_HEALTHY | BTCTRY ticker ok (3699902) |
| Clock sync | CLOCK_SYNC_OK | skewMs=N/A threshold=5000 |
| AI providers | AI_CONFIGURED | 3 enabled AI provider(s) |
| Emergency stop | EMERGENCY_STOP_INACTIVE | |
| Artifact | `C:\Users\salih\Desktop\kripto-main\artifacts\forensics\cmt4udz4u0009un3k9mndd8ki\preflight.json` | |

## 2. Round-by-round

| Round | Duration (min) | Outcome | Candidates | TDI appr/wait | Sizing +/- | Exec ready | AI (remote) | Risk +/- | Orders | Fills | Closed | Gross | Fees | Net | Recovery | Terminal | Fail reason |
|-------|----------------|---------|------------|---------------|------------|------------|-------------|----------|--------|-------|--------|-------|------|-----|----------|----------|-------------|
| 1 | 0 | NON_TERMINAL | 0 | 0/0 | 0/0 | 0 | 65 (0) | 0/0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | tariyor |  |

**Job status:** RUNNING | completed=0 failed=0 | terminal rounds=0/1

## 3. Scheduler stress results

- Progress samples: 26
- Recovery snapshots: 0
- RESTART_CURRENT_STAGE total: **0**
- Premature restart on healthy progress: **NO**
- Progress state distribution: `{"SCANNER_ACTIVE":6,"WAITING_FOR_PROVIDER":13,"AI_ACTIVE":7}`

## 4. AI gate results

- Policy: `VETO`
- NO_TRADE / HOLD / REJECT / WAIT → orders: **0** (must be 0)
- VETO bypass count: **0**
- AI gate contradictions: **0**
- Remote AI calls (aggregate): **0**
- Degraded AI calls (aggregate): **0**

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

- Mean reversion entries: 0 | complete audit rows: 1
- Scanner qualification rejections: 0
- Entry timing records: 0
- EV calibration rounds with data: 0
- TDI WAIT distribution: `{}`
- Slot report rows: 0
- Fee-aware policy evaluations: 0

## 9. Runtime health

- Zombie rounds at job end: **1**
- Worker / recovery audits (job metadata): 5
- Watchdog NO_ACTION (scheduler crash checks): 5
- Validation runner DB disconnect: NO

## 10. Runtime ↔ artifact ↔ DB consistency

- Trade consistency: **NO_TRADES** — Zero trades across rounds — pipeline blocking stage analysis required
- Failed-round consistency: **N/A**

## 11. Failures / warnings

- **AI_STARTED_ORPHAN**: 1 AI candidate(s) stuck STARTED > 180000ms (round 1)
- **JOB_STILL_RUNNING**: Finalize invoked while job still RUNNING — incomplete stress session
- **ROUND_NOT_TERMINAL**: Round 1 state=tariyor (round 1)
- **ZOMBIE_ROUNDS**: 1 zombie run(s) after job end

## 12. Production readiness

**Verdict: NOT_READY**

### Profitability (classification: NOT_PROVEN)

| Trades | Wins | Losses | Gross | Fees | Net | Note |
|--------|------|--------|-------|------|-----|------|
| 0 | 0 | 0 | 0 | 0 | 0 | Stress run — not strategy certification |

### Readiness criteria

- Critical safety tests: PASS
- All rounds terminal: NO (0/5)
- Forensic minimum exports: YES
- Scheduler false restart: NONE

