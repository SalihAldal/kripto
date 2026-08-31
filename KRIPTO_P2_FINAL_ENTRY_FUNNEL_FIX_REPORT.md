# KRIPTO P2 — FINAL ENTRY FUNNEL FIX REPORT

## Root Cause and Minimal Fix
- Root cause class: `MOMENTUM_CONTEXT_MAPPING`
- Exact file/function: `src/server/ai/hybrid-momentum-gates.ts` / `resolveLowMomentumInput()`
- Exact condition: `abs(shortMomentumPercent)<0.08 && abs(shortFlowImbalance)<0.03`
- Data path: `scanner.metadata.shortMomentumPercent/shortFlowImbalance -> scanner/ai-request-formatter.marketSignals -> resolveLowMomentumInput`
- Expected behavior: short-window momentum weakness should only be evaluated when short-window sample is sufficient.
- Actual behavior: zero-default telemetry values were interpreted as real weak momentum and produced false momentum blocks.
- Implemented minimum fix:
  - `src/types/ai.ts`: `marketSignals.shortTradeCount` added.
  - `src/server/scanner/ai-request-formatter.ts`: `shortTradeCount` forwarded.
  - `src/server/ai/hybrid-momentum-gates.ts`: low-momentum gate now requires `hasTelemetry && shortTradeCount>=2`.
- Threshold change: **NO**

## Current 2278 Candidate Funnel (Offline Replay)
- Source artifact session: `artifacts/forensics/cmt3h5yz10009unskr2vu94gx/rounds`
- Baseline APPROVED/WAIT/REJECT: `50 / 919 / 1309`
- Fixed APPROVED/WAIT/REJECT: `433 / 875 / 970`
- Delta (`newApproved/newWait/newReject`): `+383 / -44 / -339`
- Suspected false momentum-default blockers: `508`

## Historical Cohort Validation
- Profitable cohort size: `42`
- Baseline vs fixed profitable released: `0`
- Losing released: `0`
- Breakeven released: `0`
- Released net PnL: `0`
- Released expectancy: `0`
- False release rate: `0`

## Why Prior Fixes Failed
1. Confidence corrections failed because blocker was upstream telemetry-default gating, not pure confidence thresholding.
2. Momentum recalibration/penalty removal failed because low-momentum boolean was already forced by zero-default telemetry composition.
3. EV×liquidity and simple threshold experiments did not alter the gating contract that produced momentum false-block states.

## Safety Parity
- AI VETO preserved: `YES`
- Risk preserved: `YES`
- Sizing preserved: `YES`
- maxPositions/emergency stop/clock safety/order validation/fee reconciliation changed: `NO`

## Tests
- `pnpm vitest run tests/p0-tdi-buy-bottleneck.test.ts` -> `11/11 PASS`
- Entry-funnel validation artifact: `kripto-p2-entry-funnel-tests.json`
- TESTS = `PASS`

## Five-Round Readiness Gate
READY_FOR_5_ROUND = `YES`

FIVE_ROUND_VALIDATION_COMMAND =
`pnpm tsx scripts/run-5round-paper-validation.ts --rounds=5 --max-round-minutes=30 --mode=PAPER --ai=REAL_AI --no-force-trade --no-threshold-relax --emit-forensics --emit-funnel --emit-pnl --emit-runtime`

NEXT_STEP =
Bu görevde run başlatılmadı. Ayrı görevde yukarıdaki komutla tek seferlik 5-round Paper validation çalıştırılabilir.

## Final Verdict
ROOT_CAUSE = `MOMENTUM_CONTEXT_MAPPING`

FIX_IMPLEMENTED = `YES`

THRESHOLDS_CHANGED = `NO`

HISTORICAL_PROFITABLE_RELEASED = `0`

HISTORICAL_LOSING_RELEASED = `0`

RELEASED_NET_PNL = `0`

CURRENT_2278_BASELINE_APPROVED = `50`

CURRENT_2278_FIXED_APPROVED = `433`

CURRENT_2278_FIXED_EXECUTION_READY = `433`

AI_VETO_PRESERVED = `YES`

RISK_PRESERVED = `YES`

SIZING_PRESERVED = `YES`

TESTS = `PASS`

READY_FOR_5_ROUND = `YES`
