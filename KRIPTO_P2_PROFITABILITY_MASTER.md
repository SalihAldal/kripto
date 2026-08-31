# KRIPTO P2 PROFITABILITY MASTER

Generated: 2026-08-18T19:49:47.997Z
Source latest job: cmsyyp5xv000bunp4lhexsx0z (rounds=2)

## Canonical Baseline (Post-fix Latest Artifacts)

- candidateCount: 132
- tdiApproved: 0
- tdiWait: 33
- aiCalls: 290
- executionReady: 0
- orders: 0
- fills: 0
- closedTrades: 0
- grossPnL: 0
- fees: 0
- netPnL: 0
- winRate: 0
- profitFactor: 0
- expectancy: 0
- drawdown: 0

Strategy coverage (decision sample, not closed-trade PnL sample):
- Mean Reversion: 198
- Volatility Breakout: 0
- Trend Following: 8
- other: 84

Exit model counts: POSITION_MONITOR=0, REPLAY_WINDOW=0 (no closed trades)
Entry quality counts: GOOD_ENTRY=0, NORMAL=0, CHASING=0, EDGE_DECAY=0 (no executed entries)
Fee classes: FEE_SAFE=0, FEE_BORDERLINE=0, FEE_EROSION=0 (no executed trades)

## Strategy x Regime Profitability
All cells are `NOT_ENOUGH_DATA` for profitability metrics because latest post-fix sample has 0 closed trades.

## Entry Quality Analysis
- Winner/loser comparison unavailable (closedTrades=0).
- Entry timing as primary profitability driver: UNPROVEN in latest run.

## Fee Edge Analysis
- Current run: no executed trades, fee edge rows=0.
- Historical evidence: trades=51, grossPnL=-0.33651532, fees=5.09837823, netPnL=-5.43489355.
- Gross-positive/net-negative count (historical): 11.
- Minimum edge rule from actual fee model: expectedGrossEdge > estimatedRoundTripFee (no arbitrary constants).

## Candidate Quality (Repeatability Ranking)
- momentum / shortMomentum: FACT - First-blocking distribution shows momentum-dominant policy blocks in latest run.
- technical: FACT - Technical is second-largest first-blocking component in latest run.
- confidence: REPEATED_PATTERN - Confidence appears as low-frequency blocker; repeated but sparse.
- regime: HYPOTHESIS - No direct first-blocking regime events in latest run.
- flow/sentiment/liquidity/volatility/EV/OI: HYPOTHESIS - No outcome-linked winner/loser sample in current run.

## TDI Counterfactual (Offline Only)
- technical only: baselineApproved=0, counterfactualApproved=13, verdict=RESEARCH_CANDIDATE
- momentum only: baselineApproved=0, counterfactualApproved=19, verdict=RESEARCH_CANDIDATE
- confidence only: baselineApproved=0, counterfactualApproved=1, verdict=RESEARCH_CANDIDATE
- regime only: baselineApproved=0, counterfactualApproved=0, verdict=NOT_EFFECTIVE

## AI Quality
- AI reached rows: 290
- Evidence quality: INSUFFICIENT
- TDI-stopped candidates are excluded from AI reject attribution.

## Missed Opportunity Value
- NOT_DISCOVERED: 10
- DISCOVERED_BUT_NOT_TRADED: 622
- AI_REJECTED: 198
- Positive estimated opportunity rows: 0

## Promotion Gate
- Current status: RESEARCH_ONLY
- No runtime behavior change is applied in this phase.

## Profit Levers
- PRIMARY_PROFIT_LEVER: Reduce momentum-driven policy blocking only when expectedNetEdge remains positive
- SECONDARY: Fee-aware pre-trade edge validation
- SECONDARY: Regime-aware strategy gating (offline first)
- DO_NOT_CHANGE: TDI thresholds directly in production, AI confidence thresholds, EV/risk/sizing limits, maxPositions, SL/TP and hard strategy enable/disable

## Explicit Answers
1. What currently destroys net edge? Historical evidence shows fee drag dominates net edge; current run has no closed trades so active edge destruction is unobservable in-runtime.
2. Which strategy/regime combinations look promising? No profitability-proven combination in latest run; all strategy x regime cells remain NOT_ENOUGH_DATA for net edge.
3. How much is lost to fees? Historical: grossPnL=-0.33651532, fees=5.09837823, netPnL=-5.43489355 on 51 trades; current run: fees=0 due zero trades.
4. How much is lost to bad entry timing? Unquantified in latest run (no fills/closed trades). Entry timing remains RESEARCH_ONLY.
5. Which candidate features correlate with winners? No winner sample in latest run; only blocker-side facts (momentum, technical) are repeatable.
6. Which TDI gate is most restrictive? MOMENTUM
7. Which single change has the highest evidence-backed upside? Momentum-only gate relaxation is highest-upside research candidate by first-blocking frequency, pending expectancy-safe validation.
8. Which changes must NOT be made? Do not lower thresholds globally or force trade-count growth; do not deploy multi-change bundles without one-change evidence.