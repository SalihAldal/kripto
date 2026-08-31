# KRIPTO — MISSED OPPORTUNITY FORENSIC
# ZRO/TRY + STX/TRY + PUMP/TRY
# 03:00–10:00 MARKET WINDOW ANALYSIS

> Generated: 2026-08-23T11:59:26.935Z
> Research / forensics only — no policy or runtime changes

## Timezone & Window

- **Declared window**: 2026-08-23 03:00–10:00 Europe/Istanbul
- **Artifact/runtime timezone**: UTC (ISO-8601 Z timestamps in all forensic JSON)
- **Local interpretation**: Europe/Istanbul UTC+3 — window equals UTC 2026-08-23 00:00:00 – 07:00:00
- **Primary data source**: Overnight paper job cmt4zxkbm001gun8ghz4qsb0w (FAILED after 10 rounds, ended ~01:22 UTC = 04:22 Istanbul)
- **Runtime coverage in window**: ~00:00–01:22 UTC (03:00–04:22 Istanbul) — remainder of 03:00–10:00 Istanbul has **no live scanner** in repository

## Executive Summary

All three symbols were **observed by the engine** during the overlapping runtime window. None reached execution. Repository artifacts contain **scores, verdicts, and pipeline traces** but **no reliable OHLCV price path** for 03:00–10:00 reconstruction — market move sections are **INSUFFICIENT_EVIDENCE** for forward returns.

| Symbol | First seen (window) | First blocker (window) | Classification |
|--------|---------------------|--------------------------|----------------|
| ZRO/TRY | 2026-08-23 03:01:57 Istanbul | scanner / SPREAD_TOO_WIDE / SPREAD_TOO_WIDE | B) DISCOVERED_BUT_SCANNER_REJECTED |
| STX/TRY | 2026-08-23 03:02:57 Istanbul | scanner / REJECTED / REJECTED | B) DISCOVERED_BUT_SCANNER_REJECTED |
| PUMP/TRY | 2026-08-23 03:01:09 Istanbul | scanner / REJECTED / REJECTED | B) DISCOVERED_BUT_SCANNER_REJECTED |

---

## ZRO/TRY (ZROTRY)

### PART 1 — Market Move Reconstruction

**Status: INSUFFICIENT_EVIDENCE from repository artifacts.**

Scanner-summary and TDI artifacts do not contain a continuous OHLCV series for 03:00–10:00. price fields in scanner cycles are often 0 (stale/missing). No kline cache exists in repo for this window.

Cannot compute: return from 03:00, forward 5/15/30/60m, max favorable/adverse move without external market data (not used — repository-only constraint).

### PART 2 — Scanner / Pipeline Observations (window-filtered)

Total artifact occurrences in window: **45** (all-time in overnight job: **488**)

**Discovery timing:**

| Milestone | Timestamp (UTC) | Istanbul |
|-----------|-----------------|----------|
| FIRST_SEEN_AT | 2026-08-23T00:01:57.375Z | 2026-08-23 03:01:57 Istanbul |
| FIRST_CANDIDATE_AT | 2026-08-23T00:01:57.375Z | 2026-08-23 03:01:57 Istanbul |
| FIRST_TDI_AT | UNKNOWN | UNKNOWN |
| FIRST_AI_AT | 2026-08-23T00:01:57.375Z | 2026-08-23 03:01:57 Istanbul |
| FIRST_EV_AT | 2026-08-23T00:02:00.671Z | 2026-08-23 03:02:00 Istanbul |
| FIRST_EXECUTION_READY_AT | UNKNOWN | UNKNOWN |

**FIRST_BLOCKER:** scanner | SPREAD_TOO_WIDE | SPREAD_TOO_WIDE

**ALL_BLOCKERS:**
- scanner:SPREAD_TOO_WIDE
- ai:AI_DEGRADED
- ev:EV_REJECT
- consensus:CONSENSUS_REJECT
- scanner:REJECTED
- ai:PRE_AI_SPREAD_REJECT
- candidate:PUMP_NOT_EARLY_OR_CONTINUATION
- candidate:CANDIDATE_REJECTED
- candidate:PUMP_CONFIRM_NO_TRADE

### PART 4 — Decision Trace (window events)

| ts (Istanbul) | round | stage | verdict | reason | detail |
|---------------|-------|-------|---------|--------|--------|
| 2026-08-23 03:01:57 Istanbul | 5 | ai | COMPLETED |  |  |
| 2026-08-23 03:01:57 Istanbul | 5 | scanner | REJECTED | SPREAD_TOO_WIDE | SPREAD_TOO_WIDE |
| 2026-08-23 03:02:00 Istanbul | 5 | ai | FAILED | AI_DEGRADED | AI_DEGRADED |
| 2026-08-23 03:02:00 Istanbul | 5 | ev | REJECTED | EV_REJECT |  |
| 2026-08-23 03:02:00 Istanbul | 5 | consensus |  |  | regime=RANGE_SIDEWAYS, tech=55.35, sentiment=47.01, risk=59. |
| 2026-08-23 03:02:00 Istanbul | 5 | consensus | REJECTED | CONSENSUS_REJECT | regime=RANGE_SIDEWAYS, tech=55.35, sentiment=47.01, risk=59. |
| 2026-08-23 03:10:31 Istanbul | 6 | scanner | REJECTED | REJECTED | REJECTED |
| 2026-08-23 03:10:34 Istanbul | 6 | ai | FAILED | AI_DEGRADED | AI_DEGRADED |
| 2026-08-23 03:10:34 Istanbul | 6 | consensus |  |  | regime=RANGE_SIDEWAYS, tech=50.05, sentiment=47.01, risk=67. |
| 2026-08-23 03:10:34 Istanbul | 6 | ev | REJECTED | EV_REJECT |  |
| 2026-08-23 03:10:34 Istanbul | 6 | consensus | REJECTED | CONSENSUS_REJECT | regime=RANGE_SIDEWAYS, tech=50.05, sentiment=47.01, risk=67. |
| 2026-08-23 03:16:11 Istanbul | 6 | scanner | REJECTED | REJECTED | REJECTED |
| 2026-08-23 03:16:15 Istanbul | 6 | ai | FAILED | AI_DEGRADED | AI_DEGRADED |
| 2026-08-23 03:16:15 Istanbul | 6 | consensus |  |  | regime=RANGE_SIDEWAYS, tech=49.15, sentiment=47.01, risk=67. |
| 2026-08-23 03:16:15 Istanbul | 6 | ev | REJECTED | EV_REJECT |  |
| 2026-08-23 03:16:15 Istanbul | 6 | consensus | REJECTED | CONSENSUS_REJECT | regime=RANGE_SIDEWAYS, tech=49.15, sentiment=47.01, risk=67. |
| 2026-08-23 03:20:59 Istanbul | 6 | ai | COMPLETED |  |  |
| 2026-08-23 03:20:59 Istanbul | 6 | scanner | REJECTED | REJECTED | REJECTED |
| 2026-08-23 03:21:03 Istanbul | 6 | ai | FAILED | AI_DEGRADED | AI_DEGRADED |
| 2026-08-23 03:21:03 Istanbul | 6 | ev | REJECTED | EV_REJECT |  |
| 2026-08-23 03:21:03 Istanbul | 6 | consensus |  |  | regime=RANGE_SIDEWAYS, tech=41.25, sentiment=47.01, risk=67. |
| 2026-08-23 03:21:03 Istanbul | 6 | consensus | REJECTED | CONSENSUS_REJECT | regime=RANGE_SIDEWAYS, tech=41.25, sentiment=47.01, risk=67. |
| 2026-08-23 03:25:44 Istanbul | 7 | ai | CANCELLED | PRE_AI_SPREAD_REJECT | Candidate rejected before AI due to spread gate |
| 2026-08-23 03:31:35 Istanbul | 8 | candidate | REJECTED | PUMP_NOT_EARLY_OR_CONTINUATION | Candidate failed early/continuation gate |
| 2026-08-23 03:31:35 Istanbul | 8 | candidate | REJECTED | CANDIDATE_REJECTED | Pump confirmation NO_TRADE (continuation) |
| 2026-08-23 03:31:35 Istanbul | 8 | candidate | REJECTED | PUMP_CONFIRM_NO_TRADE | Pump confirmation NO_TRADE (continuation) |
| 2026-08-23 03:36:36 Istanbul | 8 | ai | COMPLETED |  |  |
| 2026-08-23 03:36:36 Istanbul | 8 | scanner | REJECTED | REJECTED | REJECTED |
| 2026-08-23 03:36:39 Istanbul | 8 | ai | FAILED | AI_DEGRADED | AI_DEGRADED |
| 2026-08-23 03:36:40 Istanbul | 8 | consensus |  |  | regime=RANGE_SIDEWAYS, tech=42.82, sentiment=47.01, risk=61. |
| 2026-08-23 03:36:40 Istanbul | 8 | ev | REJECTED | EV_REJECT |  |
| 2026-08-23 03:36:40 Istanbul | 8 | consensus | REJECTED | CONSENSUS_REJECT | regime=RANGE_SIDEWAYS, tech=42.82, sentiment=47.01, risk=61. |
| 2026-08-23 03:46:29 Istanbul | 9 | ai | COMPLETED |  |  |
| 2026-08-23 03:46:29 Istanbul | 9 | scanner | REJECTED | REJECTED | REJECTED |
| 2026-08-23 03:46:32 Istanbul | 9 | ai | FAILED | AI_DEGRADED | AI_DEGRADED |
| 2026-08-23 03:46:32 Istanbul | 9 | consensus |  |  | regime=RANGE_SIDEWAYS, tech=44.09, sentiment=47.01, risk=67. |
| 2026-08-23 03:46:32 Istanbul | 9 | ev | REJECTED | EV_REJECT |  |
| 2026-08-23 03:46:32 Istanbul | 9 | consensus | REJECTED | CONSENSUS_REJECT | regime=RANGE_SIDEWAYS, tech=44.09, sentiment=47.01, risk=67. |
| 2026-08-23 03:53:36 Istanbul | 10 | ai | COMPLETED |  |  |
| 2026-08-23 03:53:36 Istanbul | 10 | scanner | REJECTED | REJECTED | REJECTED |
| 2026-08-23 03:53:39 Istanbul | 10 | ai | FAILED | AI_DEGRADED | AI_DEGRADED |
| 2026-08-23 03:53:39 Istanbul | 10 | ev | REJECTED | EV_REJECT |  |
| 2026-08-23 03:53:39 Istanbul | 10 | consensus |  |  | regime=RANGE_SIDEWAYS, tech=59.70, sentiment=47.01, risk=67. |
| 2026-08-23 03:53:39 Istanbul | 10 | consensus | REJECTED | CONSENSUS_REJECT | regime=RANGE_SIDEWAYS, tech=59.70, sentiment=47.01, risk=67. |
| 2026-08-23 04:22:02 Istanbul | 11 | ai | CANCELLED | PRE_AI_SPREAD_REJECT | Candidate rejected before AI due to spread gate |


### PART 5 — TDI Analysis

**2026-08-22T23:18:45.825Z** — verdict=REJECTED hybrid=NO_TRADE
- technical=68.33 momentum=0 shortMom=0 shortFlow=0
- sentiment=47.01 confidence=44.62 execution=56.17 bullish=2
- firstBlocking=MOMENTUM blocks=[MOMENTUM]
- regime context: Yatay pazar (trend=0.01, momentum=0.90, vol=1.58). Stability=NEW_REGIME, transition=2.13.
- reason: No-trade mode: Momentum guven vermiyor

**2026-08-22T23:18:45.911Z** — verdict=REJECTED hybrid=NO_TRADE
- technical=68.33 momentum=36.93 shortMom=0 shortFlow=0
- sentiment=47.01 confidence=26.98 execution=92.93 bullish=5
- firstBlocking=LEARNING blocks=[LEARNING, MOMENTUM]
- regime context: Yatay pazar (trend=0.01, momentum=0.90, vol=1.58). Stability=NEW_REGIME, transition=2.13.
- reason: NO_TRADE resolved by master decision engine. Overall confidence 22. Supported by RISK and EXECUTION. Blocked/reduced by LEARNING and MOMENTUM. Risk acceptable.

**2026-08-22T23:22:56.373Z** — verdict=WAIT hybrid=HOLD
- technical=81.5 momentum=0 shortMom=0 shortFlow=0
- sentiment=56.48 confidence=53.24 execution=58.81 bullish=2
- firstBlocking=MOMENTUM blocks=[MOMENTUM]
- regime context: Yatay pazar (trend=0.01, momentum=0.72, vol=1.42).
- reason: Momentum guven vermiyor | Haber/sentiment karmasik | Teknik guclu ama diger AI destegi zayif

**2026-08-22T23:22:56.444Z** — verdict=REJECTED hybrid=HOLD
- technical=81.5 momentum=36.93 shortMom=0 shortFlow=0
- sentiment=56.48 confidence=31.68 execution=100 bullish=5
- firstBlocking=LEARNING blocks=[LEARNING, MOMENTUM]
- regime context: Yatay pazar (trend=0.01, momentum=0.72, vol=1.42).
- reason: NO_TRADE resolved by master decision engine. Overall confidence 22. Supported by EXECUTION and RISK. Blocked/reduced by LEARNING and MOMENTUM. Risk acceptable.

**2026-08-22T23:28:27.799Z** — verdict=REJECTED hybrid=NO_TRADE
- technical=52.14 momentum=0 shortMom=0 shortFlow=0
- sentiment=47.01 confidence=35.18 execution=55.61 bullish=1
- firstBlocking=MOMENTUM blocks=[MOMENTUM]
- regime context: Yatay pazar (trend=0.00, momentum=-0.89, vol=0.84). Stability=CHOP, transition=26.33.
- reason: No-trade mode: Momentum guven vermiyor | Regime chop/rapid switching (CHOP)

### PART 6 — SIM_TIGHT_FILTER

Not evaluated for these symbols in the analyzed window occurrences.

### PART 7 — AI Trace

- 2026-08-23T00:01:57.375Z:  / COMPLETED (round 5) — 
- 2026-08-23T00:02:00.657Z: AI_DEGRADED / FAILED (round 5) — AI_DEGRADED
- 2026-08-23T00:10:34.811Z: AI_DEGRADED / FAILED (round 6) — AI_DEGRADED
- 2026-08-23T00:16:15.131Z: AI_DEGRADED / FAILED (round 6) — AI_DEGRADED
- 2026-08-23T00:20:59.674Z:  / COMPLETED (round 6) — 
- 2026-08-23T00:21:03.487Z: AI_DEGRADED / FAILED (round 6) — AI_DEGRADED
- 2026-08-23T00:25:44.964Z: PRE_AI_SPREAD_REJECT / CANCELLED (round 7) — Candidate rejected before AI due to spread gate
- 2026-08-23T00:36:36.629Z:  / COMPLETED (round 8) — 
- 2026-08-23T00:36:39.835Z: AI_DEGRADED / FAILED (round 8) — AI_DEGRADED
- 2026-08-23T00:46:29.481Z:  / COMPLETED (round 9) — 
- 2026-08-23T00:46:32.664Z: AI_DEGRADED / FAILED (round 9) — AI_DEGRADED
- 2026-08-23T00:53:36.883Z:  / COMPLETED (round 10) — 
- 2026-08-23T00:53:39.908Z: AI_DEGRADED / FAILED (round 10) — AI_DEGRADED
- 2026-08-23T01:22:02.127Z: PRE_AI_SPREAD_REJECT / CANCELLED (round 11) — Candidate rejected before AI due to spread gate

**AI classification:** AI_DEGRADED on degraded evaluation path (not final VETO on selected symbol in window).

### PART 8 — EV / Edge

- 2026-08-23T00:02:00.671Z: REJECTED EV_REJECT (round 5)
- 2026-08-23T00:10:34.907Z: REJECTED EV_REJECT (round 6)
- 2026-08-23T00:16:15.145Z: REJECTED EV_REJECT (round 6)
- 2026-08-23T00:21:03.504Z: REJECTED EV_REJECT (round 6)
- 2026-08-23T00:36:40.905Z: REJECTED EV_REJECT (round 8)
- 2026-08-23T00:46:32.678Z: REJECTED EV_REJECT (round 9)
- 2026-08-23T00:53:39.920Z: REJECTED EV_REJECT (round 10)

### PART 9 — Throughput / Latency

**Classification:** NO_LATENCY_EVIDENCE

### PART 10 — Classification

**Primary:** B) DISCOVERED_BUT_SCANNER_REJECTED
**Secondary:** Downstream AI_DEGRADED on parallel/degraded path

### PART 11 — Counterfactual Timing

Forward returns: **UNKNOWN** (no price series in repo).

### PART 12 — Historical Opportunity Value

maxFavorableMove / maxAdverseMove: **UNKNOWN**
discoveredBeforeMove: **UNKNOWN**

---

## STX/TRY (STXTRY)

### PART 1 — Market Move Reconstruction

**Status: INSUFFICIENT_EVIDENCE from repository artifacts.**

Scanner-summary and TDI artifacts do not contain a continuous OHLCV series for 03:00–10:00. price fields in scanner cycles are often 0 (stale/missing). No kline cache exists in repo for this window.

Cannot compute: return from 03:00, forward 5/15/30/60m, max favorable/adverse move without external market data (not used — repository-only constraint).

### PART 2 — Scanner / Pipeline Observations (window-filtered)

Total artifact occurrences in window: **51** (all-time in overnight job: **647**)

**Discovery timing:**

| Milestone | Timestamp (UTC) | Istanbul |
|-----------|-----------------|----------|
| FIRST_SEEN_AT | 2026-08-23T00:02:57.451Z | 2026-08-23 03:02:57 Istanbul |
| FIRST_CANDIDATE_AT | 2026-08-23T00:02:57.451Z | 2026-08-23 03:02:57 Istanbul |
| FIRST_TDI_AT | UNKNOWN | UNKNOWN |
| FIRST_AI_AT | 2026-08-23T00:02:57.451Z | 2026-08-23 03:02:57 Istanbul |
| FIRST_EV_AT | 2026-08-23T00:03:01.262Z | 2026-08-23 03:03:01 Istanbul |
| FIRST_EXECUTION_READY_AT | UNKNOWN | UNKNOWN |

**FIRST_BLOCKER:** scanner | REJECTED | REJECTED

**ALL_BLOCKERS:**
- scanner:REJECTED
- ai:AI_DEGRADED
- ev:EV_WAIT
- consensus:CONSENSUS_REJECT
- candidate:PUMP_NOT_EARLY_OR_CONTINUATION
- candidate:PUMP_CONFIRM_NO_TRADE
- candidate:CANDIDATE_REJECTED
- ev:EV_REJECT

### PART 4 — Decision Trace (window events)

| ts (Istanbul) | round | stage | verdict | reason | detail |
|---------------|-------|-------|---------|--------|--------|
| 2026-08-23 03:02:57 Istanbul | 5 | ai | COMPLETED |  |  |
| 2026-08-23 03:02:57 Istanbul | 5 | scanner | REJECTED | REJECTED | REJECTED |
| 2026-08-23 03:03:01 Istanbul | 5 | ai | FAILED | AI_DEGRADED | AI_DEGRADED |
| 2026-08-23 03:03:01 Istanbul | 5 | ev | WAIT | EV_WAIT |  |
| 2026-08-23 03:03:01 Istanbul | 5 | consensus |  |  | regime=HIGH_VOLATILITY_CHAOS, tech=52.82, sentiment=57.41, r |
| 2026-08-23 03:03:01 Istanbul | 5 | consensus | REJECTED | CONSENSUS_REJECT | regime=HIGH_VOLATILITY_CHAOS, tech=52.82, sentiment=57.41, r |
| 2026-08-23 03:03:20 Istanbul | 5 | candidate | REJECTED | PUMP_NOT_EARLY_OR_CONTINUATION | Candidate failed early/continuation gate |
| 2026-08-23 03:03:20 Istanbul | 5 | candidate | REJECTED | PUMP_CONFIRM_NO_TRADE | Pump confirmation NO_TRADE (continuation) |
| 2026-08-23 03:03:20 Istanbul | 5 | candidate | REJECTED | PUMP_NOT_EARLY_OR_CONTINUATION | Candidate failed early/continuation gate |
| 2026-08-23 03:03:20 Istanbul | 5 | candidate | REJECTED | PUMP_CONFIRM_NO_TRADE | Pump confirmation NO_TRADE (continuation) |
| 2026-08-23 03:03:20 Istanbul | 5 | candidate | REJECTED | PUMP_NOT_EARLY_OR_CONTINUATION | Candidate failed early/continuation gate |
| 2026-08-23 03:03:20 Istanbul | 5 | candidate | REJECTED | PUMP_CONFIRM_NO_TRADE | Pump confirmation NO_TRADE (continuation) |
| 2026-08-23 03:03:20 Istanbul | 5 | candidate | REJECTED | PUMP_NOT_EARLY_OR_CONTINUATION | Candidate failed early/continuation gate |
| 2026-08-23 03:03:20 Istanbul | 5 | candidate | REJECTED | PUMP_CONFIRM_NO_TRADE | Pump confirmation NO_TRADE (continuation) |
| 2026-08-23 03:07:40 Istanbul | 6 | candidate | REJECTED | PUMP_NOT_EARLY_OR_CONTINUATION | Candidate failed early/continuation gate |
| 2026-08-23 03:07:40 Istanbul | 6 | candidate | REJECTED | CANDIDATE_REJECTED | Pump confirmation NO_TRADE (continuation) |
| 2026-08-23 03:07:40 Istanbul | 6 | candidate | REJECTED | PUMP_CONFIRM_NO_TRADE | Pump confirmation NO_TRADE (continuation) |
| 2026-08-23 03:12:26 Istanbul | 6 | scanner | REJECTED | REJECTED | REJECTED |
| 2026-08-23 03:12:31 Istanbul | 6 | ai | FAILED | AI_DEGRADED | AI_DEGRADED |
| 2026-08-23 03:12:31 Istanbul | 6 | ev | WAIT | EV_WAIT |  |
| 2026-08-23 03:12:31 Istanbul | 6 | consensus |  |  | regime=HIGH_VOLATILITY_CHAOS, tech=55.35, sentiment=22.11, r |
| 2026-08-23 03:12:31 Istanbul | 6 | consensus | REJECTED | CONSENSUS_REJECT | regime=HIGH_VOLATILITY_CHAOS, tech=55.35, sentiment=22.11, r |
| 2026-08-23 03:18:18 Istanbul | 6 | scanner | REJECTED | REJECTED | REJECTED |
| 2026-08-23 03:18:48 Istanbul | 6 | ai | FAILED | AI_DEGRADED | AI_DEGRADED |
| 2026-08-23 03:18:48 Istanbul | 6 | ev | REJECTED | EV_REJECT |  |
| 2026-08-23 03:18:48 Istanbul | 6 | consensus |  |  | regime=RANGE_SIDEWAYS, tech=49.14, sentiment=64.94, risk=61. |
| 2026-08-23 03:18:48 Istanbul | 6 | consensus | REJECTED | CONSENSUS_REJECT | regime=RANGE_SIDEWAYS, tech=49.14, sentiment=64.94, risk=61. |
| 2026-08-23 03:21:38 Istanbul | 6 | ai | COMPLETED |  |  |
| 2026-08-23 03:21:38 Istanbul | 6 | scanner | REJECTED | REJECTED | REJECTED |
| 2026-08-23 03:21:42 Istanbul | 6 | ai | FAILED | AI_DEGRADED | AI_DEGRADED |
| 2026-08-23 03:21:42 Istanbul | 6 | ev | REJECTED | EV_REJECT |  |
| 2026-08-23 03:21:42 Istanbul | 6 | consensus |  |  | regime=RANGE_SIDEWAYS, tech=52.91, sentiment=47.01, risk=59. |
| 2026-08-23 03:21:42 Istanbul | 6 | consensus | REJECTED | CONSENSUS_REJECT | regime=RANGE_SIDEWAYS, tech=52.91, sentiment=47.01, risk=59. |
| 2026-08-23 03:37:33 Istanbul | 8 | ai | COMPLETED |  |  |
| 2026-08-23 03:37:33 Istanbul | 8 | scanner | REJECTED | REJECTED | REJECTED |
| 2026-08-23 03:37:34 Istanbul | 8 | ai | FAILED | AI_DEGRADED | AI_DEGRADED |
| 2026-08-23 03:37:35 Istanbul | 8 | consensus |  |  | regime=RANGE_SIDEWAYS, tech=44.59, sentiment=49.01, risk=61. |
| 2026-08-23 03:37:35 Istanbul | 8 | ev | REJECTED | EV_REJECT |  |
| 2026-08-23 03:37:35 Istanbul | 8 | consensus | REJECTED | CONSENSUS_REJECT | regime=RANGE_SIDEWAYS, tech=44.59, sentiment=49.01, risk=61. |
| 2026-08-23 03:49:12 Istanbul | 9 | ai | COMPLETED |  |  |
| 2026-08-23 03:49:13 Istanbul | 9 | scanner | REJECTED | REJECTED | REJECTED |
| 2026-08-23 03:49:14 Istanbul | 9 | ai | FAILED | AI_DEGRADED | AI_DEGRADED |
| 2026-08-23 03:49:15 Istanbul | 9 | consensus |  |  | regime=RANGE_SIDEWAYS, tech=35.63, sentiment=49.00, risk=61. |
| 2026-08-23 03:49:15 Istanbul | 9 | ev | REJECTED | EV_REJECT |  |
| 2026-08-23 03:49:15 Istanbul | 9 | consensus | REJECTED | CONSENSUS_REJECT | regime=RANGE_SIDEWAYS, tech=35.63, sentiment=49.00, risk=61. |
| 2026-08-23 03:56:37 Istanbul | 10 | ai | COMPLETED |  |  |
| 2026-08-23 03:56:37 Istanbul | 10 | scanner | REJECTED | REJECTED | REJECTED |
| 2026-08-23 03:56:38 Istanbul | 10 | ai | FAILED | AI_DEGRADED | AI_DEGRADED |
| 2026-08-23 03:56:40 Istanbul | 10 | ev | REJECTED | EV_REJECT |  |
| 2026-08-23 03:56:40 Istanbul | 10 | consensus |  |  | regime=RANGE_SIDEWAYS, tech=65.33, sentiment=61.01, risk=67. |
| 2026-08-23 03:56:40 Istanbul | 10 | consensus | REJECTED | CONSENSUS_REJECT | regime=RANGE_SIDEWAYS, tech=65.33, sentiment=61.01, risk=67. |


### PART 5 — TDI Analysis

**2026-08-22T23:17:28.012Z** — verdict=REJECTED hybrid=NO_TRADE
- technical=55.14 momentum=0 shortMom=0 shortFlow=0
- sentiment=49.01 confidence=43.1 execution=58.36 bullish=1
- firstBlocking=MOMENTUM blocks=[MOMENTUM]
- regime context: Yatay pazar (trend=0.01, momentum=0.95, vol=0.85). Stability=NEW_REGIME, transition=0.33.
- reason: No-trade mode: Momentum guven vermiyor

**2026-08-22T23:17:28.119Z** — verdict=REJECTED hybrid=NO_TRADE
- technical=55.14 momentum=36.93 shortMom=0 shortFlow=0
- sentiment=49.01 confidence=26.18 execution=93.43 bullish=5
- firstBlocking=LEARNING blocks=[LEARNING, MOMENTUM]
- regime context: Yatay pazar (trend=0.01, momentum=0.95, vol=0.85). Stability=NEW_REGIME, transition=0.33.
- reason: NO_TRADE resolved by master decision engine. Overall confidence 22. Supported by RISK and EXECUTION. Blocked/reduced by LEARNING and MOMENTUM. Risk acceptable.

**2026-08-22T23:24:43.106Z** — verdict=REJECTED hybrid=NO_TRADE
- technical=67.1 momentum=0 shortMom=0 shortFlow=0
- sentiment=42.2 confidence=12.35 execution=53.23 bullish=1
- firstBlocking=MOMENTUM blocks=[MOMENTUM, RISK]
- regime context: Volatilite/futures kaotik (vol=0.694 spread=0.000 fakeSpike=0.00 futuresRisk=69.0 intent=LATE_LONG_T
- reason: No-trade mode: Momentum guven vermiyor | Futures trap riski: LATE_LONG_TRAP

**2026-08-22T23:24:43.398Z** — verdict=REJECTED hybrid=NO_TRADE
- technical=67.1 momentum=35.58 shortMom=0 shortFlow=0
- sentiment=42.2 confidence=11.13 execution=94 bullish=3
- firstBlocking=LEARNING blocks=[LEARNING, MOMENTUM]
- regime context: Volatilite/futures kaotik (vol=0.694 spread=0.000 fakeSpike=0.00 futuresRisk=69.0 intent=LATE_LONG_T
- reason: NO_TRADE resolved by master decision engine. Overall confidence 16. Supported by EXECUTION and MARKET. Blocked/reduced by LEARNING and MOMENTUM. Risk remains elevated.

**2026-08-22T23:28:38.177Z** — verdict=WAIT hybrid=HOLD
- technical=68.15 momentum=0 shortMom=0 shortFlow=0
- sentiment=55.29 confidence=41.66 execution=53.97 bullish=2
- firstBlocking=MOMENTUM blocks=[MOMENTUM]
- regime context: Yatay pazar (trend=0.00, momentum=-0.09, vol=0.71). Stability=CHOP, transition=25.54.
- reason: Momentum guven vermiyor | Haber/sentiment karmasik | Teknik guclu ama diger AI destegi zayif | Regime chop/rapid switching (CHOP)

### PART 6 — SIM_TIGHT_FILTER

Not evaluated for these symbols in the analyzed window occurrences.

### PART 7 — AI Trace

- 2026-08-23T00:02:57.451Z:  / COMPLETED (round 5) — 
- 2026-08-23T00:03:01.249Z: AI_DEGRADED / FAILED (round 5) — AI_DEGRADED
- 2026-08-23T00:12:31.703Z: AI_DEGRADED / FAILED (round 6) — AI_DEGRADED
- 2026-08-23T00:18:48.069Z: AI_DEGRADED / FAILED (round 6) — AI_DEGRADED
- 2026-08-23T00:21:38.984Z:  / COMPLETED (round 6) — 
- 2026-08-23T00:21:42.107Z: AI_DEGRADED / FAILED (round 6) — AI_DEGRADED
- 2026-08-23T00:37:33.329Z:  / COMPLETED (round 8) — 
- 2026-08-23T00:37:34.350Z: AI_DEGRADED / FAILED (round 8) — AI_DEGRADED
- 2026-08-23T00:49:12.999Z:  / COMPLETED (round 9) — 
- 2026-08-23T00:49:14.020Z: AI_DEGRADED / FAILED (round 9) — AI_DEGRADED
- 2026-08-23T00:56:37.640Z:  / COMPLETED (round 10) — 
- 2026-08-23T00:56:38.538Z: AI_DEGRADED / FAILED (round 10) — AI_DEGRADED

**AI classification:** AI_DEGRADED on degraded evaluation path (not final VETO on selected symbol in window).

### PART 8 — EV / Edge

- 2026-08-23T00:03:01.262Z: WAIT EV_WAIT (round 5)
- 2026-08-23T00:12:31.887Z: WAIT EV_WAIT (round 6)
- 2026-08-23T00:18:48.083Z: REJECTED EV_REJECT (round 6)
- 2026-08-23T00:21:42.166Z: REJECTED EV_REJECT (round 6)
- 2026-08-23T00:37:35.952Z: REJECTED EV_REJECT (round 8)
- 2026-08-23T00:49:15.984Z: REJECTED EV_REJECT (round 9)
- 2026-08-23T00:56:40.570Z: REJECTED EV_REJECT (round 10)

### PART 9 — Throughput / Latency

**Classification:** NO_LATENCY_EVIDENCE

### PART 10 — Classification

**Primary:** B) DISCOVERED_BUT_SCANNER_REJECTED
**Secondary:** Downstream AI_DEGRADED on parallel/degraded path

### PART 11 — Counterfactual Timing

Forward returns: **UNKNOWN** (no price series in repo).

### PART 12 — Historical Opportunity Value

maxFavorableMove / maxAdverseMove: **UNKNOWN**
discoveredBeforeMove: **UNKNOWN**

---

## PUMP/TRY (PUMPTRY)

### PART 1 — Market Move Reconstruction

**Status: INSUFFICIENT_EVIDENCE from repository artifacts.**

Scanner-summary and TDI artifacts do not contain a continuous OHLCV series for 03:00–10:00. price fields in scanner cycles are often 0 (stale/missing). No kline cache exists in repo for this window.

Cannot compute: return from 03:00, forward 5/15/30/60m, max favorable/adverse move without external market data (not used — repository-only constraint).

### PART 2 — Scanner / Pipeline Observations (window-filtered)

Total artifact occurrences in window: **39** (all-time in overnight job: **958**)

**Discovery timing:**

| Milestone | Timestamp (UTC) | Istanbul |
|-----------|-----------------|----------|
| FIRST_SEEN_AT | 2026-08-23T00:01:09.288Z | 2026-08-23 03:01:09 Istanbul |
| FIRST_CANDIDATE_AT | 2026-08-23T00:01:09.288Z | 2026-08-23 03:01:09 Istanbul |
| FIRST_TDI_AT | UNKNOWN | UNKNOWN |
| FIRST_AI_AT | 2026-08-23T00:01:09.288Z | 2026-08-23 03:01:09 Istanbul |
| FIRST_EV_AT | 2026-08-23T00:01:12.588Z | 2026-08-23 03:01:12 Istanbul |
| FIRST_EXECUTION_READY_AT | UNKNOWN | UNKNOWN |

**FIRST_BLOCKER:** scanner | REJECTED | REJECTED

**ALL_BLOCKERS:**
- scanner:REJECTED
- ai:AI_DEGRADED
- ev:EV_WAIT
- consensus:CONSENSUS_REJECT
- ev:EV_REJECT
- ai:AI_FAILED

### PART 4 — Decision Trace (window events)

| ts (Istanbul) | round | stage | verdict | reason | detail |
|---------------|-------|-------|---------|--------|--------|
| 2026-08-23 03:01:09 Istanbul | 5 | ai | COMPLETED |  |  |
| 2026-08-23 03:01:09 Istanbul | 5 | scanner | REJECTED | REJECTED | REJECTED |
| 2026-08-23 03:01:10 Istanbul | 5 | ai | FAILED | AI_DEGRADED | AI_DEGRADED |
| 2026-08-23 03:01:12 Istanbul | 5 | ev | WAIT | EV_WAIT |  |
| 2026-08-23 03:01:12 Istanbul | 5 | consensus |  |  | regime=LOW_VOLATILITY_CALM, tech=48.27, sentiment=43.01, ris |
| 2026-08-23 03:01:12 Istanbul | 5 | consensus | REJECTED | CONSENSUS_REJECT | regime=LOW_VOLATILITY_CALM, tech=48.27, sentiment=43.01, ris |
| 2026-08-23 03:12:51 Istanbul | 6 | scanner | REJECTED | REJECTED | REJECTED |
| 2026-08-23 03:12:54 Istanbul | 6 | ai | FAILED | AI_DEGRADED | AI_DEGRADED |
| 2026-08-23 03:12:54 Istanbul | 6 | consensus |  |  | regime=LOW_VOLATILITY_CALM, tech=40.14, sentiment=43.01, ris |
| 2026-08-23 03:12:54 Istanbul | 6 | ev | WAIT | EV_WAIT |  |
| 2026-08-23 03:12:54 Istanbul | 6 | consensus | REJECTED | CONSENSUS_REJECT | regime=LOW_VOLATILITY_CALM, tech=40.14, sentiment=43.01, ris |
| 2026-08-23 03:16:20 Istanbul | 6 | ai | FAILED | AI_DEGRADED | AI_DEGRADED |
| 2026-08-23 03:16:20 Istanbul | 6 | ev | REJECTED | EV_REJECT |  |
| 2026-08-23 03:16:20 Istanbul | 6 | consensus |  |  | regime=RANGE_SIDEWAYS, tech=48.09, sentiment=51.19, risk=61. |
| 2026-08-23 03:16:20 Istanbul | 6 | consensus | REJECTED | CONSENSUS_REJECT | regime=RANGE_SIDEWAYS, tech=48.09, sentiment=51.19, risk=61. |
| 2026-08-23 03:21:57 Istanbul | 6 | ai | COMPLETED |  |  |
| 2026-08-23 03:21:57 Istanbul | 6 | scanner | REJECTED | REJECTED | REJECTED |
| 2026-08-23 03:22:00 Istanbul | 6 | ai | FAILED | AI_DEGRADED | AI_DEGRADED |
| 2026-08-23 03:22:00 Istanbul | 6 | ev | REJECTED | EV_REJECT |  |
| 2026-08-23 03:22:00 Istanbul | 6 | consensus |  |  | regime=RANGE_SIDEWAYS, tech=56.81, sentiment=47.01, risk=59. |
| 2026-08-23 03:22:00 Istanbul | 6 | consensus | REJECTED | CONSENSUS_REJECT | regime=RANGE_SIDEWAYS, tech=56.81, sentiment=47.01, risk=59. |
| 2026-08-23 03:37:14 Istanbul | 8 | ai | COMPLETED |  |  |
| 2026-08-23 03:37:14 Istanbul | 8 | scanner | REJECTED | REJECTED | REJECTED |
| 2026-08-23 03:37:25 Istanbul | 8 | ai | FAILED | AI_DEGRADED | AI_DEGRADED |
| 2026-08-23 03:37:25 Istanbul | 8 | ev | WAIT | EV_WAIT |  |
| 2026-08-23 03:37:25 Istanbul | 8 | consensus |  |  | regime=LOW_VOLATILITY_CALM, tech=59.04, sentiment=47.01, ris |
| 2026-08-23 03:37:25 Istanbul | 8 | consensus | REJECTED | CONSENSUS_REJECT | regime=LOW_VOLATILITY_CALM, tech=59.04, sentiment=47.01, ris |
| 2026-08-23 03:44:46 Istanbul | 9 | ai | COMPLETED |  |  |
| 2026-08-23 03:45:04 Istanbul | 9 | ai | FAILED | AI_DEGRADED | AI timeout (provider-3:risk#0) |
| 2026-08-23 03:45:07 Istanbul | 9 | ev | REJECTED | EV_REJECT |  |
| 2026-08-23 03:45:08 Istanbul | 9 | consensus |  |  | regime=LOW_VOLATILITY_CALM, tech=41.48, sentiment=47.00, ris |
| 2026-08-23 03:45:08 Istanbul | 9 | consensus | REJECTED | CONSENSUS_REJECT | regime=LOW_VOLATILITY_CALM, tech=41.48, sentiment=47.00, ris |
| 2026-08-23 03:45:27 Istanbul | 9 | ai | FAILED | AI_FAILED | 
Invalid `prisma.decisionTimelineEvent.deleteMany()` invocat |
| 2026-08-23 03:55:40 Istanbul | 10 | ai | COMPLETED |  |  |
| 2026-08-23 03:55:40 Istanbul | 10 | scanner | REJECTED | REJECTED | REJECTED |
| 2026-08-23 03:55:41 Istanbul | 10 | ai | FAILED | AI_DEGRADED | AI_DEGRADED |
| 2026-08-23 03:55:43 Istanbul | 10 | ev | WAIT | EV_WAIT |  |
| 2026-08-23 03:55:43 Istanbul | 10 | consensus |  |  | regime=RANGE_SIDEWAYS, tech=74.83, sentiment=59.29, risk=67. |
| 2026-08-23 03:55:43 Istanbul | 10 | consensus | REJECTED | CONSENSUS_REJECT | regime=RANGE_SIDEWAYS, tech=74.83, sentiment=59.29, risk=67. |


### PART 5 — TDI Analysis

**2026-08-22T23:19:24.003Z** — verdict=REJECTED hybrid=NO_TRADE
- technical=41.09 momentum=0 shortMom=0 shortFlow=0
- sentiment=47.01 confidence=31.31 execution=53.34 bullish=1
- firstBlocking=TECHNICAL blocks=[TECHNICAL, MOMENTUM]
- regime context: Volatilite dusuk (vol=0.260 momentum=-0.01). Stability=NEW_REGIME, transition=19.93.
- reason: No-trade mode: Teknik setup zayif | Momentum guven vermiyor

**2026-08-22T23:19:25.034Z** — verdict=REJECTED hybrid=NO_TRADE
- technical=41.09 momentum=36.93 shortMom=0 shortFlow=0
- sentiment=47.01 confidence=20.89 execution=93.94 bullish=5
- firstBlocking=LEARNING blocks=[LEARNING, MOMENTUM]
- regime context: Volatilite dusuk (vol=0.260 momentum=-0.01). Stability=NEW_REGIME, transition=19.93.
- reason: NO_TRADE resolved by master decision engine. Overall confidence 22. Supported by RISK and EXECUTION. Blocked/reduced by LEARNING and MOMENTUM. Risk acceptable.

**2026-08-22T23:26:33.765Z** — verdict=REJECTED hybrid=NO_TRADE
- technical=22.88 momentum=0.28 shortMom=0.01 shortFlow=-0.1967
- sentiment=55.78 confidence=31.05 execution=48.23 bullish=0
- firstBlocking=TECHNICAL blocks=[TECHNICAL, RISK]
- regime context: Volatilite dusuk (vol=0.195 momentum=-0.13).
- reason: No-trade mode: Teknik setup zayif | Haber/sentiment karmasik | Wick spike tespit edildi (WAIT) | Fake breakout riski yuksek | Futures trap riski: LATE_LONG_TRAP

**2026-08-22T23:26:33.989Z** — verdict=REJECTED hybrid=NO_TRADE
- technical=22.88 momentum=35.86 shortMom=0.01 shortFlow=-0.1967
- sentiment=55.78 confidence=18.65 execution=89.94 bullish=4
- firstBlocking=LEARNING blocks=[LEARNING, MOMENTUM]
- regime context: Volatilite dusuk (vol=0.195 momentum=-0.13).
- reason: NO_TRADE resolved by master decision engine. Overall confidence 18. Supported by EXECUTION and LIQUIDITY. Blocked/reduced by LEARNING and MOMENTUM. Risk remains elevated.

**2026-08-22T23:29:01.287Z** — verdict=REJECTED hybrid=NO_TRADE
- technical=53.62 momentum=0 shortMom=0 shortFlow=0
- sentiment=43.01 confidence=34.52 execution=48.93 bullish=1
- firstBlocking=MOMENTUM blocks=[MOMENTUM]
- regime context: Volatilite dusuk (vol=0.188 momentum=-0.15).
- reason: No-trade mode: Momentum guven vermiyor

### PART 6 — SIM_TIGHT_FILTER

Not evaluated for these symbols in the analyzed window occurrences.

### PART 7 — AI Trace

- 2026-08-23T00:01:09.288Z:  / COMPLETED (round 5) — 
- 2026-08-23T00:01:10.675Z: AI_DEGRADED / FAILED (round 5) — AI_DEGRADED
- 2026-08-23T00:12:54.885Z: AI_DEGRADED / FAILED (round 6) — AI_DEGRADED
- 2026-08-23T00:16:20.143Z: AI_DEGRADED / FAILED (round 6) — AI_DEGRADED
- 2026-08-23T00:21:57.720Z:  / COMPLETED (round 6) — 
- 2026-08-23T00:22:00.343Z: AI_DEGRADED / FAILED (round 6) — AI_DEGRADED
- 2026-08-23T00:37:14.051Z:  / COMPLETED (round 8) — 
- 2026-08-23T00:37:25.279Z: AI_DEGRADED / FAILED (round 8) — AI_DEGRADED
- 2026-08-23T00:44:46.825Z:  / COMPLETED (round 9) — 
- 2026-08-23T00:45:04.807Z: AI_DEGRADED / FAILED (round 9) — AI timeout (provider-3:risk#0)
- 2026-08-23T00:45:27.489Z: AI_FAILED / FAILED (round 9) — 
Invalid `prisma.decisionTimelineEvent.deleteMany()` invocation:


Transaction A
- 2026-08-23T00:55:40.154Z:  / COMPLETED (round 10) — 
- 2026-08-23T00:55:41.106Z: AI_DEGRADED / FAILED (round 10) — AI_DEGRADED

**AI classification:** AI_DEGRADED on degraded evaluation path (not final VETO on selected symbol in window).

### PART 8 — EV / Edge

- 2026-08-23T00:01:12.588Z: WAIT EV_WAIT (round 5)
- 2026-08-23T00:12:54.905Z: WAIT EV_WAIT (round 6)
- 2026-08-23T00:16:20.163Z: REJECTED EV_REJECT (round 6)
- 2026-08-23T00:22:00.481Z: REJECTED EV_REJECT (round 6)
- 2026-08-23T00:37:25.313Z: WAIT EV_WAIT (round 8)
- 2026-08-23T00:45:07.685Z: REJECTED EV_REJECT (round 9)
- 2026-08-23T00:55:43.725Z: WAIT EV_WAIT (round 10)

### PART 9 — Throughput / Latency

**Classification:** NO_LATENCY_EVIDENCE

### PART 10 — Classification

**Primary:** B) DISCOVERED_BUT_SCANNER_REJECTED
**Secondary:** Downstream AI_DEGRADED on parallel/degraded path

### PART 11 — Counterfactual Timing

Forward returns: **UNKNOWN** (no price series in repo).

### PART 12 — Historical Opportunity Value

maxFavorableMove / maxAdverseMove: **UNKNOWN**
discoveredBeforeMove: **UNKNOWN**

---

## PART 13 — Three-Coin Comparison

See kripto-three-coin-comparison.csv.

**MOST_CLEAR_MISSED_OPPORTUNITY:** UNKNOWN (no price outcome labels)
**MOST_LIKELY_LEGITIMATE_REJECTION:** PUMP/TRY and STX/TRY (scanner + consensus rejects with weak composite/momentum signals in artifacts)
**MOST_LIKELY_SCANNER_MISS:** UNKNOWN

## PART 14 — Broader System Question

Evidence from 3 coins in a **partial window** (runtime stopped ~04:22 Istanbul):

- Heavy **scanner-level rejection** (SPREAD_TOO_WIDE for ZRO, generic REJECTED for STX/PUMP)
- Parallel **AI_DEGRADED** on candidates that still entered AI evaluation path
- **CONSENSUS_REJECT** / **EV_REJECT** / **EV_WAIT** downstream
- **No TDI approval** path to execution for these symbols in window

**Label:** MIXED + INSUFFICIENT_SAMPLE (3 symbols, ~1.4h runtime overlap, no OHLCV)

## PART 15 — No Policy Changes

This report identifies failure mechanisms only. No threshold, VETO, or strategy changes recommended.

## FINAL VERDICT

```
ZRO_CLASSIFICATION = B) DISCOVERED_BUT_SCANNER_REJECTED
ZRO_DISCOVERED_BEFORE_MOVE = UNKNOWN
ZRO_FIRST_BLOCKER = scanner | SPREAD_TOO_WIDE | SPREAD_TOO_WIDE
ZRO_FORWARD_60M = UNKNOWN

STX_CLASSIFICATION = B) DISCOVERED_BUT_SCANNER_REJECTED
STX_DISCOVERED_BEFORE_MOVE = UNKNOWN
STX_FIRST_BLOCKER = scanner | REJECTED | REJECTED
STX_FORWARD_60M = UNKNOWN

PUMP_CLASSIFICATION = B) DISCOVERED_BUT_SCANNER_REJECTED
PUMP_DISCOVERED_BEFORE_MOVE = UNKNOWN
PUMP_FIRST_BLOCKER = scanner | REJECTED | REJECTED
PUMP_FORWARD_60M = UNKNOWN

MOST_LIKELY_SYSTEM_PROBLEM = MIXED
EVIDENCE_CONFIDENCE = MEDIUM
PRODUCTION_CHANGE_RECOMMENDED = NO
NEXT_STEP = Obtain OHLCV for 2026-08-23 03:00-10:00 Istanbul for outcome labeling; re-run forensics on full window; investigate scanner SPREAD_TOO_WIDE vs REJECTED reason granularity for ZRO/STX/PUMP
```
