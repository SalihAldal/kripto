# KRIPTO P2 — DEEP PROFITABILITY ATTRIBUTION

Generated: 2026-08-22T11:28:16.017Z

## Scope
- Research/forensics only; no new paper run, no new market data, no production behavior change.

## Canonical 173 Dataset
- Trade count: 173
- Baseline net PnL: -18.59520123
- Baseline expectancy: -0.10748671

## Loss Attribution (Primary Causes)
- EXIT_PROBLEM: trades=121, netPnL=-19.406392, share=93.97%
- STRATEGY_WEAKNESS: trades=13, netPnL=-0.907587, share=4.39%
- FEE_EROSION: trades=6, netPnL=-0.338164, share=1.64%

## Fee / Entry / Regime / Strategy / Exit Impact
- Fee impact: SECONDARY (feeContributionPct=0.00%)
- Entry impact: SECONDARY
- Regime impact: SECONDARY
- Strategy impact: SECONDARY
- Exit impact: DOMINANT

## FEE_AWARE (173 paired)
- Blocks: 9
- Avoided net loss: 0.33816403
- Effect: NEUTRAL

## Temporal OOS
- Status: PARTIAL
- Split sizes: TRAIN=103, VALIDATION=34, OOS=36

## Top 5 Profitability Problems
- #1 EXIT_PROBLEM: affected=121, impact=-19.406392, exp=EXIT_MODEL forensic replay: reason-specific hold/close policy A/B
- #2 STRATEGY_WEAKNESS: affected=13, impact=-0.907587, exp=STRATEGY_REGIME selective enablement shadow A/B
- #3 FEE_EROSION: affected=6, impact=-0.338164, exp=FEE_AWARE selective block shadow experiment
- #4 REGIME_MISMATCH: affected=0, impact=0.000000, exp=REGIME_AWARE gating shadow experiment
- #5 EDGE_DECAY: affected=0, impact=0.000000, exp=ENTRY_QUALITY delayed-entry guard shadow experiment

## Report Must Answer
1) Largest negative expectancy source: EXIT (0.939679)
2) Loss percentage from fees: 0.00%
3) Loss percentage from entry quality: 0.00%
4) Loss percentage from regime mismatch: 0.00%
5) Loss percentage from strategy weakness: 4.39%
6) Loss percentage from exit behavior: 93.97%
7) FEE_AWARE materially improving net expectancy: NEUTRAL
8) Entry timing materially hurting performance: SECONDARY
9) One strategy responsible for most losses: Mean Reversion
10) One regime responsible for most losses: LOW_VOLATILITY
11) AI predictive quality useful: UNKNOWN
12) TDI too conservative: UNKNOWN
13) Strongest positive-net pattern: NONE
14) Strongest negative pattern: MR + LOW_VOLATILITY + FEE_SAFE
15) Single first experiment: EXIT_MODEL forensic replay: reason-specific hold/close policy A/B
16) What should NOT be changed: TDI/technical/momentum/confidence thresholds, sizing, EV, risk, maxPositions, AI prompts/VETO, strategy rules, SL/TP, fee schedule, scanner thresholds
17) Missing evidence: Executed trades için runtime TDI verdict ve rich AI decision snapshot coverage düşük; fee(gercek) kolonları 173 paired sette fiilen 0.

## Final Verdict
CURRENT_PAIRED_TRADES = 173
BASELINE_NET_PNL = -18.59520123
BASELINE_NET_EXPECTANCY = -0.10748671
PRIMARY_LOSS_DRIVER = EXIT
PRIMARY_LOSS_DRIVER_SHARE = 0.939679
FEE_IMPACT = SECONDARY
ENTRY_IMPACT = SECONDARY
REGIME_IMPACT = SECONDARY
STRATEGY_IMPACT = SECONDARY
EXIT_IMPACT = DOMINANT
FEE_AWARE_EFFECT = NEUTRAL
TDI_EFFECTIVENESS = UNKNOWN
AI_PREDICTIVE_QUALITY = UNKNOWN
POSITIVE_NET_PATTERN = NONE
NEGATIVE_NET_PATTERN = MR + LOW_VOLATILITY + FEE_SAFE
FIRST_EXPERIMENT = EXIT_MODEL forensic replay: reason-specific hold/close policy A/B
OOS_SUPPORTED = PARTIAL
PRODUCTION_CHANGE_RECOMMENDED = NO
