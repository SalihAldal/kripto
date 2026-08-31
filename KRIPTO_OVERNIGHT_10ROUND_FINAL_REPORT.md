# KRIPTO — Overnight 10 Tur FULL Forensic Rapor

> Oluşturulma: 23.08.2026 14:44:33
> Kapsam: Campaign A — job `cmt4zxkbm001gun8ghz4qsb0w` — terminal tur 1–10 (yeni kampanya başlatılmayacak)

---

## 0. Executive Summary

10 tur terminalize edildi. **0 trade**, **0 net PnL**. Dominant blok **AI_VETO (8/10)**. Scanner katmanı **SIM_TIGHT_FILTER (2/10)**. Job 30 tur planlıydı; Round 11 selection budget timeout sonrası **FAILED**. Policy değişikliği yapılmadı.

| Alan | Değer |
| --- | --- |
| jobId | cmt4zxkbm001gun8ghz4qsb0w |
| status | FAILED |
| startedAt | 2026-08-22T23:15:15.083Z |
| finishedAt | 2026-08-23T01:22:17.709Z |
| planlanan tur | 30 |
| rapor tur | 10 |
| failed tur | 10 |
| zombie | 1 |
| lastError | scanner-ai pool aborted: Tur secim suresi doldu (1200s) |
| aggregate candidates | 500 |
| aggregate AI calls | 753 |
| aggregate TDI reject (artifact) | 466 |
| aggregate TDI wait (artifact) | 34 |
| profitability | NOT_PROVEN |

## 1. Kampanya Konfigürasyonu

| Parametre | Değer |
| --- | --- |
| executionMode | paper |
| exchange | tr |
| aiPolicy | VETO |
| variantDEnabled | true |
| variantDShadow | false |
| gitFingerprint | 4b8d5cc3890c1d454d483aabe2f70f0f12f824de |
| configFingerprint | fe35def2890af674 |
| attachMode | EXISTING_RUNNING_JOB |
| selectionBudgetSec | 1200 |
| maxWaitSec | 1800 |

## 2. Bloklayıcı Dağılımı

- AI_VETO: 8
- SIM_TIGHT_FILTER: 2

## 3. Tur Zaman Çizelgesi (DB)

| Tur | Sembol | Başlangıç | Bitiş | Süre | Attempt | Son aşama | Blok | failReason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | CITYTRY | 23:15:16 | 23:33:31 | 18dk | 3 | EXECUTING | AI_VETO | AI_GATE_BLOCK: AI_VETO |
| 2 | INJTRY | 23:33:33 | 23:48:12 | 15dk | 3 | SYMBOL_SELECTED | SIM_TIGHT_FILTER | SIM_TIGHT_FILTER_30m: non-pump kalite dusuk (composite=43.8, sentiment=31.7, mtf=73.5) \| AI role con |
| 3 | PEOPLETRY | 23:48:13 | 23:52:43 | 5dk | 1 | EXECUTING | AI_VETO | AI_GATE_BLOCK: AI_VETO |
| 4 | TRBTRY | 23:52:43 | 23:56:32 | 4dk | 1 | EXECUTING | AI_VETO | AI_GATE_BLOCK: AI_VETO |
| 5 | RENDERTRY | 23:56:32 | 00:07:11 | 11dk | 2 | EXECUTING | AI_VETO | AI_GATE_BLOCK: AI_VETO |
| 6 | LUNCTRY | 00:07:18 | 00:24:04 | 17dk | 3 | SYMBOL_SELECTED | SIM_TIGHT_FILTER | SIM_TIGHT_FILTER_30m: non-pump kalite dusuk (composite=54.5, sentiment=71.7, mtf=45.5) \| AI role con |
| 7 | PORTALTRY | 00:24:04 | 00:29:16 | 5dk | 1 | EXECUTING | AI_VETO | AI_GATE_BLOCK: AI_VETO |
| 8 | CHZTRY | 00:29:17 | 00:42:06 | 13dk | 1 | EXECUTING | AI_VETO | AI_GATE_BLOCK: AI_VETO |
| 9 | MEGATRY | 00:42:07 | 00:51:07 | 9dk | 1 | EXECUTING | AI_VETO | AI_GATE_BLOCK: AI_VETO |
| 10 | SUPERTRY | 00:51:08 | 01:02:12 | 11dk | 1 | EXECUTING | AI_VETO | AI_GATE_BLOCK: AI_VETO |

---

## 4. Tur Bazlı FULL Detay

## Tur #1 — CITYTRY

### Kimlik & DB

| Alan | Değer |
| --- | --- |
| runId | cmt4zxl9f001tun8gz2x8h86o |
| jobId | cmt4zxkbm001gun8ghz4qsb0w |
| roundNo | 1 |
| state | tur_basarisiz |
| symbol | CITYTRY |
| startedAt | 2026-08-22T23:15:16.324Z |
| endedAt | 2026-08-22T23:33:31.541Z |
| duration | 18.3 dk |
| selectionAttempt | 3 |
| runtime.step | EXECUTING |
| failReason (DB) | AI_GATE_BLOCK: AI_VETO |
| failReason (artifact) | AI_GATE_BLOCK: AI_VETO |
| exportKind | failed-round-partial |
| exportStatus | COMPLETED |

### round-summary — Özet Metrikler

| Metrik | Değer |
| --- | --- |
| candidateCount | 205 |
| failureCount | 1054 |
| tradeCount | 0 |
| fills | 0 |
| grossPnL | 0 |
| fees | 0 |
| netPnl | 0 |
| currentStage | EXECUTING |
| elapsedMs | 830203 |
| selectionBudgetMs | 1200000 |
| lastProgressAt | 2026-08-22T23:29:08.153Z |
| heartbeatAt | 2026-08-22T23:29:08.433Z |

### funnelState — Tam Rejection Haritası

**By stage:**
- decision: 431
- ai: 157
- consensus: 157
- scanner: 136
- ev: 135
- candidate: 36
- execution: 2

**By reason (tam liste):**
- TDI_REJECTED: 292
- AI_DEGRADED: 157
- CONSENSUS_REJECT: 157
- EV_REJECT: 135
- REJECTED: 131
- SCANNER_REJECT: 131
- PUMP_NOT_EARLY_OR_CONTINUATION: 17
- PUMP_CONFIRM_NO_TRADE: 17
- Data quality issue (CHANGE24H_FALLBACK): 4
- Data quality issue (PRICE_STALE): 4
- SIM_TIGHT_FILTER: 2
- CANDIDATE_REJECTED: 2
- Spread too wide: 2
- AI_VETO: 2
- AI_GATE_BLOCK: AI_VETO: 1

**TDI runtime counters:**

| Counter | Değer |
| --- | --- |
| tdiDecisions | 315 |
| runtimeTdiApproved | 0 |
| runtimeTdiWait | 23 |
| runtimeTdiRejected | 292 |
| upstreamCandidateRejected | 131 |
| hybridRejected | 292 |
| consensusRejected | 157 |
| masterRejected | 0 |
| scannerQualificationRejections | 0 |

### opportunity-funnel — Aşama Kayıpları

| Stage | entered | lost | lostReason | count | % | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| DISCOVERED | 205 | 1054 | FILTERED_OUT | 205 | 100 | COMPLETE |
| STRATEGY_QUALIFIED | 69 | 0 | FILTERED_OUT | 0 | 0 | PARTIAL |
| TDI | 0 | 0 | TDI_WAIT | 0 | 0 | COMPLETE |
| AI | 0 | 317 | AI_REJECTED | 317 | 30.08 | COMPLETE |
| RISK | 0 | 0 | RISK | 0 | 0 | PARTIAL |
| EXECUTION | 0 | 0 | EXECUTION_FAILED | 0 | 0 | PARTIAL |

**lossByReason:**

| Reason | count | % |
| --- | --- | --- |
| FILTERED_OUT | 558 | 52.94 |
| AI_REJECTED | 317 | 30.08 |
| UNKNOWN | 179 | 16.98 |

### selectionTimeBudgetBreakdown — Zaman Bütçesi

| Alan | Değer |
| --- | --- |
| selectionBudgetMs | 1200000 |
| totalElapsedMs | 1096650 |
| measuredTotalMs | 1102024 |
| PRIMARY_TIME_CONSUMER | execution_preparation |

**TOP_5_TIME_CONSUMERS:**

| stage | totalMs | share% |
| --- | --- | --- |
| execution_preparation | 1045360 | 87.1% |
| ai_execution | 47771 | 4.0% |
| persistence | 5374 | 0.4% |
| candidate_generation | 3519 | 0.3% |
| scanner_startup | 0 | 0.0% |

**Tüm stage satırları:**

| stage | count | totalMs | p50 | p95 | max | budgetShare% |
| --- | --- | --- | --- | --- | --- | --- |
| candidate_generation | 30 | 3519 | 79 | 172 | 706 | 0.2933 |
| ai_execution | 81 | 47771 | 319 | 1997 | 2514 | 3.9809 |
| execution_preparation | 1 | 1045360 | 1045360 | 1045360 | 1045360 | 87.1133 |
| persistence | 99 | 5374 | 61 | 118 | 179 | 0.4478 |

### scanner-summary — Aggregate

| Metrik | Değer |
| --- | --- |
| scanner cycles | 1 |
| universe (sum) | 205 |
| eligible (sum) | 69 |
| qualified (sum) | 69 |
| rejected (sum) | 136 |
| errors (sum) | 0 |

**Scanner rejection reasons (aggregate):**
- REJECTED: 131
- Data quality issue (CHANGE24H_FALLBACK): 2
- Data quality issue (PRICE_STALE): 2
- Spread too wide: 1

### errors.json — Failure Özeti

| Alan | Değer |
| --- | --- |
| total failures | 157 |
| artifact failReason | AI_GATE_BLOCK: AI_VETO |

**By stage:**
- ai: 157

**By reasonCode (top 20):**
- AI_DEGRADED: 157

### ai-progress — AI Pool

| Metrik | Değer |
| --- | --- |
| processed | 27 |
| total | 27 |
| successCount | 26 |
| failedCount | 1 |
| timeoutCount | 0 |
| concurrency | 2 |
| duration p50 | 2936 ms |
| duration p95 | 4247 ms |
| duration max | 4276 ms |
| currentCandidate | DOGETRY |
| currentStage | ai |

**Status dağılımı:**
- COMPLETED: 26
- CANCELLED: 1

**Tüm AI candidate satırları:**

| symbol | status | durationMs | retry | provider | completedAt |
| --- | --- | --- | --- | --- | --- |
| CITYTRY | COMPLETED | 4247 | 0 | provider-1 | 23:28:24 |
| IMXTRY | COMPLETED | 1084 | 0 | provider-1 | 23:28:21 |
| COWTRY | COMPLETED | 2936 | 0 | provider-1 | 23:28:24 |
| PORTALTRY | COMPLETED | 3216 | 0 | provider-1 | 23:28:28 |
| ZROTRY | COMPLETED | 2687 | 0 | provider-1 | 23:28:27 |
| LUNCTRY | COMPLETED | 3593 | 0 | provider-1 | 23:28:31 |
| LUNATRY | COMPLETED | 3964 | 0 | provider-1 | 23:28:32 |
| MANTRATRY | COMPLETED | 2712 | 0 | provider-1 | 23:28:34 |
| DOLOTRY | COMPLETED | 2743 | 0 | provider-1 | 23:28:35 |
| STXTRY | COMPLETED | 3347 | 0 | provider-1 | 23:28:38 |
| TRUMPTRY | COMPLETED | 3141 | 0 | provider-1 | 23:28:39 |
| MEGATRY | COMPLETED | 2637 | 0 | provider-1 | 23:28:41 |
| MANTATRY | COMPLETED | 2462 | 0 | provider-1 | 23:28:41 |
| MANATRY | COMPLETED | 2828 | 0 | provider-1 | 23:28:44 |
| LPTTRY | COMPLETED | 3850 | 0 | provider-1 | 23:28:46 |
| LISTATRY | COMPLETED | 2933 | 0 | provider-1 | 23:28:47 |
| MEMETRY | COMPLETED | 2839 | 0 | provider-1 | 23:28:49 |
| LUMIATRY | COMPLETED | 3153 | 0 | provider-1 | 23:28:50 |
| MAGICTRY | COMPLETED | 2833 | 0 | provider-1 | 23:28:52 |
| MAVTRY | CANCELLED | 1535 | 0 | provider-1 | 23:28:52 |
| CETUSTRY | COMPLETED | 4276 | 0 | provider-1 | 23:28:56 |
| METISTRY | COMPLETED | 2777 | 0 | provider-1 | 23:28:55 |
| ENATRY | COMPLETED | 3970 | 0 | provider-1 | 23:29:00 |
| PUMPTRY | COMPLETED | 3876 | 0 | provider-1 | 23:29:01 |
| LTCTRY | COMPLETED | 3337 | 0 | provider-1 | 23:29:04 |
| JOETRY | COMPLETED | 1021 | 0 | provider-1 | 23:29:03 |
| DOGETRY | COMPLETED | 3681 | 0 | provider-1 | 23:29:07 |

### Seçilen Sembol Pipeline — CITYTRY

Decision trace kayıtları: **8** | Consensus: **1** | EV: **1** | Lifecycle: **0** | TDI: **3**

**decision-trace (seçilen sembol):**

| timestamp | stage | verdict | reasonCode | reasonDetail | score |
| --- | --- | --- | --- | --- | --- |
| 23:26:05 | decision | REJECT | SCANNER_REJECT | REJECTED | 55.27 |
| 23:28:20 | decision | REJECT | SCANNER_REJECT | REJECTED | 64.77 |
| 23:28:24 | decision | WAIT | NEUTRAL | Teknik setup zayif \| Momentum guven vermiyor \| Haber/sentiment karmasik \| Teknik |  |
| 23:28:24 | decision | REJECT | TDI_REJECTED | NO_TRADE resolved by master decision engine. Overall confidence 20. Supported by |  |
| 23:33:30 | execution | REJECT | AI_VETO | {"aiVerdict":"NO_TRADE","aiFinalDecision":"NO_TRADE","consensusDecision":"NO_TRA |  |
| 23:33:30 | execution | REJECT | AI_VETO | {"aiVerdict":"NO_TRADE","executionVerdict":"AI_GATE_BLOCK","riskVerdict":"NOT_RE |  |
| 23:33:30 | decision | WAIT | BELOW_THRESHOLD | AI finalDecision=NO_TRADE blocked by VETO gate policy |  |
| 23:33:30 | decision | REJECT | AI_GATE_BLOCK: AI_VETO | AI_GATE_BLOCK: AI_VETO | [object Object] |

**consensus-trace (seçilen sembol, son 10):**

| timestamp | finalDecision | masterRule | reason | votes |
| --- | --- | --- | --- | --- |
| 23:28:24 | HOLD | WATCHLIST | regime=RANGE_SIDEWAYS, tech=47.99, sentiment=51.50, risk=67. | {"provider-1":"NO_TRADE","provider-2":"N |

**ev-trace (seçilen sembol, son 10):**

| timestamp | verdict | EV | threshold | winProb | RR | reason |
| --- | --- | --- | --- | --- | --- | --- |
| 23:28:24 | WAIT | 54.2729 | 36 | 40.65 | 1.3333 | EV_WAIT |

**tdi-decisions (seçilen sembol, son 15):**

| timestamp | verdict | hybrid | score | detail |
| --- | --- | --- | --- | --- |
| 23:28:24 | WAIT | HOLD |  | Teknik setup zayif \| Momentum guven vermiyor \| Haber/sentiment karmasi |
| 23:28:24 | REJECTED | HOLD |  | NO_TRADE resolved by master decision engine. Overall confidence 20. Su |
| 23:33:30 | WAIT | NO_TRADE |  | AI finalDecision=NO_TRADE blocked by VETO gate policy |

### tdi-sensitivity

| Alan | Değer |
| --- | --- |
| currentThreshold | 55 |
| scoreAboveThresholdRate | 0.3302 |
| runtimeApprovalEquivalentRate | 0 |
| runtimeWaitCount | 22 |
| runtimeRejectedCount | 293 |
| recommendation | NO_CHANGE |
| productionReplayStatus | PARTIAL |

**Score distribution:** min=33.9745 p50=51.53863857620175 p90=63.3332 max=71.3174

### ev-component-attribution

| component | weight | observed | quality |
| --- | --- | --- | --- |
| expectedProfit | 0.35 | 0.8079 | HIGH |
| expectedLoss | 0.25 | -0.5967 | HIGH |
| fees | 0.15 | 0 | HIGH |
| winProbability | 0.15 | 27.2682 | HIGH |
| expectedRiskReward | 0.1 | 1.4094 | HIGH |

Dominant component: **winProbability** (sample=157)

### round-liveness (tur sonu snapshot)

| Alan | Değer |
| --- | --- |
| state | "UNKNOWN" |
| currentStage | "EXECUTING" |
| lastMeaningfulProgressAt | "2026-08-22T23:29:08.153Z" |
| meaningfulProgressAgeMs | 265006 |
| lastHeartbeatAt | "2026-08-22T23:29:08.433Z" |
| heartbeatAgeMs | 264726 |
| activeWork | {"scanner":27,"ai":27,"marketData":0} |
| activeRetries | 1 |
| activeCandidates | 0 |
| poolActive | 0 |
| poolQueued | 0 |
| remainingBudgetMs | 369797 |
| abortRequested | false |
| abortReason | null |
| stallDetectedAt | null |
| terminalizationStartedAt | null |
| terminalState | "EXECUTING" |
| terminalizationDurationMs | null |

### round-watchdog

| Alan | Değer |
| --- | --- |
| roundId | "1" |
| runId | "cmt4zxl9f001tun8gz2x8h86o" |
| jobId | "cmt4zxkbm001gun8ghz4qsb0w" |
| lastProgressAt | "2026-08-22T23:29:08.153Z" |
| lastHeartbeatAt | "2026-08-22T23:29:08.433Z" |
| currentStage | "EXECUTING" |
| elapsedSinceProgressMs | 265004 |
| elapsedSinceHeartbeatMs | 264724 |
| decision | "NONE" |
| action | "Legitimate long-running stage" |
| reasonDetail | "Monitoring active position" |
| recordedAt | "2026-08-22T23:33:33.157Z" |

### resolved-config (runtime)

```json
{
  "generatedAt": "2026-08-22T23:33:33.071Z",
  "exchange": "binance",
  "universe": {
    "scannerUniverse": "ALL_SPOT",
    "maxSymbols": 1200,
    "maxCycleSec": 180
  },
  "aiMode": {
    "executionMode": "paper",
    "minConfidence": 60,
    "strictAnalystMode": false,
    "remoteRequired": false
  },
  "strategyConfig": {},
  "evConfig": {
    "minRiskRewardRatio": 1.25,
    "minTradeQualityScore": 45
  },
  "risk": {
    "maxDailyLossPercent": 5,
    "maxOpenPositions": 3
  },
  "sizing": {},
  "fees": {
    "binanceTakerFeeRate": 0.0015,
    "binanceMakerFeeRate": 0.0009
  },
  "simulationWindow": {
    "autoRoundSelectionBudgetSec": 1200
  },
  "maxPositions": 3,
  "timeframes": [
    "1m",
    "5m",
    "15m",
    "1h",
    "4h"
  ]
}
```

### Promotion / Research Gates

| Gate | promoted | status/detail |
| --- | --- | --- |
| promotion-gate | false | RESEARCH_ONLY |
| p1-promotion-gate | false | RESEARCH_ONLY |
| strategy-comparison | false | 07503ff4691831f0 |

### Artifact Envanteri (bu tur)

| dosya | KB |
| --- | --- |
| tdi-decisions.json | 1510 |
| tdi-data-quality.json | 1068 |
| tdi-input-contract.json | 1064 |
| missed-opportunities.json | 339 |
| opportunity-value.json | 281 |
| decision-trace.json | 157 |
| consensus-trace.json | 138 |
| ai-trace.json | 122 |
| scanner-summary.json | 75 |
| ev-trace.json | 67 |
| errors.json | 38 |
| transaction-duration.json | 24 |
| candidate-lifecycle.json | 16 |
| pump-scan-lifecycle.json | 16 |
| ai-progress.json | 13 |
| stage-timings.json | 7 |
| round-summary.json | 5 |
| profitability-experiments.json | 4 |
| selectionTimeBudgetBreakdown.json | 4 |
| ev-component-attribution.json | 2 |
| opportunity-funnel.json | 2 |
| p1-promotion-gate.json | 2 |
| promotion-gate.json | 2 |
| single-change-experiments.json | 2 |
| slot-allocation-analysis.json | 2 |
| slot-opportunity-report.json | 2 |
| tdi-sensitivity.json | 2 |
| candidate-quality-factors.json | 1 |
| entry-timing-experiment.json | 1 |
| exit-forensics.json | 1 |
| fee-aware-entry-experiment.json | 1 |
| mr-regime-gating-experiment.json | 1 |
| profitability-experiments.csv | 1 |
| promotion-decisions.json | 1 |
| resolved-config.json | 1 |
| round-liveness.json | 1 |
| slot-allocation-experiment.json | 1 |
| strategy-comparison-report.json | 1 |
| volatility-breakout-validation.json | 1 |
| ai-strategy-interaction.json | 0 |
| baseline-metrics.json | 0 |
| entry-timing.json | 0 |
| ev-calibration.json | 0 |
| execution-trace.json | 0 |
| exit-fee-interaction.json | 0 |
| exit-trace.json | 0 |
| fee-aware-edge-research.json | 0 |
| fee-aware-entry-policy.json | 0 |
| fee-by-hold-time.json | 0 |
| fee-by-strategy.json | 0 |
| gross-positive-net-negative.json | 0 |
| loss-patterns.json | 0 |
| mean-reversion-audit.json | 0 |
| not-discovered-analysis.json | 0 |
| out-of-sample-evaluation.json | 0 |
| pnl-ledger.json | 0 |
| position-trace.json | 0 |
| profit-concentration.json | 0 |
| recovery-decisions.json | 0 |
| recovery-telemetry.json | 0 |
| replay-exit-diagnostics.json | 0 |
| replayExitDiagnostics.json | 0 |
| risk-sizing-trace.json | 0 |
| round-watchdog.json | 0 |
| scanner-qualification.json | 0 |
| strategy-performance.json | 0 |
| strategy-regime-matrix-p2.csv | 0 |
| strategy-regime-matrix-p2.json | 0 |
| strategy-regime-matrix.json | 0 |
| strategy-trace.json | 0 |
| tdi-missing-telemetry-report.json | 0 |
| trend-following-validation.json | 0 |
| winning-patterns.json | 0 |

---

## Tur #2 — INJTRY

### Kimlik & DB

| Alan | Değer |
| --- | --- |
| runId | cmt50l41x09iuun8gmkl9y7qi |
| jobId | cmt4zxkbm001gun8ghz4qsb0w |
| roundNo | 2 |
| state | tur_basarisiz |
| symbol | INJTRY |
| startedAt | 2026-08-22T23:33:33.766Z |
| endedAt | 2026-08-22T23:48:12.920Z |
| duration | 14.7 dk |
| selectionAttempt | 3 |
| runtime.step | SYMBOL_SELECTED |
| failReason (DB) | SIM_TIGHT_FILTER_30m: non-pump kalite dusuk (composite=43.8, sentiment=31.7, mtf=73.5) \| AI role consensus zayif (tech=37.8, sentiment=31.7, risk=62.0) \| momentum/flow zayif (-0.0850, -1.0000) \| regime chop warning \| regime lifecycle risk (CHOP) \| EMA trend uyumsuz (EMA50=235.9905, EMA200=236.3686) \| Kalite skoru dusuk (30/100 < 52) |
| failReason (artifact) | SIM_TIGHT_FILTER_30m: non-pump kalite dusuk (composite=43.8, sentiment=31.7, mtf=73.5) \| AI role consensus zayif (tech=37.8, sentiment=31.7, risk=62.0) \| momentum/flow zayif (-0.0850, -1.0000) \| regime chop warning \| regime lifecycle risk (CHOP) \| EMA trend uyumsuz (EMA50=235.9905, EMA200=236.3686) \| Kalite skoru dusuk (30/100 < 52) |
| exportKind | failed-round-partial |
| exportStatus | COMPLETED |

### round-summary — Özet Metrikler

| Metrik | Değer |
| --- | --- |
| candidateCount | 247 |
| failureCount | 758 |
| tradeCount | 0 |
| fills | 0 |
| grossPnL | 0 |
| fees | 0 |
| netPnl | 0 |
| currentStage | SYMBOL_SELECTED |
| elapsedMs | 876738 |
| selectionBudgetMs | 1200000 |
| lastProgressAt | 2026-08-22T23:48:12.322Z |
| heartbeatAt | 2026-08-22T23:48:12.322Z |

### funnelState — Tam Rejection Haritası

**By stage:**
- ai: 180
- consensus: 180
- scanner: 169
- ev: 153
- decision: 48
- candidate: 28

**By reason (tam liste):**
- AI_DEGRADED: 180
- CONSENSUS_REJECT: 180
- REJECTED: 167
- EV_REJECT: 153
- TDI_REJECTED: 38
- PUMP_NOT_EARLY_OR_CONTINUATION: 12
- PUMP_CONFIRM_NO_TRADE: 12
- SCANNER_REJECT: 7
- CANDIDATE_REJECTED: 4
- SIM_TIGHT_FILTER: 3
- Data quality issue (CHANGE24H_FALLBACK): 1
- Spread too wide: 1

**TDI runtime counters:**

| Counter | Değer |
| --- | --- |
| tdiDecisions | 185 |
| runtimeTdiApproved | 0 |
| runtimeTdiWait | 11 |
| runtimeTdiRejected | 174 |
| upstreamCandidateRejected | 7 |
| hybridRejected | 38 |
| consensusRejected | 180 |
| masterRejected | 0 |
| scannerQualificationRejections | 0 |

### opportunity-funnel — Aşama Kayıpları

| Stage | entered | lost | lostReason | count | % | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| DISCOVERED | 247 | 758 | FILTERED_OUT | 247 | 100 | COMPLETE |
| STRATEGY_QUALIFIED | 78 | 0 | FILTERED_OUT | 0 | 0 | PARTIAL |
| TDI | 0 | 0 | TDI_WAIT | 0 | 0 | COMPLETE |
| AI | 0 | 360 | AI_REJECTED | 360 | 47.49 | PARTIAL |
| RISK | 0 | 0 | RISK | 0 | 0 | PARTIAL |
| EXECUTION | 0 | 0 | EXECUTION_FAILED | 0 | 0 | PARTIAL |

**lossByReason:**

| Reason | count | % |
| --- | --- | --- |
| UNKNOWN | 179 | 23.61 |
| FILTERED_OUT | 219 | 28.89 |
| AI_REJECTED | 360 | 47.49 |

### selectionTimeBudgetBreakdown — Zaman Bütçesi

| Alan | Değer |
| --- | --- |
| selectionBudgetMs | 1200000 |
| totalElapsedMs | 879264 |
| measuredTotalMs | 886881 |
| PRIMARY_TIME_CONSUMER | execution_preparation |

**TOP_5_TIME_CONSUMERS:**

| stage | totalMs | share% |
| --- | --- | --- |
| execution_preparation | 766657 | 63.9% |
| ai_execution | 112607 | 9.4% |
| persistence | 7617 | 0.6% |
| scanner_startup | 0 | 0.0% |
| pump_discovery | 0 | 0.0% |

**Tüm stage satırları:**

| stage | count | totalMs | p50 | p95 | max | budgetShare% |
| --- | --- | --- | --- | --- | --- | --- |
| ai_execution | 119 | 112607 | 582 | 2654 | 4015 | 9.3839 |
| execution_preparation | 1 | 766657 | 766657 | 766657 | 766657 | 63.8881 |
| persistence | 99 | 7617 | 60 | 168 | 1450 | 0.6348 |

### scanner-summary — Aggregate

| Metrik | Değer |
| --- | --- |
| scanner cycles | 1 |
| universe (sum) | 452 |
| eligible (sum) | 147 |
| qualified (sum) | 147 |
| rejected (sum) | 305 |
| errors (sum) | 0 |

**Scanner rejection reasons (aggregate):**
- REJECTED: 298
- Data quality issue (CHANGE24H_FALLBACK): 3
- Spread too wide: 2
- Data quality issue (PRICE_STALE): 2

### errors.json — Failure Özeti

| Alan | Değer |
| --- | --- |
| total failures | 180 |
| artifact failReason | SIM_TIGHT_FILTER_30m: non-pump kalite dusuk (composite=43.8, sentiment=31.7, mtf=73.5) \| AI role consensus zayif (tech=37.8, sentiment=31.7, risk=62.0) \| momentum/flow zayif (-0.0850, -1.0000) \| regime chop warning \| regime lifecycle risk (CHOP) \| EMA trend uyumsuz (EMA50=235.9905, EMA200=236.3686) \| Kalite skoru dusuk (30/100 < 52) |

**By stage:**
- ai: 180

**By reasonCode (top 20):**
- AI_DEGRADED: 180

### ai-progress — AI Pool

| Metrik | Değer |
| --- | --- |
| processed | 85 |
| total | 85 |
| successCount | 66 |
| failedCount | 19 |
| timeoutCount | 0 |
| concurrency | 2 |
| duration p50 | 4679 ms |
| duration p95 | 9500 ms |
| duration max | 12497 ms |
| currentCandidate | TRUMPTRY |
| currentStage | ai |

**Status dağılımı:**
- COMPLETED: 66
- CANCELLED: 19

**Tüm AI candidate satırları:**

| symbol | status | durationMs | retry | provider | completedAt |
| --- | --- | --- | --- | --- | --- |
| MOVRTRY | COMPLETED | 6990 | 0 | provider-1 | 23:44:28 |
| POLTRY | COMPLETED | 6891 | 0 | provider-1 | 23:44:28 |
| MORPHOTRY | COMPLETED | 2776 | 0 | provider-1 | 23:44:31 |
| LTCTRY | COMPLETED | 1954 | 0 | provider-1 | 23:44:30 |
| LUNATRY | COMPLETED | 2853 | 0 | provider-1 | 23:44:33 |
| EULTRY | COMPLETED | 3500 | 0 | provider-1 | 23:44:35 |
| HMSTRTRY | COMPLETED | 2584 | 0 | provider-1 | 23:44:36 |
| GMTTRY | COMPLETED | 2624 | 0 | provider-1 | 23:44:38 |
| STXTRY | COMPLETED | 4970 | 0 | provider-1 | 23:44:42 |
| DYMTRY | COMPLETED | 3273 | 0 | provider-1 | 23:44:41 |
| KSMTRY | COMPLETED | 2725 | 0 | provider-1 | 23:44:44 |
| LDOTRY | COMPLETED | 2744 | 0 | provider-1 | 23:44:45 |
| TSTTRY | COMPLETED | 7964 | 0 | provider-1 | 23:44:52 |
| DASHTRY | COMPLETED | 5309 | 0 | provider-1 | 23:44:50 |
| PUMPTRY | COMPLETED | 2120 | 0 | provider-1 | 23:44:52 |
| MMTTRY | COMPLETED | 3399 | 0 | provider-1 | 23:44:56 |
| ENJTRY | COMPLETED | 8692 | 0 | provider-1 | 23:45:01 |
| INJTRY | COMPLETED | 12497 | 0 | provider-1 | 23:45:09 |
| DOLOTRY | CANCELLED | 2561 | 0 | provider-1 | 23:45:05 |
| FDUSDTRY | COMPLETED | 5475 | 0 | provider-1 | 23:45:12 |
| NEIROTRY | COMPLETED | 4679 | 0 | provider-1 | 23:45:14 |
| FLOKITRY | COMPLETED | 4495 | 0 | provider-1 | 23:45:17 |
| MANTRATRY | COMPLETED | 4248 | 0 | provider-1 | 23:45:19 |
| GRAMTRY | COMPLETED | 4480 | 0 | provider-1 | 23:45:21 |
| KITETRY | COMPLETED | 9495 | 0 | provider-1 | 23:45:29 |
| ESPTRY | COMPLETED | 9258 | 0 | provider-1 | 23:45:31 |
| NIGHTTRY | COMPLETED | 5418 | 0 | provider-1 | 23:45:34 |
| FORMTRY | COMPLETED | 6066 | 0 | provider-1 | 23:45:37 |
| HOTTRY | COMPLETED | 9217 | 0 | provider-1 | 23:45:44 |
| MANATRY | COMPLETED | 4663 | 0 | provider-1 | 23:45:43 |
| LINKTRY | COMPLETED | 3849 | 0 | provider-1 | 23:45:47 |
| FOGOTRY | COMPLETED | 4296 | 0 | provider-1 | 23:45:49 |
| MANTATRY | COMPLETED | 3212 | 0 | provider-1 | 23:45:51 |
| ENSOTRY | CANCELLED | 5895 | 0 | provider-1 | 23:45:55 |
| DYDXTRY | COMPLETED | 2219 | 0 | provider-1 | 23:45:53 |
| ERATRY | COMPLETED | 3096 | 0 | provider-1 | 23:45:56 |
| NEARTRY | COMPLETED | 5905 | 0 | provider-1 | 23:46:01 |
| GALATRY | COMPLETED | 4729 | 0 | provider-1 | 23:46:01 |
| FFTRY | COMPLETED | 3554 | 0 | provider-1 | 23:46:05 |
| ENATRY | COMPLETED | 5094 | 0 | provider-1 | 23:46:07 |
| LINEATRY | COMPLETED | 5318 | 0 | provider-1 | 23:46:11 |
| MEMETRY | COMPLETED | 5672 | 0 | provider-1 | 23:46:13 |
| GIGGLETRY | COMPLETED | 6259 | 0 | provider-1 | 23:46:18 |
| KAITOTRY | COMPLETED | 7391 | 0 | provider-1 | 23:46:21 |
| EGLDTRY | CANCELLED | 951 | 0 | provider-1 | 23:46:19 |
| NEOTRY | COMPLETED | 3837 | 0 | provider-1 | 23:46:23 |
| JASMYTRY | COMPLETED | 7638 | 0 | provider-1 | 23:46:29 |
| HYPERTRY | COMPLETED | 7789 | 0 | provider-1 | 23:46:31 |
| KATTRY | COMPLETED | 8961 | 0 | provider-1 | 23:46:38 |
| GENIUSTRY | COMPLETED | 5222 | 0 | provider-1 | 23:46:37 |
| LPTTRY | CANCELLED | 1554 | 0 | provider-1 | 23:46:39 |
| DOTTRY | CANCELLED | 6184 | 0 | provider-1 | 23:46:44 |
| MAGICTRY | CANCELLED | 1906 | 0 | provider-1 | 23:46:41 |
| LISTATRY | CANCELLED | 1922 | 0 | provider-1 | 23:46:43 |
| EIGENTRY | COMPLETED | 11375 | 0 | provider-1 | 23:46:54 |
| GRTTRY | COMPLETED | 6924 | 0 | provider-1 | 23:46:52 |
| EDUTRY | COMPLETED | 8155 | 0 | provider-1 | 23:47:00 |
| FILTRY | COMPLETED | 9500 | 0 | provider-1 | 23:47:04 |
| NILTRY | CANCELLED | 1895 | 0 | provider-1 | 23:47:02 |
| GTRY | COMPLETED | 4455 | 0 | provider-1 | 23:47:07 |
| FIDATRY | COMPLETED | 8512 | 0 | provider-1 | 23:47:14 |
| METTRY | CANCELLED | 1874 | 0 | provider-1 | 23:47:09 |
| MIRATRY | COMPLETED | 3839 | 0 | provider-1 | 23:47:14 |
| MINATRY | CANCELLED | 1877 | 0 | provider-1 | 23:47:16 |
| MITOTRY | CANCELLED | 2131 | 0 | provider-1 | 23:47:16 |
| LATRY | CANCELLED | 1917 | 0 | provider-1 | 23:47:18 |
| FETTRY | COMPLETED | 3214 | 0 | provider-1 | 23:47:20 |
| MUBARAKTRY | COMPLETED | 5536 | 0 | provider-1 | 23:47:24 |
| METISTRY | CANCELLED | 1895 | 0 | provider-1 | 23:47:22 |
| GPSTRY | COMPLETED | 4611 | 0 | provider-1 | 23:47:27 |
| ETHFITRY | CANCELLED | 5811 | 0 | provider-1 | 23:47:30 |
| ETHTRY | COMPLETED | 5209 | 0 | provider-1 | 23:47:33 |
| IOTRY | CANCELLED | 6015 | 0 | provider-1 | 23:47:36 |
| ICPTRY | COMPLETED | 7791 | 0 | provider-1 | 23:47:41 |
| KERNELTRY | COMPLETED | 6945 | 0 | provider-1 | 23:47:44 |
| IOTATRY | CANCELLED | 5840 | 0 | provider-1 | 23:47:47 |
| LUNCTRY | COMPLETED | 6309 | 0 | provider-1 | 23:47:50 |
| EDENTRY | COMPLETED | 3578 | 0 | provider-1 | 23:47:51 |
| PORTALTRY | COMPLETED | 2739 | 0 | provider-1 | 23:47:54 |
| ZROTRY | CANCELLED | 6931 | 0 | provider-1 | 23:47:58 |
| METRY | CANCELLED | 1585 | 0 | provider-1 | 23:47:57 |
| HEITRY | COMPLETED | 9672 | 0 | provider-1 | 23:48:07 |
| HEMITRY | COMPLETED | 9618 | 0 | provider-1 | 23:48:09 |
| NMRTRY | CANCELLED | 1501 | 0 | provider-1 | 23:48:09 |
| TRUMPTRY | COMPLETED | 2915 | 0 | provider-1 | 23:48:12 |

### Seçilen Sembol Pipeline — INJTRY

Decision trace kayıtları: **0** | Consensus: **1** | EV: **1** | Lifecycle: **1** | TDI: **0**

**consensus-trace (seçilen sembol, son 10):**

| timestamp | finalDecision | masterRule | reason | votes |
| --- | --- | --- | --- | --- |
| 23:45:07 | NO_TRADE | NO-TRADE | regime=RANGE_SIDEWAYS, tech=37.84, sentiment=31.70, risk=61. | {"provider-1":"NO_TRADE","provider-3":"H |

**ev-trace (seçilen sembol, son 10):**

| timestamp | verdict | EV | threshold | winProb | RR | reason |
| --- | --- | --- | --- | --- | --- | --- |
| 23:45:07 | REJECTED | 42.7587 | 36 | 33.92 | 1.3333 | EV_REJECT |

**candidate-lifecycle (seçilen sembol):**

| timestamp | stage | verdict | reasonCode | detail |
| --- | --- | --- | --- | --- |
| 23:48:12 | decision | REJECTED | SIM_TIGHT_FILTER | SIM_TIGHT_FILTER_30m: non-pump kalite dusuk (composite=43.8, sentiment |

### tdi-sensitivity

| Alan | Değer |
| --- | --- |
| currentThreshold | 55 |
| scoreAboveThresholdRate | 0.3135 |
| runtimeApprovalEquivalentRate | 0 |
| runtimeWaitCount | 11 |
| runtimeRejectedCount | 174 |
| recommendation | NO_CHANGE |
| productionReplayStatus | COMPLETE |

**Score distribution:** min=31.4481 p50=50.354329635825664 p90=61.0961 max=69.7281

### ev-component-attribution

| component | weight | observed | quality |
| --- | --- | --- | --- |
| expectedProfit | 0.35 | 0.8603 | HIGH |
| expectedLoss | 0.25 | -0.597 | HIGH |
| fees | 0.15 | 0 | HIGH |
| winProbability | 0.15 | 25.8087 | HIGH |
| expectedRiskReward | 0.1 | 1.5176 | HIGH |

Dominant component: **winProbability** (sample=180)

### round-liveness (tur sonu snapshot)

| Alan | Değer |
| --- | --- |
| state | "UNKNOWN" |
| currentStage | "SYMBOL_SELECTED" |
| lastMeaningfulProgressAt | "2026-08-22T23:48:12.322Z" |
| meaningfulProgressAgeMs | 755 |
| lastHeartbeatAt | "2026-08-22T23:48:12.322Z" |
| heartbeatAgeMs | 755 |
| activeWork | {"scanner":85,"ai":85,"marketData":0} |
| activeRetries | 1 |
| activeCandidates | 0 |
| poolActive | 0 |
| poolQueued | 0 |
| remainingBudgetMs | 323262 |
| abortRequested | false |
| abortReason | null |
| stallDetectedAt | null |
| terminalizationStartedAt | null |
| terminalState | "SYMBOL_SELECTED" |
| terminalizationDurationMs | null |

### round-watchdog

| Alan | Değer |
| --- | --- |
| roundId | "2" |
| runId | "cmt50l41x09iuun8gmkl9y7qi" |
| jobId | "cmt4zxkbm001gun8ghz4qsb0w" |
| lastProgressAt | "2026-08-22T23:48:12.322Z" |
| lastHeartbeatAt | "2026-08-22T23:48:12.322Z" |
| currentStage | "SYMBOL_SELECTED" |
| elapsedSinceProgressMs | 754 |
| elapsedSinceHeartbeatMs | 754 |
| decision | "NONE" |
| action | "Progress within threshold" |
| reasonDetail | "No action" |
| recordedAt | "2026-08-22T23:48:13.076Z" |

### resolved-config (runtime)

```json
{
  "generatedAt": "2026-08-22T23:48:13.060Z",
  "exchange": "binance",
  "universe": {
    "scannerUniverse": "ALL_SPOT",
    "maxSymbols": 1200,
    "maxCycleSec": 180
  },
  "aiMode": {
    "executionMode": "paper",
    "minConfidence": 60,
    "strictAnalystMode": false,
    "remoteRequired": false
  },
  "strategyConfig": {},
  "evConfig": {
    "minRiskRewardRatio": 1.25,
    "minTradeQualityScore": 45
  },
  "risk": {
    "maxDailyLossPercent": 5,
    "maxOpenPositions": 3
  },
  "sizing": {},
  "fees": {
    "binanceTakerFeeRate": 0.0015,
    "binanceMakerFeeRate": 0.0009
  },
  "simulationWindow": {
    "autoRoundSelectionBudgetSec": 1200
  },
  "maxPositions": 3,
  "timeframes": [
    "1m",
    "5m",
    "15m",
    "1h",
    "4h"
  ]
}
```

### Promotion / Research Gates

| Gate | promoted | status/detail |
| --- | --- | --- |
| promotion-gate | false | RESEARCH_ONLY |
| p1-promotion-gate | false | RESEARCH_ONLY |
| strategy-comparison | false | 07503ff4691831f0 |

### Artifact Envanteri (bu tur)

| dosya | KB |
| --- | --- |
| tdi-decisions.json | 887 |
| tdi-data-quality.json | 630 |
| tdi-input-contract.json | 625 |
| missed-opportunities.json | 227 |
| opportunity-value.json | 189 |
| consensus-trace.json | 149 |
| ev-trace.json | 77 |
| scanner-summary.json | 75 |
| ai-progress.json | 45 |
| errors.json | 44 |
| pump-scan-lifecycle.json | 31 |
| transaction-duration.json | 24 |
| decision-trace.json | 16 |
| candidate-lifecycle.json | 14 |
| stage-timings.json | 7 |
| round-summary.json | 5 |
| profitability-experiments.json | 4 |
| selectionTimeBudgetBreakdown.json | 4 |
| ev-component-attribution.json | 2 |
| opportunity-funnel.json | 2 |
| p1-promotion-gate.json | 2 |
| promotion-gate.json | 2 |
| single-change-experiments.json | 2 |
| slot-allocation-analysis.json | 2 |
| slot-opportunity-report.json | 2 |
| tdi-sensitivity.json | 2 |
| candidate-quality-factors.json | 1 |
| entry-timing-experiment.json | 1 |
| exit-forensics.json | 1 |
| fee-aware-entry-experiment.json | 1 |
| mr-regime-gating-experiment.json | 1 |
| profitability-experiments.csv | 1 |
| promotion-decisions.json | 1 |
| resolved-config.json | 1 |
| round-liveness.json | 1 |
| slot-allocation-experiment.json | 1 |
| strategy-comparison-report.json | 1 |
| volatility-breakout-validation.json | 1 |
| ai-strategy-interaction.json | 0 |
| ai-trace.json | 0 |
| baseline-metrics.json | 0 |
| entry-timing.json | 0 |
| ev-calibration.json | 0 |
| execution-trace.json | 0 |
| exit-fee-interaction.json | 0 |
| exit-trace.json | 0 |
| fee-aware-edge-research.json | 0 |
| fee-aware-entry-policy.json | 0 |
| fee-by-hold-time.json | 0 |
| fee-by-strategy.json | 0 |
| gross-positive-net-negative.json | 0 |
| loss-patterns.json | 0 |
| mean-reversion-audit.json | 0 |
| not-discovered-analysis.json | 0 |
| out-of-sample-evaluation.json | 0 |
| pnl-ledger.json | 0 |
| position-trace.json | 0 |
| profit-concentration.json | 0 |
| recovery-decisions.json | 0 |
| recovery-telemetry.json | 0 |
| replay-exit-diagnostics.json | 0 |
| replayExitDiagnostics.json | 0 |
| risk-sizing-trace.json | 0 |
| round-watchdog.json | 0 |
| scanner-qualification.json | 0 |
| strategy-performance.json | 0 |
| strategy-regime-matrix-p2.csv | 0 |
| strategy-regime-matrix-p2.json | 0 |
| strategy-regime-matrix.json | 0 |
| strategy-trace.json | 0 |
| tdi-missing-telemetry-report.json | 0 |
| trend-following-validation.json | 0 |
| winning-patterns.json | 0 |

---

## Tur #3 — PEOPLETRY

### Kimlik & DB

| Alan | Değer |
| --- | --- |
| runId | cmt513ymm0k3vun8gqsd07fkp |
| jobId | cmt4zxkbm001gun8ghz4qsb0w |
| roundNo | 3 |
| state | tur_basarisiz |
| symbol | PEOPLETRY |
| startedAt | 2026-08-22T23:48:13.198Z |
| endedAt | 2026-08-22T23:52:43.420Z |
| duration | 4.5 dk |
| selectionAttempt | 1 |
| runtime.step | EXECUTING |
| failReason (DB) | AI_GATE_BLOCK: AI_VETO |
| failReason (artifact) | AI_GATE_BLOCK: AI_VETO |
| exportKind | failed-round-partial |
| exportStatus | COMPLETED |

### round-summary — Özet Metrikler

| Metrik | Değer |
| --- | --- |
| candidateCount | 48 |
| failureCount | 276 |
| tradeCount | 0 |
| fills | 0 |
| grossPnL | 0 |
| fees | 0 |
| netPnl | 0 |
| currentStage | EXECUTING |
| elapsedMs | 268627 |
| selectionBudgetMs | 1200000 |
| lastProgressAt | 2026-08-22T23:52:41.898Z |
| heartbeatAt | 2026-08-22T23:52:42.446Z |

### funnelState — Tam Rejection Haritası

**By stage:**
- scanner: 80
- ai: 60
- consensus: 60
- ev: 54
- candidate: 22

**By reason (tam liste):**
- REJECTED: 79
- AI_DEGRADED: 60
- CONSENSUS_REJECT: 60
- EV_REJECT: 54
- PUMP_NOT_EARLY_OR_CONTINUATION: 10
- PUMP_CONFIRM_NO_TRADE: 10
- CANDIDATE_REJECTED: 2
- SPREAD_TOO_WIDE: 1

**TDI runtime counters:**

| Counter | Değer |
| --- | --- |
| tdiDecisions | 0 |
| runtimeTdiApproved | 0 |
| runtimeTdiWait | 0 |
| runtimeTdiRejected | 0 |
| upstreamCandidateRejected | 0 |
| hybridRejected | 0 |
| consensusRejected | 60 |
| masterRejected | 0 |
| scannerQualificationRejections | 0 |

### opportunity-funnel — Aşama Kayıpları

| Stage | entered | lost | lostReason | count | % | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| DISCOVERED | 48 | 276 | FILTERED_OUT | 48 | 100 | COMPLETE |
| STRATEGY_QUALIFIED | -32 | 0 | FILTERED_OUT | 0 | 0 | PARTIAL |
| TDI | 0 | 0 | TDI_WAIT | 0 | 0 | PARTIAL |
| AI | 0 | 120 | AI_REJECTED | 120 | 43.48 | PARTIAL |
| RISK | 0 | 0 | RISK | 0 | 0 | PARTIAL |
| EXECUTION | 0 | 0 | EXECUTION_FAILED | 0 | 0 | PARTIAL |

**lossByReason:**

| Reason | count | % |
| --- | --- | --- |
| UNKNOWN | 75 | 27.17 |
| FILTERED_OUT | 81 | 29.35 |
| AI_REJECTED | 120 | 43.48 |

### selectionTimeBudgetBreakdown — Zaman Bütçesi

| Alan | Değer |
| --- | --- |
| selectionBudgetMs | 1200000 |
| totalElapsedMs | 270319 |
| measuredTotalMs | 274247 |
| PRIMARY_TIME_CONSUMER | execution_preparation |

**TOP_5_TIME_CONSUMERS:**

| stage | totalMs | share% |
| --- | --- | --- |
| execution_preparation | 168850 | 14.1% |
| ai_execution | 101469 | 8.5% |
| persistence | 3928 | 0.3% |
| scanner_startup | 0 | 0.0% |
| pump_discovery | 0 | 0.0% |

**Tüm stage satırları:**

| stage | count | totalMs | p50 | p95 | max | budgetShare% |
| --- | --- | --- | --- | --- | --- | --- |
| ai_execution | 119 | 101469 | 311 | 2706 | 3941 | 8.4558 |
| execution_preparation | 1 | 168850 | 168850 | 168850 | 168850 | 14.0708 |
| persistence | 99 | 3928 | 50 | 90 | 116 | 0.3273 |

### scanner-summary — Aggregate

| Metrik | Değer |
| --- | --- |
| scanner cycles | 1 |
| universe (sum) | 537 |
| eligible (sum) | 152 |
| qualified (sum) | 152 |
| rejected (sum) | 385 |
| errors (sum) | 0 |

**Scanner rejection reasons (aggregate):**
- REJECTED: 377
- Data quality issue (CHANGE24H_FALLBACK): 3
- Spread too wide: 2
- Data quality issue (PRICE_STALE): 2
- SPREAD_TOO_WIDE: 1

### errors.json — Failure Özeti

| Alan | Değer |
| --- | --- |
| total failures | 60 |
| artifact failReason | AI_GATE_BLOCK: AI_VETO |

**By stage:**
- ai: 60

**By reasonCode (top 20):**
- AI_DEGRADED: 60

### ai-progress — AI Pool

| Metrik | Değer |
| --- | --- |
| processed | 85 |
| total | 85 |
| successCount | 60 |
| failedCount | 25 |
| timeoutCount | 0 |
| concurrency | 2 |
| duration p50 | 4123 ms |
| duration p95 | 9420 ms |
| duration max | 11449 ms |
| currentCandidate | MUBARAKTRY |
| currentStage | ai |

**Status dağılımı:**
- COMPLETED: 60
- CANCELLED: 25

**Tüm AI candidate satırları:**

| symbol | status | durationMs | retry | provider | completedAt |
| --- | --- | --- | --- | --- | --- |
| BABYTRY | COMPLETED | 6540 | 0 | provider-1 | 23:49:10 |
| POLTRY | COMPLETED | 6375 | 0 | provider-1 | 23:49:10 |
| STXTRY | COMPLETED | 3513 | 0 | provider-1 | 23:49:14 |
| REZTRY | COMPLETED | 3151 | 0 | provider-1 | 23:49:14 |
| FFTRY | COMPLETED | 2358 | 0 | provider-1 | 23:49:17 |
| REDTRY | COMPLETED | 4516 | 0 | provider-1 | 23:49:19 |
| TRBTRY | COMPLETED | 11449 | 0 | provider-1 | 23:49:29 |
| SNXTRY | COMPLETED | 3952 | 0 | provider-1 | 23:49:30 |
| SANDTRY | COMPLETED | 2629 | 0 | provider-1 | 23:49:32 |
| ORDITRY | COMPLETED | 8315 | 0 | provider-1 | 23:49:38 |
| SIGNTRY | COMPLETED | 3004 | 0 | provider-1 | 23:49:35 |
| RARETRY | COMPLETED | 8740 | 0 | provider-1 | 23:49:44 |
| TIATRY | COMPLETED | 2707 | 0 | provider-1 | 23:49:41 |
| PLUMETRY | COMPLETED | 8614 | 0 | provider-1 | 23:49:50 |
| SYRUPTRY | COMPLETED | 4210 | 0 | provider-1 | 23:49:48 |
| DASHTRY | COMPLETED | 3087 | 0 | provider-1 | 23:49:52 |
| TLMTRY | COMPLETED | 5607 | 0 | provider-1 | 23:49:56 |
| SOMITRY | CANCELLED | 5582 | 0 | provider-1 | 23:49:58 |
| PEOPLETRY | COMPLETED | 9420 | 0 | provider-1 | 23:50:07 |
| USDCTRY | COMPLETED | 6085 | 0 | provider-1 | 23:50:05 |
| TURBOTRY | COMPLETED | 5333 | 0 | provider-1 | 23:50:11 |
| TRXTRY | COMPLETED | 5261 | 0 | provider-1 | 23:50:12 |
| STRY | COMPLETED | 5392 | 0 | provider-1 | 23:50:17 |
| ONTTRY | COMPLETED | 3057 | 0 | provider-1 | 23:50:16 |
| OPTRY | CANCELLED | 2007 | 0 | provider-1 | 23:50:18 |
| ONDOTRY | COMPLETED | 2972 | 0 | provider-1 | 23:50:20 |
| THETATRY | CANCELLED | 5816 | 0 | provider-1 | 23:50:24 |
| SEITRY | COMPLETED | 9564 | 0 | provider-1 | 23:50:30 |
| SOLVTRY | COMPLETED | 9336 | 0 | provider-1 | 23:50:34 |
| TURTLETRY | CANCELLED | 1867 | 0 | provider-1 | 23:50:32 |
| POLYXTRY | CANCELLED | 304 | 0 | provider-1 | 23:50:32 |
| PUMPTRY | COMPLETED | 5273 | 0 | provider-1 | 23:50:38 |
| NXPCTRY | CANCELLED | 1739 | 0 | provider-1 | 23:50:35 |
| TSTTRY | COMPLETED | 3281 | 0 | provider-1 | 23:50:39 |
| SCRTRY | CANCELLED | 6293 | 0 | provider-1 | 23:50:44 |
| ENATRY | COMPLETED | 3320 | 0 | provider-1 | 23:50:42 |
| SUSHITRY | CANCELLED | 6338 | 0 | provider-1 | 23:50:49 |
| SENTTRY | COMPLETED | 9274 | 0 | provider-1 | 23:50:54 |
| RADTRY | CANCELLED | 1 | 0 | provider-1 | 23:50:49 |
| TRUMPTRY | COMPLETED | 3539 | 0 | provider-1 | 23:50:53 |
| SAPIENTRY | COMPLETED | 9128 | 0 | provider-1 | 23:51:02 |
| PORTALTRY | COMPLETED | 2780 | 0 | provider-1 | 23:50:57 |
| ROBOTRY | COMPLETED | 3306 | 0 | provider-1 | 23:51:00 |
| SOLTRY | COMPLETED | 4528 | 0 | provider-1 | 23:51:05 |
| RVNTRY | COMPLETED | 9572 | 0 | provider-1 | 23:51:12 |
| SHIBTRY | COMPLETED | 8859 | 0 | provider-1 | 23:51:14 |
| ROSETRY | COMPLETED | 8747 | 0 | provider-1 | 23:51:21 |
| PENDLETRY | COMPLETED | 4728 | 0 | provider-1 | 23:51:19 |
| RAYTRY | CANCELLED | 1883 | 0 | provider-1 | 23:51:21 |
| TOWNSTRY | COMPLETED | 4703 | 0 | provider-1 | 23:51:26 |
| USTCTRY | COMPLETED | 8831 | 0 | provider-1 | 23:51:30 |
| QTUMTRY | CANCELLED | 2337 | 0 | provider-1 | 23:51:29 |
| PNUTTRY | CANCELLED | 1969 | 0 | provider-1 | 23:51:31 |
| RENDERTRY | CANCELLED | 1264 | 0 | provider-1 | 23:51:32 |
| TNSRTRY | CANCELLED | 1927 | 0 | provider-1 | 23:51:33 |
| RESOLVTRY | CANCELLED | 739 | 0 | provider-1 | 23:51:33 |
| SXTTRY | CANCELLED | 0 | 0 | provider-1 | 23:51:33 |
| SLPTRY | COMPLETED | 8735 | 0 | provider-1 | 23:51:42 |
| PIXELTRY | COMPLETED | 4244 | 0 | provider-1 | 23:51:37 |
| OPNTRY | CANCELLED | 1949 | 0 | provider-1 | 23:51:40 |
| TAOTRY | COMPLETED | 4473 | 0 | provider-1 | 23:51:44 |
| NOTTRY | COMPLETED | 4575 | 0 | provider-1 | 23:51:47 |
| OPENTRY | CANCELLED | 2259 | 0 | provider-1 | 23:51:47 |
| SOPHTRY | COMPLETED | 3449 | 0 | provider-1 | 23:51:50 |
| BONKTRY | COMPLETED | 2788 | 0 | provider-1 | 23:51:50 |
| TREETRY | CANCELLED | 1498 | 0 | provider-1 | 23:51:52 |
| THETRY | COMPLETED | 2679 | 0 | provider-1 | 23:51:53 |
| PARTITRY | CANCELLED | 1413 | 0 | provider-1 | 23:51:53 |
| UMATRY | CANCELLED | 1840 | 0 | provider-1 | 23:51:55 |
| ZROTRY | CANCELLED | 2028 | 0 | provider-1 | 23:51:56 |
| PYTHTRY | CANCELLED | 1820 | 0 | provider-1 | 23:51:57 |
| TWTTRY | COMPLETED | 3705 | 0 | provider-1 | 23:51:59 |
| USUALTRY | COMPLETED | 4624 | 0 | provider-1 | 23:52:02 |
| SHELLTRY | CANCELLED | 6101 | 0 | provider-1 | 23:52:06 |
| PSGTRY | CANCELLED | 1837 | 0 | provider-1 | 23:52:04 |
| SANTOSTRY | COMPLETED | 9632 | 0 | provider-1 | 23:52:14 |
| RONINTRY | COMPLETED | 7961 | 0 | provider-1 | 23:52:14 |
| SKYTRY | COMPLETED | 7867 | 0 | provider-1 | 23:52:23 |
| PENGUTRY | COMPLETED | 5291 | 0 | provider-1 | 23:52:20 |
| PEPETRY | COMPLETED | 3441 | 0 | provider-1 | 23:52:24 |
| USDTTRY | COMPLETED | 3402 | 0 | provider-1 | 23:52:26 |
| SUITRY | COMPLETED | 4123 | 0 | provider-1 | 23:52:28 |
| ACETRY | COMPLETED | 2675 | 0 | provider-1 | 23:52:29 |
| UNITRY | COMPLETED | 2098 | 0 | provider-1 | 23:52:30 |
| MUBARAKTRY | COMPLETED | 9270 | 0 | provider-1 | 23:52:39 |

### Seçilen Sembol Pipeline — PEOPLETRY

Decision trace kayıtları: **0** | Consensus: **1** | EV: **1** | Lifecycle: **0** | TDI: **0**

**consensus-trace (seçilen sembol, son 10):**

| timestamp | finalDecision | masterRule | reason | votes |
| --- | --- | --- | --- | --- |
| 23:50:06 | NO_TRADE | NO-TRADE | regime=RANGE_SIDEWAYS, tech=24.32, sentiment=45.04, risk=61. | {"provider-1":"NO_TRADE","provider-3":"H |

**ev-trace (seçilen sembol, son 10):**

| timestamp | verdict | EV | threshold | winProb | RR | reason |
| --- | --- | --- | --- | --- | --- | --- |
| 23:50:06 | REJECTED | 39.8727 | 36 | 33.04 | 1.3333 | EV_REJECT |

### tdi-sensitivity

| Alan | Değer |
| --- | --- |
| currentThreshold | 55 |
| scoreAboveThresholdRate | 0 |
| runtimeApprovalEquivalentRate | 0 |
| runtimeWaitCount | 0 |
| runtimeRejectedCount | 0 |
| recommendation | INSUFFICIENT_DATA |
| productionReplayStatus | INCOMPLETE |

**Score distribution:** min=0 p50=0 p90=0 max=0

### ev-component-attribution

| component | weight | observed | quality |
| --- | --- | --- | --- |
| expectedProfit | 0.35 | 0.8184 | HIGH |
| expectedLoss | 0.25 | -0.6 | HIGH |
| fees | 0.15 | 0 | HIGH |
| winProbability | 0.15 | 26.7342 | HIGH |
| expectedRiskReward | 0.1 | 1.364 | HIGH |

Dominant component: **winProbability** (sample=60)

### round-liveness (tur sonu snapshot)

| Alan | Değer |
| --- | --- |
| state | "UNKNOWN" |
| currentStage | "EXECUTING" |
| lastMeaningfulProgressAt | "2026-08-22T23:52:41.898Z" |
| meaningfulProgressAgeMs | 1655 |
| lastHeartbeatAt | "2026-08-22T23:52:42.446Z" |
| heartbeatAgeMs | 1107 |
| activeWork | {"scanner":85,"ai":85,"marketData":0} |
| activeRetries | 2 |
| activeCandidates | 0 |
| poolActive | 0 |
| poolQueued | 0 |
| remainingBudgetMs | 931373 |
| abortRequested | false |
| abortReason | null |
| stallDetectedAt | null |
| terminalizationStartedAt | null |
| terminalState | "EXECUTING" |
| terminalizationDurationMs | null |

### round-watchdog

| Alan | Değer |
| --- | --- |
| roundId | "3" |
| runId | "cmt513ymm0k3vun8gqsd07fkp" |
| jobId | "cmt4zxkbm001gun8ghz4qsb0w" |
| lastProgressAt | "2026-08-22T23:52:41.898Z" |
| lastHeartbeatAt | "2026-08-22T23:52:42.446Z" |
| currentStage | "EXECUTING" |
| elapsedSinceProgressMs | 1654 |
| elapsedSinceHeartbeatMs | 1106 |
| decision | "NONE" |
| action | "Legitimate long-running stage" |
| reasonDetail | "Monitoring active position" |
| recordedAt | "2026-08-22T23:52:43.552Z" |

### resolved-config (runtime)

```json
{
  "generatedAt": "2026-08-22T23:52:43.540Z",
  "exchange": "binance",
  "universe": {
    "scannerUniverse": "ALL_SPOT",
    "maxSymbols": 1200,
    "maxCycleSec": 180
  },
  "aiMode": {
    "executionMode": "paper",
    "minConfidence": 60,
    "strictAnalystMode": false,
    "remoteRequired": false
  },
  "strategyConfig": {},
  "evConfig": {
    "minRiskRewardRatio": 1.25,
    "minTradeQualityScore": 45
  },
  "risk": {
    "maxDailyLossPercent": 5,
    "maxOpenPositions": 3
  },
  "sizing": {},
  "fees": {
    "binanceTakerFeeRate": 0.0015,
    "binanceMakerFeeRate": 0.0009
  },
  "simulationWindow": {
    "autoRoundSelectionBudgetSec": 1200
  },
  "maxPositions": 3,
  "timeframes": [
    "1m",
    "5m",
    "15m",
    "1h",
    "4h"
  ]
}
```

### Promotion / Research Gates

| Gate | promoted | status/detail |
| --- | --- | --- |
| promotion-gate | false | RESEARCH_ONLY |
| p1-promotion-gate | false | RESEARCH_ONLY |
| strategy-comparison | false | 07503ff4691831f0 |

### Artifact Envanteri (bu tur)

| dosya | KB |
| --- | --- |
| consensus-trace.json | 88 |
| missed-opportunities.json | 81 |
| scanner-summary.json | 74 |
| opportunity-value.json | 49 |
| ai-progress.json | 48 |
| pump-scan-lifecycle.json | 32 |
| ev-trace.json | 26 |
| transaction-duration.json | 24 |
| errors.json | 15 |
| candidate-lifecycle.json | 8 |
| stage-timings.json | 7 |
| round-summary.json | 5 |
| profitability-experiments.json | 4 |
| selectionTimeBudgetBreakdown.json | 4 |
| tdi-data-quality.json | 4 |
| opportunity-funnel.json | 2 |
| p1-promotion-gate.json | 2 |
| promotion-gate.json | 2 |
| single-change-experiments.json | 2 |
| slot-allocation-analysis.json | 2 |
| slot-opportunity-report.json | 2 |
| tdi-sensitivity.json | 2 |
| candidate-quality-factors.json | 1 |
| entry-timing-experiment.json | 1 |
| ev-component-attribution.json | 1 |
| exit-forensics.json | 1 |
| fee-aware-entry-experiment.json | 1 |
| mr-regime-gating-experiment.json | 1 |
| profitability-experiments.csv | 1 |
| promotion-decisions.json | 1 |
| resolved-config.json | 1 |
| round-liveness.json | 1 |
| slot-allocation-experiment.json | 1 |
| strategy-comparison-report.json | 1 |
| volatility-breakout-validation.json | 1 |
| ai-strategy-interaction.json | 0 |
| ai-trace.json | 0 |
| baseline-metrics.json | 0 |
| decision-trace.json | 0 |
| entry-timing.json | 0 |
| ev-calibration.json | 0 |
| execution-trace.json | 0 |
| exit-fee-interaction.json | 0 |
| exit-trace.json | 0 |
| fee-aware-edge-research.json | 0 |
| fee-aware-entry-policy.json | 0 |
| fee-by-hold-time.json | 0 |
| fee-by-strategy.json | 0 |
| gross-positive-net-negative.json | 0 |
| loss-patterns.json | 0 |
| mean-reversion-audit.json | 0 |
| not-discovered-analysis.json | 0 |
| out-of-sample-evaluation.json | 0 |
| pnl-ledger.json | 0 |
| position-trace.json | 0 |
| profit-concentration.json | 0 |
| recovery-decisions.json | 0 |
| recovery-telemetry.json | 0 |
| replay-exit-diagnostics.json | 0 |
| replayExitDiagnostics.json | 0 |
| risk-sizing-trace.json | 0 |
| round-watchdog.json | 0 |
| scanner-qualification.json | 0 |
| strategy-performance.json | 0 |
| strategy-regime-matrix-p2.csv | 0 |
| strategy-regime-matrix-p2.json | 0 |
| strategy-regime-matrix.json | 0 |
| strategy-trace.json | 0 |
| tdi-decisions.json | 0 |
| tdi-input-contract.json | 0 |
| tdi-missing-telemetry-report.json | 0 |
| trend-following-validation.json | 0 |
| winning-patterns.json | 0 |

---

## Tur #4 — TRBTRY

### Kimlik & DB

| Alan | Değer |
| --- | --- |
| runId | cmt519ram0nmvun8gk7m02l8r |
| jobId | cmt4zxkbm001gun8ghz4qsb0w |
| roundNo | 4 |
| state | tur_basarisiz |
| symbol | TRBTRY |
| startedAt | 2026-08-22T23:52:43.630Z |
| endedAt | 2026-08-22T23:56:32.645Z |
| duration | 3.8 dk |
| selectionAttempt | 1 |
| runtime.step | EXECUTING |
| failReason (DB) | AI_GATE_BLOCK: AI_VETO |
| failReason (artifact) | AI_GATE_BLOCK: AI_VETO |
| exportKind | failed-round-partial |
| exportStatus | COMPLETED |

### round-summary — Özet Metrikler

| Metrik | Değer |
| --- | --- |
| candidateCount | 0 |
| failureCount | 273 |
| tradeCount | 0 |
| fills | 0 |
| grossPnL | 0 |
| fees | 0 |
| netPnl | 0 |
| currentStage | EXECUTING |
| elapsedMs | 227031 |
| selectionBudgetMs | 1200000 |
| lastProgressAt | 2026-08-22T23:56:30.710Z |
| heartbeatAt | 2026-08-22T23:56:31.693Z |

### funnelState — Tam Rejection Haritası

**By stage:**
- scanner: 77
- ai: 64
- consensus: 64
- ev: 52
- candidate: 16

**By reason (tam liste):**
- REJECTED: 67
- AI_DEGRADED: 64
- CONSENSUS_REJECT: 64
- EV_REJECT: 52
- Data quality issue (PRICE_STALE): 9
- PUMP_NOT_EARLY_OR_CONTINUATION: 6
- PUMP_CONFIRM_NO_TRADE: 6
- CANDIDATE_REJECTED: 4
- Spread too wide: 1

**TDI runtime counters:**

| Counter | Değer |
| --- | --- |
| tdiDecisions | 0 |
| runtimeTdiApproved | 0 |
| runtimeTdiWait | 0 |
| runtimeTdiRejected | 0 |
| upstreamCandidateRejected | 0 |
| hybridRejected | 0 |
| consensusRejected | 64 |
| masterRejected | 0 |
| scannerQualificationRejections | 0 |

### opportunity-funnel — Aşama Kayıpları

| Stage | entered | lost | lostReason | count | % | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| DISCOVERED | 0 | 273 | FILTERED_OUT | 0 | 100 | INSUFFICIENT |
| STRATEGY_QUALIFIED | -77 | 0 | FILTERED_OUT | 0 | 0 | PARTIAL |
| TDI | 0 | 0 | TDI_WAIT | 0 | 0 | PARTIAL |
| AI | 0 | 128 | AI_REJECTED | 128 | 46.89 | PARTIAL |
| RISK | 0 | 0 | RISK | 0 | 0 | PARTIAL |
| EXECUTION | 0 | 0 | EXECUTION_FAILED | 0 | 0 | PARTIAL |

**lossByReason:**

| Reason | count | % |
| --- | --- | --- |
| UNKNOWN | 74 | 27.11 |
| FILTERED_OUT | 71 | 26.01 |
| AI_REJECTED | 128 | 46.89 |

### selectionTimeBudgetBreakdown — Zaman Bütçesi

| Alan | Değer |
| --- | --- |
| selectionBudgetMs | 1200000 |
| totalElapsedMs | 229107 |
| measuredTotalMs | 232616 |
| PRIMARY_TIME_CONSUMER | ai_execution |

**TOP_5_TIME_CONSUMERS:**

| stage | totalMs | share% |
| --- | --- | --- |
| ai_execution | 120278 | 10.0% |
| execution_preparation | 108829 | 9.1% |
| persistence | 3509 | 0.3% |
| scanner_startup | 0 | 0.0% |
| pump_discovery | 0 | 0.0% |

**Tüm stage satırları:**

| stage | count | totalMs | p50 | p95 | max | budgetShare% |
| --- | --- | --- | --- | --- | --- | --- |
| ai_execution | 119 | 120278 | 439 | 2505 | 27547 | 10.0232 |
| execution_preparation | 1 | 108829 | 108829 | 108829 | 108829 | 9.0691 |
| persistence | 99 | 3509 | 54 | 67 | 87 | 0.2924 |

### scanner-summary — Aggregate

| Metrik | Değer |
| --- | --- |
| scanner cycles | 1 |
| universe (sum) | 621 |
| eligible (sum) | 159 |
| qualified (sum) | 159 |
| rejected (sum) | 462 |
| errors (sum) | 0 |

**Scanner rejection reasons (aggregate):**
- REJECTED: 444
- Data quality issue (PRICE_STALE): 11
- Data quality issue (CHANGE24H_FALLBACK): 3
- Spread too wide: 3
- SPREAD_TOO_WIDE: 1

### errors.json — Failure Özeti

| Alan | Değer |
| --- | --- |
| total failures | 64 |
| artifact failReason | AI_GATE_BLOCK: AI_VETO |

**By stage:**
- ai: 64

**By reasonCode (top 20):**
- AI_DEGRADED: 64

### ai-progress — AI Pool

| Metrik | Değer |
| --- | --- |
| processed | 84 |
| total | 84 |
| successCount | 74 |
| failedCount | 10 |
| timeoutCount | 0 |
| concurrency | 2 |
| duration p50 | 3337 ms |
| duration p95 | 7421 ms |
| duration max | 11660 ms |
| currentCandidate | APTTRY |
| currentStage | ai |

**Status dağılımı:**
- COMPLETED: 74
- CANCELLED: 10

**Tüm AI candidate satırları:**

| symbol | status | durationMs | retry | provider | completedAt |
| --- | --- | --- | --- | --- | --- |
| TOMOTRY | COMPLETED | 2419 | 0 | provider-1 | 23:53:14 |
| FRONTTRY | COMPLETED | 2859 | 0 | provider-1 | 23:53:15 |
| WAVESTRY | COMPLETED | 1467 | 0 | provider-1 | 23:53:16 |
| EOSTRY | COMPLETED | 2855 | 0 | provider-1 | 23:53:18 |
| PENDLETRY | COMPLETED | 3882 | 0 | provider-1 | 23:53:20 |
| KITETRY | COMPLETED | 8937 | 0 | provider-1 | 23:53:27 |
| FFTRY | COMPLETED | 5724 | 0 | provider-1 | 23:53:26 |
| YBTRY | COMPLETED | 2882 | 0 | provider-1 | 23:53:29 |
| ALLOTRY | COMPLETED | 3508 | 0 | provider-1 | 23:53:31 |
| TRBTRY | COMPLETED | 5448 | 0 | provider-1 | 23:53:35 |
| RNDRTRY | COMPLETED | 3277 | 0 | provider-1 | 23:53:34 |
| TONTRY | COMPLETED | 1872 | 0 | provider-1 | 23:53:36 |
| IMXTRY | COMPLETED | 1175 | 0 | provider-1 | 23:53:36 |
| 2ZTRY | COMPLETED | 3203 | 0 | provider-1 | 23:53:39 |
| SPKTRY | COMPLETED | 3200 | 0 | provider-1 | 23:53:40 |
| ZROTRY | COMPLETED | 2660 | 0 | provider-1 | 23:53:42 |
| DASHTRY | COMPLETED | 2777 | 0 | provider-1 | 23:53:43 |
| ZILTRY | COMPLETED | 3291 | 0 | provider-1 | 23:53:46 |
| WIFTRY | COMPLETED | 3337 | 0 | provider-1 | 23:53:46 |
| ACMTRY | COMPLETED | 2958 | 0 | provider-1 | 23:53:49 |
| AMPTRY | COMPLETED | 5640 | 0 | provider-1 | 23:53:53 |
| POLTRY | COMPLETED | 2482 | 0 | provider-1 | 23:53:52 |
| ACHTRY | COMPLETED | 2673 | 0 | provider-1 | 23:53:55 |
| XECTRY | COMPLETED | 2128 | 0 | provider-1 | 23:53:55 |
| TURBOTRY | COMPLETED | 3268 | 0 | provider-1 | 23:53:58 |
| ZKTRY | COMPLETED | 2063 | 0 | provider-1 | 23:53:57 |
| XAITRY | COMPLETED | 2812 | 0 | provider-1 | 23:54:00 |
| VETTRY | COMPLETED | 3731 | 0 | provider-1 | 23:54:02 |
| WTRY | COMPLETED | 2724 | 0 | provider-1 | 23:54:03 |
| ARKMTRY | COMPLETED | 2022 | 0 | provider-1 | 23:54:05 |
| VIRTUALTRY | COMPLETED | 3547 | 0 | provider-1 | 23:54:07 |
| TURTLETRY | CANCELLED | 1826 | 0 | provider-1 | 23:54:07 |
| BABYTRY | COMPLETED | 3165 | 0 | provider-1 | 23:54:10 |
| XVGTRY | COMPLETED | 2025 | 0 | provider-1 | 23:54:09 |
| ACTTRY | COMPLETED | 5473 | 0 | provider-1 | 23:54:15 |
| 1000CATTRY | COMPLETED | 5693 | 0 | provider-1 | 23:54:17 |
| ALICETRY | CANCELLED | 1978 | 0 | provider-1 | 23:54:17 |
| UNITRY | COMPLETED | 3358 | 0 | provider-1 | 23:54:20 |
| ENATRY | COMPLETED | 3484 | 0 | provider-1 | 23:54:21 |
| USDCTRY | COMPLETED | 5936 | 0 | provider-1 | 23:54:27 |
| TREETRY | CANCELLED | 2062 | 0 | provider-1 | 23:54:24 |
| ALTTRY | COMPLETED | 4288 | 0 | provider-1 | 23:54:28 |
| AAVETRY | COMPLETED | 2445 | 0 | provider-1 | 23:54:30 |
| WLFITRY | CANCELLED | 1386 | 0 | provider-1 | 23:54:30 |
| APETRY | CANCELLED | 1165 | 0 | provider-1 | 23:54:31 |
| TRXTRY | COMPLETED | 9728 | 0 | provider-1 | 23:54:40 |
| XLMTRY | COMPLETED | 7421 | 0 | provider-1 | 23:54:39 |
| USUALTRY | COMPLETED | 5407 | 0 | provider-1 | 23:54:45 |
| ARPATRY | COMPLETED | 4176 | 0 | provider-1 | 23:54:45 |
| AIXBTTRY | CANCELLED | 2125 | 0 | provider-1 | 23:54:47 |
| 0GTRY | COMPLETED | 5634 | 0 | provider-1 | 23:54:51 |
| 1000SATSTRY | COMPLETED | 5048 | 0 | provider-1 | 23:54:53 |
| VANATRY | CANCELLED | 1860 | 0 | provider-1 | 23:54:54 |
| BONKTRY | COMPLETED | 11660 | 0 | provider-1 | 23:55:05 |
| ZKPTRY | COMPLETED | 3896 | 0 | provider-1 | 23:54:58 |
| TWTTRY | COMPLETED | 8767 | 0 | provider-1 | 23:55:08 |
| ARKTRY | COMPLETED | 3632 | 0 | provider-1 | 23:55:11 |
| TRUMPTRY | COMPLETED | 3913 | 0 | provider-1 | 23:55:12 |
| TSTTRY | COMPLETED | 4962 | 0 | provider-1 | 23:55:16 |
| TOWNSTRY | COMPLETED | 5930 | 0 | provider-1 | 23:55:19 |
| TNSRTRY | CANCELLED | 1821 | 0 | provider-1 | 23:55:19 |
| WLDTRY | COMPLETED | 4738 | 0 | provider-1 | 23:55:24 |
| UMATRY | CANCELLED | 1739 | 0 | provider-1 | 23:55:21 |
| PYTHTRY | COMPLETED | 4715 | 0 | provider-1 | 23:55:26 |
| USDTTRY | COMPLETED | 4049 | 0 | provider-1 | 23:55:28 |
| PUMPTRY | COMPLETED | 2937 | 0 | provider-1 | 23:55:29 |
| ANKRTRY | COMPLETED | 3718 | 0 | provider-1 | 23:55:32 |
| ZBTTRY | COMPLETED | 3478 | 0 | provider-1 | 23:55:33 |
| AIGENSYNTRY | COMPLETED | 3303 | 0 | provider-1 | 23:55:35 |
| BAKETRY | COMPLETED | 2838 | 0 | provider-1 | 23:55:36 |
| USTCTRY | COMPLETED | 4909 | 0 | provider-1 | 23:55:40 |
| ACETRY | COMPLETED | 3927 | 0 | provider-1 | 23:55:40 |
| XPLTRY | COMPLETED | 3459 | 0 | provider-1 | 23:55:43 |
| PORTALTRY | COMPLETED | 2658 | 0 | provider-1 | 23:55:43 |
| AEVOTRY | COMPLETED | 4787 | 0 | provider-1 | 23:55:48 |
| JOETRY | COMPLETED | 2716 | 0 | provider-1 | 23:55:47 |
| ALPINETRY | COMPLETED | 3844 | 0 | provider-1 | 23:55:51 |
| STXTRY | COMPLETED | 2522 | 0 | provider-1 | 23:55:51 |
| MUBARAKTRY | COMPLETED | 3208 | 0 | provider-1 | 23:55:54 |
| XRPTRY | COMPLETED | 4406 | 0 | provider-1 | 23:55:56 |
| API3TRY | COMPLETED | 4003 | 0 | provider-1 | 23:55:58 |
| ARTRY | COMPLETED | 4129 | 0 | provider-1 | 23:56:00 |
| ADATRY | COMPLETED | 4149 | 0 | provider-1 | 23:56:03 |
| APTTRY | CANCELLED | 1859 | 0 | provider-1 | 23:56:02 |

### Seçilen Sembol Pipeline — TRBTRY

Decision trace kayıtları: **0** | Consensus: **1** | EV: **1** | Lifecycle: **0** | TDI: **0**

**consensus-trace (seçilen sembol, son 10):**

| timestamp | finalDecision | masterRule | reason | votes |
| --- | --- | --- | --- | --- |
| 23:53:35 | NO_TRADE | NO-TRADE | regime=HIGH_VOLATILITY_CHAOS, tech=73.95, sentiment=65.10, r | {"provider-1":"BUY","provider-3":"NO_TRA |

**ev-trace (seçilen sembol, son 10):**

| timestamp | verdict | EV | threshold | winProb | RR | reason |
| --- | --- | --- | --- | --- | --- | --- |
| 23:53:35 | REJECTED | 66.3489 | 36 | 16.66 | 8.4808 | EV_REJECT |

### tdi-sensitivity

| Alan | Değer |
| --- | --- |
| currentThreshold | 55 |
| scoreAboveThresholdRate | 0 |
| runtimeApprovalEquivalentRate | 0 |
| runtimeWaitCount | 0 |
| runtimeRejectedCount | 0 |
| recommendation | INSUFFICIENT_DATA |
| productionReplayStatus | INCOMPLETE |

**Score distribution:** min=0 p50=0 p90=0 max=0

### ev-component-attribution

| component | weight | observed | quality |
| --- | --- | --- | --- |
| expectedProfit | 0.35 | 0.9961 | HIGH |
| expectedLoss | 0.25 | -0.599 | HIGH |
| fees | 0.15 | 0 | HIGH |
| winProbability | 0.15 | 28.3003 | HIGH |
| expectedRiskReward | 0.1 | 1.6646 | HIGH |

Dominant component: **winProbability** (sample=64)

### round-liveness (tur sonu snapshot)

| Alan | Değer |
| --- | --- |
| state | "UNKNOWN" |
| currentStage | "EXECUTING" |
| lastMeaningfulProgressAt | "2026-08-22T23:56:30.710Z" |
| meaningfulProgressAgeMs | 2066 |
| lastHeartbeatAt | "2026-08-22T23:56:31.693Z" |
| heartbeatAgeMs | 1083 |
| activeWork | {"scanner":83,"ai":83,"marketData":0} |
| activeRetries | 4 |
| activeCandidates | 1 |
| poolActive | 0 |
| poolQueued | 0 |
| remainingBudgetMs | 972969 |
| abortRequested | false |
| abortReason | null |
| stallDetectedAt | null |
| terminalizationStartedAt | null |
| terminalState | "EXECUTING" |
| terminalizationDurationMs | null |

### round-watchdog

| Alan | Değer |
| --- | --- |
| roundId | "4" |
| runId | "cmt519ram0nmvun8gk7m02l8r" |
| jobId | "cmt4zxkbm001gun8ghz4qsb0w" |
| lastProgressAt | "2026-08-22T23:56:30.710Z" |
| lastHeartbeatAt | "2026-08-22T23:56:31.693Z" |
| currentStage | "EXECUTING" |
| elapsedSinceProgressMs | 2064 |
| elapsedSinceHeartbeatMs | 1081 |
| decision | "NONE" |
| action | "Legitimate long-running stage" |
| reasonDetail | "Monitoring active position" |
| recordedAt | "2026-08-22T23:56:32.774Z" |

### resolved-config (runtime)

```json
{
  "generatedAt": "2026-08-22T23:56:32.760Z",
  "exchange": "binance",
  "universe": {
    "scannerUniverse": "ALL_SPOT",
    "maxSymbols": 1200,
    "maxCycleSec": 180
  },
  "aiMode": {
    "executionMode": "paper",
    "minConfidence": 60,
    "strictAnalystMode": false,
    "remoteRequired": false
  },
  "strategyConfig": {},
  "evConfig": {
    "minRiskRewardRatio": 1.25,
    "minTradeQualityScore": 45
  },
  "risk": {
    "maxDailyLossPercent": 5,
    "maxOpenPositions": 3
  },
  "sizing": {},
  "fees": {
    "binanceTakerFeeRate": 0.0015,
    "binanceMakerFeeRate": 0.0009
  },
  "simulationWindow": {
    "autoRoundSelectionBudgetSec": 1200
  },
  "maxPositions": 3,
  "timeframes": [
    "1m",
    "5m",
    "15m",
    "1h",
    "4h"
  ]
}
```

### Promotion / Research Gates

| Gate | promoted | status/detail |
| --- | --- | --- |
| promotion-gate | false | RESEARCH_ONLY |
| p1-promotion-gate | false | RESEARCH_ONLY |
| strategy-comparison | false | 07503ff4691831f0 |

### Artifact Envanteri (bu tur)

| dosya | KB |
| --- | --- |
| consensus-trace.json | 90 |
| candidate-trace.json | 88 |
| missed-opportunities.json | 81 |
| scanner-summary.json | 74 |
| opportunity-value.json | 50 |
| ai-progress.json | 41 |
| pump-scan-lifecycle.json | 32 |
| ev-trace.json | 27 |
| transaction-duration.json | 24 |
| errors.json | 16 |
| stage-timings.json | 7 |
| candidate-lifecycle.json | 6 |
| round-summary.json | 5 |
| profitability-experiments.json | 4 |
| selectionTimeBudgetBreakdown.json | 4 |
| tdi-data-quality.json | 4 |
| ev-component-attribution.json | 2 |
| opportunity-funnel.json | 2 |
| p1-promotion-gate.json | 2 |
| promotion-gate.json | 2 |
| single-change-experiments.json | 2 |
| tdi-sensitivity.json | 2 |
| candidate-quality-factors.json | 1 |
| entry-timing-experiment.json | 1 |
| exit-forensics.json | 1 |
| fee-aware-entry-experiment.json | 1 |
| mr-regime-gating-experiment.json | 1 |
| profitability-experiments.csv | 1 |
| promotion-decisions.json | 1 |
| resolved-config.json | 1 |
| round-liveness.json | 1 |
| slot-allocation-experiment.json | 1 |
| strategy-comparison-report.json | 1 |
| volatility-breakout-validation.json | 1 |
| ai-strategy-interaction.json | 0 |
| ai-trace.json | 0 |
| baseline-metrics.json | 0 |
| decision-trace.json | 0 |
| entry-timing.json | 0 |
| ev-calibration.json | 0 |
| execution-trace.json | 0 |
| exit-fee-interaction.json | 0 |
| exit-trace.json | 0 |
| fee-aware-edge-research.json | 0 |
| fee-aware-entry-policy.json | 0 |
| fee-by-hold-time.json | 0 |
| fee-by-strategy.json | 0 |
| gross-positive-net-negative.json | 0 |
| loss-patterns.json | 0 |
| mean-reversion-audit.json | 0 |
| not-discovered-analysis.json | 0 |
| out-of-sample-evaluation.json | 0 |
| pnl-ledger.json | 0 |
| position-trace.json | 0 |
| profit-concentration.json | 0 |
| recovery-decisions.json | 0 |
| recovery-telemetry.json | 0 |
| replay-exit-diagnostics.json | 0 |
| replayExitDiagnostics.json | 0 |
| risk-sizing-trace.json | 0 |
| round-watchdog.json | 0 |
| scanner-qualification.json | 0 |
| slot-allocation-analysis.json | 0 |
| slot-opportunity-report.json | 0 |
| strategy-performance.json | 0 |
| strategy-regime-matrix-p2.csv | 0 |
| strategy-regime-matrix-p2.json | 0 |
| strategy-regime-matrix.json | 0 |
| strategy-trace.json | 0 |
| tdi-decisions.json | 0 |
| tdi-input-contract.json | 0 |
| tdi-missing-telemetry-report.json | 0 |
| trend-following-validation.json | 0 |
| winning-patterns.json | 0 |

---

## Tur #5 — RENDERTRY

### Kimlik & DB

| Alan | Değer |
| --- | --- |
| runId | cmt51eo5m0rajun8gvb31uy4l |
| jobId | cmt4zxkbm001gun8ghz4qsb0w |
| roundNo | 5 |
| state | tur_basarisiz |
| symbol | RENDERTRY |
| startedAt | 2026-08-22T23:56:32.843Z |
| endedAt | 2026-08-23T00:07:11.774Z |
| duration | 10.6 dk |
| selectionAttempt | 2 |
| runtime.step | EXECUTING |
| failReason (DB) | AI_GATE_BLOCK: AI_VETO |
| failReason (artifact) | AI_GATE_BLOCK: AI_VETO |
| exportKind | failed-round-partial |
| exportStatus | COMPLETED |

### round-summary — Özet Metrikler

| Metrik | Değer |
| --- | --- |
| candidateCount | 0 |
| failureCount | 526 |
| tradeCount | 0 |
| fills | 0 |
| grossPnL | 0 |
| fees | 0 |
| netPnl | 0 |
| currentStage | EXECUTING |
| elapsedMs | 407431 |
| selectionBudgetMs | 1200000 |
| lastProgressAt | 2026-08-23T00:03:20.321Z |
| heartbeatAt | 2026-08-23T00:03:20.513Z |

### funnelState — Tam Rejection Haritası

**By stage:**
- scanner: 126
- ai: 119
- consensus: 119
- ev: 98
- candidate: 63
- decision: 1

**By reason (tam liste):**
- REJECTED: 124
- AI_DEGRADED: 119
- CONSENSUS_REJECT: 119
- EV_REJECT: 98
- PUMP_CONFIRM_NO_TRADE: 29
- PUMP_NOT_EARLY_OR_CONTINUATION: 25
- CANDIDATE_REJECTED: 5
- PUMP_SAFETY_FAILED: 4
- SPREAD_TOO_WIDE: 2
- SIM_TIGHT_FILTER: 1

**TDI runtime counters:**

| Counter | Değer |
| --- | --- |
| tdiDecisions | 0 |
| runtimeTdiApproved | 0 |
| runtimeTdiWait | 0 |
| runtimeTdiRejected | 0 |
| upstreamCandidateRejected | 0 |
| hybridRejected | 0 |
| consensusRejected | 119 |
| masterRejected | 0 |
| scannerQualificationRejections | 0 |

### opportunity-funnel — Aşama Kayıpları

| Stage | entered | lost | lostReason | count | % | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| DISCOVERED | 0 | 526 | FILTERED_OUT | 0 | 100 | INSUFFICIENT |
| STRATEGY_QUALIFIED | -126 | 0 | FILTERED_OUT | 0 | 0 | PARTIAL |
| TDI | 0 | 0 | TDI_WAIT | 0 | 0 | PARTIAL |
| AI | 0 | 242 | AI_REJECTED | 242 | 46.01 | PARTIAL |
| RISK | 0 | 0 | RISK | 0 | 0 | PARTIAL |
| EXECUTION | 0 | 0 | EXECUTION_FAILED | 0 | 0 | PARTIAL |

**lossByReason:**

| Reason | count | % |
| --- | --- | --- |
| UNKNOWN | 154 | 29.28 |
| FILTERED_OUT | 130 | 24.71 |
| AI_REJECTED | 242 | 46.01 |

### selectionTimeBudgetBreakdown — Zaman Bütçesi

| Alan | Değer |
| --- | --- |
| selectionBudgetMs | 1200000 |
| totalElapsedMs | 643179 |
| measuredTotalMs | 646393 |
| PRIMARY_TIME_CONSUMER | execution_preparation |

**TOP_5_TIME_CONSUMERS:**

| stage | totalMs | share% |
| --- | --- | --- |
| execution_preparation | 526079 | 43.8% |
| ai_execution | 117100 | 9.8% |
| persistence | 3214 | 0.3% |
| scanner_startup | 0 | 0.0% |
| pump_discovery | 0 | 0.0% |

**Tüm stage satırları:**

| stage | count | totalMs | p50 | p95 | max | budgetShare% |
| --- | --- | --- | --- | --- | --- | --- |
| ai_execution | 119 | 117100 | 509 | 2985 | 3321 | 9.7583 |
| execution_preparation | 1 | 526079 | 526079 | 526079 | 526079 | 43.8399 |
| persistence | 99 | 3214 | 13 | 62 | 91 | 0.2678 |

### scanner-summary — Aggregate

| Metrik | Değer |
| --- | --- |
| scanner cycles | 1 |
| universe (sum) | 773 |
| eligible (sum) | 185 |
| qualified (sum) | 185 |
| rejected (sum) | 588 |
| errors (sum) | 0 |

**Scanner rejection reasons (aggregate):**
- REJECTED: 568
- Data quality issue (PRICE_STALE): 11
- Data quality issue (CHANGE24H_FALLBACK): 3
- Spread too wide: 3
- SPREAD_TOO_WIDE: 3

### errors.json — Failure Özeti

| Alan | Değer |
| --- | --- |
| total failures | 119 |
| artifact failReason | AI_GATE_BLOCK: AI_VETO |

**By stage:**
- ai: 119

**By reasonCode (top 20):**
- AI_DEGRADED: 119

### ai-progress — AI Pool

| Metrik | Değer |
| --- | --- |
| processed | 74 |
| total | 74 |
| successCount | 62 |
| failedCount | 12 |
| timeoutCount | 0 |
| concurrency | 2 |
| duration p50 | 3685 ms |
| duration p95 | 9121 ms |
| duration max | 9841 ms |
| currentCandidate | MUBARAKTRY |
| currentStage | ai |

**Status dağılımı:**
- COMPLETED: 62
- CANCELLED: 12

**Tüm AI candidate satırları:**

| symbol | status | durationMs | retry | provider | completedAt |
| --- | --- | --- | --- | --- | --- |
| SHELLTRY | COMPLETED | 1174 | 0 | provider-1 | 00:00:17 |
| RENDERTRY | COMPLETED | 3587 | 0 | provider-1 | 00:00:19 |
| OGTRY | COMPLETED | 2759 | 0 | provider-1 | 00:00:20 |
| FFTRY | COMPLETED | 2963 | 0 | provider-1 | 00:00:23 |
| NEOTRY | COMPLETED | 2971 | 0 | provider-1 | 00:00:23 |
| NOTTRY | COMPLETED | 2344 | 0 | provider-1 | 00:00:25 |
| PEOPLETRY | COMPLETED | 2529 | 0 | provider-1 | 00:00:26 |
| RAYTRY | COMPLETED | 3430 | 0 | provider-1 | 00:00:29 |
| MMTTRY | COMPLETED | 3685 | 0 | provider-1 | 00:00:30 |
| SPKTRY | COMPLETED | 3309 | 0 | provider-1 | 00:00:32 |
| PORTALTRY | COMPLETED | 3348 | 0 | provider-1 | 00:00:33 |
| SENTTRY | COMPLETED | 3153 | 0 | provider-1 | 00:00:36 |
| REZTRY | COMPLETED | 3598 | 0 | provider-1 | 00:00:37 |
| RARETRY | COMPLETED | 4676 | 0 | provider-1 | 00:00:41 |
| RVNTRY | COMPLETED | 4533 | 0 | provider-1 | 00:00:42 |
| SOPHTRY | COMPLETED | 2433 | 0 | provider-1 | 00:00:43 |
| TAOTRY | COMPLETED | 2845 | 0 | provider-1 | 00:00:45 |
| ORDITRY | COMPLETED | 3326 | 0 | provider-1 | 00:00:47 |
| MORPHOTRY | COMPLETED | 3609 | 0 | provider-1 | 00:00:49 |
| THETATRY | COMPLETED | 3345 | 0 | provider-1 | 00:00:51 |
| REDTRY | COMPLETED | 2684 | 0 | provider-1 | 00:00:52 |
| NILTRY | COMPLETED | 3049 | 0 | provider-1 | 00:00:54 |
| ACETRY | COMPLETED | 3873 | 0 | provider-1 | 00:00:56 |
| DASHTRY | COMPLETED | 3672 | 0 | provider-1 | 00:00:58 |
| NIGHTTRY | COMPLETED | 3949 | 0 | provider-1 | 00:01:00 |
| BABYTRY | COMPLETED | 5542 | 0 | provider-1 | 00:01:04 |
| OPTRY | CANCELLED | 314 | 0 | provider-1 | 00:01:01 |
| PROVETRY | COMPLETED | 4897 | 0 | provider-1 | 00:01:06 |
| SYRUPTRY | COMPLETED | 3263 | 0 | provider-1 | 00:01:07 |
| SUSHITRY | COMPLETED | 3214 | 0 | provider-1 | 00:01:09 |
| MOVRTRY | CANCELLED | 1389 | 0 | provider-1 | 00:01:09 |
| PUMPTRY | COMPLETED | 3372 | 0 | provider-1 | 00:01:12 |
| POLTRY | COMPLETED | 2798 | 0 | provider-1 | 00:01:12 |
| QTUMTRY | CANCELLED | 5465 | 0 | provider-1 | 00:01:18 |
| SIGNTRY | COMPLETED | 4327 | 0 | provider-1 | 00:01:17 |
| RADTRY | CANCELLED | 5605 | 0 | provider-1 | 00:01:23 |
| SOMITRY | CANCELLED | 1865 | 0 | provider-1 | 00:01:20 |
| PIXELTRY | COMPLETED | 4473 | 0 | provider-1 | 00:01:25 |
| RESOLVTRY | COMPLETED | 7025 | 0 | provider-1 | 00:01:30 |
| MITOTRY | CANCELLED | 1854 | 0 | provider-1 | 00:01:27 |
| SPELLTRY | COMPLETED | 9121 | 0 | provider-1 | 00:01:36 |
| SXTTRY | COMPLETED | 9061 | 0 | provider-1 | 00:01:39 |
| MIRATRY | CANCELLED | 1614 | 0 | provider-1 | 00:01:38 |
| ROBOTRY | COMPLETED | 9320 | 0 | provider-1 | 00:01:48 |
| OPNTRY | COMPLETED | 4173 | 0 | provider-1 | 00:01:44 |
| METTRY | CANCELLED | 0 | 0 | provider-1 | 00:01:45 |
| STOTRY | COMPLETED | 8543 | 0 | provider-1 | 00:01:54 |
| STRKTRY | COMPLETED | 8124 | 0 | provider-1 | 00:01:56 |
| ENATRY | COMPLETED | 2794 | 0 | provider-1 | 00:01:57 |
| PENDLETRY | COMPLETED | 5065 | 0 | provider-1 | 00:02:02 |
| ZROTRY | COMPLETED | 3352 | 0 | provider-1 | 00:02:00 |
| METISTRY | CANCELLED | 6041 | 0 | provider-1 | 00:02:06 |
| THETRY | COMPLETED | 7898 | 0 | provider-1 | 00:02:10 |
| SAGATRY | COMPLETED | 2668 | 0 | provider-1 | 00:02:09 |
| PLUMETRY | COMPLETED | 4761 | 0 | provider-1 | 00:02:14 |
| SEITRY | COMPLETED | 8187 | 0 | provider-1 | 00:02:18 |
| METRY | CANCELLED | 6006 | 0 | provider-1 | 00:02:21 |
| STRAXTRY | COMPLETED | 8705 | 0 | provider-1 | 00:02:27 |
| NEARTRY | COMPLETED | 6631 | 0 | provider-1 | 00:02:28 |
| NXPCTRY | COMPLETED | 7636 | 0 | provider-1 | 00:02:35 |
| RETRY | COMPLETED | 7876 | 0 | provider-1 | 00:02:36 |
| TIATRY | COMPLETED | 8166 | 0 | provider-1 | 00:02:43 |
| PENGUTRY | COMPLETED | 7187 | 0 | provider-1 | 00:02:43 |
| SAHARATRY | COMPLETED | 9841 | 0 | provider-1 | 00:02:53 |
| SKYTRY | CANCELLED | 5961 | 0 | provider-1 | 00:02:50 |
| TSTTRY | COMPLETED | 3486 | 0 | provider-1 | 00:02:53 |
| PYTHTRY | COMPLETED | 3020 | 0 | provider-1 | 00:02:57 |
| PEPETRY | COMPLETED | 7039 | 0 | provider-1 | 00:03:01 |
| STXTRY | COMPLETED | 3876 | 0 | provider-1 | 00:03:01 |
| NMRTRY | CANCELLED | 5757 | 0 | provider-1 | 00:03:07 |
| SOLTRY | COMPLETED | 9076 | 0 | provider-1 | 00:03:10 |
| TRUMPTRY | COMPLETED | 2632 | 0 | provider-1 | 00:03:10 |
| ONTTRY | COMPLETED | 9730 | 0 | provider-1 | 00:03:20 |
| MUBARAKTRY | COMPLETED | 2978 | 0 | provider-1 | 00:03:13 |

### Seçilen Sembol Pipeline — RENDERTRY

Decision trace kayıtları: **0** | Consensus: **1** | EV: **1** | Lifecycle: **0** | TDI: **0**

**consensus-trace (seçilen sembol, son 10):**

| timestamp | finalDecision | masterRule | reason | votes |
| --- | --- | --- | --- | --- |
| 00:00:19 | NO_TRADE | NO-TRADE | regime=RANGE_SIDEWAYS, tech=61.17, sentiment=41.42, risk=67. | {"provider-1":"NO_TRADE","provider-3":"H |

**ev-trace (seçilen sembol, son 10):**

| timestamp | verdict | EV | threshold | winProb | RR | reason |
| --- | --- | --- | --- | --- | --- | --- |
| 00:00:19 | REJECTED | 57.8467 | 36 | 44.99 | 1.3333 | EV_REJECT |

### tdi-sensitivity

| Alan | Değer |
| --- | --- |
| currentThreshold | 55 |
| scoreAboveThresholdRate | 0 |
| runtimeApprovalEquivalentRate | 0 |
| runtimeWaitCount | 0 |
| runtimeRejectedCount | 0 |
| recommendation | INSUFFICIENT_DATA |
| productionReplayStatus | INCOMPLETE |

**Score distribution:** min=0 p50=0 p90=0 max=0

### ev-component-attribution

| component | weight | observed | quality |
| --- | --- | --- | --- |
| expectedProfit | 0.35 | 1.7965 | HIGH |
| expectedLoss | 0.25 | -0.603 | HIGH |
| fees | 0.15 | 0 | HIGH |
| winProbability | 0.15 | 28.7108 | HIGH |
| expectedRiskReward | 0.1 | 2.9921 | HIGH |

Dominant component: **winProbability** (sample=119)

### round-liveness (tur sonu snapshot)

| Alan | Değer |
| --- | --- |
| state | "UNKNOWN" |
| currentStage | "EXECUTING" |
| lastMeaningfulProgressAt | "2026-08-23T00:03:20.321Z" |
| meaningfulProgressAgeMs | 236408 |
| lastHeartbeatAt | "2026-08-23T00:03:20.513Z" |
| heartbeatAgeMs | 236216 |
| activeWork | {"scanner":73,"ai":73,"marketData":0} |
| activeRetries | 4 |
| activeCandidates | 1 |
| poolActive | 0 |
| poolQueued | 0 |
| remainingBudgetMs | 792569 |
| abortRequested | false |
| abortReason | null |
| stallDetectedAt | null |
| terminalizationStartedAt | null |
| terminalState | "EXECUTING" |
| terminalizationDurationMs | null |

### round-watchdog

| Alan | Değer |
| --- | --- |
| roundId | "5" |
| runId | "cmt51eo5m0rajun8gvb31uy4l" |
| jobId | "cmt4zxkbm001gun8ghz4qsb0w" |
| lastProgressAt | "2026-08-23T00:03:20.321Z" |
| lastHeartbeatAt | "2026-08-23T00:03:20.513Z" |
| currentStage | "EXECUTING" |
| elapsedSinceProgressMs | 236404 |
| elapsedSinceHeartbeatMs | 236212 |
| decision | "NONE" |
| action | "Legitimate long-running stage" |
| reasonDetail | "Monitoring active position" |
| recordedAt | "2026-08-23T00:07:16.725Z" |

### resolved-config (runtime)

```json
{
  "generatedAt": "2026-08-23T00:07:16.676Z",
  "exchange": "binance",
  "universe": {
    "scannerUniverse": "ALL_SPOT",
    "maxSymbols": 1200,
    "maxCycleSec": 180
  },
  "aiMode": {
    "executionMode": "paper",
    "minConfidence": 60,
    "strictAnalystMode": false,
    "remoteRequired": false
  },
  "strategyConfig": {},
  "evConfig": {
    "minRiskRewardRatio": 1.25,
    "minTradeQualityScore": 45
  },
  "risk": {
    "maxDailyLossPercent": 5,
    "maxOpenPositions": 3
  },
  "sizing": {},
  "fees": {
    "binanceTakerFeeRate": 0.0015,
    "binanceMakerFeeRate": 0.0009
  },
  "simulationWindow": {
    "autoRoundSelectionBudgetSec": 1200
  },
  "maxPositions": 3,
  "timeframes": [
    "1m",
    "5m",
    "15m",
    "1h",
    "4h"
  ]
}
```

### Promotion / Research Gates

| Gate | promoted | status/detail |
| --- | --- | --- |
| promotion-gate | false | RESEARCH_ONLY |
| p1-promotion-gate | false | RESEARCH_ONLY |
| strategy-comparison | false | 07503ff4691831f0 |

### Artifact Envanteri (bu tur)

| dosya | KB |
| --- | --- |
| candidate-trace.json | 186 |
| missed-opportunities.json | 160 |
| consensus-trace.json | 118 |
| opportunity-value.json | 96 |
| scanner-summary.json | 74 |
| ev-trace.json | 51 |
| ai-progress.json | 38 |
| pump-scan-lifecycle.json | 32 |
| errors.json | 29 |
| candidate-lifecycle.json | 24 |
| transaction-duration.json | 24 |
| stage-timings.json | 7 |
| round-summary.json | 5 |
| profitability-experiments.json | 4 |
| selectionTimeBudgetBreakdown.json | 4 |
| tdi-data-quality.json | 4 |
| ev-component-attribution.json | 2 |
| opportunity-funnel.json | 2 |
| p1-promotion-gate.json | 2 |
| promotion-gate.json | 2 |
| single-change-experiments.json | 2 |
| tdi-sensitivity.json | 2 |
| candidate-quality-factors.json | 1 |
| entry-timing-experiment.json | 1 |
| exit-forensics.json | 1 |
| fee-aware-entry-experiment.json | 1 |
| mr-regime-gating-experiment.json | 1 |
| profitability-experiments.csv | 1 |
| promotion-decisions.json | 1 |
| resolved-config.json | 1 |
| round-liveness.json | 1 |
| slot-allocation-experiment.json | 1 |
| strategy-comparison-report.json | 1 |
| volatility-breakout-validation.json | 1 |
| ai-strategy-interaction.json | 0 |
| ai-trace.json | 0 |
| baseline-metrics.json | 0 |
| decision-trace.json | 0 |
| entry-timing.json | 0 |
| ev-calibration.json | 0 |
| execution-trace.json | 0 |
| exit-fee-interaction.json | 0 |
| exit-trace.json | 0 |
| fee-aware-edge-research.json | 0 |
| fee-aware-entry-policy.json | 0 |
| fee-by-hold-time.json | 0 |
| fee-by-strategy.json | 0 |
| gross-positive-net-negative.json | 0 |
| loss-patterns.json | 0 |
| mean-reversion-audit.json | 0 |
| not-discovered-analysis.json | 0 |
| out-of-sample-evaluation.json | 0 |
| pnl-ledger.json | 0 |
| position-trace.json | 0 |
| profit-concentration.json | 0 |
| recovery-decisions.json | 0 |
| recovery-telemetry.json | 0 |
| replay-exit-diagnostics.json | 0 |
| replayExitDiagnostics.json | 0 |
| risk-sizing-trace.json | 0 |
| round-watchdog.json | 0 |
| scanner-qualification.json | 0 |
| slot-allocation-analysis.json | 0 |
| slot-opportunity-report.json | 0 |
| strategy-performance.json | 0 |
| strategy-regime-matrix-p2.csv | 0 |
| strategy-regime-matrix-p2.json | 0 |
| strategy-regime-matrix.json | 0 |
| strategy-trace.json | 0 |
| tdi-decisions.json | 0 |
| tdi-input-contract.json | 0 |
| tdi-missing-telemetry-report.json | 0 |
| trend-following-validation.json | 0 |
| winning-patterns.json | 0 |

---

## Tur #6 — LUNCTRY

### Kimlik & DB

| Alan | Değer |
| --- | --- |
| runId | cmt51sifa0y05un8g57mzms4r |
| jobId | cmt4zxkbm001gun8ghz4qsb0w |
| roundNo | 6 |
| state | tur_basarisiz |
| symbol | LUNCTRY |
| startedAt | 2026-08-23T00:07:18.597Z |
| endedAt | 2026-08-23T00:24:04.203Z |
| duration | 16.8 dk |
| selectionAttempt | 3 |
| runtime.step | SYMBOL_SELECTED |
| failReason (DB) | SIM_TIGHT_FILTER_30m: non-pump kalite dusuk (composite=54.5, sentiment=71.7, mtf=45.5) \| AI role consensus zayif (tech=32.1, sentiment=71.7, risk=59.5) \| momentum/flow zayif (-0.0002, 1.0000) \| Sahte hour-only pump (tape=-0.000%, hour=-0.228%) \| EMA trend uyumsuz (EMA50=0.0026, EMA200=0.0026) \| Hacim yetersiz (0.46x < 1.05x) \| Kalite skoru dusuk (39/100 < 52) |
| failReason (artifact) | SIM_TIGHT_FILTER_30m: non-pump kalite dusuk (composite=54.5, sentiment=71.7, mtf=45.5) \| AI role consensus zayif (tech=32.1, sentiment=71.7, risk=59.5) \| momentum/flow zayif (-0.0002, 1.0000) \| Sahte hour-only pump (tape=-0.000%, hour=-0.228%) \| EMA trend uyumsuz (EMA50=0.0026, EMA200=0.0026) \| Hacim yetersiz (0.46x < 1.05x) \| Kalite skoru dusuk (39/100 < 52) |
| exportKind | failed-round-partial |
| exportStatus | COMPLETED |

### round-summary — Özet Metrikler

| Metrik | Değer |
| --- | --- |
| candidateCount | 0 |
| failureCount | 686 |
| tradeCount | 0 |
| fills | 0 |
| grossPnL | 0 |
| fees | 0 |
| netPnl | 0 |
| currentStage | SYMBOL_SELECTED |
| elapsedMs | 1002893 |
| selectionBudgetMs | 1200000 |
| lastProgressAt | 2026-08-23T00:24:03.186Z |
| heartbeatAt | 2026-08-23T00:24:03.186Z |

### funnelState — Tam Rejection Haritası

**By stage:**
- ai: 171
- consensus: 171
- scanner: 167
- ev: 145
- candidate: 29
- decision: 3

**By reason (tam liste):**
- AI_DEGRADED: 171
- CONSENSUS_REJECT: 171
- REJECTED: 162
- EV_REJECT: 145
- PUMP_CONFIRM_NO_TRADE: 12
- PUMP_NOT_EARLY_OR_CONTINUATION: 7
- CANDIDATE_REJECTED: 5
- PUMP_SAFETY_FAILED: 4
- Data quality issue (CHANGE24H_FALLBACK): 3
- SIM_TIGHT_FILTER: 3
- Data quality issue (PRICE_STALE): 2
- PUMP_SAFETY_FINAL_FAILED: 1

**TDI runtime counters:**

| Counter | Değer |
| --- | --- |
| tdiDecisions | 0 |
| runtimeTdiApproved | 0 |
| runtimeTdiWait | 0 |
| runtimeTdiRejected | 0 |
| upstreamCandidateRejected | 0 |
| hybridRejected | 0 |
| consensusRejected | 171 |
| masterRejected | 0 |
| scannerQualificationRejections | 0 |

### opportunity-funnel — Aşama Kayıpları

| Stage | entered | lost | lostReason | count | % | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| DISCOVERED | 0 | 686 | FILTERED_OUT | 0 | 100 | INSUFFICIENT |
| STRATEGY_QUALIFIED | -167 | 0 | FILTERED_OUT | 0 | 0 | PARTIAL |
| TDI | 0 | 0 | TDI_WAIT | 0 | 0 | PARTIAL |
| AI | 0 | 347 | AI_REJECTED | 347 | 50.58 | PARTIAL |
| RISK | 0 | 0 | RISK | 0 | 0 | PARTIAL |
| EXECUTION | 0 | 0 | EXECUTION_FAILED | 0 | 0 | PARTIAL |

**lossByReason:**

| Reason | count | % |
| --- | --- | --- |
| UNKNOWN | 169 | 24.64 |
| FILTERED_OUT | 170 | 24.78 |
| AI_REJECTED | 347 | 50.58 |

### selectionTimeBudgetBreakdown — Zaman Bütçesi

| Alan | Değer |
| --- | --- |
| selectionBudgetMs | 1200000 |
| totalElapsedMs | 1005704 |
| measuredTotalMs | 1011316 |
| PRIMARY_TIME_CONSUMER | execution_preparation |

**TOP_5_TIME_CONSUMERS:**

| stage | totalMs | share% |
| --- | --- | --- |
| execution_preparation | 895553 | 74.6% |
| ai_execution | 110151 | 9.2% |
| persistence | 5612 | 0.5% |
| scanner_startup | 0 | 0.0% |
| pump_discovery | 0 | 0.0% |

**Tüm stage satırları:**

| stage | count | totalMs | p50 | p95 | max | budgetShare% |
| --- | --- | --- | --- | --- | --- | --- |
| ai_execution | 119 | 110151 | 635 | 2461 | 3672 | 9.1792 |
| execution_preparation | 1 | 895553 | 895553 | 895553 | 895553 | 74.6294 |
| persistence | 99 | 5612 | 58 | 169 | 467 | 0.4677 |

### scanner-summary — Aggregate

| Metrik | Değer |
| --- | --- |
| scanner cycles | 1 |
| universe (sum) | 996 |
| eligible (sum) | 241 |
| qualified (sum) | 241 |
| rejected (sum) | 755 |
| errors (sum) | 0 |

**Scanner rejection reasons (aggregate):**
- REJECTED: 730
- Data quality issue (PRICE_STALE): 13
- Data quality issue (CHANGE24H_FALLBACK): 6
- Spread too wide: 3
- SPREAD_TOO_WIDE: 3

### errors.json — Failure Özeti

| Alan | Değer |
| --- | --- |
| total failures | 171 |
| artifact failReason | SIM_TIGHT_FILTER_30m: non-pump kalite dusuk (composite=54.5, sentiment=71.7, mtf=45.5) \| AI role consensus zayif (tech=32.1, sentiment=71.7, risk=59.5) \| momentum/flow zayif (-0.0002, 1.0000) \| Sahte hour-only pump (tape=-0.000%, hour=-0.228%) \| EMA trend uyumsuz (EMA50=0.0026, EMA200=0.0026) \| Hacim yetersiz (0.46x < 1.05x) \| Kalite skoru dusuk (39/100 < 52) |

**By stage:**
- ai: 171

**By reasonCode (top 20):**
- AI_DEGRADED: 171

### ai-progress — AI Pool

| Metrik | Değer |
| --- | --- |
| processed | 81 |
| total | 81 |
| successCount | 59 |
| failedCount | 22 |
| timeoutCount | 0 |
| concurrency | 2 |
| duration p50 | 3847 ms |
| duration p95 | 10133 ms |
| duration max | 11756 ms |
| currentCandidate | LUNATRY |
| currentStage | ai |

**Status dağılımı:**
- COMPLETED: 59
- CANCELLED: 22

**Tüm AI candidate satırları:**

| symbol | status | durationMs | retry | provider | completedAt |
| --- | --- | --- | --- | --- | --- |
| IOTATRY | COMPLETED | 7070 | 0 | provider-1 | 00:20:57 |
| LAZIOTRY | COMPLETED | 6987 | 0 | provider-1 | 00:20:57 |
| JUVTRY | COMPLETED | 3847 | 0 | provider-1 | 00:21:01 |
| IMXTRY | COMPLETED | 1124 | 0 | provider-1 | 00:20:59 |
| ZROTRY | COMPLETED | 3947 | 0 | provider-1 | 00:21:03 |
| LATRY | COMPLETED | 2631 | 0 | provider-1 | 00:21:05 |
| LPTTRY | COMPLETED | 2673 | 0 | provider-1 | 00:21:06 |
| KATTRY | COMPLETED | 4770 | 0 | provider-1 | 00:21:10 |
| PAXGTRY | COMPLETED | 3792 | 0 | provider-1 | 00:21:10 |
| LAYERTRY | CANCELLED | 5476 | 0 | provider-1 | 00:21:16 |
| SANTOSTRY | COMPLETED | 2184 | 0 | provider-1 | 00:21:13 |
| MEGATRY | COMPLETED | 3200 | 0 | provider-1 | 00:21:16 |
| INJTRY | COMPLETED | 2761 | 0 | provider-1 | 00:21:19 |
| PORTALTRY | COMPLETED | 2852 | 0 | provider-1 | 00:21:19 |
| NEARTRY | COMPLETED | 4066 | 0 | provider-1 | 00:21:23 |
| JASMYTRY | COMPLETED | 3741 | 0 | provider-1 | 00:21:23 |
| PLUMETRY | COMPLETED | 3250 | 0 | provider-1 | 00:21:27 |
| SAPIENTRY | COMPLETED | 1927 | 0 | provider-1 | 00:21:26 |
| PNUTTRY | COMPLETED | 3164 | 0 | provider-1 | 00:21:30 |
| LUNCTRY | COMPLETED | 4148 | 0 | provider-1 | 00:21:32 |
| MANTATRY | COMPLETED | 2388 | 0 | provider-1 | 00:21:32 |
| TRUMPTRY | COMPLETED | 2038 | 0 | provider-1 | 00:21:34 |
| NEIROTRY | COMPLETED | 5139 | 0 | provider-1 | 00:21:38 |
| PENDLETRY | COMPLETED | 4134 | 0 | provider-1 | 00:21:38 |
| STXTRY | COMPLETED | 3406 | 0 | provider-1 | 00:21:42 |
| NILTRY | CANCELLED | 1367 | 0 | provider-1 | 00:21:41 |
| PSGTRY | CANCELLED | 1368 | 0 | provider-1 | 00:21:42 |
| NIGHTTRY | COMPLETED | 3664 | 0 | provider-1 | 00:21:46 |
| MIRATRY | CANCELLED | 1370 | 0 | provider-1 | 00:21:44 |
| SAGATRY | COMPLETED | 5768 | 0 | provider-1 | 00:21:50 |
| ORCATRY | COMPLETED | 2514 | 0 | provider-1 | 00:21:49 |
| MMTTRY | COMPLETED | 6720 | 0 | provider-1 | 00:21:56 |
| OGTRY | COMPLETED | 5938 | 0 | provider-1 | 00:21:57 |
| RAYTRY | CANCELLED | 1907 | 0 | provider-1 | 00:21:58 |
| PUMPTRY | COMPLETED | 2840 | 0 | provider-1 | 00:22:00 |
| SCRTRY | CANCELLED | 5730 | 0 | provider-1 | 00:22:04 |
| RENDERTRY | CANCELLED | 1393 | 0 | provider-1 | 00:22:02 |
| ROBOTRY | COMPLETED | 4757 | 0 | provider-1 | 00:22:07 |
| LINEATRY | COMPLETED | 6405 | 0 | provider-1 | 00:22:11 |
| ROSETRY | COMPLETED | 5334 | 0 | provider-1 | 00:22:12 |
| LTCTRY | COMPLETED | 2726 | 0 | provider-1 | 00:22:14 |
| RVNTRY | COMPLETED | 4980 | 0 | provider-1 | 00:22:18 |
| SEITRY | COMPLETED | 9225 | 0 | provider-1 | 00:22:24 |
| SHIBTRY | COMPLETED | 8555 | 0 | provider-1 | 00:22:27 |
| SANDTRY | CANCELLED | 1503 | 0 | provider-1 | 00:22:25 |
| RESOLVTRY | COMPLETED | 4539 | 0 | provider-1 | 00:22:30 |
| POLYXTRY | CANCELLED | 1435 | 0 | provider-1 | 00:22:28 |
| MANATRY | CANCELLED | 301 | 0 | provider-1 | 00:22:29 |
| OPGTRY | CANCELLED | 1816 | 0 | provider-1 | 00:22:31 |
| MANTRATRY | COMPLETED | 7168 | 0 | provider-1 | 00:22:38 |
| QTUMTRY | CANCELLED | 1471 | 0 | provider-1 | 00:22:33 |
| LISTATRY | CANCELLED | 1068 | 0 | provider-1 | 00:22:34 |
| MINATRY | CANCELLED | 6075 | 0 | provider-1 | 00:22:40 |
| MEMETRY | COMPLETED | 2608 | 0 | provider-1 | 00:22:40 |
| NOTTRY | COMPLETED | 8735 | 0 | provider-1 | 00:22:49 |
| OPNTRY | CANCELLED | 1505 | 0 | provider-1 | 00:22:42 |
| MOVRTRY | CANCELLED | 1 | 0 | provider-1 | 00:22:42 |
| METISTRY | CANCELLED | 5418 | 0 | provider-1 | 00:22:48 |
| MORPHOTRY | CANCELLED | 5859 | 0 | provider-1 | 00:22:54 |
| NEOTRY | COMPLETED | 1881 | 0 | provider-1 | 00:22:51 |
| KSMTRY | CANCELLED | 1817 | 0 | provider-1 | 00:22:53 |
| SHELLTRY | CANCELLED | 1490 | 0 | provider-1 | 00:22:55 |
| LINKTRY | COMPLETED | 6359 | 0 | provider-1 | 00:23:00 |
| NMRTRY | CANCELLED | 5988 | 0 | provider-1 | 00:23:01 |
| KITETRY | COMPLETED | 3672 | 0 | provider-1 | 00:23:05 |
| LDOTRY | COMPLETED | 4937 | 0 | provider-1 | 00:23:06 |
| METRY | COMPLETED | 9519 | 0 | provider-1 | 00:23:15 |
| PEPETRY | COMPLETED | 10133 | 0 | provider-1 | 00:23:17 |
| MUBARAKTRY | COMPLETED | 5119 | 0 | provider-1 | 00:23:21 |
| JUPTRY | COMPLETED | 5616 | 0 | provider-1 | 00:23:24 |
| OGNTRY | COMPLETED | 11400 | 0 | provider-1 | 00:23:34 |
| PEOPLETRY | COMPLETED | 11179 | 0 | provider-1 | 00:23:36 |
| JTOTRY | COMPLETED | 4666 | 0 | provider-1 | 00:23:39 |
| KAITOTRY | COMPLETED | 4997 | 0 | provider-1 | 00:23:41 |
| RONINTRY | CANCELLED | 1381 | 0 | provider-1 | 00:23:40 |
| RETRY | COMPLETED | 11756 | 0 | provider-1 | 00:23:52 |
| PENGUTRY | COMPLETED | 10912 | 0 | provider-1 | 00:23:52 |
| SENTTRY | COMPLETED | 2763 | 0 | provider-1 | 00:23:55 |
| NXPCTRY | COMPLETED | 9263 | 0 | provider-1 | 00:24:02 |
| JOETRY | COMPLETED | 2352 | 0 | provider-1 | 00:23:58 |
| LUNATRY | COMPLETED | 4650 | 0 | provider-1 | 00:24:03 |

### Seçilen Sembol Pipeline — LUNCTRY

Decision trace kayıtları: **0** | Consensus: **2** | EV: **2** | Lifecycle: **1** | TDI: **0**

**consensus-trace (seçilen sembol, son 10):**

| timestamp | finalDecision | masterRule | reason | votes |
| --- | --- | --- | --- | --- |
| 00:16:17 | NO_TRADE | NO-TRADE | regime=LOW_VOLATILITY_CALM, tech=33.91, sentiment=30.92, ris | {"provider-1":"NO_TRADE","provider-3":"H |
| 00:21:31 | NO_TRADE | NO-TRADE | regime=LOW_VOLATILITY_CALM, tech=32.12, sentiment=71.74, ris | {"provider-1":"NO_TRADE","provider-2":"B |

**ev-trace (seçilen sembol, son 10):**

| timestamp | verdict | EV | threshold | winProb | RR | reason |
| --- | --- | --- | --- | --- | --- | --- |
| 00:16:17 | REJECTED | 40.0473 | 36 | 25.86 | 1.3333 | EV_REJECT |
| 00:21:31 | REJECTED | 49.8192 | 36 | 38.35 | 1.3333 | EV_REJECT |

**candidate-lifecycle (seçilen sembol):**

| timestamp | stage | verdict | reasonCode | detail |
| --- | --- | --- | --- | --- |
| 00:24:04 | decision | REJECTED | SIM_TIGHT_FILTER | SIM_TIGHT_FILTER_30m: non-pump kalite dusuk (composite=54.5, sentiment |

### tdi-sensitivity

| Alan | Değer |
| --- | --- |
| currentThreshold | 55 |
| scoreAboveThresholdRate | 0 |
| runtimeApprovalEquivalentRate | 0 |
| runtimeWaitCount | 0 |
| runtimeRejectedCount | 0 |
| recommendation | INSUFFICIENT_DATA |
| productionReplayStatus | INCOMPLETE |

**Score distribution:** min=0 p50=0 p90=0 max=0

### ev-component-attribution

| component | weight | observed | quality |
| --- | --- | --- | --- |
| expectedProfit | 0.35 | 0.9578 | HIGH |
| expectedLoss | 0.25 | -0.6038 | HIGH |
| fees | 0.15 | 0 | HIGH |
| winProbability | 0.15 | 28.3882 | HIGH |
| expectedRiskReward | 0.1 | 1.5944 | HIGH |

Dominant component: **winProbability** (sample=171)

### round-liveness (tur sonu snapshot)

| Alan | Değer |
| --- | --- |
| state | "UNKNOWN" |
| currentStage | "SYMBOL_SELECTED" |
| lastMeaningfulProgressAt | "2026-08-23T00:24:03.186Z" |
| meaningfulProgressAgeMs | 1169 |
| lastHeartbeatAt | "2026-08-23T00:24:03.186Z" |
| heartbeatAgeMs | 1169 |
| activeWork | {"scanner":81,"ai":81,"marketData":0} |
| activeRetries | 2 |
| activeCandidates | 0 |
| poolActive | 0 |
| poolQueued | 0 |
| remainingBudgetMs | 197107 |
| abortRequested | false |
| abortReason | null |
| stallDetectedAt | null |
| terminalizationStartedAt | null |
| terminalState | "SYMBOL_SELECTED" |
| terminalizationDurationMs | null |

### round-watchdog

| Alan | Değer |
| --- | --- |
| roundId | "6" |
| runId | "cmt51sifa0y05un8g57mzms4r" |
| jobId | "cmt4zxkbm001gun8ghz4qsb0w" |
| lastProgressAt | "2026-08-23T00:24:03.186Z" |
| lastHeartbeatAt | "2026-08-23T00:24:03.186Z" |
| currentStage | "SYMBOL_SELECTED" |
| elapsedSinceProgressMs | 1168 |
| elapsedSinceHeartbeatMs | 1168 |
| decision | "NONE" |
| action | "Progress within threshold" |
| reasonDetail | "No action" |
| recordedAt | "2026-08-23T00:24:04.354Z" |

### resolved-config (runtime)

```json
{
  "generatedAt": "2026-08-23T00:24:04.333Z",
  "exchange": "binance",
  "universe": {
    "scannerUniverse": "ALL_SPOT",
    "maxSymbols": 1200,
    "maxCycleSec": 180
  },
  "aiMode": {
    "executionMode": "paper",
    "minConfidence": 60,
    "strictAnalystMode": false,
    "remoteRequired": false
  },
  "strategyConfig": {},
  "evConfig": {
    "minRiskRewardRatio": 1.25,
    "minTradeQualityScore": 45
  },
  "risk": {
    "maxDailyLossPercent": 5,
    "maxOpenPositions": 3
  },
  "sizing": {},
  "fees": {
    "binanceTakerFeeRate": 0.0015,
    "binanceMakerFeeRate": 0.0009
  },
  "simulationWindow": {
    "autoRoundSelectionBudgetSec": 1200
  },
  "maxPositions": 3,
  "timeframes": [
    "1m",
    "5m",
    "15m",
    "1h",
    "4h"
  ]
}
```

### Promotion / Research Gates

| Gate | promoted | status/detail |
| --- | --- | --- |
| promotion-gate | false | RESEARCH_ONLY |
| p1-promotion-gate | false | RESEARCH_ONLY |
| strategy-comparison | false | 07503ff4691831f0 |

### Artifact Envanteri (bu tur)

| dosya | KB |
| --- | --- |
| candidate-trace.json | 219 |
| missed-opportunities.json | 203 |
| consensus-trace.json | 145 |
| opportunity-value.json | 124 |
| scanner-summary.json | 75 |
| ev-trace.json | 73 |
| ai-progress.json | 45 |
| errors.json | 42 |
| pump-scan-lifecycle.json | 33 |
| transaction-duration.json | 24 |
| candidate-lifecycle.json | 15 |
| stage-timings.json | 8 |
| round-summary.json | 5 |
| profitability-experiments.json | 4 |
| selectionTimeBudgetBreakdown.json | 4 |
| tdi-data-quality.json | 4 |
| ev-component-attribution.json | 2 |
| opportunity-funnel.json | 2 |
| p1-promotion-gate.json | 2 |
| promotion-gate.json | 2 |
| single-change-experiments.json | 2 |
| tdi-sensitivity.json | 2 |
| candidate-quality-factors.json | 1 |
| entry-timing-experiment.json | 1 |
| exit-forensics.json | 1 |
| fee-aware-entry-experiment.json | 1 |
| mr-regime-gating-experiment.json | 1 |
| profitability-experiments.csv | 1 |
| promotion-decisions.json | 1 |
| resolved-config.json | 1 |
| round-liveness.json | 1 |
| slot-allocation-experiment.json | 1 |
| strategy-comparison-report.json | 1 |
| volatility-breakout-validation.json | 1 |
| ai-strategy-interaction.json | 0 |
| ai-trace.json | 0 |
| baseline-metrics.json | 0 |
| decision-trace.json | 0 |
| entry-timing.json | 0 |
| ev-calibration.json | 0 |
| execution-trace.json | 0 |
| exit-fee-interaction.json | 0 |
| exit-trace.json | 0 |
| fee-aware-edge-research.json | 0 |
| fee-aware-entry-policy.json | 0 |
| fee-by-hold-time.json | 0 |
| fee-by-strategy.json | 0 |
| gross-positive-net-negative.json | 0 |
| loss-patterns.json | 0 |
| mean-reversion-audit.json | 0 |
| not-discovered-analysis.json | 0 |
| out-of-sample-evaluation.json | 0 |
| pnl-ledger.json | 0 |
| position-trace.json | 0 |
| profit-concentration.json | 0 |
| recovery-decisions.json | 0 |
| recovery-telemetry.json | 0 |
| replay-exit-diagnostics.json | 0 |
| replayExitDiagnostics.json | 0 |
| risk-sizing-trace.json | 0 |
| round-watchdog.json | 0 |
| scanner-qualification.json | 0 |
| slot-allocation-analysis.json | 0 |
| slot-opportunity-report.json | 0 |
| strategy-performance.json | 0 |
| strategy-regime-matrix-p2.csv | 0 |
| strategy-regime-matrix-p2.json | 0 |
| strategy-regime-matrix.json | 0 |
| strategy-trace.json | 0 |
| tdi-decisions.json | 0 |
| tdi-input-contract.json | 0 |
| tdi-missing-telemetry-report.json | 0 |
| trend-following-validation.json | 0 |
| winning-patterns.json | 0 |

---

## Tur #7 — PORTALTRY

### Kimlik & DB

| Alan | Değer |
| --- | --- |
| runId | cmt52e2kl189lun8gc1z2xj2q |
| jobId | cmt4zxkbm001gun8ghz4qsb0w |
| roundNo | 7 |
| state | tur_basarisiz |
| symbol | PORTALTRY |
| startedAt | 2026-08-23T00:24:04.485Z |
| endedAt | 2026-08-23T00:29:16.680Z |
| duration | 5.2 dk |
| selectionAttempt | 1 |
| runtime.step | EXECUTING |
| failReason (DB) | AI_GATE_BLOCK: AI_VETO |
| failReason (artifact) | AI_GATE_BLOCK: AI_VETO |
| exportKind | failed-round-partial |
| exportStatus | COMPLETED |

### round-summary — Özet Metrikler

| Metrik | Değer |
| --- | --- |
| candidateCount | 0 |
| failureCount | 145 |
| tradeCount | 0 |
| fills | 0 |
| grossPnL | 0 |
| fees | 0 |
| netPnl | 0 |
| currentStage | EXECUTING |
| elapsedMs | 308384 |
| selectionBudgetMs | 1200000 |
| lastProgressAt | 2026-08-23T00:29:12.936Z |
| heartbeatAt | 2026-08-23T00:29:14.491Z |

### funnelState — Tam Rejection Haritası

**By stage:**
- scanner: 37
- ai: 32
- consensus: 31
- ev: 26
- candidate: 19

**By reason (tam liste):**
- AI_DEGRADED: 31
- CONSENSUS_REJECT: 31
- REJECTED: 30
- EV_REJECT: 26
- PUMP_CONFIRM_NO_TRADE: 9
- PUMP_NOT_EARLY_OR_CONTINUATION: 8
- Data quality issue (PRICE_STALE): 7
- CANDIDATE_REJECTED: 1
- AI_FAILED: 1
- PUMP_SAFETY_FINAL_FAILED: 1

**TDI runtime counters:**

| Counter | Değer |
| --- | --- |
| tdiDecisions | 0 |
| runtimeTdiApproved | 0 |
| runtimeTdiWait | 0 |
| runtimeTdiRejected | 0 |
| upstreamCandidateRejected | 0 |
| hybridRejected | 0 |
| consensusRejected | 31 |
| masterRejected | 0 |
| scannerQualificationRejections | 0 |

### opportunity-funnel — Aşama Kayıpları

| Stage | entered | lost | lostReason | count | % | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| DISCOVERED | 0 | 145 | FILTERED_OUT | 0 | 100 | INSUFFICIENT |
| STRATEGY_QUALIFIED | -37 | 0 | FILTERED_OUT | 0 | 0 | PARTIAL |
| TDI | 0 | 0 | TDI_WAIT | 0 | 0 | PARTIAL |
| AI | 0 | 64 | AI_REJECTED | 64 | 44.14 | PARTIAL |
| RISK | 0 | 0 | RISK | 0 | 0 | PARTIAL |
| EXECUTION | 0 | 0 | EXECUTION_FAILED | 0 | 0 | PARTIAL |

**lossByReason:**

| Reason | count | % |
| --- | --- | --- |
| UNKNOWN | 50 | 34.48 |
| FILTERED_OUT | 31 | 21.38 |
| AI_REJECTED | 64 | 44.14 |

### selectionTimeBudgetBreakdown — Zaman Bütçesi

| Alan | Değer |
| --- | --- |
| selectionBudgetMs | 1200000 |
| totalElapsedMs | 312369 |
| measuredTotalMs | 341501 |
| PRIMARY_TIME_CONSUMER | ai_execution |

**TOP_5_TIME_CONSUMERS:**

| stage | totalMs | share% |
| --- | --- | --- |
| ai_execution | 250274 | 20.9% |
| execution_preparation | 62095 | 5.2% |
| persistence | 29132 | 2.4% |
| scanner_startup | 0 | 0.0% |
| pump_discovery | 0 | 0.0% |

**Tüm stage satırları:**

| stage | count | totalMs | p50 | p95 | max | budgetShare% |
| --- | --- | --- | --- | --- | --- | --- |
| ai_execution | 119 | 250274 | 814 | 3328 | 108344 | 20.8562 |
| execution_preparation | 1 | 62095 | 62095 | 62095 | 62095 | 5.1746 |
| persistence | 99 | 29132 | 59 | 943 | 12546 | 2.4277 |

### scanner-summary — Aggregate

| Metrik | Değer |
| --- | --- |
| scanner cycles | 1 |
| universe (sum) | 1042 |
| eligible (sum) | 250 |
| qualified (sum) | 250 |
| rejected (sum) | 792 |
| errors (sum) | 0 |

**Scanner rejection reasons (aggregate):**
- REJECTED: 760
- Data quality issue (PRICE_STALE): 20
- Data quality issue (CHANGE24H_FALLBACK): 6
- Spread too wide: 3
- SPREAD_TOO_WIDE: 3

### errors.json — Failure Özeti

| Alan | Değer |
| --- | --- |
| total failures | 32 |
| artifact failReason | AI_GATE_BLOCK: AI_VETO |

**By stage:**
- ai: 32

**By reasonCode (top 20):**
- AI_DEGRADED: 31
- AI_FAILED: 1

### ai-progress — AI Pool

| Metrik | Değer |
| --- | --- |
| processed | 46 |
| total | 90 |
| successCount | 37 |
| failedCount | 9 |
| timeoutCount | 0 |
| concurrency | 2 |
| duration p50 | 4388 ms |
| duration p95 | 12777 ms |
| duration max | 42025 ms |
| currentCandidate | ZBTTRY |
| currentStage | ai |

**Status dağılımı:**
- COMPLETED: 37
- CANCELLED: 9

**Tüm AI candidate satırları:**

| symbol | status | durationMs | retry | provider | completedAt |
| --- | --- | --- | --- | --- | --- |
| TOMOTRY | COMPLETED | 2594 | 0 | provider-1 | 00:24:41 |
| FRONTTRY | COMPLETED | 1905 | 0 | provider-1 | 00:24:40 |
| PORTALTRY | COMPLETED | 3795 | 0 | provider-1 | 00:24:44 |
| USDTTRY | COMPLETED | 4138 | 0 | provider-1 | 00:24:45 |
| UTRY | COMPLETED | 3929 | 0 | provider-1 | 00:24:48 |
| WAVESTRY | COMPLETED | 841 | 0 | provider-1 | 00:24:46 |
| EOSTRY | COMPLETED | 1265 | 0 | provider-1 | 00:24:48 |
| BABYTRY | COMPLETED | 2428 | 0 | provider-1 | 00:24:51 |
| XAUTTRY | COMPLETED | 3374 | 0 | provider-1 | 00:24:52 |
| USDCTRY | COMPLETED | 8343 | 0 | provider-1 | 00:24:59 |
| RNDRTRY | COMPLETED | 8196 | 0 | provider-1 | 00:25:00 |
| TONTRY | COMPLETED | 2816 | 0 | provider-1 | 00:25:04 |
| POLTRY | COMPLETED | 4388 | 0 | provider-1 | 00:25:06 |
| ENATRY | COMPLETED | 4290 | 0 | provider-1 | 00:25:09 |
| SPKTRY | COMPLETED | 3912 | 0 | provider-1 | 00:25:10 |
| IMXTRY | COMPLETED | 3107 | 0 | provider-1 | 00:25:12 |
| SUSHITRY | COMPLETED | 5443 | 0 | provider-1 | 00:25:16 |
| EGLDTRY | COMPLETED | 4463 | 0 | provider-1 | 00:25:17 |
| 1000CATTRY | COMPLETED | 4660 | 0 | provider-1 | 00:25:22 |
| XVGTRY | COMPLETED | 3896 | 0 | provider-1 | 00:25:22 |
| ZKTRY | COMPLETED | 12777 | 0 | provider-1 | 00:25:35 |
| USUALTRY | CANCELLED | 2517 | 0 | provider-1 | 00:25:25 |
| VETTRY | COMPLETED | 11857 | 0 | provider-1 | 00:25:37 |
| STRY | CANCELLED | 1059 | 0 | provider-1 | 00:25:38 |
| TNSRTRY | CANCELLED | 6841 | 0 | provider-1 | 00:25:44 |
| FFTRY | COMPLETED | 10681 | 0 | provider-1 | 00:25:49 |
| ZROTRY | CANCELLED | 1600 | 0 | provider-1 | 00:25:46 |
| THETRY | COMPLETED | 10031 | 0 | provider-1 | 00:25:56 |
| PYTHTRY | CANCELLED | 7925 | 0 | provider-1 | 00:25:57 |
| ACMTRY | CANCELLED | 7776 | 0 | provider-1 | 00:26:04 |
| XAITRY | COMPLETED | 11436 | 0 | provider-1 | 00:26:09 |
| TWTTRY | COMPLETED | 9803 | 0 | provider-1 | 00:26:14 |
| XECTRY | COMPLETED | 4060 | 0 | provider-1 | 00:26:13 |
| SKLTRY | COMPLETED | 5233 | 0 | provider-1 | 00:26:19 |
| TRBTRY | COMPLETED | 1977 | 0 | provider-1 | 00:26:17 |
| SYRUPTRY | COMPLETED | 5133 | 0 | provider-1 | 00:26:22 |
| TRUMPTRY | COMPLETED | 1970 | 0 | provider-1 | 00:26:21 |
| 2ZTRY | COMPLETED | 11449 | 0 | provider-1 | 00:26:33 |
| YBTRY | CANCELLED | 7288 | 0 | provider-1 | 00:26:30 |
| SNXTRY | COMPLETED | 5753 | 0 | provider-1 | 00:26:36 |
| ZKPTRY | CANCELLED | 8016 | 0 | provider-1 | 00:26:42 |
| TSTTRY | COMPLETED | 3516 | 0 | provider-1 | 00:26:39 |
| UNITRY | COMPLETED | 3402 | 0 | provider-1 | 00:26:43 |
| TLMTRY | COMPLETED | 42025 | 0 | provider-1 | 00:27:24 |
| XRPTRY | COMPLETED | 4227 | 0 | provider-1 | 00:26:48 |
| ZBTTRY | CANCELLED | 17225 | 0 | provider-1 | 00:27:05 |

### Seçilen Sembol Pipeline — PORTALTRY

Decision trace kayıtları: **0** | Consensus: **2** | EV: **2** | Lifecycle: **8** | TDI: **0**

**consensus-trace (seçilen sembol, son 10):**

| timestamp | finalDecision | masterRule | reason | votes |
| --- | --- | --- | --- | --- |
| 00:24:44 | NO_TRADE | NO-TRADE | regime=HIGH_VOLATILITY_CHAOS, tech=54.50, sentiment=51.86, r | {"provider-1":"NO_TRADE","provider-3":"N |
| 00:29:12 | NO_TRADE | NO-TRADE | regime=HIGH_VOLATILITY_CHAOS, tech=65.06, sentiment=70.13, r | {"provider-1":"BUY","provider-3":"NO_TRA |

**ev-trace (seçilen sembol, son 10):**

| timestamp | verdict | EV | threshold | winProb | RR | reason |
| --- | --- | --- | --- | --- | --- | --- |
| 00:24:44 | REJECTED | 52.7714 | 36 | 12.58 | 1.3333 | EV_REJECT |
| 00:29:12 | REJECTED | 63.4784 | 36 | 17.59 | 23.3029 | EV_REJECT |

**candidate-lifecycle (seçilen sembol):**

| timestamp | stage | verdict | reasonCode | detail |
| --- | --- | --- | --- | --- |
| 00:27:26 | candidate | REJECTED | PUMP_NOT_EARLY_OR_CONTINUATION | Candidate failed early/continuation gate |
| 00:27:26 | candidate | REJECTED | PUMP_CONFIRM_NO_TRADE | Pump confirmation NO_TRADE (early) |
| 00:28:23 | candidate | REJECTED | PUMP_NOT_EARLY_OR_CONTINUATION | Candidate failed early/continuation gate |
| 00:28:23 | candidate | REJECTED | PUMP_CONFIRM_NO_TRADE | Pump confirmation NO_TRADE (continuation) |
| 00:28:23 | candidate | REJECTED | PUMP_NOT_EARLY_OR_CONTINUATION | Candidate failed early/continuation gate |
| 00:28:23 | candidate | REJECTED | PUMP_CONFIRM_NO_TRADE | Pump confirmation NO_TRADE (continuation) |
| 00:29:12 | candidate | REJECTED | PUMP_SAFETY_FINAL_FAILED | Chaos rejiminde pullback riski (15dk=3.38%, red5=2, tape=0.53%) |
| 00:29:12 | candidate | REJECTED | PUMP_CONFIRM_NO_TRADE | Pump confirmation NO_TRADE (continuation) |

### tdi-sensitivity

| Alan | Değer |
| --- | --- |
| currentThreshold | 55 |
| scoreAboveThresholdRate | 0 |
| runtimeApprovalEquivalentRate | 0 |
| runtimeWaitCount | 0 |
| runtimeRejectedCount | 0 |
| recommendation | INSUFFICIENT_DATA |
| productionReplayStatus | INCOMPLETE |

**Score distribution:** min=0 p50=0 p90=0 max=0

### ev-component-attribution

| component | weight | observed | quality |
| --- | --- | --- | --- |
| expectedProfit | 0.35 | 4.5176 | HIGH |
| expectedLoss | 0.25 | -0.6 | HIGH |
| fees | 0.15 | 0 | HIGH |
| winProbability | 0.15 | 33.3184 | HIGH |
| expectedRiskReward | 0.1 | 7.5292 | HIGH |

Dominant component: **winProbability** (sample=31)

### round-liveness (tur sonu snapshot)

| Alan | Değer |
| --- | --- |
| state | "UNKNOWN" |
| currentStage | "EXECUTING" |
| lastMeaningfulProgressAt | "2026-08-23T00:29:12.936Z" |
| meaningfulProgressAgeMs | 4689 |
| lastHeartbeatAt | "2026-08-23T00:29:14.491Z" |
| heartbeatAgeMs | 3134 |
| activeWork | {"scanner":44,"ai":44,"marketData":0} |
| activeRetries | 1 |
| activeCandidates | 46 |
| poolActive | 0 |
| poolQueued | 0 |
| remainingBudgetMs | 891616 |
| abortRequested | false |
| abortReason | null |
| stallDetectedAt | null |
| terminalizationStartedAt | null |
| terminalState | "EXECUTING" |
| terminalizationDurationMs | null |

### round-watchdog

| Alan | Değer |
| --- | --- |
| roundId | "7" |
| runId | "cmt52e2kl189lun8gc1z2xj2q" |
| jobId | "cmt4zxkbm001gun8ghz4qsb0w" |
| lastProgressAt | "2026-08-23T00:29:12.936Z" |
| lastHeartbeatAt | "2026-08-23T00:29:14.491Z" |
| currentStage | "EXECUTING" |
| elapsedSinceProgressMs | 4685 |
| elapsedSinceHeartbeatMs | 3130 |
| decision | "NONE" |
| action | "Legitimate long-running stage" |
| reasonDetail | "Monitoring active position" |
| recordedAt | "2026-08-23T00:29:17.621Z" |

### resolved-config (runtime)

```json
{
  "generatedAt": "2026-08-23T00:29:17.547Z",
  "exchange": "binance",
  "universe": {
    "scannerUniverse": "ALL_SPOT",
    "maxSymbols": 1200,
    "maxCycleSec": 180
  },
  "aiMode": {
    "executionMode": "paper",
    "minConfidence": 60,
    "strictAnalystMode": false,
    "remoteRequired": false
  },
  "strategyConfig": {},
  "evConfig": {
    "minRiskRewardRatio": 1.25,
    "minTradeQualityScore": 45
  },
  "risk": {
    "maxDailyLossPercent": 5,
    "maxOpenPositions": 3
  },
  "sizing": {},
  "fees": {
    "binanceTakerFeeRate": 0.0015,
    "binanceMakerFeeRate": 0.0009
  },
  "simulationWindow": {
    "autoRoundSelectionBudgetSec": 1200
  },
  "maxPositions": 3,
  "timeframes": [
    "1m",
    "5m",
    "15m",
    "1h",
    "4h"
  ]
}
```

### Promotion / Research Gates

| Gate | promoted | status/detail |
| --- | --- | --- |
| promotion-gate | false | RESEARCH_ONLY |
| p1-promotion-gate | false | RESEARCH_ONLY |
| strategy-comparison | false | 07503ff4691831f0 |

### Artifact Envanteri (bu tur)

| dosya | KB |
| --- | --- |
| scanner-summary.json | 75 |
| consensus-trace.json | 73 |
| candidate-trace.json | 54 |
| missed-opportunities.json | 45 |
| pump-scan-lifecycle.json | 33 |
| opportunity-value.json | 27 |
| ai-progress.json | 24 |
| transaction-duration.json | 24 |
| ev-trace.json | 13 |
| candidate-lifecycle.json | 8 |
| errors.json | 8 |
| stage-timings.json | 7 |
| round-summary.json | 5 |
| profitability-experiments.json | 4 |
| selectionTimeBudgetBreakdown.json | 4 |
| tdi-data-quality.json | 4 |
| opportunity-funnel.json | 2 |
| p1-promotion-gate.json | 2 |
| promotion-gate.json | 2 |
| single-change-experiments.json | 2 |
| tdi-sensitivity.json | 2 |
| candidate-quality-factors.json | 1 |
| entry-timing-experiment.json | 1 |
| ev-component-attribution.json | 1 |
| exit-forensics.json | 1 |
| fee-aware-entry-experiment.json | 1 |
| mr-regime-gating-experiment.json | 1 |
| profitability-experiments.csv | 1 |
| promotion-decisions.json | 1 |
| resolved-config.json | 1 |
| round-liveness.json | 1 |
| slot-allocation-experiment.json | 1 |
| strategy-comparison-report.json | 1 |
| volatility-breakout-validation.json | 1 |
| ai-strategy-interaction.json | 0 |
| ai-trace.json | 0 |
| baseline-metrics.json | 0 |
| decision-trace.json | 0 |
| entry-timing.json | 0 |
| ev-calibration.json | 0 |
| execution-trace.json | 0 |
| exit-fee-interaction.json | 0 |
| exit-trace.json | 0 |
| fee-aware-edge-research.json | 0 |
| fee-aware-entry-policy.json | 0 |
| fee-by-hold-time.json | 0 |
| fee-by-strategy.json | 0 |
| gross-positive-net-negative.json | 0 |
| loss-patterns.json | 0 |
| mean-reversion-audit.json | 0 |
| not-discovered-analysis.json | 0 |
| out-of-sample-evaluation.json | 0 |
| pnl-ledger.json | 0 |
| position-trace.json | 0 |
| profit-concentration.json | 0 |
| recovery-decisions.json | 0 |
| recovery-telemetry.json | 0 |
| replay-exit-diagnostics.json | 0 |
| replayExitDiagnostics.json | 0 |
| risk-sizing-trace.json | 0 |
| round-watchdog.json | 0 |
| scanner-qualification.json | 0 |
| slot-allocation-analysis.json | 0 |
| slot-opportunity-report.json | 0 |
| strategy-performance.json | 0 |
| strategy-regime-matrix-p2.csv | 0 |
| strategy-regime-matrix-p2.json | 0 |
| strategy-regime-matrix.json | 0 |
| strategy-trace.json | 0 |
| tdi-decisions.json | 0 |
| tdi-input-contract.json | 0 |
| tdi-missing-telemetry-report.json | 0 |
| trend-following-validation.json | 0 |
| winning-patterns.json | 0 |

---

## Tur #8 — CHZTRY

### Kimlik & DB

| Alan | Değer |
| --- | --- |
| runId | cmt52ksck1aogun8gyfzo1i42 |
| jobId | cmt4zxkbm001gun8ghz4qsb0w |
| roundNo | 8 |
| state | tur_basarisiz |
| symbol | CHZTRY |
| startedAt | 2026-08-23T00:29:17.829Z |
| endedAt | 2026-08-23T00:42:06.242Z |
| duration | 12.8 dk |
| selectionAttempt | 1 |
| runtime.step | EXECUTING |
| failReason (DB) | AI_GATE_BLOCK: AI_VETO |
| failReason (artifact) | AI_GATE_BLOCK: AI_VETO |
| exportKind | failed-round-partial |
| exportStatus | COMPLETED |

### round-summary — Özet Metrikler

| Metrik | Değer |
| --- | --- |
| candidateCount | 0 |
| failureCount | 292 |
| tradeCount | 0 |
| fills | 0 |
| grossPnL | 0 |
| fees | 0 |
| netPnl | 0 |
| currentStage | EXECUTING |
| elapsedMs | 516221 |
| selectionBudgetMs | 1200000 |
| lastProgressAt | 2026-08-23T00:37:54.133Z |
| heartbeatAt | 2026-08-23T00:37:54.772Z |

### funnelState — Tam Rejection Haritası

**By stage:**
- scanner: 76
- ai: 72
- consensus: 70
- ev: 46
- candidate: 28

**By reason (tam liste):**
- REJECTED: 76
- AI_DEGRADED: 72
- CONSENSUS_REJECT: 70
- EV_REJECT: 46
- PUMP_CONFIRM_NO_TRADE: 10
- CANDIDATE_REJECTED: 8
- PUMP_NOT_EARLY_OR_CONTINUATION: 5
- PUMP_SAFETY_FAILED: 2
- PUMP_SAFETY_FINAL_FAILED: 2
- PUMP_CONFIRM_FAILED: 1

**TDI runtime counters:**

| Counter | Değer |
| --- | --- |
| tdiDecisions | 0 |
| runtimeTdiApproved | 0 |
| runtimeTdiWait | 0 |
| runtimeTdiRejected | 0 |
| upstreamCandidateRejected | 0 |
| hybridRejected | 0 |
| consensusRejected | 70 |
| masterRejected | 0 |
| scannerQualificationRejections | 0 |

### opportunity-funnel — Aşama Kayıpları

| Stage | entered | lost | lostReason | count | % | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| DISCOVERED | 0 | 292 | FILTERED_OUT | 0 | 100 | INSUFFICIENT |
| STRATEGY_QUALIFIED | -76 | 0 | FILTERED_OUT | 0 | 0 | PARTIAL |
| TDI | 0 | 0 | TDI_WAIT | 0 | 0 | PARTIAL |
| AI | 0 | 147 | AI_REJECTED | 147 | 50.34 | PARTIAL |
| RISK | 0 | 0 | RISK | 0 | 0 | PARTIAL |
| EXECUTION | 0 | 0 | EXECUTION_FAILED | 0 | 0 | PARTIAL |

**lossByReason:**

| Reason | count | % |
| --- | --- | --- |
| AI_REJECTED | 147 | 50.34 |
| FILTERED_OUT | 84 | 28.77 |
| UNKNOWN | 61 | 20.89 |

### selectionTimeBudgetBreakdown — Zaman Bütçesi

| Alan | Değer |
| --- | --- |
| selectionBudgetMs | 1200000 |
| totalElapsedMs | 768941 |
| measuredTotalMs | 781824 |
| PRIMARY_TIME_CONSUMER | execution_preparation |

**TOP_5_TIME_CONSUMERS:**

| stage | totalMs | share% |
| --- | --- | --- |
| execution_preparation | 615627 | 51.3% |
| ai_execution | 153314 | 12.8% |
| persistence | 12883 | 1.1% |
| scanner_startup | 0 | 0.0% |
| pump_discovery | 0 | 0.0% |

**Tüm stage satırları:**

| stage | count | totalMs | p50 | p95 | max | budgetShare% |
| --- | --- | --- | --- | --- | --- | --- |
| ai_execution | 119 | 153314 | 728 | 3299 | 17335 | 12.7762 |
| execution_preparation | 1 | 615627 | 615627 | 615627 | 615627 | 51.3023 |
| persistence | 99 | 12883 | 60 | 332 | 4351 | 1.0736 |

### scanner-summary — Aggregate

| Metrik | Değer |
| --- | --- |
| scanner cycles | 1 |
| universe (sum) | 1125 |
| eligible (sum) | 257 |
| qualified (sum) | 257 |
| rejected (sum) | 868 |
| errors (sum) | 0 |

**Scanner rejection reasons (aggregate):**
- REJECTED: 836
- Data quality issue (PRICE_STALE): 20
- Data quality issue (CHANGE24H_FALLBACK): 6
- Spread too wide: 3
- SPREAD_TOO_WIDE: 3

### errors.json — Failure Özeti

| Alan | Değer |
| --- | --- |
| total failures | 73 |
| artifact failReason | AI_GATE_BLOCK: AI_VETO |

**By stage:**
- ai: 72
- candidate: 1

**By reasonCode (top 20):**
- AI_DEGRADED: 72
- PUMP_CONFIRM_FAILED: 1

### ai-progress — AI Pool

| Metrik | Değer |
| --- | --- |
| processed | 83 |
| total | 83 |
| successCount | 69 |
| failedCount | 14 |
| timeoutCount | 0 |
| concurrency | 2 |
| duration p50 | 7107 ms |
| duration p95 | 13185 ms |
| duration max | 14502 ms |
| currentCandidate | STXTRY |
| currentStage | ai |

**Status dağılımı:**
- COMPLETED: 69
- CANCELLED: 14

**Tüm AI candidate satırları:**

| symbol | status | durationMs | retry | provider | completedAt |
| --- | --- | --- | --- | --- | --- |
| PORTALTRY | CANCELLED | 1306 | 0 | provider-1 | 00:32:12 |
| ENATRY | COMPLETED | 4309 | 0 | provider-1 | 00:32:16 |
| JUPTRY | COMPLETED | 4131 | 0 | provider-1 | 00:32:17 |
| ENSTRY | COMPLETED | 3750 | 0 | provider-1 | 00:32:20 |
| CHZTRY | COMPLETED | 4408 | 0 | provider-1 | 00:32:22 |
| GIGGLETRY | COMPLETED | 6855 | 0 | provider-1 | 00:32:27 |
| FFTRY | COMPLETED | 4814 | 0 | provider-1 | 00:32:27 |
| GMTTRY | COMPLETED | 6115 | 0 | provider-1 | 00:32:34 |
| HYPERTRY | COMPLETED | 5942 | 0 | provider-1 | 00:32:34 |
| POLTRY | COMPLETED | 13185 | 0 | provider-1 | 00:32:49 |
| BERATRY | CANCELLED | 1 | 0 | provider-1 | 00:32:36 |
| DASHTRY | COMPLETED | 2493 | 0 | provider-1 | 00:32:39 |
| IDTRY | COMPLETED | 13263 | 0 | provider-1 | 00:32:52 |
| BEAMXTRY | COMPLETED | 5043 | 0 | provider-1 | 00:32:54 |
| ERATRY | COMPLETED | 2688 | 0 | provider-1 | 00:32:57 |
| FILTRY | COMPLETED | 3022 | 0 | provider-1 | 00:32:59 |
| BMTTRY | COMPLETED | 6931 | 0 | provider-1 | 00:33:05 |
| DODOTRY | COMPLETED | 7161 | 0 | provider-1 | 00:33:06 |
| BBTRY | COMPLETED | 2883 | 0 | provider-1 | 00:33:08 |
| CFGTRY | COMPLETED | 13376 | 0 | provider-1 | 00:33:20 |
| DOTTRY | COMPLETED | 11852 | 0 | provider-1 | 00:33:21 |
| COTITRY | COMPLETED | 4471 | 0 | provider-1 | 00:33:28 |
| BANKTRY | COMPLETED | 6379 | 0 | provider-1 | 00:33:30 |
| EGLDTRY | COMPLETED | 4405 | 0 | provider-1 | 00:33:33 |
| FLOKITRY | COMPLETED | 8609 | 0 | provider-1 | 00:33:41 |
| HMSTRTRY | COMPLETED | 9003 | 0 | provider-1 | 00:33:43 |
| HBARTRY | COMPLETED | 7563 | 0 | provider-1 | 00:33:49 |
| FDUSDTRY | COMPLETED | 9019 | 0 | provider-1 | 00:33:53 |
| HOTTRY | COMPLETED | 9195 | 0 | provider-1 | 00:33:58 |
| JASMYTRY | COMPLETED | 8545 | 0 | provider-1 | 00:34:01 |
| DYDXTRY | COMPLETED | 10671 | 0 | provider-1 | 00:34:09 |
| CATITRY | CANCELLED | 9716 | 0 | provider-1 | 00:34:12 |
| HOLOTRY | COMPLETED | 9740 | 0 | provider-1 | 00:34:22 |
| JTOTRY | CANCELLED | 2164 | 0 | provider-1 | 00:34:15 |
| CHIPTRY | COMPLETED | 9157 | 0 | provider-1 | 00:34:24 |
| AVNTTRY | COMPLETED | 4974 | 0 | provider-1 | 00:34:27 |
| ICPTRY | CANCELLED | 5884 | 0 | provider-1 | 00:34:30 |
| EDENTRY | COMPLETED | 12079 | 0 | provider-1 | 00:34:40 |
| FORMTRY | COMPLETED | 10456 | 0 | provider-1 | 00:34:41 |
| GRTTRY | COMPLETED | 9374 | 0 | provider-1 | 00:34:50 |
| CETUSTRY | COMPLETED | 7107 | 0 | provider-1 | 00:34:49 |
| EIGENTRY | COMPLETED | 8935 | 0 | provider-1 | 00:34:58 |
| GUNTRY | COMPLETED | 9383 | 0 | provider-1 | 00:35:00 |
| FOGOTRY | COMPLETED | 9851 | 0 | provider-1 | 00:35:08 |
| DYMTRY | COMPLETED | 9313 | 0 | provider-1 | 00:35:09 |
| HOMETRY | COMPLETED | 9689 | 0 | provider-1 | 00:35:18 |
| BARDTRY | CANCELLED | 1912 | 0 | provider-1 | 00:35:11 |
| BLURTRY | COMPLETED | 8650 | 0 | provider-1 | 00:35:20 |
| DOGSTRY | COMPLETED | 14502 | 0 | provider-1 | 00:35:33 |
| EDUTRY | CANCELLED | 7705 | 0 | provider-1 | 00:35:28 |
| BONKTRY | COMPLETED | 8233 | 0 | provider-1 | 00:35:38 |
| MUBARAKTRY | COMPLETED | 4291 | 0 | provider-1 | 00:35:41 |
| CRVTRY | CANCELLED | 5969 | 0 | provider-1 | 00:35:46 |
| IOTATRY | CANCELLED | 5848 | 0 | provider-1 | 00:35:48 |
| GASTRY | CANCELLED | 6391 | 0 | provider-1 | 00:35:52 |
| AXSTRY | CANCELLED | 1897 | 0 | provider-1 | 00:35:50 |
| TRUMPTRY | COMPLETED | 5104 | 0 | provider-1 | 00:35:55 |
| GPSTRY | COMPLETED | 10376 | 0 | provider-1 | 00:36:03 |
| GRAMTRY | COMPLETED | 8884 | 0 | provider-1 | 00:36:05 |
| FETTRY | COMPLETED | 9005 | 0 | provider-1 | 00:36:12 |
| FIDATRY | COMPLETED | 9329 | 0 | provider-1 | 00:36:14 |
| HAEDALTRY | COMPLETED | 9761 | 0 | provider-1 | 00:36:22 |
| ESPTRY | COMPLETED | 8683 | 0 | provider-1 | 00:36:23 |
| ETHFITRY | COMPLETED | 11397 | 0 | provider-1 | 00:36:34 |
| BIOTRY | COMPLETED | 5028 | 0 | provider-1 | 00:36:28 |
| HEMITRY | COMPLETED | 12478 | 0 | provider-1 | 00:36:41 |
| CELOTRY | CANCELLED | 1585 | 0 | provider-1 | 00:36:36 |
| ZROTRY | COMPLETED | 5034 | 0 | provider-1 | 00:36:41 |
| AVAXTRY | COMPLETED | 6497 | 0 | provider-1 | 00:36:49 |
| INJTRY | COMPLETED | 5496 | 0 | provider-1 | 00:36:48 |
| BCHTRY | COMPLETED | 4273 | 0 | provider-1 | 00:36:53 |
| BNBTRY | COMPLETED | 3493 | 0 | provider-1 | 00:36:53 |
| COMPTRY | COMPLETED | 8863 | 0 | provider-1 | 00:37:03 |
| GALATRY | COMPLETED | 8712 | 0 | provider-1 | 00:37:02 |
| BARTRY | CANCELLED | 1200 | 0 | provider-1 | 00:37:04 |
| AXLTRY | CANCELLED | 1457 | 0 | provider-1 | 00:37:04 |
| CKBTRY | COMPLETED | 8130 | 0 | provider-1 | 00:37:12 |
| HEITRY | COMPLETED | 8765 | 0 | provider-1 | 00:37:13 |
| ETHTRY | COMPLETED | 13931 | 0 | provider-1 | 00:37:27 |
| PUMPTRY | COMPLETED | 12949 | 0 | provider-1 | 00:37:27 |
| BABYTRY | COMPLETED | 3979 | 0 | provider-1 | 00:37:33 |
| TSTTRY | COMPLETED | 3085 | 0 | provider-1 | 00:37:33 |
| STXTRY | COMPLETED | 3142 | 0 | provider-1 | 00:37:36 |

### Seçilen Sembol Pipeline — CHZTRY

Decision trace kayıtları: **0** | Consensus: **1** | EV: **1** | Lifecycle: **0** | TDI: **0**

**consensus-trace (seçilen sembol, son 10):**

| timestamp | finalDecision | masterRule | reason | votes |
| --- | --- | --- | --- | --- |
| 00:32:21 | HOLD | WATCHLIST | regime=RANGE_SIDEWAYS, tech=54.67, sentiment=43.23, risk=66. | {"provider-1":"NO_TRADE","provider-3":"H |

**ev-trace (seçilen sembol, son 10):**

| timestamp | verdict | EV | threshold | winProb | RR | reason |
| --- | --- | --- | --- | --- | --- | --- |
| 00:32:21 | WAIT | 54.8195 | 36 | 44.01 | 1.3333 | EV_WAIT |

### tdi-sensitivity

| Alan | Değer |
| --- | --- |
| currentThreshold | 55 |
| scoreAboveThresholdRate | 0 |
| runtimeApprovalEquivalentRate | 0 |
| runtimeWaitCount | 0 |
| runtimeRejectedCount | 0 |
| recommendation | INSUFFICIENT_DATA |
| productionReplayStatus | INCOMPLETE |

**Score distribution:** min=0 p50=0 p90=0 max=0

### ev-component-attribution

| component | weight | observed | quality |
| --- | --- | --- | --- |
| expectedProfit | 0.35 | 1.0471 | HIGH |
| expectedLoss | 0.25 | -0.6 | HIGH |
| fees | 0.15 | 0 | HIGH |
| winProbability | 0.15 | 30.2054 | HIGH |
| expectedRiskReward | 0.1 | 1.745 | HIGH |

Dominant component: **winProbability** (sample=70)

### round-liveness (tur sonu snapshot)

| Alan | Değer |
| --- | --- |
| state | "UNKNOWN" |
| currentStage | "EXECUTING" |
| lastMeaningfulProgressAt | "2026-08-23T00:37:54.133Z" |
| meaningfulProgressAgeMs | 252772 |
| lastHeartbeatAt | "2026-08-23T00:37:54.772Z" |
| heartbeatAgeMs | 252133 |
| activeWork | {"scanner":83,"ai":83,"marketData":0} |
| activeRetries | 8 |
| activeCandidates | 0 |
| poolActive | 0 |
| poolQueued | 0 |
| remainingBudgetMs | 683779 |
| abortRequested | false |
| abortReason | null |
| stallDetectedAt | null |
| terminalizationStartedAt | null |
| terminalState | "EXECUTING" |
| terminalizationDurationMs | null |

### round-watchdog

| Alan | Değer |
| --- | --- |
| roundId | "8" |
| runId | "cmt52ksck1aogun8gyfzo1i42" |
| jobId | "cmt4zxkbm001gun8ghz4qsb0w" |
| lastProgressAt | "2026-08-23T00:37:54.133Z" |
| lastHeartbeatAt | "2026-08-23T00:37:54.772Z" |
| currentStage | "EXECUTING" |
| elapsedSinceProgressMs | 252771 |
| elapsedSinceHeartbeatMs | 252132 |
| decision | "NONE" |
| action | "Legitimate long-running stage" |
| reasonDetail | "Monitoring active position" |
| recordedAt | "2026-08-23T00:42:06.904Z" |

### resolved-config (runtime)

```json
{
  "generatedAt": "2026-08-23T00:42:06.862Z",
  "exchange": "binance",
  "universe": {
    "scannerUniverse": "ALL_SPOT",
    "maxSymbols": 1200,
    "maxCycleSec": 180
  },
  "aiMode": {
    "executionMode": "paper",
    "minConfidence": 60,
    "strictAnalystMode": false,
    "remoteRequired": false
  },
  "strategyConfig": {},
  "evConfig": {
    "minRiskRewardRatio": 1.25,
    "minTradeQualityScore": 45
  },
  "risk": {
    "maxDailyLossPercent": 5,
    "maxOpenPositions": 3
  },
  "sizing": {},
  "fees": {
    "binanceTakerFeeRate": 0.0015,
    "binanceMakerFeeRate": 0.0009
  },
  "simulationWindow": {
    "autoRoundSelectionBudgetSec": 1200
  },
  "maxPositions": 3,
  "timeframes": [
    "1m",
    "5m",
    "15m",
    "1h",
    "4h"
  ]
}
```

### Promotion / Research Gates

| Gate | promoted | status/detail |
| --- | --- | --- |
| promotion-gate | false | RESEARCH_ONLY |
| p1-promotion-gate | false | RESEARCH_ONLY |
| strategy-comparison | false | 07503ff4691831f0 |

### Artifact Envanteri (bu tur)

| dosya | KB |
| --- | --- |
| candidate-trace.json | 103 |
| consensus-trace.json | 93 |
| missed-opportunities.json | 91 |
| scanner-summary.json | 75 |
| opportunity-value.json | 55 |
| ai-progress.json | 42 |
| pump-scan-lifecycle.json | 33 |
| ev-trace.json | 30 |
| transaction-duration.json | 24 |
| errors.json | 18 |
| candidate-lifecycle.json | 11 |
| stage-timings.json | 7 |
| round-summary.json | 5 |
| profitability-experiments.json | 4 |
| selectionTimeBudgetBreakdown.json | 4 |
| tdi-data-quality.json | 4 |
| opportunity-funnel.json | 2 |
| p1-promotion-gate.json | 2 |
| promotion-gate.json | 2 |
| single-change-experiments.json | 2 |
| tdi-sensitivity.json | 2 |
| candidate-quality-factors.json | 1 |
| entry-timing-experiment.json | 1 |
| ev-component-attribution.json | 1 |
| exit-forensics.json | 1 |
| fee-aware-entry-experiment.json | 1 |
| mr-regime-gating-experiment.json | 1 |
| profitability-experiments.csv | 1 |
| promotion-decisions.json | 1 |
| resolved-config.json | 1 |
| round-liveness.json | 1 |
| slot-allocation-experiment.json | 1 |
| strategy-comparison-report.json | 1 |
| volatility-breakout-validation.json | 1 |
| ai-strategy-interaction.json | 0 |
| ai-trace.json | 0 |
| baseline-metrics.json | 0 |
| decision-trace.json | 0 |
| entry-timing.json | 0 |
| ev-calibration.json | 0 |
| execution-trace.json | 0 |
| exit-fee-interaction.json | 0 |
| exit-trace.json | 0 |
| fee-aware-edge-research.json | 0 |
| fee-aware-entry-policy.json | 0 |
| fee-by-hold-time.json | 0 |
| fee-by-strategy.json | 0 |
| gross-positive-net-negative.json | 0 |
| loss-patterns.json | 0 |
| mean-reversion-audit.json | 0 |
| not-discovered-analysis.json | 0 |
| out-of-sample-evaluation.json | 0 |
| pnl-ledger.json | 0 |
| position-trace.json | 0 |
| profit-concentration.json | 0 |
| recovery-decisions.json | 0 |
| recovery-telemetry.json | 0 |
| replay-exit-diagnostics.json | 0 |
| replayExitDiagnostics.json | 0 |
| risk-sizing-trace.json | 0 |
| round-watchdog.json | 0 |
| scanner-qualification.json | 0 |
| slot-allocation-analysis.json | 0 |
| slot-opportunity-report.json | 0 |
| strategy-performance.json | 0 |
| strategy-regime-matrix-p2.csv | 0 |
| strategy-regime-matrix-p2.json | 0 |
| strategy-regime-matrix.json | 0 |
| strategy-trace.json | 0 |
| tdi-decisions.json | 0 |
| tdi-input-contract.json | 0 |
| tdi-missing-telemetry-report.json | 0 |
| trend-following-validation.json | 0 |
| winning-patterns.json | 0 |

---

## Tur #9 — MEGATRY

### Kimlik & DB

| Alan | Değer |
| --- | --- |
| runId | cmt5319zf1f0gun8g7co4oiii |
| jobId | cmt4zxkbm001gun8ghz4qsb0w |
| roundNo | 9 |
| state | tur_basarisiz |
| symbol | MEGATRY |
| startedAt | 2026-08-23T00:42:07.179Z |
| endedAt | 2026-08-23T00:51:07.788Z |
| duration | 9.0 dk |
| selectionAttempt | 1 |
| runtime.step | EXECUTING |
| failReason (DB) | AI_GATE_BLOCK: AI_VETO |
| failReason (artifact) | AI_GATE_BLOCK: AI_VETO |
| exportKind | failed-round-partial |
| exportStatus | COMPLETED |

### round-summary — Özet Metrikler

| Metrik | Değer |
| --- | --- |
| candidateCount | 0 |
| failureCount | 332 |
| tradeCount | 0 |
| fills | 0 |
| grossPnL | 0 |
| fees | 0 |
| netPnl | 0 |
| currentStage | EXECUTING |
| elapsedMs | 537247 |
| selectionBudgetMs | 1200000 |
| lastProgressAt | 2026-08-23T00:51:04.791Z |
| heartbeatAt | 2026-08-23T00:51:05.987Z |

### funnelState — Tam Rejection Haritası

**By stage:**
- ai: 75
- consensus: 73
- scanner: 69
- candidate: 65
- ev: 50

**By reason (tam liste):**
- AI_DEGRADED: 73
- CONSENSUS_REJECT: 73
- REJECTED: 68
- EV_REJECT: 50
- PUMP_CONFIRM_NO_TRADE: 31
- PUMP_NOT_EARLY_OR_CONTINUATION: 9
- PUMP_SAFETY_FAILED: 9
- PUMP_SAFETY_FINAL_FAILED: 8
- PUMP_WEAK_PROFILE: 4
- CANDIDATE_REJECTED: 3
- AI_FAILED: 2
- PUMP_NO_BUY_SIGNAL: 1
- Data quality issue (CHANGE24H_FALLBACK): 1

**TDI runtime counters:**

| Counter | Değer |
| --- | --- |
| tdiDecisions | 0 |
| runtimeTdiApproved | 0 |
| runtimeTdiWait | 0 |
| runtimeTdiRejected | 0 |
| upstreamCandidateRejected | 0 |
| hybridRejected | 0 |
| consensusRejected | 73 |
| masterRejected | 0 |
| scannerQualificationRejections | 0 |

### opportunity-funnel — Aşama Kayıpları

| Stage | entered | lost | lostReason | count | % | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| DISCOVERED | 0 | 332 | FILTERED_OUT | 0 | 100 | INSUFFICIENT |
| STRATEGY_QUALIFIED | -69 | 0 | FILTERED_OUT | 0 | 0 | PARTIAL |
| TDI | 0 | 0 | TDI_WAIT | 0 | 0 | PARTIAL |
| AI | 0 | 165 | AI_REJECTED | 165 | 49.7 | PARTIAL |
| RISK | 0 | 0 | RISK | 0 | 0 | PARTIAL |
| EXECUTION | 0 | 0 | EXECUTION_FAILED | 0 | 0 | PARTIAL |

**lossByReason:**

| Reason | count | % |
| --- | --- | --- |
| UNKNOWN | 96 | 28.92 |
| FILTERED_OUT | 71 | 21.39 |
| AI_REJECTED | 165 | 49.7 |

### selectionTimeBudgetBreakdown — Zaman Bütçesi

| Alan | Değer |
| --- | --- |
| selectionBudgetMs | 1200000 |
| totalElapsedMs | 540790 |
| measuredTotalMs | 550011 |
| PRIMARY_TIME_CONSUMER | execution_preparation |

**TOP_5_TIME_CONSUMERS:**

| stage | totalMs | share% |
| --- | --- | --- |
| execution_preparation | 398468 | 33.2% |
| ai_execution | 142322 | 11.9% |
| persistence | 9221 | 0.8% |
| scanner_startup | 0 | 0.0% |
| pump_discovery | 0 | 0.0% |

**Tüm stage satırları:**

| stage | count | totalMs | p50 | p95 | max | budgetShare% |
| --- | --- | --- | --- | --- | --- | --- |
| ai_execution | 119 | 142322 | 769 | 2419 | 30595 | 11.8602 |
| execution_preparation | 1 | 398468 | 398468 | 398468 | 398468 | 33.2057 |
| persistence | 99 | 9221 | 59 | 338 | 1245 | 0.7684 |

### scanner-summary — Aggregate

| Metrik | Değer |
| --- | --- |
| scanner cycles | 1 |
| universe (sum) | 1220 |
| eligible (sum) | 283 |
| qualified (sum) | 283 |
| rejected (sum) | 937 |
| errors (sum) | 0 |

**Scanner rejection reasons (aggregate):**
- REJECTED: 904
- Data quality issue (PRICE_STALE): 20
- Data quality issue (CHANGE24H_FALLBACK): 7
- Spread too wide: 3
- SPREAD_TOO_WIDE: 3

### errors.json — Failure Özeti

| Alan | Değer |
| --- | --- |
| total failures | 75 |
| artifact failReason | AI_GATE_BLOCK: AI_VETO |

**By stage:**
- ai: 75

**By reasonCode (top 20):**
- AI_DEGRADED: 73
- AI_FAILED: 2

### ai-progress — AI Pool

| Metrik | Değer |
| --- | --- |
| processed | 95 |
| total | 95 |
| successCount | 60 |
| failedCount | 35 |
| timeoutCount | 0 |
| concurrency | 2 |
| duration p50 | 4884 ms |
| duration p95 | 16799 ms |
| duration max | 35084 ms |
| currentCandidate | NMRTRY |
| currentStage | ai |

**Status dağılımı:**
- COMPLETED: 60
- CANCELLED: 35

**Tüm AI candidate satırları:**

| symbol | status | durationMs | retry | provider | completedAt |
| --- | --- | --- | --- | --- | --- |
| POLTRY | COMPLETED | 34917 | 0 | provider-1 | 00:45:21 |
| PUMPTRY | COMPLETED | 35084 | 0 | provider-1 | 00:45:21 |
| NILTRY | COMPLETED | 24757 | 0 | provider-1 | 00:46:02 |
| BABYTRY | COMPLETED | 21423 | 0 | provider-1 | 00:46:02 |
| PAXGTRY | COMPLETED | 8840 | 0 | provider-1 | 00:46:14 |
| MOVRTRY | COMPLETED | 8128 | 0 | provider-1 | 00:46:14 |
| MEGATRY | COMPLETED | 13513 | 0 | provider-1 | 00:46:28 |
| ORDITRY | COMPLETED | 12320 | 0 | provider-1 | 00:46:26 |
| SENTTRY | COMPLETED | 8928 | 0 | provider-1 | 00:46:37 |
| ZROTRY | COMPLETED | 3313 | 0 | provider-1 | 00:46:32 |
| MMTTRY | COMPLETED | 10491 | 0 | provider-1 | 00:46:43 |
| NEIROTRY | COMPLETED | 4123 | 0 | provider-1 | 00:46:41 |
| SHIBTRY | COMPLETED | 10243 | 0 | provider-1 | 00:46:52 |
| RVNTRY | COMPLETED | 10399 | 0 | provider-1 | 00:46:54 |
| ONETRY | COMPLETED | 2635 | 0 | provider-1 | 00:46:55 |
| PEOPLETRY | COMPLETED | 4631 | 0 | provider-1 | 00:46:59 |
| XVGTRY | COMPLETED | 3237 | 0 | provider-1 | 00:46:58 |
| PENDLETRY | COMPLETED | 4240 | 0 | provider-1 | 00:47:03 |
| MORPHOTRY | CANCELLED | 5818 | 0 | provider-1 | 00:47:05 |
| KITETRY | COMPLETED | 2978 | 0 | provider-1 | 00:47:06 |
| LUMIATRY | CANCELLED | 6048 | 0 | provider-1 | 00:47:11 |
| RADTRY | CANCELLED | 583 | 0 | provider-1 | 00:47:07 |
| PIXELTRY | COMPLETED | 4730 | 0 | provider-1 | 00:47:12 |
| METTRY | COMPLETED | 3906 | 0 | provider-1 | 00:47:15 |
| SHELLTRY | CANCELLED | 1961 | 0 | provider-1 | 00:47:15 |
| OPENTRY | CANCELLED | 1530 | 0 | provider-1 | 00:47:17 |
| MUBARAKTRY | COMPLETED | 9591 | 0 | provider-1 | 00:47:25 |
| TSTTRY | CANCELLED | 1919 | 0 | provider-1 | 00:47:20 |
| OPTRY | CANCELLED | 6298 | 0 | provider-1 | 00:47:29 |
| ENATRY | COMPLETED | 5248 | 0 | provider-1 | 00:47:31 |
| ORCATRY | CANCELLED | 1866 | 0 | provider-1 | 00:47:31 |
| SAGATRY | COMPLETED | 2918 | 0 | provider-1 | 00:47:34 |
| RARETRY | COMPLETED | 3580 | 0 | provider-1 | 00:47:35 |
| LINEATRY | COMPLETED | 3989 | 0 | provider-1 | 00:47:38 |
| LUNCTRY | COMPLETED | 10133 | 0 | provider-1 | 00:47:46 |
| ROSETRY | COMPLETED | 4708 | 0 | provider-1 | 00:47:46 |
| LTCTRY | COMPLETED | 8642 | 0 | provider-1 | 00:47:57 |
| LAYERTRY | CANCELLED | 1900 | 0 | provider-1 | 00:47:50 |
| MAGICTRY | CANCELLED | 5949 | 0 | provider-1 | 00:47:56 |
| PLUMETRY | COMPLETED | 7486 | 0 | provider-1 | 00:48:04 |
| NXPCTRY | CANCELLED | 2074 | 0 | provider-1 | 00:47:59 |
| NOMTRY | COMPLETED | 6311 | 0 | provider-1 | 00:48:07 |
| MEMETRY | COMPLETED | 12436 | 0 | provider-1 | 00:48:17 |
| NOTTRY | COMPLETED | 7851 | 0 | provider-1 | 00:48:16 |
| SCRTRY | CANCELLED | 2232 | 0 | provider-1 | 00:48:19 |
| SANDTRY | CANCELLED | 1630 | 0 | provider-1 | 00:48:20 |
| MIRATRY | CANCELLED | 5307 | 0 | provider-1 | 00:48:25 |
| PROVETRY | CANCELLED | 1985 | 0 | provider-1 | 00:48:23 |
| OPNTRY | CANCELLED | 4286 | 0 | provider-1 | 00:48:28 |
| MANTATRY | COMPLETED | 16799 | 0 | provider-1 | 00:48:42 |
| RENDERTRY | CANCELLED | 1835 | 0 | provider-1 | 00:48:36 |
| MITOTRY | CANCELLED | 5989 | 0 | provider-1 | 00:48:42 |
| REDTRY | CANCELLED | 1932 | 0 | provider-1 | 00:48:44 |
| LISTATRY | CANCELLED | 5853 | 0 | provider-1 | 00:48:49 |
| RESOLVTRY | CANCELLED | 1917 | 0 | provider-1 | 00:48:46 |
| MANATRY | CANCELLED | 6000 | 0 | provider-1 | 00:48:53 |
| LPTTRY | CANCELLED | 5936 | 0 | provider-1 | 00:48:55 |
| OGTRY | CANCELLED | 2287 | 0 | provider-1 | 00:48:56 |
| PARTITRY | CANCELLED | 3780 | 0 | provider-1 | 00:49:00 |
| LUNATRY | COMPLETED | 12831 | 0 | provider-1 | 00:49:10 |
| LATRY | CANCELLED | 2157 | 0 | provider-1 | 00:49:06 |
| MINATRY | CANCELLED | 6017 | 0 | provider-1 | 00:49:12 |
| PYTHTRY | COMPLETED | 3018 | 0 | provider-1 | 00:49:13 |
| STXTRY | COMPLETED | 3091 | 0 | provider-1 | 00:49:16 |
| PHATRY | CANCELLED | 951 | 0 | provider-1 | 00:49:14 |
| NEOTRY | COMPLETED | 5045 | 0 | provider-1 | 00:49:20 |
| LDOTRY | COMPLETED | 3905 | 0 | provider-1 | 00:49:20 |
| KSMTRY | CANCELLED | 1414 | 0 | provider-1 | 00:49:21 |
| PNUTTRY | CANCELLED | 1454 | 0 | provider-1 | 00:49:22 |
| KAITOTRY | COMPLETED | 3756 | 0 | provider-1 | 00:49:25 |
| LINKTRY | COMPLETED | 5161 | 0 | provider-1 | 00:49:27 |
| METISTRY | CANCELLED | 6019 | 0 | provider-1 | 00:49:32 |
| FFTRY | COMPLETED | 3198 | 0 | provider-1 | 00:49:30 |
| METRY | COMPLETED | 8791 | 0 | provider-1 | 00:49:40 |
| RAYTRY | COMPLETED | 3319 | 0 | provider-1 | 00:49:35 |
| PEPETRY | COMPLETED | 2934 | 0 | provider-1 | 00:49:39 |
| LAZIOTRY | CANCELLED | 1900 | 0 | provider-1 | 00:49:41 |
| SAPIENTRY | COMPLETED | 4728 | 0 | provider-1 | 00:49:44 |
| NEARTRY | COMPLETED | 8389 | 0 | provider-1 | 00:49:49 |
| NIGHTTRY | COMPLETED | 3884 | 0 | provider-1 | 00:49:49 |
| RSRTRY | COMPLETED | 5789 | 0 | provider-1 | 00:49:55 |
| ONTTRY | COMPLETED | 5862 | 0 | provider-1 | 00:49:55 |
| REZTRY | COMPLETED | 5360 | 0 | provider-1 | 00:50:00 |
| MANTRATRY | COMPLETED | 9503 | 0 | provider-1 | 00:50:05 |
| KATTRY | COMPLETED | 5295 | 0 | provider-1 | 00:50:06 |
| RETRY | COMPLETED | 4884 | 0 | provider-1 | 00:50:10 |
| PENGUTRY | COMPLETED | 5339 | 0 | provider-1 | 00:50:11 |
| OPGTRY | CANCELLED | 1463 | 0 | provider-1 | 00:50:12 |
| SANTOSTRY | COMPLETED | 2972 | 0 | provider-1 | 00:50:15 |
| ROBOTRY | COMPLETED | 6487 | 0 | provider-1 | 00:50:19 |
| OGNTRY | CANCELLED | 1502 | 0 | provider-1 | 00:50:16 |
| TRUMPTRY | COMPLETED | 6568 | 0 | provider-1 | 00:50:24 |
| PORTALTRY | COMPLETED | 6560 | 0 | provider-1 | 00:50:27 |
| ONDOTRY | COMPLETED | 7662 | 0 | provider-1 | 00:50:34 |
| NMRTRY | CANCELLED | 2554 | 0 | provider-1 | 00:50:31 |

### Seçilen Sembol Pipeline — MEGATRY

Decision trace kayıtları: **0** | Consensus: **1** | EV: **1** | Lifecycle: **0** | TDI: **0**

**consensus-trace (seçilen sembol, son 10):**

| timestamp | finalDecision | masterRule | reason | votes |
| --- | --- | --- | --- | --- |
| 00:46:25 | NO_TRADE | NO-TRADE | regime=RANGE_SIDEWAYS, tech=62.06, sentiment=77.26, risk=67. | {"provider-1":"NO_TRADE","provider-2":"B |

**ev-trace (seçilen sembol, son 10):**

| timestamp | verdict | EV | threshold | winProb | RR | reason |
| --- | --- | --- | --- | --- | --- | --- |
| 00:46:25 | REJECTED | 67.5834 | 36 | 52.22 | 1.3333 | EV_REJECT |

### tdi-sensitivity

| Alan | Değer |
| --- | --- |
| currentThreshold | 55 |
| scoreAboveThresholdRate | 0 |
| runtimeApprovalEquivalentRate | 0 |
| runtimeWaitCount | 0 |
| runtimeRejectedCount | 0 |
| recommendation | INSUFFICIENT_DATA |
| productionReplayStatus | INCOMPLETE |

**Score distribution:** min=0 p50=0 p90=0 max=0

### ev-component-attribution

| component | weight | observed | quality |
| --- | --- | --- | --- |
| expectedProfit | 0.35 | 1.163 | HIGH |
| expectedLoss | 0.25 | -0.6 | HIGH |
| fees | 0.15 | 0 | HIGH |
| winProbability | 0.15 | 26.6937 | HIGH |
| expectedRiskReward | 0.1 | 1.9383 | HIGH |

Dominant component: **winProbability** (sample=73)

### round-liveness (tur sonu snapshot)

| Alan | Değer |
| --- | --- |
| state | "UNKNOWN" |
| currentStage | "EXECUTING" |
| lastMeaningfulProgressAt | "2026-08-23T00:51:04.791Z" |
| meaningfulProgressAgeMs | 3416 |
| lastHeartbeatAt | "2026-08-23T00:51:05.987Z" |
| heartbeatAgeMs | 2220 |
| activeWork | {"scanner":94,"ai":94,"marketData":0} |
| activeRetries | 3 |
| activeCandidates | 1 |
| poolActive | 0 |
| poolQueued | 0 |
| remainingBudgetMs | 662753 |
| abortRequested | false |
| abortReason | null |
| stallDetectedAt | null |
| terminalizationStartedAt | null |
| terminalState | "EXECUTING" |
| terminalizationDurationMs | null |

### round-watchdog

| Alan | Değer |
| --- | --- |
| roundId | "9" |
| runId | "cmt5319zf1f0gun8g7co4oiii" |
| jobId | "cmt4zxkbm001gun8ghz4qsb0w" |
| lastProgressAt | "2026-08-23T00:51:04.791Z" |
| lastHeartbeatAt | "2026-08-23T00:51:05.987Z" |
| currentStage | "EXECUTING" |
| elapsedSinceProgressMs | 3414 |
| elapsedSinceHeartbeatMs | 2218 |
| decision | "NONE" |
| action | "Legitimate long-running stage" |
| reasonDetail | "Monitoring active position" |
| recordedAt | "2026-08-23T00:51:08.205Z" |

### resolved-config (runtime)

```json
{
  "generatedAt": "2026-08-23T00:51:08.163Z",
  "exchange": "binance",
  "universe": {
    "scannerUniverse": "ALL_SPOT",
    "maxSymbols": 1200,
    "maxCycleSec": 180
  },
  "aiMode": {
    "executionMode": "paper",
    "minConfidence": 60,
    "strictAnalystMode": false,
    "remoteRequired": false
  },
  "strategyConfig": {},
  "evConfig": {
    "minRiskRewardRatio": 1.25,
    "minTradeQualityScore": 45
  },
  "risk": {
    "maxDailyLossPercent": 5,
    "maxOpenPositions": 3
  },
  "sizing": {},
  "fees": {
    "binanceTakerFeeRate": 0.0015,
    "binanceMakerFeeRate": 0.0009
  },
  "simulationWindow": {
    "autoRoundSelectionBudgetSec": 1200
  },
  "maxPositions": 3,
  "timeframes": [
    "1m",
    "5m",
    "15m",
    "1h",
    "4h"
  ]
}
```

### Promotion / Research Gates

| Gate | promoted | status/detail |
| --- | --- | --- |
| promotion-gate | false | RESEARCH_ONLY |
| p1-promotion-gate | false | RESEARCH_ONLY |
| strategy-comparison | false | 07503ff4691831f0 |

### Artifact Envanteri (bu tur)

| dosya | KB |
| --- | --- |
| candidate-trace.json | 134 |
| missed-opportunities.json | 108 |
| consensus-trace.json | 94 |
| scanner-summary.json | 75 |
| opportunity-value.json | 62 |
| ai-progress.json | 56 |
| pump-scan-lifecycle.json | 33 |
| ev-trace.json | 31 |
| candidate-lifecycle.json | 24 |
| transaction-duration.json | 24 |
| errors.json | 19 |
| stage-timings.json | 7 |
| round-summary.json | 5 |
| profitability-experiments.json | 4 |
| selectionTimeBudgetBreakdown.json | 4 |
| tdi-data-quality.json | 4 |
| opportunity-funnel.json | 2 |
| p1-promotion-gate.json | 2 |
| promotion-gate.json | 2 |
| single-change-experiments.json | 2 |
| tdi-sensitivity.json | 2 |
| candidate-quality-factors.json | 1 |
| entry-timing-experiment.json | 1 |
| ev-component-attribution.json | 1 |
| exit-forensics.json | 1 |
| fee-aware-entry-experiment.json | 1 |
| mr-regime-gating-experiment.json | 1 |
| profitability-experiments.csv | 1 |
| promotion-decisions.json | 1 |
| resolved-config.json | 1 |
| round-liveness.json | 1 |
| slot-allocation-experiment.json | 1 |
| strategy-comparison-report.json | 1 |
| volatility-breakout-validation.json | 1 |
| ai-strategy-interaction.json | 0 |
| ai-trace.json | 0 |
| baseline-metrics.json | 0 |
| decision-trace.json | 0 |
| entry-timing.json | 0 |
| ev-calibration.json | 0 |
| execution-trace.json | 0 |
| exit-fee-interaction.json | 0 |
| exit-trace.json | 0 |
| fee-aware-edge-research.json | 0 |
| fee-aware-entry-policy.json | 0 |
| fee-by-hold-time.json | 0 |
| fee-by-strategy.json | 0 |
| gross-positive-net-negative.json | 0 |
| loss-patterns.json | 0 |
| mean-reversion-audit.json | 0 |
| not-discovered-analysis.json | 0 |
| out-of-sample-evaluation.json | 0 |
| pnl-ledger.json | 0 |
| position-trace.json | 0 |
| profit-concentration.json | 0 |
| recovery-decisions.json | 0 |
| recovery-telemetry.json | 0 |
| replay-exit-diagnostics.json | 0 |
| replayExitDiagnostics.json | 0 |
| risk-sizing-trace.json | 0 |
| round-watchdog.json | 0 |
| scanner-qualification.json | 0 |
| slot-allocation-analysis.json | 0 |
| slot-opportunity-report.json | 0 |
| strategy-performance.json | 0 |
| strategy-regime-matrix-p2.csv | 0 |
| strategy-regime-matrix-p2.json | 0 |
| strategy-regime-matrix.json | 0 |
| strategy-trace.json | 0 |
| tdi-decisions.json | 0 |
| tdi-input-contract.json | 0 |
| tdi-missing-telemetry-report.json | 0 |
| trend-following-validation.json | 0 |
| winning-patterns.json | 0 |

---

## Tur #10 — SUPERTRY

### Kimlik & DB

| Alan | Değer |
| --- | --- |
| runId | cmt53cvq21jiuun8g4237c6h1 |
| jobId | cmt4zxkbm001gun8ghz4qsb0w |
| roundNo | 10 |
| state | tur_basarisiz |
| symbol | SUPERTRY |
| startedAt | 2026-08-23T00:51:08.570Z |
| endedAt | 2026-08-23T01:02:12.915Z |
| duration | 11.1 dk |
| selectionAttempt | 1 |
| runtime.step | EXECUTING |
| failReason (DB) | AI_GATE_BLOCK: AI_VETO |
| failReason (artifact) | AI_GATE_BLOCK: AI_VETO |
| exportKind | failed-round-partial |
| exportStatus | COMPLETED |

### round-summary — Özet Metrikler

| Metrik | Değer |
| --- | --- |
| candidateCount | 0 |
| failureCount | 354 |
| tradeCount | 0 |
| fills | 0 |
| grossPnL | 0 |
| fees | 0 |
| netPnl | 0 |
| currentStage | EXECUTING |
| elapsedMs | 399622 |
| selectionBudgetMs | 1200000 |
| lastProgressAt | 2026-08-23T00:57:48.322Z |
| heartbeatAt | 2026-08-23T00:57:49.387Z |

### funnelState — Tam Rejection Haritası

**By stage:**
- ai: 82
- consensus: 82
- scanner: 82
- ev: 64
- candidate: 44

**By reason (tam liste):**
- AI_DEGRADED: 82
- CONSENSUS_REJECT: 82
- REJECTED: 81
- EV_REJECT: 64
- PUMP_CONFIRM_NO_TRADE: 16
- CANDIDATE_REJECTED: 12
- PUMP_NOT_EARLY_OR_CONTINUATION: 7
- PUMP_SAFETY_FINAL_FAILED: 4
- PUMP_WEAK_PROFILE: 3
- PUMP_SAFETY_FAILED: 2
- Data quality issue (CHANGE24H_FALLBACK): 1

**TDI runtime counters:**

| Counter | Değer |
| --- | --- |
| tdiDecisions | 0 |
| runtimeTdiApproved | 0 |
| runtimeTdiWait | 0 |
| runtimeTdiRejected | 0 |
| upstreamCandidateRejected | 0 |
| hybridRejected | 0 |
| consensusRejected | 82 |
| masterRejected | 0 |
| scannerQualificationRejections | 0 |

### opportunity-funnel — Aşama Kayıpları

| Stage | entered | lost | lostReason | count | % | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| DISCOVERED | 0 | 354 | FILTERED_OUT | 0 | 100 | INSUFFICIENT |
| STRATEGY_QUALIFIED | -82 | 0 | FILTERED_OUT | 0 | 0 | PARTIAL |
| TDI | 0 | 0 | TDI_WAIT | 0 | 0 | PARTIAL |
| AI | 0 | 170 | AI_REJECTED | 170 | 48.02 | PARTIAL |
| RISK | 0 | 0 | RISK | 0 | 0 | PARTIAL |
| EXECUTION | 0 | 0 | EXECUTION_FAILED | 0 | 0 | PARTIAL |

**lossByReason:**

| Reason | count | % |
| --- | --- | --- |
| AI_REJECTED | 170 | 48.02 |
| UNKNOWN | 91 | 25.71 |
| FILTERED_OUT | 93 | 26.27 |

### selectionTimeBudgetBreakdown — Zaman Bütçesi

| Alan | Değer |
| --- | --- |
| selectionBudgetMs | 1200000 |
| totalElapsedMs | 666328 |
| measuredTotalMs | 675968 |
| PRIMARY_TIME_CONSUMER | execution_preparation |

**TOP_5_TIME_CONSUMERS:**

| stage | totalMs | share% |
| --- | --- | --- |
| execution_preparation | 554289 | 46.2% |
| ai_execution | 112039 | 9.3% |
| persistence | 9640 | 0.8% |
| scanner_startup | 0 | 0.0% |
| pump_discovery | 0 | 0.0% |

**Tüm stage satırları:**

| stage | count | totalMs | p50 | p95 | max | budgetShare% |
| --- | --- | --- | --- | --- | --- | --- |
| ai_execution | 119 | 112039 | 380 | 2454 | 8388 | 9.3366 |
| execution_preparation | 1 | 554289 | 554289 | 554289 | 554289 | 46.1908 |
| persistence | 99 | 9640 | 72 | 201 | 1157 | 0.8033 |

### scanner-summary — Aggregate

| Metrik | Değer |
| --- | --- |
| scanner cycles | 1 |
| universe (sum) | 1313 |
| eligible (sum) | 294 |
| qualified (sum) | 294 |
| rejected (sum) | 1019 |
| errors (sum) | 0 |

**Scanner rejection reasons (aggregate):**
- REJECTED: 985
- Data quality issue (PRICE_STALE): 20
- Data quality issue (CHANGE24H_FALLBACK): 8
- Spread too wide: 3
- SPREAD_TOO_WIDE: 3

### errors.json — Failure Özeti

| Alan | Değer |
| --- | --- |
| total failures | 82 |
| artifact failReason | AI_GATE_BLOCK: AI_VETO |

**By stage:**
- ai: 82

**By reasonCode (top 20):**
- AI_DEGRADED: 82

### ai-progress — AI Pool

| Metrik | Değer |
| --- | --- |
| processed | 93 |
| total | 93 |
| successCount | 77 |
| failedCount | 16 |
| timeoutCount | 0 |
| concurrency | 2 |
| duration p50 | 4512 ms |
| duration p95 | 9402 ms |
| duration max | 19850 ms |
| currentCandidate | ENATRY |
| currentStage | ai |

**Status dağılımı:**
- COMPLETED: 77
- CANCELLED: 16

**Tüm AI candidate satırları:**

| symbol | status | durationMs | retry | provider | completedAt |
| --- | --- | --- | --- | --- | --- |
| SOLTRY | COMPLETED | 4057 | 0 | provider-1 | 00:53:27 |
| SUPERTRY | COMPLETED | 2683 | 0 | provider-1 | 00:53:26 |
| WALTRY | COMPLETED | 2606 | 0 | provider-1 | 00:53:29 |
| TRUMPTRY | COMPLETED | 3894 | 0 | provider-1 | 00:53:31 |
| TSTTRY | COMPLETED | 4177 | 0 | provider-1 | 00:53:33 |
| XVGTRY | COMPLETED | 3362 | 0 | provider-1 | 00:53:35 |
| UNITRY | COMPLETED | 2697 | 0 | provider-1 | 00:53:36 |
| SUSHITRY | COMPLETED | 2638 | 0 | provider-1 | 00:53:38 |
| ZROTRY | COMPLETED | 3126 | 0 | provider-1 | 00:53:40 |
| POLTRY | COMPLETED | 2864 | 0 | provider-1 | 00:53:41 |
| VETTRY | COMPLETED | 8881 | 0 | provider-1 | 00:53:49 |
| XLMTRY | COMPLETED | 6891 | 0 | provider-1 | 00:53:49 |
| ALGOTRY | COMPLETED | 2885 | 0 | provider-1 | 00:53:52 |
| VIRTUALTRY | COMPLETED | 2790 | 0 | provider-1 | 00:53:52 |
| 1MBABYDOGETRY | COMPLETED | 3433 | 0 | provider-1 | 00:53:56 |
| ZILTRY | COMPLETED | 1990 | 0 | provider-1 | 00:53:55 |
| TWTTRY | COMPLETED | 5235 | 0 | provider-1 | 00:54:00 |
| API3TRY | COMPLETED | 2632 | 0 | provider-1 | 00:53:59 |
| SNXTRY | COMPLETED | 8705 | 0 | provider-1 | 00:54:08 |
| ZBTTRY | CANCELLED | 1831 | 0 | provider-1 | 00:54:02 |
| SOMITRY | CANCELLED | 5499 | 0 | provider-1 | 00:54:09 |
| FFTRY | COMPLETED | 5018 | 0 | provider-1 | 00:54:13 |
| ALLOTRY | COMPLETED | 5161 | 0 | provider-1 | 00:54:14 |
| TREETRY | CANCELLED | 6340 | 0 | provider-1 | 00:54:20 |
| ACHTRY | COMPLETED | 5267 | 0 | provider-1 | 00:54:20 |
| ARKTRY | CANCELLED | 8113 | 0 | provider-1 | 00:54:28 |
| XRPTRY | COMPLETED | 11669 | 0 | provider-1 | 00:54:33 |
| XAUTTRY | COMPLETED | 5732 | 0 | provider-1 | 00:54:38 |
| UTRY | COMPLETED | 6262 | 0 | provider-1 | 00:54:40 |
| XECTRY | COMPLETED | 4034 | 0 | provider-1 | 00:54:44 |
| AMPTRY | COMPLETED | 6101 | 0 | provider-1 | 00:54:47 |
| ANKRTRY | COMPLETED | 4271 | 0 | provider-1 | 00:54:49 |
| XAITRY | COMPLETED | 9402 | 0 | provider-1 | 00:54:57 |
| ALTTRY | COMPLETED | 5737 | 0 | provider-1 | 00:54:55 |
| TURBOTRY | COMPLETED | 8924 | 0 | provider-1 | 00:55:04 |
| ZKTRY | COMPLETED | 7373 | 0 | provider-1 | 00:55:04 |
| SKLTRY | COMPLETED | 4825 | 0 | provider-1 | 00:55:09 |
| TIATRY | COMPLETED | 3384 | 0 | provider-1 | 00:55:08 |
| USUALTRY | COMPLETED | 8220 | 0 | provider-1 | 00:55:17 |
| WTRY | COMPLETED | 5028 | 0 | provider-1 | 00:55:15 |
| AEVOTRY | COMPLETED | 3380 | 0 | provider-1 | 00:55:19 |
| APTTRY | CANCELLED | 1885 | 0 | provider-1 | 00:55:19 |
| APETRY | CANCELLED | 1874 | 0 | provider-1 | 00:55:21 |
| USTCTRY | COMPLETED | 19850 | 0 | provider-1 | 00:55:39 |
| ARKMTRY | COMPLETED | 17422 | 0 | provider-1 | 00:55:39 |
| PUMPTRY | COMPLETED | 3702 | 0 | provider-1 | 00:55:43 |
| 1000CATTRY | COMPLETED | 3479 | 0 | provider-1 | 00:55:43 |
| TRBTRY | COMPLETED | 4308 | 0 | provider-1 | 00:55:48 |
| WIFTRY | COMPLETED | 4512 | 0 | provider-1 | 00:55:48 |
| AAVETRY | COMPLETED | 4819 | 0 | provider-1 | 00:55:53 |
| WLDTRY | COMPLETED | 2743 | 0 | provider-1 | 00:55:51 |
| ARBTRY | CANCELLED | 1454 | 0 | provider-1 | 00:55:53 |
| SOPHTRY | COMPLETED | 4716 | 0 | provider-1 | 00:55:58 |
| XPLTRY | COMPLETED | 4983 | 0 | provider-1 | 00:55:58 |
| THETATRY | CANCELLED | 2094 | 0 | provider-1 | 00:56:00 |
| TLMTRY | COMPLETED | 6517 | 0 | provider-1 | 00:56:05 |
| SXTTRY | COMPLETED | 4919 | 0 | provider-1 | 00:56:08 |
| SYRUPTRY | CANCELLED | 1682 | 0 | provider-1 | 00:56:07 |
| TAOTRY | COMPLETED | 5694 | 0 | provider-1 | 00:56:13 |
| SPELLTRY | COMPLETED | 5910 | 0 | provider-1 | 00:56:14 |
| ANIMETRY | COMPLETED | 7831 | 0 | provider-1 | 00:56:21 |
| 1000SATSTRY | COMPLETED | 4429 | 0 | provider-1 | 00:56:19 |
| SOLVTRY | COMPLETED | 4944 | 0 | provider-1 | 00:56:24 |
| ARPATRY | COMPLETED | 7306 | 0 | provider-1 | 00:56:29 |
| YBTRY | CANCELLED | 1900 | 0 | provider-1 | 00:56:26 |
| THETRY | COMPLETED | 4580 | 0 | provider-1 | 00:56:31 |
| ZKPTRY | COMPLETED | 2381 | 0 | provider-1 | 00:56:31 |
| TURTLETRY | CANCELLED | 1850 | 0 | provider-1 | 00:56:33 |
| ARTRY | COMPLETED | 5158 | 0 | provider-1 | 00:56:37 |
| WLFITRY | COMPLETED | 3558 | 0 | provider-1 | 00:56:37 |
| PORTALTRY | CANCELLED | 6128 | 0 | provider-1 | 00:56:43 |
| STXTRY | COMPLETED | 3005 | 0 | provider-1 | 00:56:40 |
| STRY | CANCELLED | 1374 | 0 | provider-1 | 00:56:42 |
| STRKTRY | COMPLETED | 4285 | 0 | provider-1 | 00:56:46 |
| STRAXTRY | COMPLETED | 3853 | 0 | provider-1 | 00:56:47 |
| SPKTRY | COMPLETED | 2375 | 0 | provider-1 | 00:56:49 |
| TNSRTRY | CANCELLED | 1401 | 0 | provider-1 | 00:56:49 |
| SKYTRY | COMPLETED | 5158 | 0 | provider-1 | 00:56:54 |
| AIGENSYNTRY | COMPLETED | 3292 | 0 | provider-1 | 00:56:52 |
| USDCTRY | COMPLETED | 8863 | 0 | provider-1 | 00:57:02 |
| USDTTRY | COMPLETED | 10588 | 0 | provider-1 | 00:57:05 |
| PYTHTRY | CANCELLED | 5497 | 0 | provider-1 | 00:57:08 |
| SLPTRY | COMPLETED | 4256 | 0 | provider-1 | 00:57:12 |
| TRXTRY | COMPLETED | 5923 | 0 | provider-1 | 00:57:14 |
| MUBARAKTRY | COMPLETED | 2976 | 0 | provider-1 | 00:57:15 |
| SUITRY | COMPLETED | 3760 | 0 | provider-1 | 00:57:19 |
| ACETRY | COMPLETED | 4631 | 0 | provider-1 | 00:57:21 |
| STOTRY | COMPLETED | 5212 | 0 | provider-1 | 00:57:25 |
| BONKTRY | COMPLETED | 3663 | 0 | provider-1 | 00:57:24 |
| ADATRY | COMPLETED | 6545 | 0 | provider-1 | 00:57:31 |
| ZKCTRY | CANCELLED | 1397 | 0 | provider-1 | 00:57:26 |
| 0GTRY | COMPLETED | 5776 | 0 | provider-1 | 00:57:33 |
| ENATRY | COMPLETED | 5904 | 0 | provider-1 | 00:57:39 |

### Seçilen Sembol Pipeline — SUPERTRY

Decision trace kayıtları: **0** | Consensus: **1** | EV: **1** | Lifecycle: **0** | TDI: **0**

**consensus-trace (seçilen sembol, son 10):**

| timestamp | finalDecision | masterRule | reason | votes |
| --- | --- | --- | --- | --- |
| 00:53:26 | NO_TRADE | NO-TRADE | regime=RANGE_SIDEWAYS, tech=67.34, sentiment=56.03, risk=67. | {"provider-1":"BUY","provider-3":"HOLD"} |

**ev-trace (seçilen sembol, son 10):**

| timestamp | verdict | EV | threshold | winProb | RR | reason |
| --- | --- | --- | --- | --- | --- | --- |
| 00:53:26 | REJECTED | 64.5452 | 36 | 52.69 | 11.5304 | EV_REJECT |

### tdi-sensitivity

| Alan | Değer |
| --- | --- |
| currentThreshold | 55 |
| scoreAboveThresholdRate | 0 |
| runtimeApprovalEquivalentRate | 0 |
| runtimeWaitCount | 0 |
| runtimeRejectedCount | 0 |
| recommendation | INSUFFICIENT_DATA |
| productionReplayStatus | INCOMPLETE |

**Score distribution:** min=0 p50=0 p90=0 max=0

### ev-component-attribution

| component | weight | observed | quality |
| --- | --- | --- | --- |
| expectedProfit | 0.35 | 1.3126 | HIGH |
| expectedLoss | 0.25 | -0.5942 | HIGH |
| fees | 0.15 | 0 | HIGH |
| winProbability | 0.15 | 28.1555 | HIGH |
| expectedRiskReward | 0.1 | 2.2593 | HIGH |

Dominant component: **winProbability** (sample=82)

### round-liveness (tur sonu snapshot)

| Alan | Değer |
| --- | --- |
| state | "UNKNOWN" |
| currentStage | "EXECUTING" |
| lastMeaningfulProgressAt | "2026-08-23T00:57:48.322Z" |
| meaningfulProgressAgeMs | 267193 |
| lastHeartbeatAt | "2026-08-23T00:57:49.387Z" |
| heartbeatAgeMs | 266128 |
| activeWork | {"scanner":93,"ai":93,"marketData":0} |
| activeRetries | 12 |
| activeCandidates | 0 |
| poolActive | 0 |
| poolQueued | 0 |
| remainingBudgetMs | 800378 |
| abortRequested | false |
| abortReason | null |
| stallDetectedAt | null |
| terminalizationStartedAt | null |
| terminalState | "EXECUTING" |
| terminalizationDurationMs | null |

### round-watchdog

| Alan | Değer |
| --- | --- |
| roundId | "10" |
| runId | "cmt53cvq21jiuun8g4237c6h1" |
| jobId | "cmt4zxkbm001gun8ghz4qsb0w" |
| lastProgressAt | "2026-08-23T00:57:48.322Z" |
| lastHeartbeatAt | "2026-08-23T00:57:49.387Z" |
| currentStage | "EXECUTING" |
| elapsedSinceProgressMs | 267192 |
| elapsedSinceHeartbeatMs | 266127 |
| decision | "NONE" |
| action | "Legitimate long-running stage" |
| reasonDetail | "Monitoring active position" |
| recordedAt | "2026-08-23T01:02:15.514Z" |

### resolved-config (runtime)

```json
{
  "generatedAt": "2026-08-23T01:02:15.485Z",
  "exchange": "binance",
  "universe": {
    "scannerUniverse": "ALL_SPOT",
    "maxSymbols": 1200,
    "maxCycleSec": 180
  },
  "aiMode": {
    "executionMode": "paper",
    "minConfidence": 60,
    "strictAnalystMode": false,
    "remoteRequired": false
  },
  "strategyConfig": {},
  "evConfig": {
    "minRiskRewardRatio": 1.25,
    "minTradeQualityScore": 45
  },
  "risk": {
    "maxDailyLossPercent": 5,
    "maxOpenPositions": 3
  },
  "sizing": {},
  "fees": {
    "binanceTakerFeeRate": 0.0015,
    "binanceMakerFeeRate": 0.0009
  },
  "simulationWindow": {
    "autoRoundSelectionBudgetSec": 1200
  },
  "maxPositions": 3,
  "timeframes": [
    "1m",
    "5m",
    "15m",
    "1h",
    "4h"
  ]
}
```

### Promotion / Research Gates

| Gate | promoted | status/detail |
| --- | --- | --- |
| promotion-gate | false | RESEARCH_ONLY |
| p1-promotion-gate | false | RESEARCH_ONLY |
| strategy-comparison | false | 07503ff4691831f0 |

### Artifact Envanteri (bu tur)

| dosya | KB |
| --- | --- |
| candidate-trace.json | 126 |
| missed-opportunities.json | 109 |
| consensus-trace.json | 99 |
| scanner-summary.json | 75 |
| opportunity-value.json | 65 |
| ai-progress.json | 48 |
| ev-trace.json | 35 |
| pump-scan-lifecycle.json | 33 |
| transaction-duration.json | 24 |
| errors.json | 20 |
| candidate-lifecycle.json | 16 |
| stage-timings.json | 7 |
| round-summary.json | 5 |
| profitability-experiments.json | 4 |
| selectionTimeBudgetBreakdown.json | 4 |
| tdi-data-quality.json | 4 |
| ev-component-attribution.json | 2 |
| opportunity-funnel.json | 2 |
| p1-promotion-gate.json | 2 |
| promotion-gate.json | 2 |
| single-change-experiments.json | 2 |
| tdi-sensitivity.json | 2 |
| candidate-quality-factors.json | 1 |
| entry-timing-experiment.json | 1 |
| exit-forensics.json | 1 |
| fee-aware-entry-experiment.json | 1 |
| mr-regime-gating-experiment.json | 1 |
| profitability-experiments.csv | 1 |
| promotion-decisions.json | 1 |
| resolved-config.json | 1 |
| round-liveness.json | 1 |
| slot-allocation-experiment.json | 1 |
| strategy-comparison-report.json | 1 |
| volatility-breakout-validation.json | 1 |
| ai-strategy-interaction.json | 0 |
| ai-trace.json | 0 |
| baseline-metrics.json | 0 |
| decision-trace.json | 0 |
| entry-timing.json | 0 |
| ev-calibration.json | 0 |
| execution-trace.json | 0 |
| exit-fee-interaction.json | 0 |
| exit-trace.json | 0 |
| fee-aware-edge-research.json | 0 |
| fee-aware-entry-policy.json | 0 |
| fee-by-hold-time.json | 0 |
| fee-by-strategy.json | 0 |
| gross-positive-net-negative.json | 0 |
| loss-patterns.json | 0 |
| mean-reversion-audit.json | 0 |
| not-discovered-analysis.json | 0 |
| out-of-sample-evaluation.json | 0 |
| pnl-ledger.json | 0 |
| position-trace.json | 0 |
| profit-concentration.json | 0 |
| recovery-decisions.json | 0 |
| recovery-telemetry.json | 0 |
| replay-exit-diagnostics.json | 0 |
| replayExitDiagnostics.json | 0 |
| risk-sizing-trace.json | 0 |
| round-watchdog.json | 0 |
| scanner-qualification.json | 0 |
| slot-allocation-analysis.json | 0 |
| slot-opportunity-report.json | 0 |
| strategy-performance.json | 0 |
| strategy-regime-matrix-p2.csv | 0 |
| strategy-regime-matrix-p2.json | 0 |
| strategy-regime-matrix.json | 0 |
| strategy-trace.json | 0 |
| tdi-decisions.json | 0 |
| tdi-input-contract.json | 0 |
| tdi-missing-telemetry-report.json | 0 |
| trend-following-validation.json | 0 |
| winning-patterns.json | 0 |

---

## 5. Round 11 — Job Abort & Zombie

| Alan | Değer |
| --- | --- |
| round11 runId | cmt53r6rf1oa6un8gst00c5dn |
| state | tariyor |
| symbol | POLTRY |
| startedAt | 2026-08-23T01:02:16.059Z |
| endedAt | — (ZOMBIE) |
| failReason | — |

**Job lastError:** `scanner-ai pool aborted: Tur secim suresi doldu (1200s)`

Round 11 attempt 3: scanner-ai pool ~83 candidate, ~9 işlendi → **1200s selection budget** doldu → job FAILED.

## 6. Final Verdict

```
ROUND_TARGET = 10
ROUNDS_COMPLETED = 0
ROUNDS_FAILED = 10
TRADES = 0
NET_PNL = 0
AI_VETO_BYPASS = 0
ZOMBIE_ROUNDS = 1
VARIANT_D_LIVE_TRADES = 0
PRIMARY_RUNTIME_INCIDENT = scanner-ai pool aborted: Tur secim suresi doldu (1200s)
PRIMARY_LOSS_DRIVER = ZERO_TRADES_FUNNEL_BLOCK
PROFITABILITY_STATUS = NOT_PROVEN
POLICY_CHANGES = NO
```

## 7. Mühendislik Önceliği (10 tur verisi)

1. **Selection budget vs throughput** — Round 1 `execution_preparation` ~87% budget; Round 11 scanner-ai timeout.
2. **AI_VETO @ EXECUTING** — 8 tur pipeline derinliği yüksek; final gate reddi.
3. **SIM_TIGHT_FILTER** — Tur #2 INJTRY, #6 LUNCTRY scanner block.
4. **TDI approval = 0** — yoğun reject/wait; sensitivity NO_CHANGE öneriyor.
5. **Zombie Round 11 reconcile** — yeni job engeli riski.
