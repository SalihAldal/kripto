# KRIPTO Strategy Core Rebuild — Alpha Engine V2 Report

## 1. Starting HEAD
`fbf5c721f17cb903517fccc626b7ac7eb07984f4`

## 2. Research preservation
All prior forensic scripts, reports, JSON results preserved. Experimental scanner/strategy code remains isolated (not production-wired).

## 3. Failed old architecture
Scanner-centric global score → top-1 → AI BUY path showed NO_RELIABLE_EDGE across all prior phases.

## 4. New architecture
```text
DATA → FEATURE LAYER → ALPHA ENGINE V2 → VALIDATION → PORTFOLIO → AI OVERLAY → RISK → EXECUTION → PAPER
```

## 5–8. Contracts
Implemented in `src/server/alpha-engine-v2/`: AlphaSignal, AlphaModule, cost model v2, feature registry, lookahead guard.

## 9. Experiment scoreboard
| Alpha | Status | VAL Exp | VAL PF | TEST Exp | TEST PF |
|-------|--------|--------:|-------:|---------:|--------:|
| RESIDUAL_MOMENTUM | VALIDATION_FAIL | -9.1309 | 0.3274 | -1.9726 | 0.7156 |
| RESIDUAL_MOMENTUM_SHORT | FINAL_FAIL | 8.2742 | 2.5442 | -3.7898 | 0.5228 |
| CROSS_SECTIONAL_RESIDUAL_STRENGTH | VALIDATION_FAIL | -10.9235 | 0.304 | -4.3239 | 0.4877 |
| VOLUME_PERSISTENCE_RESIDUAL | VALIDATION_FAIL | -10.4809 | 0.159 | -6.9088 | 0.351 |
| FUNDING_BASIS_DISLOCATION | VALIDATION_FAIL | n/a | n/a | 9.2166 | 999 |
| CVD_REGIME_CONDITIONAL | VALIDATION_FAIL | -10.6903 | 0.3883 | 3.6281 | 76.5814 |
| LOW_TURNOVER_SWING | VALIDATION_FAIL | -19.0423 | 0.1634 | -6.9462 | 0.5055 |
| CASH_FILTER_REGIME | VALIDATION_FAIL | n/a | n/a | n/a | n/a |

## 10–13. Alpha experiments
See `artifacts/alpha-research/alpha-scoreboard.json`

## 14. Paper-readiness
{
  "passed": false,
  "smokePassed": false,
  "checklist": {
    "alphaEngineV2": true,
    "featureLayer": true,
    "lookaheadGuard": true,
    "costModel": true,
    "validationFramework": true,
    "portfolioLayer": true,
    "aiOverlay": true,
    "bestAlphaValidationPass": false,
    "bestAlphaFinalPass": false,
    "bestAlphaRobustnessPass": false,
    "realisticCostExpectancyPositive": false,
    "realisticCostPfAboveOne": false,
    "netPnlPositive": false,
    "smokePassed": false,
    "accountingPass": true,
    "liveFalse": true
  }
}

## 15. 10h campaign
NOT STARTED — NO_ALPHA_CAN_PASS_OUT_OF_SAMPLE

## 16–20. Verdicts
{
  "ENGINEERING_VERDICT": "PASS",
  "ALPHA_DISCOVERY_VERDICT": "FAIL",
  "HISTORICAL_EDGE_VERDICT": "FAIL",
  "PAPER_FORWARD_VERDICT": "NOT_STARTED",
  "ACCOUNTING_VERDICT": "PASS",
  "AI_OVERLAY_VERDICT": "ENGINEERING_ONLY",
  "LIVE_READINESS_VERDICT": "DISABLED"
}

## 21. Final verdict
```text
ALPHA_ENGINE_V2_ENGINEERING=PASS
ALPHA_DISCOVERY=FAIL
10H_PAPER_NOT_STARTED=true (no alpha passed validation+final+robustness)
DO_NOT_CONTINUE_BLIND_TUNING=true
LIVE_TRADING_ENABLED=false
```

---
*Generated 2026-09-08T00:16:11.507Z*
