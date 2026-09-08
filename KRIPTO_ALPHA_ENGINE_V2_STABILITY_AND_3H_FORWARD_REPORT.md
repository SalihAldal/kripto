# KRIPTO Alpha Engine V2 Stability & 3H Forward Report

## 1. Starting HEAD
`73d776e157a3f90e7bb8cfbb3a06376de7b7daa5`

## 2. Residual Momentum Short Forensic
Primary root cause: **REGIME_SHIFT**
Implementation bug: **false**

## 3. Root Cause
[
  "IMPLEMENTATION_PARITY_OK",
  "REGIME_SHIFT",
  "DATA_SHIFT",
  "SYMBOL_CONCENTRATION",
  "TIME_CONCENTRATION",
  "SIGNAL_SHIFT"
]

Validation vs Final BTC context: {"validationAvgBtcRet24":-2.3255035356398266,"testAvgBtcRet24":0.7152180425165513}

## 4. Fixes
No implementation parity bug found. REGIME_SHIFT dominant — validation period had different BTC/residual structure than final test.

## 5–8. Fresh Dataset Experiments
Dataset: ds-2026-04-15_2026-05-15

{
  "paperReady": false,
  "bestAlpha": null,
  "scoreboard": [
    {
      "alphaId": "RESIDUAL_MOMENTUM",
      "version": "v2.1.0",
      "datasetId": "ds-2026-04-15_2026-05-15",
      "configHash": "c1dec9a4589f82c9b6fe5420ea69bd6d108abdde2803e266a5dbd53768cf7ac1",
      "featureVersion": "v2.0.0",
      "costModelVersion": "v2.0.0",
      "validationTrades": 90,
      "validationExpectancy": 1.2293,
      "validationProfitFactor": 1.3012,
      "validationNetPnl": 110.64,
      "testTrades": 80,
      "testExpectancy": 4.0779,
      "testProfitFactor": 1.5528,
      "testNetPnl": 326.23,
      "maxDrawdown": 2.0325,
      "status": "ROBUSTNESS_FAIL",
      "edgeConfidence": "HIGH",
      "robustnessPassed": false
    },
    {
      "alphaId": "RESIDUAL_MOMENTUM_SHORT",
      "version": "v2.1.0",
      "datasetId": "ds-2026-04-15_2026-05-15",
      "configHash": "c1dec9a4589f82c9b6fe5420ea69bd6d108abdde2803e266a5dbd53768cf7ac1",
      "featureVersion": "v2.0.0",
      "costModelVersion": "v2.0.0",
      "validationTrades": 135,
      "validationExpectancy": -3.2718,
      "validationProfitFactor": 0.4286,
      "validationNetPnl": -441.7,
      "testTrades": 120,
      "testExpectancy": -1.8283,
      "testProfitFactor": 0.6882,
      "testNetPnl": -219.39,
      "maxDrawdown": 5.1745,
      "status": "VALIDATION_FAIL",
      "edgeConfidence": "HIGH",
      "robustnessPassed": false
    },
    {
      "alphaId": "BTC_REGIME_RESIDUAL_SHORT",
      "version": "v2.1.0",
      "datasetId": "ds-2026-04-15_2026-05-15",
      "configHash": "c1dec9a4589f82c9b6fe5420ea69bd6d108abdde2803e266a5dbd53768cf7ac1",
      "featureVersion": "v2.0.0",
      "costModelVersion": "v2.0.0",
      "validationTrades": 135,
      "validationExpectancy": -3.2718,
      "validationProfitFactor": 0.4286,
      "validationNetPnl": -441.7,
      "testTrades": 120,
      "testExpectancy": -1.8283,
      "testProfitFactor": 0.6882,
      "testNetPnl": -219.39,
      "maxDrawdown": 5.1745,
      "status": "VALIDATION_FAIL",
      "edgeConfidence": "HIGH",
      "robustnessPassed": false
    },
    {
      "alphaId": "RESIDUAL_STRENGTH_LONG",
      "version": "v2.1.0",
      "datasetId": "ds-2026-04-15_2026-05-15",
      "configHash": "c1dec9a4589f82c9b6fe5420ea69bd6d108abdde2803e266a5dbd53768cf7ac1",
      "featureVersion": "v2.0.0",
      "costModelVersion": "v2.0.0",
      "validationTrades": 34,
      "validationExpectancy": 2.1966,
      "validationProfitFactor": 1.5038,
      "validationNetPnl": 74.69,
      "testTrades": 38,
      "testExpectancy": 6.7037,
      "testProfitFactor": 1.8478,
      "testNetPnl": 254.74,
      "maxDrawdown": 1.2801,
      "status": "ROBUSTNESS_FAIL",
      "edgeConfidence": "HIGH",
      "robustnessPassed": false
    },
    {
      "alphaId": "CROSS_SECTIONAL_RESIDUAL_STRENGTH",
      "version": "v2.1.0",
      "datasetId": "ds-2026-04-15_2026-05-15",
      "configHash": "c1dec9a4589f82c9b6fe5420ea69bd6d108abdde2803e266a5dbd53768cf7ac1",
      "featureVersion": "v2.0.0",
      "costModelVersion": "v2.0.0",
      "validationTrades": 71,
      "validationExpectancy": -0.6472,
      "validationProfitFactor": 0.8869,
      "validationNetPnl": -45.95,
      "testTrades": 90,
      "testExpectancy": 3.3115,
      "testProfitFactor": 1.4251,
      "testNetPnl": 298.03,
      "maxDrawdown": 3.5226,
      "status": "VALIDATION_FAIL",
      "edgeConfidence": "HIGH",
      "robustnessPassed": false
    },
    {
      "alphaId": "VOLUME_PERSISTENCE_RESIDUAL",
      "version": "v2.1.0",
      "datasetId": "ds-2026-04-15_2026-05-15",
      "configHash": "c1dec9a4589f82c9b6fe5420ea69bd6d108abdde2803e266a5dbd53768cf7ac1",
      "featureVersion": "v2.0.0",
      "costModelVersion": "v2.0.0",
      "validationTrades": 31,
      "validationExpectancy": -3.8565,
      "validationProfitFactor": 0.5792,
      "validationNetPnl": -119.55,
      "testTrades": 46,
      "testExpectancy": 11.2649,
      "testProfitFactor": 2.9714,
      "testNetPnl": 518.19,
      "maxDrawdown": 1.6008,
      "status": "VALIDATION_FAIL",
      "edgeConfidence": "HIGH",
      "robustnessPassed": false
    },
    {
      "alphaId": "FUNDING_BASIS_DISLOCATION",
      "version": "v2.1.0",
      "datasetId": "ds-2026-04-15_2026-05-15",
      "configHash": "c1dec9a4589f82c9b6fe5420ea69bd6d108abdde2803e266a5dbd53768cf7ac1",
      "featureVersion": "v2.0.0",
      "costModelVersion": "v2.0.0",
      "validationTrades": 0,
      "validationExpectancy": null,
      "validationProfitFactor": null,
      "validationNetPnl": null,
      "testTrades": 0,
      "testExpectancy": null,
      "testProfitFactor": null,
      "testNetPnl": null,
      "maxDrawdown": 0,
      "status": "VALIDATION_FAIL",
      "edgeConfidence": "NONE",
      "robustnessPassed": false
    },
    {
      "alphaId": "FUNDING_RESIDUAL_DIVERGENCE",
      "version": "v2.1.0",
      "datasetId": "ds-2026-04-15_2026-05-15",
      "configHash": "c1dec9a4589f82c9b6fe5420ea69bd6d108abdde2803e266a5dbd53768cf7ac1",
      "featureVersion": "v2.0.0",
      "costModelVersion": "v2.0.0",
      "validationTrades": 0,
      "validationExpectancy": null,
      "validationProfitFactor": null,
      "validationNetPnl": null,
      "testTrades": 0,
      "testExpectancy": null,
      "testProfitFactor": null,
      "testNetPnl": null,
      "maxDrawdown": 0,
      "status": "VALIDATION_FAIL",
      "edgeConfidence": "NONE",
      "robustnessPassed": false
    },
    {
      "alphaId": "RESIDUAL_MEAN_REVERSION",
      "version": "v2.1.0",
      "datasetId": "ds-2026-04-15_2026-05-15",
      "configHash": "c1dec9a4589f82c9b6fe5420ea69bd6d108abdde2803e266a5dbd53768cf7ac1",
      "featureVersion": "v2.0.0",
      "costModelVersion": "v2.0.0",
      "validationTrades": 15,
      "validationExpectancy": 2.3663,
      "validationProfitFactor": 1.5603,
      "validationNetPnl": 35.49,
      "testTrades": 31,
      "testExpectancy": -7.5496,
      "testProfitFactor": 0.4049,
      "testNetPnl": -234.04,
      "maxDrawdown": 2.783,
      "status": "FINAL_FAIL",
      "edgeConfidence": "HIGH",
      "robustnessPassed": false
    },
    {
      "alphaId": "CVD_REGIME_CONDITIONAL",
      "version": "v2.1.0",
      "datasetId": "ds-2026-04-15_2026-05-15",
      "configHash": "c1dec9a4589f82c9b6fe5420ea69bd6d108abdde2803e266a5dbd53768cf7ac1",
      "featureVersion": "v2.0.0",
      "costModelVersion": "v2.0.0",
      "validationTrades": 6,
      "validationExpectancy": -5.4328,
      "validationProfitFactor": 0.1374,
      "validationNetPnl": -32.6,
      "testTrades": 2,
      "testExpectancy": -2.1495,
      "testProfitFactor": 0,
      "testNetPnl": -4.3,
      "maxDrawdown": 0.043,
      "status": "VALIDATION_FAIL",
      "edgeConfidence": "NONE",
      "robustnessPassed": false
    },
    {
      "alphaId": "LOW_TURNOVER_SWING",
      "version": "v2.1.0",
      "datasetId": "ds-2026-04-15_2026-05-15",
      "configHash": "c1dec9a4589f82c9b6fe5420ea69bd6d108abdde2803e266a5dbd53768cf7ac1",
      "featureVersion": "v2.0.0",
      "costModelVersion": "v2.0.0",
      "validationTrades": 62,
      "validationExpectancy": 5.1407,
      "validationProfitFactor": 1.983,
      "validationNetPnl": 318.72,
      "testTrades": 55,
      "testExpectancy": 16.903,
      "testProfitFactor": 2.5428,
      "testNetPnl": 929.66,
      "maxDrawdown": 4.0684,
      "status": "ROBUSTNESS_FAIL",
      "edgeConfidence": "HIGH",
      "robustnessPassed": false
    },
    {
      "alphaId": "LOW_TURNOVER_RESIDUAL_SWING",
      "version": "v2.1.0",
      "datasetId": "ds-2026-04-15_2026-05-15",
      "configHash": "c1dec9a4589f82c9b6fe5420ea69bd6d108abdde2803e266a5dbd53768cf7ac1",
      "featureVersion": "v2.0.0",
      "costModelVersion": "v2.0.0",
      "validationTrades": 78,
      "validationExpectancy": -3.0857,
      "validationProfitFactor": 0.6056,
      "validationNetPnl": -240.68,
      "testTrades": 78,
      "testExpectancy": 2.4513,
      "testProfitFactor": 1.2269,
      "testNetPnl": 191.2,
      "maxDrawdown": 4.9741,
      "status": "VALIDATION_FAIL",
      "edgeConfidence": "HIGH",
      "robustnessPassed": false
    },
    {
      "alphaId": "CASH_FILTER_REGIME",
      "version": "v2.1.0",
      "datasetId": "ds-2026-04-15_2026-05-15",
      "configHash": "c1dec9a4589f82c9b6fe5420ea69bd6d108abdde2803e266a5dbd53768cf7ac1",
      "featureVersion": "v2.0.0",
      "costModelVersion": "v2.0.0",
      "validationTrades": 0,
      "validationExpectancy": null,
      "validationProfitFactor": null,
      "validationNetPnl": null,
      "testTrades": 0,
      "testExpectancy": null,
      "testProfitFactor": null,
      "testNetPnl": null,
      "maxDrawdown": 0,
      "status": "VALIDATION_FAIL",
      "edgeConfidence": "NONE",
      "robustnessPassed": false
    }
  ]
}

Regime-conditioned (TRAIN-derived filter): {
  "allowedRegimes": [
    "UPTREND"
  ],
  "valStats": {
    "trades": 54,
    "wins": 21,
    "losses": 33,
    "grossPnl": 18.35,
    "netPnl": -99.46,
    "expectancy": -1.8418,
    "profitFactor": 0.5798,
    "maxDrawdown": 1.4536,
    "longTrades": 0,
    "shortTrades": 54,
    "cashSkips": 0
  },
  "testStats": {
    "trades": 3,
    "wins": 3,
    "losses": 0,
    "grossPnl": 44.2,
    "netPnl": 37.67,
    "expectancy": 12.5572,
    "profitFactor": 999,
    "maxDrawdown": 0,
    "longTrades": 0,
    "shortTrades": 3,
    "cashSkips": 0
  },
  "validationPass": false,
  "finalPass": false
}

## 9–12. Paper
Smoke: {"started":false,"passed":false,"reason":"NO_PAPER_READY_ALPHA"}
3H: {"started":false,"completed":false,"campaignId":"","runtimeMinutes":0,"reason":"NO_ALPHA_CAN_PASS_OUT_OF_SAMPLE"}

## Final Verdict
{
  "ENGINEERING_VERDICT": "PASS",
  "ALPHA_DISCOVERY_VERDICT": "FAIL",
  "HISTORICAL_EDGE_VERDICT": "FAIL",
  "PAPER_FORWARD_VERDICT": "NOT_STARTED",
  "PROFITABILITY_VERDICT": "NOT_STARTED"
}

---
*Generated 2026-09-08T06:15:28.273Z*
