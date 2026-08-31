# KRIPTO — Final 5-Round Post-Throughput Gate

## 1) Preflight
- Result: **BLOCKED (validation not started)**
- Reason: Active/duplicate job safety conflict detected before run start.
- Preflight attempt: `final-5round-post-throughput-preflight-1787131832762`
- Preflight overall verdict: `READY` (service-level checks pass), but runtime state query shows user has `RUNNING` jobs with `stopRequested=true` not fully terminalized.

## 2) Critical blocker evidence
- `runningForUser` includes:
  - `cmsz9dsy80009unlw9c26k8hb` (`RUNNING`, `currentRound=1`, `stopRequested=true`)
  - `cmsz7lzqi0009uneosnuhv08d` (`RUNNING`, `currentRound=2`, `stopRequested=true`)
- `zombieRuns`: `0`
- This is treated as a **critical safety ambiguity** for duplicate/active job checks.

## 3) Execution status
- 5-round run requested: **YES**
- 5-round run started: **NO**
- Rounds executed: **0 / 5**
- Manual stop: **NO**

## 4) Required comparison vs previous validation
- Previous metrics are preserved, but current run metrics are `N/A` because validation did not start under safety rule.
- No code/config/policy change was made.

## 5) Final verdict
- FIVE_ROUNDS_COMPLETED = **NO**
- SELECTION_THROUGHPUT = **FAIL**
- AI_REMOTE_HEALTH = **FAIL**
- TDI_RECONCILIATION = **FAIL**
- SCANNER_RUNTIME = **FAIL**
- ROUND_LIVENESS = **FAIL**
- AI_PARITY = **FAIL**
- EXIT_RUNTIME_PROVEN = **NO**
- FEE_RECONCILIATION_PROVEN = **NO**
- TRADE_LIFECYCLE_PROVEN = **NO**
- PROFITABILITY_PROVEN = **NOT_PROVEN**
- READY_FOR_30_50_ROUNDS = **NO**
- READY_FOR_50_ROUND_PAPER = **NO**

## 6) Follow-up needed (before rerun)
- Force-terminalize or reconcile the two `RUNNING + stopRequested=true` jobs.
- Re-run preflight until `runningForUser=[]` and duplicate-job check is unambiguous.
- Then start exactly one 5-round validation run.

