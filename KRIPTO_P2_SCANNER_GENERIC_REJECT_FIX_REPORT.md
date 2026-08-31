# KRIPTO P2 — Scanner Generic Reject Fix Report

> Generated: 2026-08-23T13:00:28.645Z
> Implementation: exact reject telemetry + spread/momentum shadow (no production policy change)

## Implementation

- `src/server/scanner/scanner-reject-telemetry.service.ts` — derive exact reject + shadow evaluator
- `src/server/scanner/scanner.service.ts` — telemetry on observeScannerDecision + PRE_AI spread shadow record
- `src/server/observability/decision-observability.service.ts` — exact reasonCode in timeline/execution bridge

## 37 Cohort Replay

- Diagnosable generic rejects: **15**
- False negatives explained: **19** / 19
- Legitimate rejections confirmed: **17**

## Loss Control (PARTIAL)

- Shadow released profitable symbols: **0**
- Shadow released losing symbols: **0**
- Shadow net PnL if released: **0.0000**

## FINAL VERDICT

```
GENERIC_SCANNER_REJECT_FIXED = YES
EXACT_REJECT_TELEMETRY = PASS
MISSING_DATA_HANDLING = PASS
STALE_DATA_HANDLING = PASS
SHADOW_EVALUATOR = PASS
37_COHORT_REPLAY = PASS
FALSE_NEGATIVES_EXPLAINED = 19
LEGITIMATE_REJECTIONS_CONFIRMED = 17
SHADOW_RELEASED_PROFITABLE = 0
SHADOW_RELEASED_LOSING = 0
SHADOW_NET_PNL = 0.0000
LOSS_CONTROL = PARTIAL
PRODUCTION_POLICY_CHANGED = NO
READY_FOR_SINGLE_VARIABLE_PAPER = YES
NEXT_STEP = Run single-variable paper validation on spread+momentum shadow gate after telemetry baseline round
```
