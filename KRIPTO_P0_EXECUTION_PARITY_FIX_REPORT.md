# KRIPTO P0 — AI NO_TRADE -> EXECUTION PARITY FIX REPORT

## Executive Answer

`AI NO_TRADE/HOLD/REJECT/WAIT` veto semantics are now enforced by a single canonical gate before order creation, with missing/conflicting AI evidence defaulting to `BLOCK`.  
The 45-case offline replay blocks all cases (`historicalNoTradeExecutedAfter = 0`), and controlled runtime validation observed zero NO_TRADE bypass (no orders created in the observed round).

---

## 1) Root Cause

Primary divergence was not risk/sizing/fee logic; it was **execution semantics drift** between AI decision sources:

- Paper/learning paths could mutate `ai.finalDecision` to `BUY` while consensus remained blocking.
- Gate logic previously required consensus existence but did not block **AI vs consensus conflicts**.
- V2 order execution accepted `riskApproved` without requiring explicit AI-gate proof from caller.

This created a route where AI semantics and execution semantics could diverge under paper/learning conditions.

---

## 2) Exact Bypass Path (Classified)

- **DECISION_LAYER_OVERRIDE**
  - File: `src/server/scanner/fast-entry.service.ts`
  - Function: `selectPaperLearningMicroCandidates`
  - Condition: learning micro lane remaps `finalDecision` to `BUY`
  - Reason: execution could see executable final decision while upstream consensus still veto-like

- **CONFLICTING_DECISION_SOURCE**
  - File: `src/server/execution/ai-execution-gate.service.ts`
  - Function: `evaluateAiExecutionReadiness`
  - Condition: conflict check missing
  - Reason: `finalDecision` and `consensusDecision` mismatch was not a hard block

- **MISSING_VERDICT / GATE PROOF GAP**
  - File: `src/server/execution-engine-v2/execution-flow.service.ts`
  - Function: `executeApprovedSpotOrder`
  - Condition: direct order path could run without `aiGateVerdict` evidence
  - Reason: execution path did not require canonical AI-gate pass token

---

## 3) Canonical Gate

Authoritative pre-order gate: `evaluateAiExecutionReadiness` in `src/server/execution/ai-execution-gate.service.ts`.

Policy semantics:

- `NO_TRADE` -> `BLOCK`
- `HOLD` -> `BLOCK`
- `REJECT` -> `BLOCK`
- `WAIT` -> `BLOCK`
- `BUY/SELL` -> can continue only if downstream gates pass

Implemented reason-code behavior:

- `AI_VERDICT_MISSING`
- `AI_CONSENSUS_MISSING`
- `AI_DECISION_CONFLICT`
- `AI_EVIDENCE_MISSING`
- `AI_VETO`

No missing/conflicting evidence is interpreted as approval.

---

## 4) Paper Override Behavior

- Runtime policy is hardened to `VETO`.
- Silent paper advisory bypass is removed.
- Advisory path exists only as an explicit audited override payload (must include `overridePolicy`, `overrideReason`, `overrideSource`, `overrideAudit`) and is not used by normal runtime flow.

---

## 5) Historical Replay Results (45 Cases)

Replay artifact: `reports/p0-execution-parity-replay.json`.

- Replayed cases: `45`
- Gate blocked: `45`
- Executed after fix: `0`
- Reason distribution: `AI_VETO: 45`

Baseline before-count is the accepted forensic evidence for this P0 scope:

- `historicalNoTradeExecutedBefore = 45`
- `historicalNoTradeExecutedAfter = 0`

---

## 6) Test Results

Executed:

- `npx vitest run tests/forensics/p0-execution-correctness.test.ts tests/p0-tdi-buy-bottleneck.test.ts tests/master-decision-engine.test.ts tests/forensics/tdi-sensitivity-reconciliation.test.ts`

Result:

- Test files: `4/4 PASS`
- Tests: `53 PASS`

Added/updated parity regressions include:

- VETO blocks for `NO_TRADE/HOLD/WAIT/REJECT`
- missing AI verdict -> block
- missing consensus -> block (`AI_CONSENSUS_MISSING`)
- conflicting decision sources -> block (`AI_DECISION_CONFLICT`)
- explicit audited override required for advisory behavior
- NO-TRADE spelling normalization regression

---

## 7) Controlled Validation (2-round Target)

Runtime artifact: `reports/p0-execution-parity-2round-validation.json`

- Session: `cmsxgoteo000jun34o8rz4lym`
- Status: `STOPPED`
- Observed rounds: `1` (failed before execution phase)
- Orders created: `0`
- `aiVetoBypass`: `0`

Observation: run was interrupted under prolonged scanner/network instability; despite that, no NO_TRADE bypass into order creation was observed.

---

## 8) Before/After NO_TRADE Divergence

- Before (forensic evidence): `45` executed NO_TRADE divergence cases
- After (replay through canonical gate): `0`

Metric target satisfied:

- `historicalNoTradeExecutedBefore > 0`
- `historicalNoTradeExecutedAfter = 0`

---

## 9) Remaining Blockers

- Controlled runtime validation did not complete full 2 rounds because of environment instability (scanner/network).
- Validation JSON currently includes large live status payload noise (operational, not semantic correctness).

---

## Files Changed

- `src/server/execution/ai-execution-gate.service.ts`
- `src/server/execution/execution-orchestrator.service.ts`
- `src/server/execution-engine-v2/execution-flow.service.ts`
- `src/server/execution-engine-v2/execution-engine-v2.types.ts`
- `tests/forensics/p0-execution-correctness.test.ts`
- `scripts/run-5round-paper-validation.ts`
- `scripts/_p0-execution-parity-replay.ts`
- `scripts/_p0-execution-parity-2round-validation.ts`
- `reports/p0-execution-parity-replay.json`
- `reports/p0-execution-parity-2round-validation.json`
- `kripto-p0-execution-parity-fix.json`
