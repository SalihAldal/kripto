# KRIPTO - FINAL 5-ROUND CONTROLLED PAPER VALIDATION

## 1. Preflight
- PostgreSQL / Prisma: PASS (`DB_HEALTHY`)
- Binance TR: PASS (`BINANCE_TR_HEALTHY`, BTCTRY ticker OK)
- Clock sync and API latency: PASS (clock skew `28ms`, latency `128ms`)
- REAL_AI providers: PASS (`3` provider configured)
- Emergency stop: PASS (`EMERGENCY_STOP_INACTIVE`)
- Active jobs: PASS (`NO_ACTIVE_JOB`)
- Zombie rounds: PASS (`NO_ZOMBIE_ROUNDS`)
- Worker lock: PASS (`WORKER_LOCKS_CLEAR`)
- Resolved config: PASS (`executionMode=paper`, `exchange=binance`)
- Code/worker fingerprint: not explicitly exposed in preflight payload

## 2. Round-by-round summary
- Round 1: `tur_basarisiz`, symbol `BMTUSDT`, duration `8.78m`, scannerCandidates `6`, TDI `0/1/0` (APPROVED/WAIT/REJECTED), orders `0`, trades `0`, failReason `SIM_TIGHT_FILTER_15m ... risk 100.00 > 82`
- Round 2: `tur_basarisiz`, symbol `EULUSDT`, duration `20.22m`, scannerCandidates `31`, TDI `0/6/0`, orders `0`, trades `0`, failReason `Tur secim suresi doldu (1200s)`
- Round 3: `tur_basarisiz`, symbol `ONTTRY`, duration `21.90m`, scannerCandidates `35`, TDI `0/11/0`, orders `0`, trades `0`, failReason `Tur secim suresi doldu (1200s)`
- Round 4: `tur_basarisiz`, symbol `DOLOTRY`, duration `18.53m`, scannerCandidates `29`, TDI `0/14/0`, orders `0`, trades `0`, failReason `PUMP_SCAN_FAILED ... exceeded 90000ms`
- Round 5: not started (job failed before round start)

## 3. Funnel totals
- scannerCandidates: `101`
- TDI: APPROVED `0`, WAIT `32`, REJECTED `0`
- execution-ready: `0`
- orders/fills/simulated trades: `0/0/0`

## 4. AI parity result
- AI gate policy: `VETO`
- Critical AI execution bypass (`NO_TRADE/HOLD/REJECT/WAIT` + order created): **not detected**
- AI parity verdict: **PASS**

## 5. Scanner priority-lane result
- rotationCandidates: `0`
- priorityCandidates: `0`
- priorityRescuedCount: `0`
- notDiscoveredCount: `0`
- discoverySource evidence: not observed in this run
- Verdict: **NOT_PROVEN**

## 6. Entry timing result
- Entry timing records: `0`
- CHASING count: `0`
- EDGE_DECAY count: `0`
- Verdict: **NOT_PROVEN**

## 7. Exit result
- TAKE_PROFIT: `0`
- STOP_LOSS: `0`
- STRATEGY_EXIT: `0`
- TIME_EXIT: `0`
- END_OF_REPLAY: `0`
- POSITION_MONITOR model: `0`
- REPLAY_WINDOW model: `0`
- Exit verdict: **EXIT_RUNTIME_NOT_PROVEN**

## 8. Fee/PnL reconciliation
- grossPnL: `0`
- totalFees: `0`
- netPnL: `0`
- Check `netPnL = grossPnL - totalFees`: **PASS**
- Mismatch count: `0`

## 9. Runtime health
- Job status: `FAILED`
- Rounds terminal: `4 / 5`
- Zombie rounds: `0`
- Critical failure class hit: none of `CRITICAL_AI_EXECUTION_BYPASS`, `PNL_MISMATCH`, orphan/zombie safety breaks
- Blocking runtime failure: `PUMP_SCAN_FAILED: resolveLiveTopGainerPumpCandidates exceeded 90000ms (timer)`

## 10. Remaining gaps
- `5_ROUNDS_NOT_COMPLETED`
- `FIRST_BLOCKING_STAGE=SCANNER_PUMP_DISCOVERY_TIMEOUT`
- `SCANNER_PRIORITY_LANE_NOT_PROVEN`
- `ENTRY_TIMING_NOT_PROVEN`
- `EXIT_RUNTIME_NOT_PROVEN`
- `NO_TRADES_OBSERVED`

## 11. Final readiness verdict
- Final verdict: **PARTIAL**
- READY_FOR_30_50_ROUNDS = **NO**

Zero-trade outcome is not marked as failure by itself; the first blocking stage is scanner/pump discovery timeout before execution and trade lifecycle stages.
