# KRIPTO Final Round Liveness / Auto-Terminalization Fix

## 1) Actual hang root cause
- Root cause was a combined liveness defect:
  - watchdog treated `HEARTBEAT_ONLY` / degraded waiting states as indefinitely safe,
  - meaningful-business progress and heartbeat were not cleanly separated in runtime updates,
  - some round-critical market-context calls were not fully bound to abort/timeout propagation.
- This allowed long non-productive windows to stay `RUNNING` until external/manual intervention.

## 2) Hang snapshot analysis
- Legacy stalled run evidence (`artifacts/forensics/job-cmsz9hkmi0009un9wvgfystkf/rounds/1/round-hang-snapshot.json`) showed:
  - `currentStage=SCANNING`
  - `activeCandidates=80`
  - `activeScannerWork=28`
  - `remainingBudgetMs=153522`
  - watchdog classification already indicated `STALLED` but terminalization was not guaranteed end-to-end.
- Live replay evidence from latest 2-round run:
  - round runtime stuck windows observed around `SCANNING` context lane and `AI_ANALYSIS` (`Scanner consensus 56/70`) before round terminalization.

## 3) Exact in-flight operation
- Primary wait chain (scanner context stall):
  - `src/server/scanner/scanner.service.ts` -> `runScannerPipeline()` -> context `mapWithConcurrency(...)` worker
  - `withBoundedAwait("context-lite:*")`
  - `buildMarketContext(...)`
  - `marketDataOrchestrator.fetchContextBundle(...)`
  - `getKlines/getOrderBook/getRecentTrades` -> `fetchFromExchange(...)` -> provider calls
- Secondary wait chain (AI lane):
  - `runScannerPipeline()` AI worker
  - `buildMarketContext(...)` (full context refresh) before consensus
  - `withBoundedAwait("ai-consensus:*")` -> `runAIConsensusFromInput(...)`
- Classification:
  - `MARKET_DATA_WAIT` for context fetch path,
  - `AI_WAIT` for consensus path.

## 4) Abort propagation audit + fixes
- Added abort/timeout plumbing into market-data read options and context bundle reads:
  - `src/server/market-data/market-data.types.ts`
  - `src/server/market-data/market-data-orchestrator.service.ts`
- `fetchFromExchange(...)` now enforces timeout and abort-aware racing.
- Scanner / fast-entry / pump context calls now pass signal-linked bounded work into `withBoundedAwait(...)`.

## 5) Untracked promise findings
- Round-critical context/AI paths were converted to bounded, signal-aware awaits.
- Background market-intel enqueue from market-context was guarded to avoid starting when round signal is already aborted, and disabled in round-critical scanner/fast-entry paths.

## 6) Retry loop findings
- Retry/wait chains now inherit deadline-aware timeout and abort on market-data calls.
- Budget-driven abort continues to be enforced from pool/runtime controllers.

## 7) Watchdog failure reason and fix
- Failure reason: fresh heartbeat could mask stale meaningful business progress.
- Fix in `src/server/execution/round-progress-state.service.ts`:
  - progress age now prioritizes `lastMeaningfulProgressAt`,
  - waiting states (`WAITING_FOR_RETRY/PROVIDER/DB`, `DEPENDENCY_DEGRADED`, `HEARTBEAT_ONLY`) are grace-bounded,
  - beyond grace they escalate to `STALLED` (`MEANINGFUL_PROGRESS_STALE`).

## 8) Dependency grace behavior
- `DEPENDENCY_DEGRADED` is now explicitly finite via grace-window escalation.
- System no longer treats degraded dependency heartbeat as infinite safe harbor.

## 9) Terminalization mechanism
- Added canonical terminalization path in `src/server/execution/round-selection.service.ts`:
  - `terminalizeRound(...)` used by watchdog stale callback and abort catch path.
- Terminalization sequence:
  - cancel selection signal,
  - terminalize open AI candidates,
  - persist timeout/failure state through runtime controller.

## 10) Pool/worker cleanup hardening
- Existing cooperative pool bounds remained in place; liveness fix ensures stalled phases escalate/cancel instead of idling in `RUNNING`.

## 11) Scanner liveness changes
- Context fetch lanes are now signal-linked and bounded in both primary and fallback scanner context paths.
- Full-context call inside AI worker stage is now bounded and abort-aware.

## 12) AI liveness changes
- AI consensus remains bounded (`withBoundedAwait`) and abort-aware.
- Late updates are prevented from reopening terminal state by runtime terminal-step guard.

## 13) DB liveness changes
- Runtime persistence remains bounded (existing bounded Prisma path), and watchdog/progress classification no longer depends solely on heartbeat freshness.

## 14) Synthetic hang tests
- Added deterministic test suite: `tests/final-round-liveness.test.ts`
  - heartbeat fresh + meaningful stale => `STALLED`
  - dependency-degraded grace behavior
  - retry loop grace overrun => `STALLED`
  - terminal step cannot reopen to running phase

## 15) Real hang replay
- Replayed with `SCANNER_AI_CONCURRENCY=2 pnpm tsx scripts/_p1-scanner-entry-2round-validation.ts`.
- Before fix pattern: long non-productive windows required manual stop in previous cycle.
- After fix: run completed automatically with terminal rounds (no manual stop), job status reached `COMPLETED`.

## 16) Controlled 2-round validation result
- Source: `reports/p1-scanner-entry-2round-validation.json`
- Session: `cmszafzhn0009unww38mk64uh`
- Job status: `COMPLETED`
- Rounds:
  - Round 1: terminal failed (`SIM_TIGHT_FILTER_15m ...`)
  - Round 2: terminal failed (`AI_GATE_BLOCK: AI_VETO`)
- Manual stop: `0`

## 17) Before/after metrics
- `Maximum call stack size exceeded`: `12 -> 0` (previously validated)
- 2-round terminal completion: `NO -> YES` (terminalized automatically, no manual stop)
- AI veto bypass count: `0`
- Job zombie (`RUNNING` after run end): not observed in this replay

## 18) Remaining blockers
- No remaining P0 liveness blocker observed in the final 2-round replay.
- Profitability/strategy quality blockers remain outside this task scope (rounds ended by business gates, not liveness failure).

## 19) 50-round readiness
- Liveness/cancellation/terminalization path is materially improved and passed this 2-round controlled replay.
- Recommended next step: 5-round controlled paper (no parameter-policy changes) before 30/50 escalation.

## Final Verdict
- HANG_ROOT_CAUSE_IDENTIFIED = YES
- AUTO_STALL_TERMINALIZATION = PASS
- AI_STACK_STABILITY = PASS
- ROUND_LIVENESS = PASS
- CANCELLATION = PASS
- NO_ZOMBIES = PASS
- TWO_ROUNDS_COMPLETED = YES
- MANUAL_STOP_REQUIRED = NO
- READY_FOR_5_ROUNDS = YES
- READY_FOR_30_50_ROUNDS = CONDITIONAL
- READY_FOR_50_ROUND_PAPER = CONDITIONAL
