# KRIPTO P2 FINAL PROFITABILITY VALIDATION

Generated: 2026-08-18T20:59:45.015Z

## 1) Baseline
- Current baseline (post-fix latest): candidateCount=132, tradeCount=0, netPnL=0, expectancy=0, profitFactor=0.
- Historical before-P2 reference: trades=51, grossPnL=-0.33651532, fees=5.09837823, netPnL=-5.43489355.

## 2) Variant
- Variant under validation: P2 fee-aware profitability guard (EXECUTION_FEE_AWARE_MODE=enabled).
- No strategy/threshold tuning performed during validation.

## 3) Offline Replay Result
- Deterministic baseline vs variant replay at candidate/trade-row level: NOT AVAILABLE.
- Limitation: current post-fix artifact set has zero closed trades and no executable per-trade replay rows for attribution.

## 4) Paper Result
- Baseline shadow run: session cmsz4f7td0009uniwl6ip6khj -> status EXIT_RUNTIME_NOT_EXERCISED, round failed by selection timeout (1200s), closedTrades=0.
- Variant enabled run: session cmsz585hc0009uniweey6rdds -> status EXIT_RUNTIME_NOT_EXERCISED, critical failure CRITICAL_ROUND_NOT_CREATED, lastError transactionallyBeginRound job version conflict.
- AI VETO bypass observed: NO (0).

## 5) Net Expectancy
- Baseline: 0
- Variant: 0
- Delta: 0 (NOT_PROVEN)

## 6) Net PnL
- Baseline: 0
- Variant: 0
- Delta: 0 (NOT_PROVEN)

## 7) Profit Factor
- Baseline: 0
- Variant: 0

## 8) Drawdown
- Baseline: 0
- Variant: 0

## 9) Fees
- Baseline round fees: 0
- Variant round fees: 0
- Historical fee-drag context remains significant (fees > |gross| in reference sample).

## 10) Entry Quality
- Baseline GOOD/NORMAL/CHASING/EDGE_DECAY: 0/0/0/0
- Variant GOOD/NORMAL/CHASING/EDGE_DECAY: 0/0/0/0

## 11) Exit Quality
- POSITION_MONITOR/REPLAY_WINDOW and TP/SL/STRATEGY_EXIT/TIME_EXIT/END_OF_REPLAY: all 0 in both runs.

## 12) Strategy Performance
- No executed trades in baseline/variant validation windows; no strategy performance delta can be validated.

## 13) Regime Performance
- No regime-level PnL validation possible due zero closed trades.

## 14) AI Quality
- Baseline AI calls observed (progress): 51; variant: 0 (round not created).
- AI parity/safety bypass: none detected.

## 15) Loss Attribution Before/After
- Before P2 strongest known driver: FEE_DRAG (historical).
- After P2 validation window: NOT_PROVEN (no executed trades).

## 16) Safety Checks
- AI VETO bypass: none detected.
- PnL mismatch bypass: none detected in sampled runs.
- Runtime critical issue: variant job version conflict prevented round creation.

## 17) OOS Result
- OOS_NOT_AVAILABLE.

## 18) Profit Concentration
- Not applicable (net PnL not positive).

## 19) Promotion Decision
- Classification: RESEARCH_ONLY.
- Reason: improvement could not be validated offline or in controlled paper; variant run hit runtime correctness failure before round creation.

## 20) Remaining Weaknesses
- No closed trades in validation windows.
- Variant runtime failure (transactionallyBeginRound job version conflict).
- Deterministic candidate-level replay attribution unavailable.

## Final Verdict
- P2_VALIDATION = PARTIAL
- VARIANT_RESULT = NOT_PROVEN
- NET_EDGE_IMPROVED = NOT_PROVEN
- SAFETY_REGRESSION = NONE
- READY_FOR_30_50_ROUNDS = NO
- READY_FOR_100_PLUS_TRADE_VALIDATION = NO
- PROFITABILITY_CONFIRMED = NOT_PROVEN