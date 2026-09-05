# KRIPTO P4 - Regime-Aware Multi-Strategy Engine

- `P3_ENGINEERING_VERDICT=PASS`
- `P4_ENGINEERING_VERDICT=PASS`
- `SELECTED_STRATEGY=NONE`
- `OFFLINE_PROMOTION_CANDIDATE_COUNT=0`

## Implemented
- Tek canonical regime authority (deterministic): `evaluateCanonicalRegime`.
- Five explicit strategy contract (enum-based, string parsing yok): `evaluateStrategies`.
- Shadow-only strategy router + deterministic conflict state: `routeStrategies`.
- Cost-aware minimum viable move hesabı: `computeMinimumViableMove`.
- Walk-forward split (time ordered + embargo + lifecycle isolation): `walkForwardSplit`.
- Negative control label-shuffle gate: `runNegativeControlLabelShuffle`.
- Multiple-testing correction (Bonferroni style): `evaluateMultipleTesting`.

## Firewall and Safety
- `shadowOnly=true` for evaluations and router.
- Production canonical entry mutation: `0`
- Strategy-caused paper/live order: `0`
- Risk/safety bypass: `0`
- `liveSubmitCount=0`

## Validation
- `tests/p4-regime-strategy-shadow.test.ts` PASS
- P3 dependency suite PASS
- `npm run typecheck` PASS
- `npm run build` PASS
