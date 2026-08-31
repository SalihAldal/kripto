# KRIPTO P0 - Round Runtime Persistence Fix Report

## 1. Root cause
- Primary: MULTIPLE_WRITERS + TRANSACTION_CONTENTION + CONNECTION_POOL.
- Secondary: write amplification on hot `AutoRoundJob` metadata row under scanner + AI bursts.

## 2. Writer map
- RoundRuntimeController.transition/heartbeat: persist -> idempotentPatchJobActiveRound + idempotentMergeRunMetadata -> AutoRoundJob + AutoRoundRun (high under scanner/AI)
- setJobState: updateAutoRoundJob(activeState) -> AutoRoundJob (per state transition)
- touchSchedulerLease: compareAndSetSchedulerLease -> AutoRoundJob.metadata.schedulerLease (loop heartbeat (now throttled))
- Scheduler recovery audit: appendRecoveryAuditEvent -> AutoRoundJob.metadata.recoveryAudit/recoveryState (watchdog/recovery ticks (now coalesced))
- Terminal transitions: transactionallyFailRound / transactionallyCompleteRound -> AutoRoundRun + AutoRoundJob (per round terminalization)

## 3. DB contention
- Before session: `cmsxuaect0009unioi4gvkxcb`
- After session: `cmsxx9h680009unmgzid9xa9g`
- Timeout count (patchJobActiveRound): before=2, after=0

## 4. Queue behavior
- coalescedWrites(max observed)=0
- maxQueueDepth=0
- maxQueueWaitMs=0
- retryCount(max observed)=0

## 5. Transaction analysis
- patchJobActiveRound p50/p95/p99/max (ms) after=8/61/126/126
- No patchJobActiveRound timeout row observed in controlled validation.

## 6. Connection pool analysis
- No connection acquisition/transaction-expired timeout surfaced in patchJobActiveRound path during this validation.

## 7. Retry and idempotency
- Runtime persist now retries transient bounded timeout path with short backoff.
- Terminal guard added: heartbeat patch ignored once job is already terminal.

## 8. Tests
- tests/round-runtime.test.ts
- tests/auto-round-integrity.test.ts
- tests/scheduler-ownership.test.ts
- tests/forensics/p1-runtime-reliability.test.ts

## 9. Controlled 2-round runtime validation
- scannerCandidates=304, aiCalls=600
- rounds failed=2, completed=0
- patchJobActiveRound timeoutCount=0

## 10. Before/after latency
- p50: 21 -> 8
- p95: 986 -> 61
- p99: 14742 -> 126
- max: 14742 -> 126

## 11. Remaining risks
- Round outcomes still fail on business gates (AI_NO_RESPONSE / SIM_TIGHT_FILTER) even though persistence path is stable.
- Queue telemetry fields remained low/zero in final snapshots; keep observing under future stress campaigns.

## Final Verdict
- RUNTIME_STABILITY = PASS
- READY_FOR_5_ROUND = CONDITIONAL
- READY_FOR_30_50_ROUND = CONDITIONAL
