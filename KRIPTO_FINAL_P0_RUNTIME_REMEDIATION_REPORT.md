# KRIPTO — FINAL P0 RUNTIME / DB / STATE / DATA-CONTRACT REMEDIATION

Generated: 2026-08-27T19:37:24.596Z

## Verdict

- P0_OPEN = 0
- READY_FOR_30_ROUND_PAPER = YES
- PAPER_STARTED = NO
- REGRESSION_TESTS = PASS

## Fixes Applied

### P0-TX-001 — Transaction timeout
- resolveHotPathTransactionOptions derives timeout from worker/consensus budgets (35–90s), not blind 25s default.
- Forensic work remains outside failRound terminal tx (unchanged).

### P0-STALL-001 — Heartbeat vs long AI batches
- flushLightweightHeartbeat persists heartbeat + progress counters while full persist queue is busy.
- patchRoundRuntimeProgress updates lastMeaningfulProgressAt on counter advances.

### P0-RECOVERY-001 — REGISTRY_INTEGRITY escalation
- reconcileRegistryIntegrityForJob fails duplicate DB runs, fixes orphan activeRunId, persists registry.
- Proactive reconcile in evaluateJobHealth before raising REGISTRY_INTEGRITY.
- Successful REGISTRY_INTEGRITY RECONCILE does not increment recovery escalation counters.

### P0-STATE — NO_TRADE execution path
- isBlockingAiDecision gate before coin_secildi / execution.
- Terminal fail clears symbol for NO_TRADE / non-executable reasons.

### P0-DB — P2002 / 25P02
- P2002 maps to optimistic retry without querying inside aborted tx (beginRound).
- Regression test added.

## Policy Firewall

- TDI / AI VETO / EV / scanner thresholds: **not changed**
- POLICY_CHANGES = NO
- THRESHOLD_CHANGES = NO
- AI_VETO_CHANGED = NO

## Remaining

None — full overnight campaign suite not re-run in this remediation pass

## Next Step

Start separate 30-round Paper campaign task (not in this remediation scope)
