# KRIPTO — Job Reconciliation + Final 5-Round Gate

## 1) Initial Stale-Job Inventory
- `cmsz9dsy80009unlw9c26k8hb`: `RUNNING`, `stopRequested=true`, `activeRunId=null`, no open run.
- `cmsz7lzqi0009uneosnuhv08d`: `RUNNING`, `stopRequested=true`, `activeRunId=null`, no open run.
- Both had stale scheduler lease metadata and no live local scheduler loop/ownership evidence.

## 2) Ownership Analysis
- Worker/process ownership (local): no active loop, no active round ownership for both jobs.
- Scheduler lease: both leases existed in metadata, `state=RUNNING`, but heartbeat stale (`leaseLive=false`, `leaseStale=true`).
- Classification: both jobs were `STALE_STOPPING_JOB` (stop requested, no live owner).

## 3) Reconciliation Actions (Safe Native Mechanism)
- Used existing engine flow only: `stopAutoRoundJob(userId)` from `auto-round-engine.service`.
- Flow executed by app:
  - finalize stop-requested job
  - terminalize in-progress round records (if any)
  - persist job terminal state (`STOPPED`)
  - clear active run pointer
  - stop scheduler watchdog registration
- No direct ad-hoc SQL, no app-code changes, no config/threshold/policy changes.

## 4) Before/After Job States
- `cmsz9dsy80009unlw9c26k8hb`: `RUNNING -> STOPPED`, terminal state `bekliyor`, `activeRunId=null`, lock none.
- `cmsz7lzqi0009uneosnuhv08d`: `RUNNING -> STOPPED`, terminal state `bekliyor`, `activeRunId=null`, lock none.
- Proof artifact: `job-reconciliation.json`.

## 5) Clean Preflight Result
- Clean preflight (pre-start) executed and all required checks passed:
  - Postgres PASS
  - Binance PASS
  - Clock PASS
  - REAL_AI config PASS
  - Emergency stop PASS
  - Active jobs PASS
  - Duplicate jobs PASS
  - Zombie rounds PASS
  - Worker locks PASS
  - Resolved config PASS
- Preflight artifact: `artifacts/forensics/preflight/final-5round-clean-preflight-1787132132688/preflight.json`.

## 6) 5-Round Gate Results
- Started session/job: `cmszwci4l0009unywvfufbuj9`.
- Intended: exactly 5 rounds, up to 30 min/round.
- Observed:
  - Round 1: terminal `tur_basarisiz` (selection timeout), ~1200s.
  - Round 2: terminal `tur_basarisiz` (`AI_GATE_BLOCK: AI_VETO`), ~1269s.
  - Round 3: terminal `tur_basarisiz` (selection timeout), ~1200s.
  - Round 4: entered `tariyor`, then validation monitor hit timeout condition and reported zombie/non-terminal evidence.
  - Round 5: not started.
- Validation artifact (`kripto-5round-paper-validation.json`) recorded critical failures:
  - `JOB_TIMEOUT`
  - `ROUND_NOT_TERMINAL`
  - `ZOMBIE_ROUNDS`

## 7) Runtime Health
- During gate execution, runtime stayed live for rounds 1-3.
- Critical runtime violation occurred at round 4 in validation monitor (`RUNNING` + non-terminal/zombie evidence).
- Safe stop reconciliation was applied to the gate job after violation; final DB state:
  - job `STOPPED`
  - no running jobs
  - no zombie open runs
- Post-run preflight returned clean (`READY`).

## 8) AI Remote Health
- Rounds 1-3 showed non-zero remote/degraded AI telemetry (remote calls present).
- Round 4 artifact set was incomplete due interruption; remote/degraded counters were not complete for that round.
- Result: AI parity not proven across full 5-round horizon.

## 9) TDI Reconciliation
- Rounds 1-3 had consistent TDI telemetry exported (`tdi-decisions.json`, `tdi-sensitivity.json`, summary counters).
- Round 4 missing TDI export set due non-terminal interruption at validation stage.
- Result: partial reconciliation only.

## 10) Scanner/Pump Health
- Scanner/pump progressed and produced telemetry in terminal rounds.
- No evidence of forced-symbol bypass.
- Round 4 interruption prevents full 5-round stability claim.

## 11) Trade Lifecycle
- No orders/fills/trades created in observed rounds.
- No AI veto bypass observed (round 2 veto correctly blocked execution).

## 12) Fees / PnL
- No trades -> gross/net/fees remained zero for observed rounds.
- No PnL mismatch evidence.

## 13) Artifact Completeness
- Rounds 1-3: required artifact set present (including `round-liveness.json` and `selectionTimeBudgetBreakdown.json`).
- Round 4: partial artifacts; missing key files including:
  - `round-liveness.json`
  - `selectionTimeBudgetBreakdown.json`
  - multiple execution/TDI/fee/pnl traces
- Round 5: no artifacts (round not started).

## 14) Readiness Verdict
- Reconciliation goal was successful (stale blockers cleared safely).
- Gate start condition was satisfied (clean preflight achieved).
- Full 5-round completion gate was **not** achieved due runtime timeout/zombie critical condition in round 4.

## Final Verdict
- `STALE_JOBS_CLEARED = YES`
- `CLEAN_PREFLIGHT = YES`
- `FIVE_ROUNDS_STARTED = YES`
- `FIVE_ROUNDS_COMPLETED = NO`
- `RUNTIME_STABLE = NO`
- `AI_PARITY = FAIL`
- `SCANNER_STABLE = PARTIAL`
- `TDI_RECONCILED = PARTIAL`
- `READY_FOR_30_50_ROUNDS = CONDITIONAL`
- `READY_FOR_50_ROUND_PAPER = NO`

