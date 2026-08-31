# KRIPTO P1 — Scanner Coverage + Candidate Quality + Entry Timing Fix

## Executive Answer

P1 core changes are implemented in native repository code with bounded priority evaluation, scanner coverage observability, deterministic COW-type reproduction, and expanded entry-timing forensics (`CHASING` / `EDGE_DECAY`) without changing BrainOS or lowering trade thresholds.

Runtime 2-round Paper proof was attempted and had to be stopped because of provider/network instability during scanner/AI phases; this is logged as a blocker, not a logic failure.

## 1) Scanner Root Cause

- Root cause: extreme movers could remain outside `cycleSymbols` in the rotating cursor window, producing `NOT_IN_CYCLE_SLICE`.
- Gap location: `watchlist -> cursor -> cycleSymbols -> context/qualification/ranking`.
- Fix strategy: add a bounded priority lane to ensure exceptional symbols are evaluated sooner, while preserving normal rotation and all downstream gates.

## 2) Rotation Analysis

- Deterministic bound: `maxCycles = ceil(watchlistSize / cycleLimit)`.
- Minimum cycles to revisit: `1`.
- Expected cycles (uniform position assumption): `(maxCycles + 1) / 2`.
- COW reproduction case implemented in tests:
  - `index=0`, `cursor=224`, `batch=79` -> excluded from rotation slice.
  - same symbol becomes evaluable through priority lane (still not auto-approved).

## 3) Bounded Priority Lane Design

Implemented in scanner pipeline:

- `priorityMaxPerCycle`: env-controlled (`SCANNER_PRIORITY_MAX_PER_CYCLE`), bounded to `1..24` (default `8`).
- Deduplication:
  - dedupe against rotation slice,
  - dedupe inside priority list,
  - merged evaluation list uses set semantics.
- Source + observability:
  - per symbol `discoverySource` (`ROTATION` / `PRIORITY` / `OTHER`),
  - `priorityReason` and `priorityScore` metadata on priority-routed symbols.
- Safety:
  - no symbol hardcode,
  - no bypass of strategy/TDI/sizing/risk/AI/execution.

## 4) COW-Type Reproduction

Added deterministic fixture tests showing:

- normal cycle excludes COW in the given cursor window;
- bounded priority includes COW in evaluation set;
- priority lane remains bounded and deduplicated.

## 5) Discovery Coverage Metrics (Exported)

Added and exported to forensic artifacts via scanner coverage snapshots:

- `scannerUniverse`
- `rotationCandidates`
- `priorityCandidates`
- `duplicatesRemoved`
- `totalEvaluated`
- `notDiscoveredCount`
- `priorityRescuedCount`
- per-symbol `discoverySource`, `priorityReason`, `priorityScore`

Scanner summary artifact now includes `coverage[]` and `latestCoverage`.

## 6) Candidate Quality Measurability

No thresholds were lowered. Candidate quality is now more measurable through:

- explicit per-symbol discovery source tracing,
- richer scanner qualification categorization (`LIQUIDITY`, `SPREAD`, `QUALIFICATION`, etc.),
- downstream entry timing and loss-pattern linkage.

## 7) Entry Timing Forensics

Extended entry timing classification with existing timing/move semantics (no new production gating thresholds):

- `GOOD_ENTRY`
- `NORMAL`
- `CHASING`
- `EDGE_DECAY`
- `UNKNOWN`

Also added aggregate telemetry in `entry-timing.json`:

- `entryDelayMs` p50/p90/p95
- `movementToEntryPercent` p50/p90/p95
- `candidateToDecision` p50/p90/p95
- `decisionToEntry` p50/p90/p95

Entry timing record updates now upsert by `(candidateId, symbol)` to prevent stale duplicates.

## 8) Chasing / Edge-Decay Analysis

- `CHASING`: late or adverse entry pressure relative to existing delay/move thresholds.
- `EDGE_DECAY`: adverse move plus delay beyond normal threshold.
- These are forensic classifications only; no automatic production approval/rejection behavior was introduced.

## 9) Missed Opportunity & Exclusion Categories

Scanner exclusion records now include `exclusionCategory`:

- `SCANNER_ROTATION`
- `PUMP_LANE_MISS`
- `QUALIFICATION`
- `LIQUIDITY`
- `SPREAD`
- `VOLATILITY`
- `STALE_DATA`
- `OTHER`

This improves first-blocking-stage auditability without weakening safety semantics.

## 10) Tests

Executed focused suite:

- `tests/forensics/p1-strategy-scanner-ev.test.ts`
- `tests/forensics/p2-tdi-slot-strategy.test.ts`
- `tests/scanner.test.ts`

Result: **3 files, 25 tests, all PASS**.

## 11) Controlled Validation (2 rounds)

- Script added: `scripts/_p1-scanner-entry-2round-validation.ts`
- Runtime attempt started, then blocked by prolonged scanner/AI runtime instability (provider/network cooldown behavior); manual stop required.
- Outcome: runtime validation status marked **BLOCKED_BY_RUNTIME_INSTABILITY** for this run.

## 12) Acceptance Status

- Priority candidates evaluable without safety bypass: **PASS**
- COW-type rotation miss resolved: **PASS**
- Scanner bounded + deduplicated + observable: **PASS**
- No symbol hardcode: **PASS**
- No TDI/AI/risk bypass: **PASS**
- Entry timing observable + chasing measurable + no look-ahead: **PASS**
- 2–5 round runtime proof: **BLOCKED** (environment instability)

## 13) Remaining Blockers

- Stable Paper runtime is required to complete round-level empirical validation artifacts for P1.
- Current blocker is operational (network/provider instability), not semantic gate logic.
